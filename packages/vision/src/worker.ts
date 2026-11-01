/// <reference lib="webworker" />
import { createModelSession, runtimeDiagnostics, Tensor, type ModelSession } from './runtime';
import { fullArtProfile } from './full-art';
import { RecognitionPipeline } from './pipeline';
import { decodeIndex } from './index-format';
import { validateIndexProfile } from './profile';
import type { GameProfile, IndexMeta, RecognizeOptions } from './types';
import type { RGBAImage } from './pixels';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let pipeline: RecognitionPipeline | undefined;
let sessions: ModelSession[] = [];
async function checkedJson(url: string): Promise<IndexMeta> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}. Build the index first.`);
  return response.json();
}
async function initialize(profile: GameProfile, backend: 'auto' | 'wasm', runtimeBase: string) {
  try {
    const meta = await checkedJson(profile.metaUrl);
    validateIndexProfile(meta, profile);
    const response = await fetch(profile.indexUrl);
    if (!response.ok) throw new Error(`Cannot load index: HTTP ${response.status}`);
    const index = decodeIndex(await response.arrayBuffer(), meta);
    // Sequential session creation avoids simultaneous WASM runtime initialization.
    const detector = await createModelSession(profile.detector.url, profile.detector.sha256, backend, runtimeBase); sessions.push(detector);
    const embedder = await createModelSession(profile.embedding.url, profile.embedding.sha256, backend, runtimeBase); sessions.push(embedder);
    let fullArtIndex;
    if(profile.fullArtIndex) {
      const reply=await fetch(profile.fullArtIndex.metaUrl);
      if(reply.ok) {
        const fullMeta=await reply.json() as IndexMeta;
        validateIndexProfile(fullMeta,fullArtProfile(profile));
        const binary=await fetch(profile.fullArtIndex.indexUrl);
        if(!binary.ok) throw new Error('Cannot load full-art index');
        fullArtIndex=decodeIndex(await binary.arrayBuffer(),fullMeta);
      } else if(reply.status!==404) throw new Error('Cannot load full-art metadata');
    }
    pipeline = new RecognitionPipeline(profile, index, detector, embedder, Tensor, fullArtIndex);
  } catch (error) {
    await Promise.allSettled(sessions.map(s => s.release())); sessions = []; throw error;
  }
}
function pixels(frame: ImageBitmap | ImageData): RGBAImage {
  if ('close' in frame) {
    try {
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('OffscreenCanvas 2D is unavailable');
      context.drawImage(frame, 0, 0);
      return context.getImageData(0, 0, frame.width, frame.height);
    } finally { frame.close(); }
  }
  return frame;
}
type Request = { id: number; type: 'init'; profile: GameProfile; backend: 'auto' | 'wasm'; runtimeBase: string } | { id: number; type: 'detect'; frame: ImageBitmap | ImageData } | { id: number; type: 'recognize'; frames: (ImageBitmap | ImageData)[]; opts?: RecognizeOptions };
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  // The ONNX sessions are never run concurrently. Failed requests do not poison the queue.
  queue = queue.then(async () => {
    try {
      if (message.type === 'init') { await initialize(message.profile, message.backend, message.runtimeBase); scope.postMessage({ id: message.id, result: null }); }
      else {
        if (!pipeline) throw new Error('Recognizer has not initialized');
        if(message.type==='detect') { scope.postMessage({id:message.id,result:await pipeline.detectCards(pixels(message.frame))});return; }
        const images: RGBAImage[] = [];
        try { for (const frame of message.frames) images.push(pixels(frame)); }
        finally { for (const frame of message.frames) if ('close' in frame) frame.close(); }
        const result = await pipeline.recognize(images, message.opts);
        const {warpedCard,...publicResult}=result;
        if(warpedCard) {
          const canvas=new OffscreenCanvas(warpedCard.width,warpedCard.height),ctx=canvas.getContext('2d')!;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(warpedCard.data),warpedCard.width,warpedCard.height),0,0);
          const bytes=new Uint8Array(await (await canvas.convertToBlob({type:'image/jpeg',quality:.75})).arrayBuffer());
          let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
          publicResult.cropJpeg=btoa(binary);
        }
        scope.postMessage({ id: message.id, result: { ...publicResult, runtime: runtimeDiagnostics() } });
      }
    } catch (error) { scope.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};

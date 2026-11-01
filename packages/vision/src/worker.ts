/// <reference lib="webworker" />
import { createModelSession, runtimeDiagnostics, Tensor, type ModelSession } from './runtime';
import { fullArtProfile } from './full-art';
import { RecognitionPipeline } from './pipeline';
import { emptyLearning, indexVersion, type LearningSnapshot } from './learning';
import { decodeIndex } from './index-format';
import { validateIndexProfile } from './profile';
import type { GameProfile, LoadedIndex, IndexMeta, RecognizeOptions, PeekOptions, ReadAllOptions } from './types';
import type { RGBAImage } from './pixels';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let pipeline: RecognitionPipeline | undefined;
let sessions: ModelSession[] = [];
let refreshLearning:()=>Promise<void>=async()=>{};
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
    let fullArtIndex:LoadedIndex|undefined;
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
    refreshLearning=async()=>{
      // Fail closed: a failed refresh cannot resurrect deleted/rejected references.
      pipeline!.setLearning(emptyLearning());
      try {
        const response=await fetch('/api/remote-vision/learning',{cache:'no-store',signal:AbortSignal.timeout(1500)});
        if(!response.ok)return;
        const raw=await response.json();
        const compatible=(r:any)=>[index,fullArtIndex].some(i=>i && r.gameId===profile.id && r.modelId===profile.embedding.id && r.modelSha256===profile.embedding.sha256 && r.layoutKey===i.meta.layoutKey && r.indexVersion===indexVersion(i.meta) && r.space===(i===fullArtIndex?'whole-card':'art-box'));
        const value:LearningSnapshot={version:String(raw.version),references:raw.references.filter(compatible).slice(0,512).map((r:any)=>({cardId:r.chosenCardId,embedding:r.embedding,space:r.space})),confusions:raw.confusions.filter(compatible).slice(0,256)};
        pipeline!.setLearning(value);
      }catch{/* Local recognition remains available without collection or a session. */}
    };
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
type Request = { id: number; type: 'init'; profile: GameProfile; backend: 'auto' | 'wasm'; runtimeBase: string } | { id: number; type: 'detect'; frame: ImageBitmap | ImageData } | { id: number; type: 'recognize'; frames: (ImageBitmap | ImageData)[]; opts?: RecognizeOptions } | {id:number;type:'peek';frame:ImageBitmap|ImageData;opts:PeekOptions} | {id:number;type:'readAll';frame:ImageBitmap|ImageData;opts:ReadAllOptions};
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  // The ONNX sessions are never run concurrently. Failed requests do not poison the queue.
  queue = queue.then(async () => {
    try {
      if (message.type === 'init') { await initialize(message.profile, message.backend, message.runtimeBase); scope.postMessage({ id: message.id, result: null }); }
      else {
        if (!pipeline) throw new Error('Recognizer has not initialized');
        if(message.type!=='detect') await refreshLearning();
        if(message.type==='detect') { scope.postMessage({id:message.id,result:await pipeline.detectCards(pixels(message.frame))});return; }
        if(message.type==='peek') {scope.postMessage({id:message.id,result:await pipeline.peek(pixels(message.frame),message.opts)});return;}
        if(message.type==='readAll') {scope.postMessage({id:message.id,result:await pipeline.readAll(pixels(message.frame),message.opts)});return;}
        const images: RGBAImage[] = [];
        try { for (const frame of message.frames) images.push(pixels(frame)); }
        finally { for (const frame of message.frames) if ('close' in frame) frame.close(); }
        const result = await pipeline.recognize(images, message.opts);
        const {warpedCard,...publicResult}=result;
        if(warpedCard) {
          const canvas=new OffscreenCanvas(warpedCard.width,warpedCard.height),ctx=canvas.getContext('2d')!;
          ctx.putImageData(new ImageData(new Uint8ClampedArray(warpedCard.data),warpedCard.width,warpedCard.height),0,0);
          const small=new OffscreenCanvas(224,Math.round(224*warpedCard.height/warpedCard.width));
          small.getContext('2d')!.drawImage(canvas,0,0,small.width,small.height);
          const bytes=new Uint8Array(await (await small.convertToBlob({type:'image/jpeg',quality:.72})).arrayBuffer());
          let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
          publicResult.cropJpeg=btoa(binary);
        }
        scope.postMessage({ id: message.id, result: { ...publicResult, runtime: runtimeDiagnostics() } });
      }
    } catch (error) { scope.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};

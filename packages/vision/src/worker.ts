/// <reference lib="webworker" />
import { createModelSession, runtimeDiagnostics, Tensor, type ModelSession } from './runtime';
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
    pipeline = new RecognitionPipeline(profile, index, detector, embedder, Tensor);
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
type Request = { id: number; type: 'init'; profile: GameProfile; backend: 'auto' | 'wasm'; runtimeBase: string } | { id: number; type: 'recognize'; frames: (ImageBitmap | ImageData)[]; opts?: RecognizeOptions } | { id: number; type: 'detect'; frame: ImageBitmap | ImageData };
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  // The ONNX sessions are never run concurrently. Failed requests do not poison the queue.
  queue = queue.then(async () => {
    try {
      if (message.type === 'init') { await initialize(message.profile, message.backend, message.runtimeBase); scope.postMessage({ id: message.id, result: null }); }
      else if (message.type === 'detect') {
        if (!pipeline) throw new Error('Recognizer has not initialized');
        const image = (() => { try { return pixels(message.frame); } finally { if ('close' in message.frame) message.frame.close(); } })();
        const start = performance.now();
        const cards = await pipeline.detectCards(image);
        scope.postMessage({ id: message.id, result: { cards, width: image.width, height: image.height, timingMs: performance.now() - start, backend: sessions[0]?.backend ?? 'wasm' } });
      } else {
        if (!pipeline) throw new Error('Recognizer has not initialized');
        const images: RGBAImage[] = [];
        try { for (const frame of message.frames) images.push(pixels(frame)); }
        finally { for (const frame of message.frames) if ('close' in frame) frame.close(); }
        const result = await pipeline.recognize(images, message.opts);
        scope.postMessage({ id: message.id, result: { ...result, runtime: runtimeDiagnostics() } });
      }
    } catch (error) { scope.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
  });
};

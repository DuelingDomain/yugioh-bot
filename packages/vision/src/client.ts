import { yugioh } from './games/yugioh';
import { validateOptions } from './options';
import type { GameProfile, RecognitionResult, RecognizeOptions } from './types';
export interface RecognizerConfig { profile?: GameProfile; backend?: 'auto' | 'wasm'; workerUrl?: string; runtimeBase?: string }
export interface Recognizer {
  /** ImageBitmaps transfer to the worker and are consumed. ImageData is copied. Up to 12 frames. */
  recognize(frames: ImageBitmap[] | ImageData[], opts?: RecognizeOptions): Promise<RecognitionResult>;
  dispose(): void;
}
export function createRecognizer(config: RecognizerConfig = {}): Recognizer {
  let worker: Worker | undefined, disposed = false, serial = 0, initial: Promise<unknown> | undefined;
  let inFlight = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const failAll = (error: Error) => { for (const value of pending.values()) value.reject(error); pending.clear(); };
  function request(message: object, transfers: Transferable[] = []): Promise<unknown> {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { worker!.postMessage({ ...message, id }, transfers); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  function initialize() {
    if (!initial) {
      worker = new Worker(config.workerUrl ?? '/dev/vision-assets/worker.js', { type: 'module', name: 'card-recognition' });
      worker.onmessage = event => {
        const { id, result, error } = event.data;
        const value = pending.get(id); if (!value) return; pending.delete(id);
        if (error) value.reject(new Error(error)); else value.resolve(result);
      };
      worker.onerror = event => { failAll(new Error(event.message || 'Recognition worker failed')); worker?.terminate(); worker = undefined; initial = undefined; };
      worker.onmessageerror = () => failAll(new Error('Recognition worker message failed'));
      initial = request({ type: 'init', profile: config.profile ?? yugioh, backend: config.backend ?? 'auto', runtimeBase: config.runtimeBase ?? '/dev/vision-assets/ort/' }).catch(error => { worker?.terminate(); worker = undefined; initial = undefined; throw error; });
    }
    return initial;
  }
  return {
    async recognize(frames, opts = {}) {
      if (disposed) throw new Error('Recognizer is disposed');
      validateOptions(opts);
      if (!frames.length || frames.length > 12 || frames.some(f => f.width < 3 || f.height < 3 || f.width * f.height > 16_000_000)) throw new Error('Supply 1–12 frames, each 3 pixels to 16 MP');
      if (inFlight) throw new Error('Recognition is already in progress');
      inFlight = true;
      try {
        await initialize();
        if (disposed) throw new Error('Recognizer is disposed');
        const bitmaps = frames.filter(f => typeof ImageBitmap !== 'undefined' && f instanceof ImageBitmap);
        return await request({ type: 'recognize', frames, opts }, bitmaps) as RecognitionResult;
      } finally { inFlight = false; }
    },
    dispose() { disposed = true; worker?.terminate(); worker = undefined; failAll(new Error('Recognizer disposed')); },
  };
}

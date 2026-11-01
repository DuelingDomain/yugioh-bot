import { pipeline, env } from '@huggingface/transformers';
import { CardMatcher } from './matcher.js';

let model, matcher, info;
self.onmessage = async ({ data: { id, type, ...data } }) => {
  try {
    let result;
    if (type === 'load') {
      if (model) throw new Error('Model already loaded');
      const started = performance.now();
      // Route all model requests to the caller's explicit static asset host.
      env.allowRemoteModels = true;
      env.allowLocalModels = false;
      const assetBase = new URL(data.base);
      env.remoteHost = assetBase.origin;
      env.remotePathTemplate = assetBase.pathname.replace(/^\/|\/$/g, '');
      env.useBrowserCache = false;
      env.useWasmCache = false;
      env.backends.onnx.wasm.wasmPaths = {
        mjs: new URL('./ort-tiny/ort-wasm-simd-threaded.asyncify.mjs', self.location.href).href,
        wasm: new URL('./ort-tiny/ort-wasm-simd-threaded.asyncify.wasm', self.location.href).href,
      };
      env.backends.onnx.wasm.numThreads = self.crossOriginIsolated ? data.threads : 1;
      const rows = data.cards ?? await fetch(data.catalogUrl).then(r => { if (!r.ok) throw new Error(`Catalog HTTP ${r.status}`); return r.json(); });
      matcher = new CardMatcher(rows.data ?? rows);
      const sessionStart = performance.now();
      model = await pipeline('automatic-speech-recognition', 'whisper-tiny.en', { device: 'wasm', dtype: 'q8' });
      info = { model: 'whisper-tiny.en-int8', backend: 'wasm', threads: env.backends.onnx.wasm.numThreads,
        crossOriginIsolated: self.crossOriginIsolated, requestedEncoderProvider: 'wasm', decoderProvider: 'wasm',
        loadMs: performance.now() - started, sessionMs: performance.now() - sessionStart,
        catalogCount: rows.data?.length ?? rows.length };
      result = info;
    } else if (type === 'transcribe') {
      if (!model) throw new Error('Call start() before transcription');
      const started = performance.now();
      const speechDetected = data.pcm.some(x => Math.abs(x) > 0.00001);
      const decoded = speechDetected ? await model(data.pcm, { return_timestamps: false }) : null;
      const decodeMs = performance.now() - started;
      const matching = performance.now();
      const transcript = decoded?.text?.trim() ?? '';
      result = { ...matcher.match(transcript, data.hotwords), transcript, model: info.model, backend: 'wasm',
        durationMs: data.pcm.length / 16, speechDetected, decodeMs, matchMs: performance.now() - matching };
    } else throw new Error(`Unknown message ${type}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.stack || String(error) });
  }
};

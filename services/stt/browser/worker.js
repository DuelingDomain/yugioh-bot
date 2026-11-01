import * as ort from 'onnxruntime-web';
import { fromUrls } from 'parakeet.js';
import { CardMatcher } from './matcher.js';

let model, matcher, info;
self.onmessage = async ({ data: { id, type, ...data } }) => {
  try {
    let result;
    if (type === 'load') {
      if (model) throw new Error('Model already loaded');
      const started = performance.now();
      let adapter = null;
      if (data.backend === 'webgpu') {
        adapter = await navigator.gpu?.requestAdapter();
        if (!adapter) throw new Error('WebGPU adapter unavailable; explicitly select wasm');
        ort.env.webgpu.adapter = adapter;
      }
      ort.env.wasm.wasmPaths = new URL('./ort/', self.location.href).href;
      ort.env.wasm.numThreads = self.crossOriginIsolated ? data.threads : 1;
      const rows = data.cards ?? await fetch(data.catalogUrl).then(r => { if (!r.ok) throw new Error(`Catalog HTTP ${r.status}`); return r.json(); });
      matcher = new CardMatcher(rows.data ?? rows);
      const sessionStart = performance.now();
      model = await fromUrls({
        encoderUrl: `${data.base}encoder-model.int8.onnx`,
        decoderUrl: `${data.base}decoder_joint-model.int8.onnx`,
        tokenizerUrl: `${data.base}vocab.txt`,
        // Select WebGPU explicitly; ORT can still place unsupported nodes on CPU.
        // Do not use the hub loader: it silently upgrades int8 to fp32 on WebGPU.
        backend: data.backend === 'webgpu' ? 'webgpu-strict' : 'wasm',
        preprocessorBackend: 'js', nMels: 128, cpuThreads: data.threads,
      });
      info = {
        model: 'parakeet-tdt-0.6b-v3-int8', backend: data.backend,
        requestedEncoderProvider: data.backend, decoderProvider: 'wasm',
        encoderOperatorPlacement: data.backend === 'webgpu' ? 'WebGPU EP selected; unsupported nodes may use CPU; placement not profiled' : 'WASM CPU',
        threads: ort.env.wasm.numThreads, crossOriginIsolated: self.crossOriginIsolated,
        adapter: adapter ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null } : null,
        loadMs: performance.now() - started, sessionMs: performance.now() - sessionStart,
        catalogCount: rows.data?.length ?? rows.length,
      };
      result = info;
    } else if (type === 'transcribe') {
      if (!model) throw new Error('Call start() before transcription');
      const started = performance.now();
      const speechDetected = data.pcm.some(x => Math.abs(x) > 0.00001);
      const decoded = speechDetected ? await model.transcribe(data.pcm, 16000, { returnTimestamps: false, returnConfidences: false }) : null;
      const decodeMs = performance.now() - started;
      const matching = performance.now();
      const transcript = decoded?.utterance_text ?? '';
      result = { ...matcher.match(transcript, data.hotwords), transcript, model: info.model, backend: info.backend,
        durationMs: data.pcm.length / 16, speechDetected, decodeMs, matchMs: performance.now() - matching };
    } else throw new Error(`Unknown message ${type}`);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: error.stack || String(error) });
  }
};

/** Browser-only push-to-talk. Caller supplies mono 16 kHz Float32 PCM and mic UI. */
export function createBrowserSTT({
  backend = 'wasm', modelBaseUrl = new URL('./models/', import.meta.url).href,
  catalogUrl, cards, threads = 4, maxSeconds = 15,
} = {}) {
  if (!['wasm', 'webgpu'].includes(backend)) throw new Error('backend must be wasm or webgpu');
  if (!Number.isInteger(threads) || threads < 1 || threads > 16) throw new Error('threads must be 1..16');
  if (!(maxSeconds > 0 && maxSeconds <= 15)) throw new Error('maxSeconds must be >0 and <=15');
  const base = new URL(modelBaseUrl, globalThis.location.href).href.replace(/\/?$/, '/');
  const worker = new Worker(new URL(`./worker-${backend}.js`, import.meta.url), { type: 'module' });
  const pending = new Map();
  let sequence = 0, state = 'idle', loaded, chunks = [], length = 0, hotwords = [];
  function fail(error) {
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  }
  worker.onmessage = ({ data }) => {
    const request = pending.get(data.id);
    if (!request) return;
    pending.delete(data.id);
    if (data.error) request.reject(new Error(data.error));
    else request.resolve(data.result);
  };
  worker.onerror = event => { state = 'failed'; fail(new Error(event.message || 'STT worker failed')); };
  worker.onmessageerror = () => { state = 'failed'; fail(new Error('STT worker message could not be decoded')); };
  function call(type, payload, transfer = []) {
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ id, type, ...payload }, transfer); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  return {
    async start({ hotwords: hints = [] } = {}) {
      if (state !== 'idle') throw new Error(`Cannot start while ${state}`);
      if (!Array.isArray(hints) || hints.length > 256 || hints.some(w => typeof w !== 'string' || w.length > 120)) throw new Error('hotwords: at most 256 names, each <=120 characters');
      state = 'loading';
      try {
        loaded ??= call('load', { backend, base, cards, catalogUrl: catalogUrl ? new URL(catalogUrl, globalThis.location.href).href : `${base}cards.json`, threads });
        const info = await loaded;
        if (state === 'disposed') throw new Error('STT disposed');
        chunks = []; length = 0;
        hotwords = [...new Set(hints)];
        state = 'recording';
        return info;
      } catch (error) {
        // A failed session can retain partially initialized native allocations.
        // Reclaim the entire worker; create a new instance to retry.
        worker.terminate();
        if (state !== 'disposed') state = 'failed';
        fail(error);
        throw error;
      }
    },
    pushAudio(pcm) {
      if (state !== 'recording') throw new Error(`Cannot push audio while ${state}`);
      if (!(pcm instanceof Float32Array) || !pcm.length || pcm.some(x => !Number.isFinite(x) || Math.abs(x) > 1)) throw new Error('Expected nonempty Float32Array mono PCM in [-1,1] at 16000 Hz');
      if (length + pcm.length > 16000 * maxSeconds) throw new Error(`Utterance exceeds ${maxSeconds} seconds; stop or cancel`);
      // Copy: AudioWorklet/capture code may reuse its input buffers.
      chunks.push(pcm.slice()); length += pcm.length;
    },
    async stop() {
      if (state !== 'recording') throw new Error(`Cannot stop while ${state}`);
      state = 'decoding';
      const started = performance.now();
      const pcm = new Float32Array(length);
      let offset = 0;
      for (const chunk of chunks) { pcm.set(chunk, offset); offset += chunk.length; }
      chunks = []; length = 0;
      try {
        const result = await call('transcribe', { pcm, hotwords }, [pcm.buffer]);
        return { ...result, processingMs: performance.now() - started };
      } finally { if (state === 'decoding') state = 'idle'; }
    },
    cancel() {
      if (state !== 'recording') throw new Error(`Cannot cancel while ${state}`);
      chunks = []; length = 0; state = 'idle';
    },
    dispose() {
      state = 'disposed'; chunks = []; length = 0;
      worker.terminate(); fail(new Error('STT disposed'));
    },
  };
}

/**
 * Thin JS side of the KWS-only sherpa-onnx module (scripts/voice/build-kws-wasm.sh). The config structs are written into
 * the module heap by hand, the way upstream wasm/kws/sherpa-onnx-kws.js does for the pinned release (v2.0.1); the C++
 * side asserts the struct sizes at build time. Adapted from that file (Apache-2.0, k2-fsa/sherpa-onnx).
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Mod = any;

export type KwsOptions = {
  encoder: string; decoder: string; joiner: string; tokens: string;
  /** Used for a keyword line that has no `:boost` / `#threshold` of its own. */
  keywordsScore: number; keywordsThreshold: number;
  /** Keywords the spotter always carries (streams made with extra keywords add to these). */
  keywords: string;
};

const cstr = (m: Mod, text: string) => { const len = m.lengthBytesUTF8(text) + 1; const ptr = m._malloc(len); m.stringToUTF8(text, ptr, len); return ptr; };

function buildConfig(m: Mod, o: KwsOptions) {
  const strings = [o.encoder, o.decoder, o.joiner, o.tokens, "cpu", "", "", "", "", o.keywords].map(text => cstr(m, text));
  const [encoder, decoder, joiner, tokens, provider, modelType, modelingUnit, bpeVocab, tokensBuf, keywords] = strings;
  // SherpaOnnxKeywordSpotterConfig: feat(2 ints), model config, then 7 more fields (all 4 bytes on wasm32).
  const modelLen = 3 * 4 + 2 * 4 + 1 * 4 + 9 * 4 + 1 * 4 + 1 * 4;
  const len = 2 * 4 + modelLen + 7 * 4;
  const ptr = m._malloc(len); m.HEAPU8.fill(0, ptr, ptr + len);
  let at = ptr;
  const i32 = (v: number) => { m.setValue(at, v, "i32"); at += 4; };
  const f32 = (v: number) => { m.setValue(at, v, "float"); at += 4; };
  const p = (v: number) => { m.setValue(at, v, "i8*"); at += 4; };
  i32(16000); i32(80);                       // feature config
  p(encoder); p(decoder); p(joiner);         // transducer
  at += 2 * 4 + 1 * 4;                       // paraformer, zipformer2 ctc (unused, zeroed)
  p(tokens); i32(1); p(provider); i32(0);    // tokens, num_threads, provider, debug
  p(modelType); p(modelingUnit); p(bpeVocab); p(tokensBuf); i32(0);
  at += 1 * 4 + 1 * 4;                       // nemo ctc, t-one ctc (unused, zeroed)
  i32(4); i32(1); f32(o.keywordsScore); f32(o.keywordsThreshold); // max active paths, trailing blanks, score, threshold
  p(keywords); p(0); i32(0);                 // keywords_file (the wasm build reads it as text), keywords_buf, size
  return { ptr, strings };
}

export type KwsStream = { handle: number; free(): void; accept(samples: Float32Array): void };
export type KwsHit = { keyword: string; startTime: number; timestamps: number[]; tokens: string[] };

export function createKws(m: Mod, options: KwsOptions) {
  const config = buildConfig(m, options);
  const handle: number = m._SherpaOnnxCreateKeywordSpotter(config.ptr);
  for (const s of config.strings) m._free(s);
  m._free(config.ptr);
  if (!handle) throw new Error("Keyword spotter could not be created");
  let buffer = 0; let capacity = 0;

  const stream = (streamHandle: number): KwsStream => ({
    handle: streamHandle,
    free() { if (streamHandle) { m._SherpaOnnxDestroyOnlineStream(streamHandle); streamHandle = 0; } if (buffer) { m._free(buffer); buffer = 0; capacity = 0; } },
    accept(samples) {
      if (capacity < samples.length) { if (buffer) m._free(buffer); buffer = m._malloc(samples.length * 4); capacity = samples.length; }
      m.HEAPF32.set(samples, buffer / 4);
      m._SherpaOnnxOnlineStreamAcceptWaveform(streamHandle, 16000, buffer, samples.length);
    },
  });

  return {
    /** Lines `TOKENS :boost #threshold @tag` joined with "\n". Null when the spotter rejects a token. */
    createStream(keywords: string): KwsStream | null {
      const text = cstr(m, keywords);
      const h = m._SherpaOnnxCreateKeywordStreamWithKeywords(handle, text);
      m._free(text);
      return h ? stream(h) : null;
    },
    /** Decodes everything ready and returns the hits. A hit resets the stream. */
    run(s: KwsStream): KwsHit[] {
      const hits: KwsHit[] = [];
      while (m._SherpaOnnxIsKeywordStreamReady(handle, s.handle) === 1) {
        m._SherpaOnnxDecodeKeywordStream(handle, s.handle);
        const r = m._SherpaOnnxGetKeywordResult(handle, s.handle);
        const json = m.UTF8ToString(m.getValue(r + 24, "i8*"));
        m._SherpaOnnxDestroyKeywordResult(r);
        const parsed = JSON.parse(json) as { keyword?: string; start_time?: number; timestamps?: number[]; tokens?: string[] };
        if (parsed.keyword) { hits.push({ keyword: parsed.keyword, startTime: parsed.start_time ?? 0, timestamps: parsed.timestamps ?? [], tokens: parsed.tokens ?? [] }); m._SherpaOnnxResetKeywordStream(handle, s.handle); }
      }
      return hits;
    },
    /** Clears the audio state of a stream, keeping its keywords. */
    reset(s: KwsStream) { m._SherpaOnnxResetKeywordStream(handle, s.handle); },
    heapBytes: () => m.HEAPU8.length as number,
    free() { m._SherpaOnnxDestroyKeywordSpotter(handle); },
  };
}

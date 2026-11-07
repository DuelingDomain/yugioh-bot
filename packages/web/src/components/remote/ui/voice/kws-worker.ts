/**
 * Speech worker for the browser voice commands. It holds the KWS-only sherpa-onnx module and the int8 model, takes 16 kHz
 * mono frames, and answers with the tags of the phrases it heard. Audio never leaves this worker (no network use after
 * the model files are loaded). Bundled by scripts/voice/prepare.mts into data/vision/kws/worker.js.
 */
/// <reference lib="webworker" />
import { createKws, type KwsHit, type KwsStream } from "./kws-glue";

export type KwsWorkerIn =
  | { type: "init"; base: string; defaultKeywords: string; keywords: string; boost: number; threshold: number }
  | { type: "keywords"; keywords: string }
  | { type: "frames"; samples: Float32Array }
  | { type: "end"; id: number }
  | { type: "reset" };
export type KwsWorkerOut =
  | { type: "ready"; fetchMs: number; initMs: number; bytes: number; heapBytes: number; accepted: boolean }
  | { type: "keywords"; accepted: boolean }
  | { type: "utterance"; id: number; hits: KwsHit[]; busyMs: number; audioMs: number }
  | { type: "error"; message: string };

const MODEL = ["encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx", "tokens.txt"];
const post = (message: KwsWorkerOut) => (self as unknown as Worker).postMessage(message);
// Quiet tail so the last word of an utterance can complete (the spotter wants trailing blanks).
const TAIL = new Float32Array(16000 * 0.4);

let kws: ReturnType<typeof createKws> | undefined;
let stream: KwsStream | null = null;
let hits: KwsHit[] = [];
let busyMs = 0; let audioMs = 0;
let defaultKeywords = "";

function swap(keywords: string): boolean {
  const next = kws!.createStream(keywords);
  if (!next) return false;
  stream?.free(); stream = next; hits = [];
  return true;
}
function work(samples: Float32Array) {
  const started = performance.now();
  stream!.accept(samples);
  // No reset on a hit: a reset drops the word said right after it ("activate" + name, "main" + "two").
  hits.push(...kws!.run(stream!, false));
  busyMs += performance.now() - started; audioMs += samples.length / 16;
}

self.onmessage = async (event: MessageEvent<KwsWorkerIn>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const t0 = performance.now();
      const dir = `${message.base}model/`;
      const files = await Promise.all(MODEL.map(async name => {
        const response = await fetch(dir + name);
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      }));
      const glue = (await import(/* @vite-ignore */ `${message.base}sherpa-kws.js`)).default as (options: object) => Promise<unknown>;
      const module = await glue({ locateFile: (path: string) => path.endsWith(".wasm") ? `${message.base}sherpa-kws.wasm` : path }) as { FS: { mkdir(path: string): void; writeFile(path: string, data: Uint8Array): void } };
      const t1 = performance.now();
      module.FS.mkdir("/kws");
      MODEL.forEach((name, index) => module.FS.writeFile(`/kws/${name}`, files[index]));
      defaultKeywords = message.defaultKeywords;
      kws = createKws(module, {
        encoder: `/kws/${MODEL[0]}`, decoder: `/kws/${MODEL[1]}`, joiner: `/kws/${MODEL[2]}`, tokens: `/kws/${MODEL[3]}`,
        keywordsScore: message.boost, keywordsThreshold: message.threshold, keywords: defaultKeywords,
      });
      const accepted = swap(message.keywords);
      post({ type: "ready", fetchMs: t1 - t0, initMs: performance.now() - t1, bytes: files.reduce((sum, file) => sum + file.length, 0), heapBytes: kws.heapBytes(), accepted });
    } else if (!kws) {
      return;
    } else if (message.type === "keywords") {
      post({ type: "keywords", accepted: swap(message.keywords) });
    } else if (message.type === "frames") {
      if (stream) work(message.samples);
    } else if (message.type === "end") {
      if (stream) work(TAIL);
      post({ type: "utterance", id: message.id, hits, busyMs, audioMs });
      hits = []; busyMs = 0; audioMs = 0;
      if (stream) kws.reset(stream);
    } else if (message.type === "reset") {
      hits = []; busyMs = 0; audioMs = 0;
    }
  } catch (error) {
    post({ type: "error", message: (error as Error).message || String(error) });
  }
};

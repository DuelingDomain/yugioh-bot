/**
 * Speech-to-text worker for Method B of the voice check. Same messages as kws-worker.ts (init, frames, end, reset), so the
 * mic and the energy gate in kws-client.ts serve both. It runs Moonshine Tiny q8 on onnxruntime-web (WASM, SIMD, one thread,
 * no SharedArrayBuffer) once per gated utterance and answers with the text. Audio never leaves this worker.
 * Bundled by scripts/voice/prepare-asr.mts into data/vision/asr/worker.js.
 */
/// <reference lib="webworker" />
import * as ort from "onnxruntime-web/wasm";
import { Moonshine } from "./moonshine";

export type AsrWorkerIn =
  | { type: "init"; base: string }
  | { type: "keywords"; keywords: string }
  | { type: "frames"; samples: Float32Array }
  | { type: "end"; id: number }
  | { type: "reset" };
export type AsrWorkerOut =
  | { type: "ready"; fetchMs: number; initMs: number; bytes: number; heapBytes: number; accepted: boolean }
  | { type: "work"; busyMs: number; audioMs: number }
  | { type: "utterance"; id: number; hits: []; text: string; passes: number; busyMs: number; audioMs: number }
  | { type: "error"; message: string };

const post = (message: AsrWorkerOut) => (self as unknown as Worker).postMessage(message);
const rate = 16000;
// Moonshine drops very short words after a long silence: the first pass has 0.3 s of quiet in front and 0.4 s behind, and an
// empty answer gets one retry with tight padding (the bake-off settings).
const PASS_PAD = [[0.3, 0.4], [0.1, 0.1]] as const;

let model: Moonshine | undefined;
let chunks: Float32Array[] = [];

function padded(samples: Float32Array, lead: number, tail: number): Float32Array {
  const out = new Float32Array(Math.round(lead * rate) + samples.length + Math.round(tail * rate));
  out.set(samples, Math.round(lead * rate));
  return out;
}

self.onmessage = async (event: MessageEvent<AsrWorkerIn>) => {
  const message = event.data;
  try {
    if (message.type === "init") {
      const t0 = performance.now();
      const dir = `${message.base}model/`;
      const get = async (name: string) => {
        const response = await fetch(dir + name);
        if (!response.ok) throw new Error(`${name}: HTTP ${response.status}`);
        return new Uint8Array(await response.arrayBuffer());
      };
      const [encoder, decoder, vocabBytes] = await Promise.all([get("encoder_model_quantized.onnx"), get("decoder_model_merged_quantized.onnx"), get("vocab.json")]);
      const t1 = performance.now();
      ort.env.wasm.wasmPaths = message.base;
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.simd = true;
      ort.env.wasm.proxy = false;
      model = await Moonshine.create(ort, { encoder, decoder, vocab: JSON.parse(new TextDecoder().decode(vocabBytes)) as string[] });
      post({ type: "ready", fetchMs: t1 - t0, initMs: performance.now() - t1, bytes: encoder.length + decoder.length + vocabBytes.length, heapBytes: 0, accepted: true });
    } else if (!model) {
      return;
    } else if (message.type === "frames") {
      chunks.push(message.samples);
    } else if (message.type === "end") {
      const all = new Float32Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
      let at = 0; for (const chunk of chunks) { all.set(chunk, at); at += chunk.length; }
      chunks = [];
      const started = performance.now();
      let text = ""; let passes = 0;
      for (const [lead, tail] of PASS_PAD) {
        passes++;
        text = await model.transcribe(padded(all, lead, tail));
        if (text) break;
      }
      const busyMs = performance.now() - started; const audioMs = all.length / (rate / 1000);
      post({ type: "work", busyMs, audioMs });
      post({ type: "utterance", id: message.id, hits: [], text, passes, busyMs, audioMs });
    } else if (message.type === "reset") {
      chunks = [];
    }
  } catch (error) {
    post({ type: "error", message: (error as Error).message || String(error) });
  }
};

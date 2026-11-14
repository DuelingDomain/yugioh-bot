/**
 * Moonshine Tiny (q8 ONNX) speech to text on onnxruntime-web: the encoder runs once, then the merged decoder runs a greedy
 * loop with a key/value cache. Pure of browser APIs, so the same code runs in the speech worker and in a Node test.
 * Files come from onnx-community/moonshine-tiny-ONNX (MIT); see scripts/voice/prepare-asr.mts.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
type Ort = any;
type Tensor = any;

const LAYERS = 6; const HEADS = 8; const HEAD_DIM = 36; const START = 1; const END = 2;
/** Moonshine writes about 6 tokens per second of speech at most; the loop stops there so a loop of noise cannot run long. */
const TOKENS_PER_SECOND = 7;

export type MoonshineFiles = { encoder: Uint8Array; decoder: Uint8Array; vocab: string[] };

export class Moonshine {
  private constructor(private readonly ort: Ort, private readonly encoder: any, private readonly decoder: any, private readonly vocab: string[]) {}

  static async create(ort: Ort, files: MoonshineFiles): Promise<Moonshine> {
    const options = { executionProviders: ["wasm"], graphOptimizationLevel: "all" };
    const [encoder, decoder] = await Promise.all([ort.InferenceSession.create(files.encoder, options), ort.InferenceSession.create(files.decoder, options)]);
    return new Moonshine(ort, encoder, decoder, files.vocab);
  }

  /** 16 kHz mono samples to text. */
  async transcribe(samples: Float32Array): Promise<string> {
    const ort = this.ort;
    const input = new ort.Tensor("float32", samples, [1, samples.length]);
    const encoded = (await this.encoder.run({ input_values: input })).last_hidden_state as Tensor;
    const empty = () => new ort.Tensor("float32", new Float32Array(0), [1, HEADS, 0, HEAD_DIM]);
    let past: Record<string, Tensor> = {};
    for (let i = 0; i < LAYERS; i++) for (const side of ["decoder", "encoder"]) for (const kv of ["key", "value"]) past[`past_key_values.${i}.${side}.${kv}`] = empty();
    const ids: number[] = [START];
    const limit = Math.min(256, Math.ceil((samples.length / 16000) * TOKENS_PER_SECOND) + 4);
    try {
      for (let step = 0; step < limit; step++) {
        const feeds = {
          input_ids: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids[ids.length - 1])]), [1, 1]),
          encoder_hidden_states: encoded, ...past,
          use_cache_branch: new ort.Tensor("bool", [step > 0], [1]),
        };
        const out = await this.decoder.run(feeds);
        const logits = out.logits.data as Float32Array;
        const vocab = logits.length;
        let best = 0; for (let i = 1; i < vocab; i++) if (logits[i] > logits[best]) best = i;
        // The decoder cache grows every step; the encoder cache is written once, at step 0.
        const next: Record<string, Tensor> = {};
        for (const key of Object.keys(past)) {
          const fresh = out[key.replace("past_key_values", "present")];
          const keepOld = step > 0 && key.includes(".encoder.");
          if (keepOld) next[key] = past[key]; else next[key] = fresh;
          if (!keepOld) past[key]?.dispose?.();
          if (keepOld) fresh?.dispose?.();
        }
        out.logits.dispose?.();
        past = next;
        if (best === END) break;
        ids.push(best);
      }
    } finally {
      for (const tensor of Object.values(past)) tensor?.dispose?.();
      encoded.dispose?.(); input.dispose?.();
    }
    return decodeTokens(ids.slice(1), this.vocab);
  }

  async dispose() { await this.encoder.release?.(); await this.decoder.release?.(); }
}

/** SentencePiece pieces to text: "▁" is a space, `<0xNN>` is a byte, special tokens (empty in the table) are dropped. */
export function decodeTokens(ids: readonly number[], vocab: readonly string[]): string {
  const bytes: number[] = [];
  const encoder = new TextEncoder();
  for (const id of ids) {
    const piece = vocab[id] ?? "";
    const hex = /^<0x([0-9A-Fa-f]{2})>$/.exec(piece);
    if (hex) bytes.push(parseInt(hex[1], 16));
    else for (const byte of encoder.encode(piece.replace(/▁/g, " "))) bytes.push(byte);
  }
  return new TextDecoder().decode(Uint8Array.from(bytes)).replace(/^ /, "").trim();
}

// Output check for half-precision WebGPU graphs. A shader-f16 graph can run without an error and return finite
// numbers that are wrong: on an RTX 3070 (Chrome 157) the fp16 card detector's heat output peaked at 0.099
// where the fp32 graph on WebGPU and the WASM graph gave 0.881 for the same frame (2026-11-07). The runtime
// therefore runs one fixed input through a new fp16 session and compares it with a float32 reference stored
// in the repo (scripts/vision/gpu-check-reference.ts makes it); a session that disagrees is replaced by the fp32 graph.
import { embedImages, type SessionLike, type TensorCtor } from './embed';
import type { RGBAImage } from './pixels';
import type { EmbeddingModelSpec } from './types';

export interface GpuCheck {
  /** The model's output vector for the fixed check input, run on the session under test (`Tensor` is that session's own class). */
  output(session: SessionLike, Tensor: TensorCtor): Promise<ArrayLike<number>>;
  /** The float32 graph's output for the same input. */
  reference: ArrayLike<number>;
  /** The lowest cosine similarity with `reference` that passes. */
  minCosine: number;
}

/** mulberry32: integer arithmetic only, so every JavaScript engine draws the same numbers. */
function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const CHECK_SEED = 0x5eed;

/**
 * A deterministic test picture: per colour channel, concentric sine ripples around a seeded centre, with
 * their own seeded period and phase. Made in code so the check needs no download, and at the model's input
 * size so the preprocessing resize leaves it as it is. Why ripples and not blobs or noise: this embedder
 * sends every smooth gradient, stripe, checker or noise picture to nearly the same vector (cosine 0.99+
 * between them), which would pass a broken graph that ignores its input. Ripples land far from that
 * cluster (cosine 0.28 with stripes or flat grey), and other seeds land at 0.75-0.95, so agreement with the
 * reference means this picture went through the whole network right. The pixels are bytes, so a last-bit difference in
 * Math.sin between engines changes a pixel by 1 level at most, which moves the vector by under 1e-5.
 */
export function checkImage(size: number, seed = CHECK_SEED): RGBAImage {
  const rand = seeded(seed), span = size * 0.6;
  const cx = size * 0.2 + rand() * span, cy = size * 0.2 + rand() * span;
  const period = [0, 1, 2].map(() => 2.5 + rand() * 3.5), phase = [0, 1, 2].map(() => rand() * 2 * Math.PI);
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)), at = (y * size + x) * 4;
    for (let c = 0; c < 3; c++) data[at + c] = Math.round(128 + 127 * Math.sin(radius / period[c] + phase[c]));
    data[at + 3] = 255;
  }
  return { data, width: size, height: size };
}

/** The embedder's check, or undefined when its spec carries none. Runs the production path (embedImages), so the input is normalised exactly like a real crop. */
export function embeddingGpuCheck(spec: EmbeddingModelSpec): GpuCheck | undefined {
  const check = spec.gpuCheck;
  if (!check) return undefined;
  const image = checkImage(spec.inputSize);
  return { reference: check.reference, minCosine: check.minCosine, output: async (session, Tensor) => (await embedImages(session, Tensor, spec, [image]))[0] };
}

/** `ok` when `output` has the reference's length, only finite values, and cosine similarity >= minCosine with it; `note` says what was measured. */
export function checkOutput(output: ArrayLike<number>, { reference, minCosine }: Pick<GpuCheck, 'reference' | 'minCosine'>): { ok: boolean; note: string } {
  if (output.length !== reference.length) return { ok: false, note: `${output.length} values, expected ${reference.length}` };
  let dot = 0, a = 0, b = 0;
  for (let i = 0; i < output.length; i++) {
    const x = output[i];
    if (x - x !== 0) return { ok: false, note: 'a value that is not finite' };
    dot += x * reference[i]; a += x * x; b += reference[i] * reference[i];
  }
  const cosine = dot / Math.sqrt(a * b);
  return { ok: cosine >= minCosine, note: `cosine ${cosine.toFixed(4)} with the float32 reference (needs ${minCosine})` };
}

import type { RGBAImage } from './pixels';

export type FaceState = 'up' | 'down' | 'unknown';
export interface FaceStateResult { state: FaceState; confidence: number }
export interface FaceStateEmbedding { values: ArrayLike<number>; space: 'art-box' | 'whole-card'; modelId?:string }
export interface FaceStateOptions {
  /** The face-down class probability, NOT 1 minus the winning face-up score. */
  detectorFaceDownScore?: number;
  /** Reuse an existing embedding; this module never runs an embedding model. */
  embedding?: FaceStateEmbedding;
  /** Retain locally from the last verified face-up read; never update from a back. */
  reference?: { crop?: RGBAImage; embedding?: FaceStateEmbedding };
}

const W = 40, H = 56, N = W * H;
// Synchronous calls reuse isolate-local scratch buffers, overwritten on the next call.
const currentPixels = new Float32Array(N * 3), referencePixels = new Float32Array(N * 3);
const unknown = (): FaceStateResult => ({ state: 'unknown', confidence: 0 });
const clamp = (v: number) => Math.max(0, Math.min(1, v));
interface Features { rgb: Float32Array; texture: number; edges: number; spread: number; frame: number; borderRatio: number; borderSpread: number; residual: number; colorResidual: number }

/** Fixed work regardless of source resolution. Ignore the outer 3.5% sleeve/warp border. */
function measure(image: RGBAImage, rgb: Float32Array): Features | undefined {
  const { width, height, data } = image;
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 24 || height < 24 || data.length < width * height * 4) return;
  const means = [0, 0, 0], covX = [0, 0, 0], covY = [0, 0, 0];
  const landscape = width > height;
  // Four taps suppress single-pixel sensor noise without resizing the source crop.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const u = .035 + .93 * (x + .5) / W, v = .035 + .93 * (y + .5) / H;
    const sx = (landscape ? v : u) * (width - 1), sy = (landscape ? 1 - u : v) * (height - 1);
    const x0 = Math.floor(sx), y0 = Math.floor(sy), tx = sx - x0, ty = sy - y0;
    const i = (y * W + x) * 3;
    for (let c = 0; c < 3; c++) {
      const a = (y0 * width + x0) * 4 + c, b = (Math.min(height - 1, y0 + 1) * width + x0) * 4 + c;
      const value = ((1 - ty) * ((1 - tx) * data[a] + tx * data[a + 4]) + ty * ((1 - tx) * data[b] + tx * data[b + 4])) / 255;
      rgb[i + c] = value; means[c] += value / N;
      covX[c] += value * (x / (W - 1) - .5) / N; covY[c] += value * (y / (H - 1) - .5) / N;
    }
  }
  const difference = (a: number, b: number) => (Math.abs(rgb[a] - rgb[b]) + Math.abs(rgb[a + 1] - rgb[b + 1]) + Math.abs(rgb[a + 2] - rgb[b + 2])) / 3;
  let texture = 0, edges = 0, spread = 0, count = 0, lumaVariance = 0;
  const lumaMean = (means[0] + means[1] + means[2]) / 3, covLuma = [0, 0, 0];
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3;
    const luma = (rgb[i] + rgb[i + 1] + rgb[i + 2]) / 3 - lumaMean;
    lumaVariance += luma * luma / N;
    for (let c = 0; c < 3; c++) {
      spread += (rgb[i + c] - means[c]) ** 2 / (N * 3);
      covLuma[c] += (rgb[i + c] - means[c]) * luma / N;
    }
    if (x) { const d = difference(i, i - 3); texture += d; edges += d > .07 ? 1 : 0; count++; }
    if (y) { const d = difference(i, i - W * 3); texture += d; edges += d > .07 ? 1 : 0; count++; }
  }
  let borderTexture = 0, artTexture = 0, borderN = 0, artN = 0;
  const borderMean = [0, 0, 0], borderSq = [0, 0, 0];
  for (let y = 12; y < 38; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 3, d = (difference(i, i + (x < W - 1 ? 3 : -3)) + difference(i, i + W * 3)) / 2;
    if (x === 0 || x === W - 1) {
      borderTexture += difference(i, i + W * 3); borderN++;
      for (let c = 0; c < 3; c++) { borderMean[c] += rgb[i + c]; borderSq[c] += rgb[i + c] ** 2; }
    }
    if (x >= 7 && x < W - 7) { artTexture += d; artN++; }
  }
  // Residual after a planar lighting gradient: a blurred front still contains
  // broad art/frame colour regions; a plain matte sleeve mostly does not.
  const explained = covX.reduce((sum, v, c) => sum + v * v * (12 * (W - 1) / (W + 1)) + covY[c] ** 2 * (12 * (H - 1) / (H + 1)), 0) / 3;
  const residual = Math.sqrt(Math.max(0, spread - explained));
  // Remove both planar exposure and a shared reflection: glossy coloured sleeves
  // can vary on two RGB axes without acquiring a front's art/frame colour regions.
  const vx = 12 * (W - 1) / (W + 1), vy = 12 * (H - 1) / (H + 1);
  const lx = (covX[0] + covX[1] + covX[2]) / 3, ly = (covY[0] + covY[1] + covY[2]) / 3;
  const remainingLuma = Math.max(1e-10, lumaVariance - lx * lx * vx - ly * ly * vy);
  const colorResidual = Math.sqrt(Math.max(0, residual ** 2 - covLuma.reduce((sum,v,c) => sum + (v - covX[c] * lx * vx - covY[c] * ly * vy) ** 2, 0) / (3 * remainingLuma)));
  const borderRatio = (borderTexture / borderN) / Math.max(.01, artTexture / artN);
  const borderSpread = Math.sqrt(Math.max(0, borderSq.reduce((sum, sq, c) => sum + sq / borderN - (borderMean[c] / borderN) ** 2, 0) / 3));
  // A front has a rectangular art window and a separate text region. A textured
  // sleeve may have many edges, but lacks these long, aligned frame boundaries.
  const col = (u: number) => Math.max(1, Math.min(W - 2, Math.round((u - .035) / .93 * W)));
  const row = (v: number) => Math.max(1, Math.min(H - 2, Math.round((v - .035) / .93 * H)));
  const frameContrast = Math.max(.012, Math.min(.16, Math.sqrt(spread) * .7));
  const horizontal = (from: number, to: number, reverse: boolean) => {
    let best = 0;
    for (let y = row(from); y <= row(to); y++) {
      let sum = 0, n = 0;
      for (let x = col(.18); x <= col(.82); x++) {
        const yy = reverse ? H - 1 - y : y;
        sum += Math.min(1, difference(((yy - 1) * W + x) * 3, ((yy + 1) * W + x) * 3) / frameContrast); n++;
      }
      best = Math.max(best, sum / n);
    }
    return best;
  };
  const vertical = (from: number, to: number, reverse: boolean) => {
    let best = 0;
    for (let x = col(from); x <= col(to); x++) {
      let sum = 0, n = 0;
      for (let y = row(.25); y <= row(.62); y++) {
        const yy = reverse ? H - 1 - y : y;
        sum += Math.min(1, difference((yy * W + x - 1) * 3, (yy * W + x + 1) * 3) / frameContrast); n++;
      }
      best = Math.max(best, sum / n);
    }
    return best;
  };
  const frameAt = (reverse: boolean) => Math.min(horizontal(.14, .23, reverse), horizontal(.65, .75, reverse),
    vertical(.09, .18, reverse), vertical(.82, .91, reverse));
  return { rgb, texture: texture / count, edges: edges / count, spread: Math.sqrt(spread), frame: Math.max(frameAt(false), frameAt(true)), borderRatio, borderSpread, residual, colorResidual };
}

/** Per-channel centred correlation tolerates exposure and white balance, and 180-degree pose. */
function cropDistance(a: Features, b: Features): number {
  const am = [0, 0, 0], bm = [0, 0, 0];
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) { am[c] += a.rgb[i * 3 + c] / N; bm[c] += b.rgb[i * 3 + c] / N; }
  let aa = 0, bb = 0, forward = 0, reverse = 0;
  for (let i = 0; i < N; i++) for (let c = 0; c < 3; c++) {
    const x = a.rgb[i * 3 + c] - am[c], y = b.rgb[i * 3 + c] - bm[c];
    aa += x * x; bb += y * y; forward += x * y;
    reverse += x * (b.rgb[(N - 1 - i) * 3 + c] - bm[c]);
  }
  return aa > 1e-6 && bb > 1e-6 ? 1 - Math.max(forward, reverse) / Math.sqrt(aa * bb) : 1;
}

function cosine(a?: FaceStateEmbedding, b?: FaceStateEmbedding): number | undefined {
  if (!a || !b || a.space !== b.space || a.modelId !== b.modelId || !a.values.length || a.values.length !== b.values.length || a.values.length > 4096) return;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.values.length; i++) {
    const x = a.values[i], y = b.values[i];
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    dot += x * y; aa += x * x; bb += y * y;
  }
  return aa > 0 && bb > 0 ? dot / Math.sqrt(aa * bb) : undefined;
}

/**
 * Pure CPU evidence, not identity recognition. Input must be an isolated warped
 * card (portrait or quarter-turned), with motion/hand/occlusion filtered by caller.
 * Confidence is a heuristic strength, not a calibrated posterior probability.
 */
export function classifyFaceState(crop: RGBAImage, options: FaceStateOptions = {}): FaceStateResult {
  const current = measure(crop, currentPixels);
  if (!current) return unknown();
  const reference = options.reference?.crop && measure(options.reference.crop, referencePixels);
  const distance = reference ? cropDistance(current, reference) : undefined;
  const similarity = cosine(options.embedding, options.reference?.embedding);
  const score = options.detectorFaceDownScore;
  const detector = score !== undefined && Number.isFinite(score) && score >= 0 && score <= 1 ? score : undefined;
  const cropSame = distance !== undefined && distance < .15;
  const cropChanged = distance !== undefined && distance > .45;
  const same = cropSame || !cropChanged && similarity !== undefined && similarity >= .90;
  const changed = cropChanged || !cropSame && similarity !== undefined && similarity < .68;
  const uniform = current.edges < .055 && current.texture < .025;
  const front = current.frame >= .50 && current.residual > .01 && (current.borderRatio < .62 || current.borderSpread < .065);

  // Conflicting strong evidence abstains rather than publishing a false flip.
  if (uniform) {
    const colouredStructure = current.colorResidual > Math.max(.002, current.spread * .12);
    const lostDetail = colouredStructure && (current.residual > .06 || current.residual > .012 && current.residual > current.spread * .75);
    if (front || cropSame || colouredStructure && distance !== undefined && distance < .65 || lostDetail) return unknown();
    return { state: 'down', confidence: .96 };
  }
  if (same && detector !== undefined && detector >= .8) return unknown();
  if (same) return { state: 'up', confidence: .94 };
  if (detector !== undefined && detector >= .95) return { state: 'down', confidence: detector };
  if (detector !== undefined && detector >= .8) return front ? unknown() : { state: 'down', confidence: Math.max(.8, detector) };
  if (front) return { state: 'up', confidence: .80 + .17 * clamp((current.frame - .5) / .3) };
  if (changed && !front) return { state: 'down', confidence: .88 };
  if ((current.frame < .28 && current.spread > .045 && current.texture > .012 && current.edges > .035) ||
    (current.borderRatio > .80 && current.borderSpread > .10 && current.spread > .07 && current.edges > .04)) return { state: 'down', confidence: .82 };
  return unknown();
}

/** Conservative new-card gate: ambiguous art sleeves remain unknown for later evidence. */
export function isLikelyFaceDown(crop: RGBAImage): boolean {
  const result = classifyFaceState(crop);
  return result.state === 'down' && result.confidence >= .8;
}

/** One helper per physical track; call with unknown on motion/occlusion/misses. */
export function createFaceStateHysteresis(options: { sustainMs?: number; maxGapMs?: number; minConfidence?: number; minSamples?:number } = {}) {
  const sustainMs = Math.max(0, options.sustainMs ?? 300), maxGapMs = Math.max(sustainMs, options.maxGapMs ?? 650);
  const minConfidence = Math.max(.5, Math.min(1, options.minConfidence ?? .8));
  const minSamples=Math.max(2,Math.floor(options.minSamples??2));
  let samples=0;
  let pending: FaceState = 'unknown', since = 0, last = -Infinity, confidence = 0;
  const reset = () => { pending = 'unknown'; since = 0; last = -Infinity; confidence = 0;samples=0; };
  return {
    reset,
    update(result: FaceStateResult, at: number): FaceStateResult {
      if (!Number.isFinite(at)) { reset(); return unknown(); }
      if (at <= last || at - last > maxGapMs) reset();
      last = at;
      if ((result.state !== 'up' && result.state !== 'down') || !Number.isFinite(result.confidence) || result.confidence < minConfidence || result.confidence > 1) {
        pending = 'unknown'; confidence = 0;samples=0; return unknown();
      }
      if (pending !== result.state) { pending = result.state; since = at; confidence = result.confidence;samples=0; }
      samples++;confidence = Math.min(confidence, result.confidence);
      return samples>=minSamples&&at - since >= sustainMs ? { state: pending, confidence } : unknown();
    },
  };
}

// Light/glare pre-clean for card crops (Remote Duels webcams under monitor or RGB light).
// Pure pixel work, no model: cheap enough to run per crop in the worker (a 295x430 warp is ~2-4 ms).
import type { RGBAImage } from './pixels';

export interface PrecleanStats {
  /** Per-channel gains the cast removal applied (R, G, B). */
  gains: [number, number, number];
  /** Share of crop pixels masked as glare (near-saturated, low saturation), 0..1. */
  glare: number;
  /** Share of the crop in a shadow (cells much darker than the bright part), 0..1; the lift ran when > 0. */
  shadow: number;
  ms: number;
}


/**
 * Dark region evidence on a coarse luminance grid: the share of cells darker than
 * 60% of the bright (75th percentile) cell, or 1 when the whole image is dim
 * (a shadow from above over the whole board). Cheap: every 4th pixel.
 */
export function darkShare(img: RGBAImage, gx = 16, gy = 12, opts: { dim?: boolean; factor?: number } = {}): number {
  const cells = luminanceGrid(img, gx, gy), sorted = Array.from(cells).sort((a, b) => a - b), ref = sorted[Math.floor(sorted.length * .75)];
  if (opts.dim !== false && ref < 55) return 1;
  let dark = 0; for (const v of cells) if (v < ref * (opts.factor ?? .6)) dark++;
  return dark / cells.length;
}
function luminanceGrid(img: RGBAImage, gx: number, gy: number) {
  const sum = new Float64Array(gx * gy), count = new Float64Array(gx * gy), d = img.data;
  for (let y = 0; y < img.height; y += 4) for (let x = 0; x < img.width; x += 4) {
    const p = (y * img.width + x) * 4, c = Math.min(gy - 1, Math.floor(y * gy / img.height)) * gx + Math.min(gx - 1, Math.floor(x * gx / img.width));
    sum[c] += (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) / 256; count[c]++;
  }
  return Float32Array.from(sum, (v, i) => count[i] ? v / count[i] : 0);
}
/**
 * Shadow lift: local brightness normalization on a coarse grid. Cells darker than
 * 80% of the bright level get a gain towards it (at most 2.5x), a dim image gets a
 * global lift, and gains are interpolated bilinearly so soft shadow edges stay soft.
 * Bright, unshadowed pixels are unchanged.
 */
export function shadowLift(img: RGBAImage, gx = 16, gy = 12): RGBAImage {
  const cells = luminanceGrid(img, gx, gy), sorted = Array.from(cells).sort((a, b) => a - b), ref = Math.max(1, sorted[Math.floor(sorted.length * .75)]);
  const global = ref < 110 ? Math.min(2, 120 / ref) : 1;
  const gains = Float32Array.from(cells, v => global * (v > 0 && v < ref * .8 ? Math.min(2.5, ref * .85 / v) : 1));
  const out = new Uint8ClampedArray(img.data), { width: w, height: h } = img, cw = w / gx, ch = h / gy;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(gy - 1, Math.max(0, (y + .5) / ch - .5)), j0 = Math.floor(fy), j1 = Math.min(gy - 1, j0 + 1), ay = fy - j0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(gx - 1, Math.max(0, (x + .5) / cw - .5)), k0 = Math.floor(fx), k1 = Math.min(gx - 1, k0 + 1), ax = fx - k0;
      const g = (1 - ay) * ((1 - ax) * gains[j0 * gx + k0] + ax * gains[j0 * gx + k1]) + ay * ((1 - ax) * gains[j1 * gx + k0] + ax * gains[j1 * gx + k1]);
      if (g === 1) continue;
      const p = (y * w + x) * 4; out[p] = out[p] * g; out[p + 1] = out[p + 1] * g; out[p + 2] = out[p + 2] * g;
    }
  }
  return { data: out, width: w, height: h };
}

/** Glare share above which a read always also tries the pre-cleaned crop. */
export const GLARE_ALWAYS_TRY = 0.02;

/** Glare = near-white pixels with almost no colour: specular reflections on sleeves and gloss. */
export function glareMask(img: RGBAImage): { mask: Uint8Array; share: number } {
  const n = img.width * img.height, mask = new Uint8Array(n), d = img.data;
  let count = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const r = d[p], g = d[p + 1], b = d[p + 2];
    const max = r > g ? (r > b ? r : b) : (g > b ? g : b), min = r < g ? (r < b ? r : b) : (g < b ? g : b);
    if (max >= 235 && max - min <= 28) { mask[i] = 1; count++; }
  }
  return { mask, share: count / n };
}

/** Robust per-channel levels: gains that map each channel's [2%, 98%] range onto a common range. */
function channelLevels(img: RGBAImage, mask?: Uint8Array) {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)], d = img.data, n = img.width * img.height;
  let total = 0;
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    if (mask?.[i]) continue;
    hist[0][d[p]]++; hist[1][d[p + 1]]++; hist[2][d[p + 2]]++; total++;
  }
  const pct = (h: Uint32Array, q: number) => {
    const target = q * total; let acc = 0;
    for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= target) return v; }
    return 255;
  };
  return hist.map(h => [pct(h, .02), pct(h, .98)] as [number, number]);
}

/**
 * Pre-clean one card crop for the embedder:
 * 1. glare pixels are filled with the local mean of nearby non-glare pixels,
 * 1b. a shadow over part of the card (or a dim whole card) is lifted locally,
 * 2. per-channel robust levels remove a colour cast and restore washed-out contrast,
 * 3. a mild CLAHE-like local contrast on luminance restores detail in lit or dim areas.
 */
export function precleanCrop(img: RGBAImage): { image: RGBAImage; stats: PrecleanStats } {
  const started = performance.now();
  const { width: w, height: h } = img, n = w * h;
  const out = new Uint8ClampedArray(img.data);
  const { mask, share } = glareMask(img);
  if (share > 0) fillMasked(out, w, h, mask, Math.max(4, Math.round(Math.min(w, h) / 24)));
  const shadow = darkShare({ data: out, width: w, height: h }, 4, 6);
  if (shadow > 0) out.set(shadowLift({ data: out, width: w, height: h }, 4, 6).data);
  const levels = channelLevels({ data: out, width: w, height: h });
  // Common target: the mean of the channel ranges, so a cast is removed without global re-exposure.
  const lo = Math.min(...levels.map(l => l[0])), hi = Math.max(...levels.map(l => l[1]));
  const targetLo = Math.min(lo, 16), targetHi = Math.max(hi, 239);
  const gains = levels.map(([a, b]) => b > a + 8 ? Math.max(.5, Math.min(2.5, (targetHi - targetLo) / (b - a))) : 1) as [number, number, number];
  const luts = levels.map(([a], c) => {
    const lut = new Uint8ClampedArray(256);
    for (let v = 0; v < 256; v++) lut[v] = targetLo + (v - a) * gains[c];
    return lut;
  });
  for (let p = 0; p < out.length; p += 4) { out[p] = luts[0][out[p]]; out[p + 1] = luts[1][out[p + 1]]; out[p + 2] = luts[2][out[p + 2]]; }
  localContrast(out, w, h);
  return { image: { data: out, width: w, height: h }, stats: { gains, glare: share, shadow, ms: performance.now() - started } };
}

/** Replace masked pixels with the mean of unmasked pixels in a (2r+1)^2 box (integral images). */
function fillMasked(d: Uint8ClampedArray, w: number, h: number, mask: Uint8Array, r: number) {
  const W = w + 1, sum = [new Float64Array(W * (h + 1)), new Float64Array(W * (h + 1)), new Float64Array(W * (h + 1))], cnt = new Float64Array(W * (h + 1));
  for (let y = 0; y < h; y++) {
    let s0 = 0, s1 = 0, s2 = 0, c = 0;
    for (let x = 0; x < w; x++) {
      const i = y * w + x, p = i * 4;
      if (!mask[i]) { s0 += d[p]; s1 += d[p + 1]; s2 += d[p + 2]; c++; }
      const o = (y + 1) * W + x + 1, u = y * W + x + 1;
      sum[0][o] = sum[0][u] + s0; sum[1][o] = sum[1][u] + s1; sum[2][o] = sum[2][u] + s2; cnt[o] = cnt[u] + c;
    }
  }
  let gm = [0, 0, 0], gc = cnt[h * W + w];
  if (gc) gm = [sum[0][h * W + w] / gc, sum[1][h * W + w] / gc, sum[2][h * W + w] / gc];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!mask[i]) continue;
    let rr = r, x0 = 0, x1 = 0, y0 = 0, y1 = 0, c = 0;
    // Grow the window for big blobs until it reaches real pixels.
    for (; rr <= Math.max(w, h); rr *= 2) {
      x0 = Math.max(0, x - rr); x1 = Math.min(w, x + rr + 1); y0 = Math.max(0, y - rr); y1 = Math.min(h, y + rr + 1);
      c = cnt[y1 * W + x1] - cnt[y0 * W + x1] - cnt[y1 * W + x0] + cnt[y0 * W + x0];
      if (c >= 4) break;
    }
    const p = i * 4;
    for (let k = 0; k < 3; k++) {
      const s = sum[k];
      d[p + k] = c ? (s[y1 * W + x1] - s[y0 * W + x1] - s[y1 * W + x0] + s[y0 * W + x0]) / c : gm[k];
    }
  }
}

/** CLAHE on luminance: 4x6 tiles, clip limit 2.5, bilinear between tile maps; RGB scaled by Y'/Y. */
function localContrast(d: Uint8ClampedArray, w: number, h: number) {
  const tx = 4, ty = 6, n = w * h, Y = new Uint8Array(n);
  for (let i = 0, p = 0; i < n; i++, p += 4) Y[i] = (d[p] * 77 + d[p + 1] * 150 + d[p + 2] * 29) >> 8;
  const maps = new Uint8Array(tx * ty * 256);
  for (let j = 0; j < ty; j++) for (let k = 0; k < tx; k++) {
    const xa = Math.floor(k * w / tx), xb = Math.floor((k + 1) * w / tx), ya = Math.floor(j * h / ty), yb = Math.floor((j + 1) * h / ty);
    const hist = new Uint32Array(256), area = (xb - xa) * (yb - ya);
    for (let y = ya; y < yb; y++) for (let x = xa; x < xb; x++) hist[Y[y * w + x]]++;
    const limit = Math.max(1, Math.floor(2.5 * area / 256));
    let excess = 0;
    for (let v = 0; v < 256; v++) if (hist[v] > limit) { excess += hist[v] - limit; hist[v] = limit; }
    const add = excess / 256;
    let acc = 0; const base = (j * tx + k) * 256;
    for (let v = 0; v < 256; v++) { acc += hist[v] + add; maps[base + v] = Math.min(255, Math.round(acc * 255 / area)); }
  }
  const tw = w / tx, th = h / ty;
  for (let y = 0; y < h; y++) {
    const fy = Math.min(ty - 1, Math.max(0, (y + .5) / th - .5)), j0 = Math.floor(fy), j1 = Math.min(ty - 1, j0 + 1), ay = fy - j0;
    for (let x = 0; x < w; x++) {
      const fx = Math.min(tx - 1, Math.max(0, (x + .5) / tw - .5)), k0 = Math.floor(fx), k1 = Math.min(tx - 1, k0 + 1), ax = fx - k0;
      const i = y * w + x, v = Y[i];
      const m = (1 - ay) * ((1 - ax) * maps[(j0 * tx + k0) * 256 + v] + ax * maps[(j0 * tx + k1) * 256 + v])
        + ay * ((1 - ax) * maps[(j1 * tx + k0) * 256 + v] + ax * maps[(j1 * tx + k1) * 256 + v]);
      // Blend half-way: full CLAHE over-flattens card art compared to the clean index scans.
      const target = (v + m) / 2, scale = v > 2 ? target / v : 1, p = i * 4;
      d[p] = d[p] * scale; d[p + 1] = d[p + 1] * scale; d[p + 2] = d[p + 2] * scale;
    }
  }
}

/** Synthetic lighting faults for fixture checks: colour cast, lowered contrast, specular blob. */
export function degradeLighting(img: RGBAImage, kind: 'blue' | 'purple' | 'white' | 'blob' | 'flat'): RGBAImage {
  const out = new Uint8ClampedArray(img.data), { width: w, height: h } = img;
  const cast: Record<string, [number, number, number, number]> = {
    // [r gain, g gain, b gain, additive lift]
    blue: [.7, .9, 1.35, 20], purple: [1.1, .65, 1.4, 25], white: [.75, .75, .75, 70], flat: [.55, .55, .55, 60], blob: [1, 1, 1, 0],
  };
  const [gr, gg, gb, lift] = cast[kind];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (y * w + x) * 4;
    out[p] = out[p] * gr + lift; out[p + 1] = out[p + 1] * gg + lift; out[p + 2] = out[p + 2] * gb + lift;
    if (kind === 'blob') {
      const dx = (x - w * .55) / (w * .22), dy = (y - h * .4) / (h * .14), f = Math.exp(-(dx * dx + dy * dy) * 1.5);
      out[p] += f * 255; out[p + 1] += f * 255; out[p + 2] += f * 255;
    }
  }
  return { data: out, width: w, height: h };
}

/**
 * Benchmark only: the detector keeps raw frames, because frame cast removal gave no recall gain
 * on the owner webcam frames or the synthetic casts (scripts/vision/benchmark-preclean.ts).
 * Frame-level cast gains (robust gray-world): per-channel mean of mid-luminance pixels sampled on a
 * grid, scaled so every channel matches the gray mean. Cheap (every 4th pixel in x and y).
 */
export function frameCastGains(img: RGBAImage, step = 4): [number, number, number] {
  const d = img.data; let r = 0, g = 0, b = 0, n = 0;
  for (let y = 0; y < img.height; y += step) for (let x = 0; x < img.width; x += step) {
    const p = (y * img.width + x) * 4, R = d[p], G = d[p + 1], B = d[p + 2], l = (R + G + B) / 3;
    if (l < 12 || Math.max(R, G, B) >= 245) continue;
    r += R; g += G; b += B; n++;
  }
  if (!n) return [1, 1, 1];
  const m = (r + g + b) / 3, clamp = (v: number) => Math.max(.6, Math.min(1.6, v));
  return [clamp(m / Math.max(1, r)), clamp(m / Math.max(1, g)), clamp(m / Math.max(1, b))];
}
export function applyGains(img: RGBAImage, gains: [number, number, number]): RGBAImage {
  const out = new Uint8ClampedArray(img.data);
  for (let p = 0; p < out.length; p += 4) { out[p] *= gains[0]; out[p + 1] *= gains[1]; out[p + 2] *= gains[2]; }
  return { data: out, width: img.width, height: img.height };
}

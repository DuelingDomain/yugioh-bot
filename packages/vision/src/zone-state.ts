/**
 * Tiny zone-state classifier (prototype, heuristics only, no model, nothing trained).
 * Input: one video frame and one zone quad. Output: empty / face-up / face-down / sideways / hand-over.
 * About 0.1-0.3 ms per call on a desktop core; it only runs when the zone watch reports a settled zone.
 *
 * Steps: warp the zone to a small upright crop; learn the mat colour from the crops of all zones (most are empty, plain
 * mat); foreground = pixels far from the mat colour; skin share says hand; foreground extent says empty / upright / sideways;
 * the existing `classifyFaceState` says up / down on the foreground box.
 */
import { warpQuad, type Quad } from './geometry';
import { classifyFaceState } from './face-state';
import type { RGBAImage } from './pixels';
import type { Point } from './types';

export type ZoneKind = 'empty' | 'face-up' | 'face-down' | 'sideways-up' | 'sideways-down' | 'hand' | 'unknown';
export interface ZoneState { kind: ZoneKind; confidence: number; /** Share of the zone covered by something that is not mat. */ cover: number; skin: number; /** Foreground extent as share of the zone (w, h). */ extent: { w: number; h: number };
  /** The foreground box touches the crop edge: the object is bigger than the zone or straddles it (a held or neighbouring card). */ edge: boolean }
export interface MatColour { rgb: [number, number, number]; spread: number }
const CW = 48, CH = 72;
const crops = { data: new Uint8ClampedArray(0) };
void crops;

/** Rectify a zone (padded a little) into CW x CH pixels. The frame may be any size; `quad` is in normalised coordinates. */
export function zoneCrop(frame: RGBAImage, quad: readonly Point[], pad = .06, width = CW, height = CH): RGBAImage | null {
  const cx = quad.reduce((s, p) => s + p.x, 0) / 4, cy = quad.reduce((s, p) => s + p.y, 0) / 4;
  const grown = quad.map(p => ({ x: (cx + (p.x - cx) * (1 + pad * 2)) * frame.width, y: (cy + (p.y - cy) * (1 + pad * 2)) * frame.height })) as Quad;
  return warpQuad(frame, grown, width, height);
}

/** The mat colour: per-channel median over the crops of every zone (most zones are empty). Call again when the light changes. */
export function estimateMat(zoneCrops: readonly RGBAImage[]): MatColour {
  const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
  let n = 0;
  for (const crop of zoneCrops) for (let i = 0; i < crop.data.length; i += 4 * 3) { hist[0][crop.data[i]]++; hist[1][crop.data[i + 1]]++; hist[2][crop.data[i + 2]]++; n++; }
  const median = (h: Uint32Array) => { let acc = 0; for (let v = 0; v < 256; v++) { acc += h[v]; if (acc >= n / 2) return v; } return 0; };
  const rgb: [number, number, number] = [median(hist[0]), median(hist[1]), median(hist[2])];
  // Spread: median absolute deviation of the green channel.
  const dev = new Uint32Array(256);
  for (let v = 0; v < 256; v++) dev[Math.abs(v - rgb[1])] += hist[1][v];
  let acc = 0, mad = 0; for (let v = 0; v < 256; v++) { acc += dev[v]; if (acc >= n / 2) { mad = v; break; } }
  return { rgb, spread: mad };
}

const skinAt = (r: number, g: number, b: number) => {
  if (r <= 40 || r <= g || r <= b) return false;
  const cb = 128 - .168736 * r - .331264 * g + .5 * b, cr = 128 + .5 * r - .418688 * g - .081312 * b;
  return cb >= 77 && cb <= 127 && cr >= 133 && cr <= 173;
};

export function classifyZone(crop: RGBAImage, mat: MatColour): ZoneState {
  const { width: w, height: h, data } = crop;
  const fg = new Uint8Array(w * h);
  const threshold = Math.max(42, mat.spread * 6);
  let cover = 0, skinFg = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4, r = data[i], g = data[i + 1], b = data[i + 2];
    const d = Math.abs(r - mat.rgb[0]) + Math.abs(g - mat.rgb[1]) + Math.abs(b - mat.rgb[2]);
    if (d > threshold) { fg[y * w + x] = 1; cover++; if (skinAt(r, g, b)) skinFg++; }
  }
  const total = w * h;
  // Extent: rows and columns where at least 35% of the line is foreground (ignores a stray finger or reflection).
  let left = w, right = -1, top = h, bottom = -1;
  const colCount = new Uint16Array(w), rowCount = new Uint16Array(h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fg[y * w + x]) { colCount[x]++; rowCount[y]++; }
  for (let x = 0; x < w; x++) if (colCount[x] >= h * .35) { if (x < left) left = x; right = x; }
  for (let y = 0; y < h; y++) if (rowCount[y] >= w * .35) { if (y < top) top = y; bottom = y; }
  const extent = { w: right >= left ? (right - left + 1) / w : 0, h: bottom >= top ? (bottom - top + 1) / h : 0 };
  const skinShare = skinFg / total;
  const touchesEdge = right >= left && bottom >= top && (left <= 0 || top <= 0 || right >= w - 1 || bottom >= h - 1);
  const state = (kind: ZoneKind, confidence: number): ZoneState => ({ kind, confidence, cover: cover / total, skin: skinShare, extent, edge: touchesEdge });
  // A hand comes from outside: skin-coloured foreground that reaches the crop edge. A card lies inside the zone with a mat margin,
  // even when its art is skin-coloured, and a tan mat passes the skin test by itself, so skin only counts on foreground pixels.
  let edge = 0, edgeFg = 0;
  for (let x = 0; x < w; x++) { edge += 2; edgeFg += fg[x] + fg[(h - 1) * w + x]; }
  for (let y = 1; y < h - 1; y++) { edge += 2; edgeFg += fg[y * w] + fg[y * w + w - 1]; }
  if (skinFg / Math.max(1, cover) > .45 && skinShare > .08 && edgeFg / edge > .12) return state('hand', .8);
  if (cover / total < .14 || extent.w < .3 || extent.h < .3) return state('empty', cover / total < .08 ? .95 : .75);
  const sideways = extent.h / extent.w < .78 && extent.w > .6;
  // Face-up or down on the foreground box (rotated upright for a sideways card).
  const box = { x0: Math.max(0, left), x1: Math.min(w - 1, right), y0: Math.max(0, top), y1: Math.min(h - 1, bottom) };
  const bw = box.x1 - box.x0 + 1, bh = box.y1 - box.y0 + 1;
  if (bw < 24 || bh < 24) return state('unknown', .3);
  const piece = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++) piece.set(data.subarray(((box.y0 + y) * w + box.x0) * 4, ((box.y0 + y) * w + box.x0 + bw) * 4), y * bw * 4);
  const face = classifyFaceState({ data: piece, width: bw, height: bh });
  const up = face.state === 'up', down = face.state === 'down';
  if (sideways) return state(up ? 'sideways-up' : down ? 'sideways-down' : 'unknown', face.confidence * .9);
  return state(up ? 'face-up' : down ? 'face-down' : 'unknown', face.confidence);
}

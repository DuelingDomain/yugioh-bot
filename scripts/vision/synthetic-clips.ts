/** Writes three small synthetic .ddclip files (cards pasted on a mat) for speed work on the card reader. No camera, no player.
 *  npx tsx scripts/vision/synthetic-clips.ts [--data data/vision] [--out data/vision-eval]
 *  Needs the index (build-index.ts) and network for a handful of full card images (cached in <out>/cards, 4 requests/s).
 *  Output: <out>/clips/<name>-deck.ddclip (with a 40-card deck list) and <name>-open.ddclip (no deck list), plus labels/<name>-*.json.
 *    synth-still  four cards set down one by one and left alone (still cards, slide-in arrival)
 *    synth-flip   a Set card flipped face up, and a face-up card swapped for another one
 *    synth-offlist  four cards, two of them missing from the deck list (deck variant only)
 *    synth-move   a card moved to another zone, a card removed, a still card with camera jitter and light flicker
 *    synth-hand   three cards set down with an arm resting over the card edge for about 0.7 s before it withdraws
 *    synth-focus  three cards set down while the camera focus ramps from soft to sharp over 1.5 s
 *    synth-shake  three cards set down while the camera shakes (5 px, fading over 1 s)
 *    synth-two    four cards set down two at a time
 *  The clips are git-ignored output (about 6 MB each): delete them after use. */
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import sharp, { type OverlayOptions } from 'sharp';
import { buildClipEntries, writeZip, CLIP_VERSION, type ClipFrameMeta, type ClipSession, type ClipTruth, type ClipTruthEvent } from '../../packages/vision/src/clip-format';
import { createFieldCalibration, fieldZoneCells, type FieldZone } from '../../packages/vision/src/field-zones';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import type { IndexMeta } from '../../packages/vision/src/types';
import { defaultDataDir, evalDir, root } from './clip-node';

const { values } = parseArgs({ options: { data: { type: 'string' }, out: { type: 'string' }, fps: { type: 'string' }, seed: { type: 'string' } } });
const data = values.data ? resolve(values.data) : defaultDataDir(), out = values.out ? resolve(values.out) : evalDir();
const FPS = Number(values.fps ?? 10), W = 960, H = 540, CARD_W = 100, CARD_H = 146, START_MS = 1000;
let seed = Number(values.seed ?? 7); const random = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 2 ** 32; };

const meta = JSON.parse(await readFile(join(data, 'yugioh-index.meta.json'), 'utf8')) as IndexMeta;
const entries = meta.entries.filter(e => e.cardId !== yugioh.cardBack.cardId && e.passcode);
if (entries.length < 60) throw new Error(`Index has only ${entries.length} cards: build a larger one (build-index.ts --limit 500)`);
// Cards on the mat: spread through the index so they are not all one archetype. The deck list holds them plus 36 other cards.
const stride = Math.floor(entries.length / 12), pick = (i: number) => entries[i * stride + 3];
const onMat = Array.from({ length: 8 }, (_, i) => pick(i));
const deck = [...new Set([...onMat.map(e => e.cardId), ...entries.filter((_, i) => i % 13 === 5).map(e => e.cardId)])].slice(0, 40);

const MAT = { x0: .04, y0: .04, x1: .96, y1: .96 };
const calibration = createFieldCalibration([{ x: MAT.x0, y: MAT.y0 }, { x: MAT.x1, y: MAT.y0 }, { x: MAT.x1, y: MAT.y1 }, { x: MAT.x0, y: MAT.y1 }]);
const cells = new Map(fieldZoneCells('normal').map(c => [c.zone, c]));
/** The mat is axis-aligned, so mat units map straight to pixels. */
const centre = (zone: FieldZone) => { const c = cells.get(zone)!; return { x: (MAT.x0 + (c.x + c.w / 2) * (MAT.x1 - MAT.x0)) * W, y: (MAT.y0 + (c.y + c.h / 2) * (MAT.y1 - MAT.y0)) * H }; };

async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise(r => setTimeout(r, 300));
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { 'User-Agent': 'YugiDraft-offline-artwork-index/1.0' } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 429 && response.status < 500) throw new Error(`HTTP ${response.status}: ${url}`);
  }
  throw new Error(`Download failed: ${url}`);
}
await mkdir(join(out, 'cards'), { recursive: true });
const faces = new Map<string, Buffer>();
for (const e of onMat) {
  const file = join(out, 'cards', `${e.passcode}.jpg`);
  let bytes: Buffer; try { await access(file); bytes = await readFile(file); } catch { bytes = await download(`https://images.ygoprodeck.com/images/cards/${e.passcode}.jpg`); await writeFile(file, bytes); }
  faces.set(e.cardId, await sharp(bytes).resize(CARD_W, CARD_H, { fit: 'fill' }).removeAlpha().toBuffer());
}
const back = await sharp(join(root, 'packages/web/public', yugioh.cardBack.imageUrl)).resize(CARD_W, CARD_H, { fit: 'fill' }).removeAlpha().toBuffer();

// A dark felt mat with a soft vignette and fixed texture; per frame only camera noise changes.
const mat = Buffer.alloc(W * H * 3);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const v = 1 - .25 * Math.hypot((x - W / 2) / W, (y - H / 2) / H), n = (random() - .5) * 8, i = (y * W + x) * 3; mat[i] = 24 * v + n; mat[i + 1] = 46 * v + n; mat[i + 2] = 52 * v + n; }

interface Piece { image: Buffer; x: number; y: number; angle?: number; scaleX?: number; alpha?: number }
/** An arm over the mat: a skin-coloured ellipse (centre, half-sizes, tilt in degrees). */
interface Arm { x: number; y: number; rx: number; ry: number; angle?: number }
const armSvg = (arms: Arm[]) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${arms.map(a => `<ellipse cx="${a.x.toFixed(1)}" cy="${a.y.toFixed(1)}" rx="${a.rx}" ry="${a.ry}" transform="rotate(${a.angle ?? 0} ${a.x.toFixed(1)} ${a.y.toFixed(1)})" fill="rgb(228,172,132)"/>`).join('')}</svg>`);
async function render(pieces: Piece[], light = 1, shiftX = 0, shiftY = 0, arms: Arm[] = [], blur = 0): Promise<{ bytes: Uint8Array }> {
  const layers: OverlayOptions[] = [];
  for (const p of pieces) {
    let img = sharp(p.image); const w = Math.max(4, Math.round(CARD_W * (p.scaleX ?? 1)));
    if (w !== CARD_W) img = img.resize(w, CARD_H, { fit: 'fill' });
    let buf = await img.png().toBuffer(), width = w, height = CARD_H;
    if (p.angle) { const r = await sharp(buf).rotate(p.angle, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true }); buf = r.data; width = r.info.width; height = r.info.height; }
    layers.push({ input: buf, left: Math.round(p.x - width / 2 + shiftX), top: Math.round(p.y - height / 2 + shiftY) });
  }
  if (arms.length) layers.push({ input: armSvg(arms), left: 0, top: 0 });
  let composed = sharp(mat, { raw: { width: W, height: H, channels: 3 } }).composite(layers).removeAlpha();
  // A soft camera: the whole picture blurred (autofocus still settling).
  if (blur > .3) composed = sharp(await composed.raw().toBuffer(), { raw: { width: W, height: H, channels: 3 } }).blur(blur);
  const raw = await composed.raw().toBuffer();
  const px = Buffer.from(raw);
  for (let i = 0; i < px.length; i++) px[i] = Math.max(0, Math.min(255, px[i] * light + (random() - .5) * 4));
  return { bytes: new Uint8Array(await sharp(px, { raw: { width: W, height: H, channels: 3 } }).jpeg({ quality: 88 }).toBuffer()) };
}

type Place = { id: string; down?: boolean; zone: FieldZone; from?: { x: number; y: number }; at: number; slideMs?: number; until?: number; tilt?: number; /** x scale while turning, a function of ms since the turn started */ flipAt?: number };
/** Where a piece is at time t (ms), or null when it is not on the mat. */
function pose(p: Place, t: number): { x: number; y: number; scaleX: number; down: boolean } | null {
  if (t < p.at || (p.until !== undefined && t >= p.until)) return null;
  const to = centre(p.zone), slide = p.slideMs ?? 400, from = p.from ?? { x: to.x, y: -CARD_H };
  const k = Math.min(1, (t - p.at) / slide), e = 1 - (1 - k) ** 2;
  let scaleX = 1, down = !!p.down;
  if (p.flipAt !== undefined && t >= p.flipAt) { const j = (t - p.flipAt) / 300; if (j < 1) { scaleX = Math.max(.08, Math.abs(Math.cos(j * Math.PI))); down = j < .5; } else down = false; }
  return { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e, scaleX, down };
}

interface Scenario { name: string; seconds: number; places: Place[]; labels: ClipTruthEvent[]; jitter?: (t: number) => { dx: number; dy: number; light: number }; jitterOnly?: string; /** Arms (a hand resting on a card) and camera focus blur (sigma px) as functions of time. */ arms?: (t: number) => Arm[]; blur?: (t: number) => number; /** Cards that are on the mat but missing from the deck list (a side-deck swap, a wrong list, an opponent card). */ offList?: string[]; variants?: ('deck' | 'open')[] }
const a = onMat.map(e => e.cardId);
const label = (t: number, kind: ClipTruthEvent['kind'], cardId: string | undefined, zone: FieldZone, extra: Partial<ClipTruthEvent> = {}): ClipTruthEvent => ({ t, kind, cardId, to: { zone, faceUp: kind !== 'set' }, source: 'owner', ...extra });
const scenarios: Scenario[] = [
  { name: 'synth-still', seconds: 9, places: [
      { id: a[0], zone: 'M2', at: 1000 }, { id: a[1], zone: 'M3', at: 2000 }, { id: a[2], zone: 'M4', at: 3000 }, { id: a[3], zone: 'S2', at: 4000, from: { x: centre('S2').x, y: H + CARD_H } },
    ], labels: [label(1000, 'summon', a[0], 'M2'), label(2000, 'summon', a[1], 'M3'), label(3000, 'summon', a[2], 'M4'), label(4000, 'summon', a[3], 'S2')] },
  { name: 'synth-flip', seconds: 13, places: [
      { id: a[4], down: true, zone: 'M3', at: 1000, flipAt: 6000 },
      { id: a[5], zone: 'S3', at: 1500, until: 9000 }, { id: a[6], zone: 'S3', at: 9400 },
    ], labels: [label(1000, 'set', undefined, 'M3'), label(6000, 'flip', a[4], 'M3', { from: { zone: 'M3', faceUp: false } }), label(1500, 'summon', a[5], 'S3'),
      { t: 9000, kind: 'destroy', cardId: a[5], from: { zone: 'S3' }, source: 'owner' }, label(9400, 'summon', a[6], 'S3')] },
  { name: 'synth-move', seconds: 12, places: [
      { id: a[0], zone: 'M1', at: 1000, until: 5000 }, { id: a[0], zone: 'M5', at: 5000, from: centre('M1'), slideMs: 600 },
      { id: a[7], zone: 'M2', at: 1500, until: 8000, slideMs: 400 },
      { id: a[1], zone: 'S4', at: 2000, tilt: 1.5 },
    ], jitter: t => ({ dx: Math.round((random() - .5) * 3), dy: Math.round((random() - .5) * 3), light: 1 + (Math.sin(t / 180) * .06) }), jitterOnly: a[1],
    labels: [label(1000, 'summon', a[0], 'M1'), { t: 5000, kind: 'move', cardId: a[0], from: { zone: 'M1' }, to: { zone: 'M5', faceUp: true }, source: 'owner' }, label(1500, 'summon', a[7], 'M2'),
      { t: 8000, kind: 'destroy', cardId: a[7], from: { zone: 'M2' }, source: 'owner' }, label(2000, 'summon', a[1], 'S4')] },
  // Two of the four cards are not in the deck list: the deck-first search must not turn them into a deck card.
  { name: 'synth-offlist', seconds: 7, offList: [a[2], a[3]], variants: ['deck'], places: [
      { id: a[0], zone: 'M2', at: 1000 }, { id: a[2], zone: 'M3', at: 2000 }, { id: a[1], zone: 'M4', at: 3000 }, { id: a[3], zone: 'S2', at: 4000, from: { x: centre('S2').x, y: H + CARD_H } },
    ], labels: [label(1000, 'summon', a[0], 'M2'), label(2000, 'summon', a[2], 'M3'), label(3000, 'summon', a[1], 'M4'), label(4000, 'summon', a[3], 'S2')] },
];

/** Seconds-since-last-placement helpers for the harder scenarios. */
const sinceLast = (ats: number[], t: number) => { const past = ats.filter(x => x <= t); return past.length ? t - Math.max(...past) : Infinity; };
const HAND_ATS = [1000, 3000, 5000], HAND_CARDS: { zone: FieldZone; at: number }[] = [{ zone: 'M2', at: 1000 }, { zone: 'M3', at: 3000 }, { zone: 'M4', at: 5000 }];
/** An arm that follows the card down, rests over its top edge for 700 ms after it arrives (400 ms slide), then withdraws upward over 400 ms. */
const handOver = (t: number): Arm[] => HAND_CARDS.flatMap(({ zone, at }) => {
  const leave = at + 400 + 700, end = leave + 400, q = pose({ id: '', zone, at }, t); if (!q || t >= end) return [];
  return [{ x: q.x + 8, y: q.y - CARD_H * .6 - (t < leave ? 0 : (t - leave) / 400 * 200), rx: 34, ry: 80 }];
});
const SHAKE_ATS = [1000, 3000, 5000];
scenarios.push(
  { name: 'synth-hand', seconds: 8, arms: handOver, places: [
      { id: a[0], zone: 'M2', at: 1000 }, { id: a[1], zone: 'M3', at: 3000 }, { id: a[2], zone: 'M4', at: 5000 },
    ], labels: [label(1000, 'summon', a[0], 'M2'), label(3000, 'summon', a[1], 'M3'), label(5000, 'summon', a[2], 'M4')] },
  { name: 'synth-focus', seconds: 8, blur: t => 2.6 * Math.max(0, 1 - sinceLast(SHAKE_ATS, t) / 1500), places: [
      { id: a[3], zone: 'M2', at: 1000 }, { id: a[4], zone: 'M3', at: 3000 }, { id: a[5], zone: 'M4', at: 5000 },
    ], labels: [label(1000, 'summon', a[3], 'M2'), label(3000, 'summon', a[4], 'M3'), label(5000, 'summon', a[5], 'M4')] },
  { name: 'synth-shake', seconds: 8, jitter: t => { const k = Math.max(0, 1 - sinceLast(SHAKE_ATS, t) / 1000); return { dx: Math.round((random() - .5) * 10 * k), dy: Math.round((random() - .5) * 10 * k), light: 1 }; }, places: [
      { id: a[6], zone: 'M2', at: 1000 }, { id: a[7], zone: 'M3', at: 3000 }, { id: a[0], zone: 'M4', at: 5000 },
    ], labels: [label(1000, 'summon', a[6], 'M2'), label(3000, 'summon', a[7], 'M3'), label(5000, 'summon', a[0], 'M4')] },
  { name: 'synth-two', seconds: 8, places: [
      { id: a[1], zone: 'M2', at: 1000 }, { id: a[2], zone: 'M4', at: 1000 },
      { id: a[3], zone: 'S2', at: 4000, from: { x: centre('S2').x, y: H + CARD_H } }, { id: a[4], zone: 'S4', at: 4000, from: { x: centre('S4').x, y: H + CARD_H } },
    ], labels: [label(1000, 'summon', a[1], 'M2'), label(1000, 'summon', a[2], 'M4'), label(4000, 'summon', a[3], 'S2'), label(4000, 'summon', a[4], 'S4')] },
);

await mkdir(join(out, 'clips'), { recursive: true }); await mkdir(join(out, 'labels'), { recursive: true });
for (const s of scenarios) {
  const frames: { meta: ClipFrameMeta; bytes: Uint8Array }[] = [];
  const gap = 1000 / FPS;
  for (let i = 0, t = 0; t <= s.seconds * 1000; i++, t = Math.round(i * gap)) {
    const pieces: Piece[] = [];
    for (const p of s.places) {
      const q = pose(p, t); if (!q) continue;
      pieces.push({ image: q.down ? back : faces.get(p.id)!, x: q.x, y: q.y, scaleX: q.scaleX, angle: p.tilt });
    }
    // The jitter case moves the whole camera view a pixel or two and flickers the light, like a hand-held phone under a lamp.
    const j = s.jitter?.(t);
    const { bytes } = await render(pieces, j?.light ?? 1, j?.dx ?? 0, j?.dy ?? 0, s.arms?.(t), s.blur?.(t));
    const name = `frames/${String(i).padStart(5, '0')}.jpg`;
    frames.push({ meta: { at: START_MS + t, name, width: W, height: H, bytes: bytes.length }, bytes });
  }
  for (const variant of s.variants ?? ['deck', 'open'] as const) {
    const session: ClipSession = {
      version: CLIP_VERSION, savedAt: new Date().toISOString(), clipStartAt: START_MS, clipEndAt: START_MS + s.seconds * 1000, windowMs: 30_000,
      camera: { width: W, height: H }, frame: { width: W, height: H, fps: FPS, type: 'image/jpeg' }, calibration, frameCalibration: calibration, format: 'normal',
      ...(variant === 'deck' ? { decklist: deck.filter(id => !s.offList?.includes(id)) } : {}), backend: 'wasm', detectorBackend: 'wasm', seat: 0, note: `synthetic ${s.name}`,
      cost: { frames: frames.length, bytes: frames.reduce((n, f) => n + f.bytes.length, 0), events: 0, encodeMsMean: 0, encodeMsMax: 0, encodeMsTotal: 0, dropped: 0, activeS: s.seconds },
    };
    const truth: ClipTruth = { version: 1, clip: `${s.name}-${variant}`, draft: false, events: s.labels };
    await writeFile(join(out, 'clips', `${s.name}-${variant}.ddclip`), writeZip(buildClipEntries(session, frames, [], truth)));
    await writeFile(join(out, 'labels', `${s.name}-${variant}.json`), JSON.stringify(truth, null, 1));
  }
  console.log(`${s.name}: ${frames.length} frames, ${s.labels.length} labels`);
}
console.log(`Wrote clips to ${join(out, 'clips')}. Cards on the mat: ${onMat.map(e => `${e.cardId} ${e.name}`).join('; ')}. Deck list: ${deck.length} cards.`);

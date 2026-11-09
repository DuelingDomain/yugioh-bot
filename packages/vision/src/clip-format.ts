// Clip bundle (.ddclip): the last 30 s of the local player's own mat camera plus everything the field
// watcher saw and did, saved to the player's own computer. Nothing here is uploaded. One file is a plain
// zip (STORE only, so browsers and Node write it without a dependency): session.json, frames.json,
// frames/NNNNN.jpg, events.jsonl, truth.json (labels, empty draft), README.txt.
import type { DetectedQuad, RecognitionResult } from './types';
import type { FieldCalibration, FieldFormat, FieldZone } from './field-zones';
import { createFieldCalibration } from './field-zones';
import type { FieldEvent, FieldTiming } from './field-watcher';

export const CLIP_VERSION = 1;
export const CLIP_EXTENSION = '.ddclip';

/** Fractions of the camera frame. */
export interface ClipRect { x: number; y: number; w: number; h: number }

export interface ClipSession {
  version: typeof CLIP_VERSION;
  /** Wall clock when the file was saved, for the file list only. */
  savedAt: string;
  /** Watcher clock (ms) of the first and last saved frame; event and frame `at` use the same clock. */
  clipStartAt: number; clipEndAt: number;
  windowMs: number;
  camera: { width: number; height: number };
  /** Saved frames: size after crop and downscale, source crop (camera fractions) and the target rate. */
  frame: { width: number; height: number; crop?: ClipRect; fps: number; type: string };
  /** Calibration in camera coordinates (as the watcher ran) and the same grid rebased to the saved frames. */
  calibration?: FieldCalibration; frameCalibration?: FieldCalibration;
  format?: FieldFormat;
  /** Card ids the reader was told to prefer (the seat deck list) and their count. */
  decklist?: string[];
  backend?: string; detectorBackend?: string; threads?: number;
  model?: { id?: string; sha256?: string }; indexVersion?: string;
  userAgent?: string; hardwareConcurrency?: number;
  seat?: number; room?: string;
  /** Measured recorder cost while the ring buffer ran. */
  cost: ClipRecorderStats;
  note?: string;
}

export interface ClipRecorderStats {
  frames: number; bytes: number; events: number;
  /** Frame encode time (main thread draw + encode), mean and max per frame, and total over the session. */
  encodeMsMean: number; encodeMsMax: number; encodeMsTotal: number;
  /** Frames the recorder skipped because an encode was still running. */
  dropped: number;
  /** Seconds the recorder was active. */
  activeS: number;
}

export interface ClipFrameMeta { at: number; name: string; width: number; height: number; bytes: number }

/** A recognition result with the heavy fields removed (embeddings, crops, raw evidence). */
export interface SlimRecognitionResult {
  candidates: RecognitionResult['candidates'];
  tier: RecognitionResult['tier'];
  quality: RecognitionResult['quality'];
  timingsMs: RecognitionResult['timingsMs'];
  backend: RecognitionResult['backend'];
  prior?: string; preclean?: RecognitionResult['preclean']; runtime?: RecognitionResult['runtime'];
  detectedCard?: DetectedQuad;
}

export type SlimFieldEvent = Omit<FieldEvent, 'result'> & { result?: SlimRecognitionResult };

export type ClipEvent = { at: number } & (
  | { kind: 'watcher'; event: SlimFieldEvent }
  | { kind: 'detect'; ms: number; cards: DetectedQuad[]; opts?: unknown }
  | { kind: 'read'; ms: number; frames: number; card?: DetectedQuad; result?: SlimRecognitionResult; error?: string; opts?: { k?: number; closedSet?: boolean } }
  | { kind: 'action'; action: 'confirm' | 'dismiss' | 'forget' | 'undo' | 'scan' | 'calibration' | 'note'; data?: Record<string, unknown> }
  | { kind: 'timing'; timing: FieldTiming }
);

/** What really happened on the mat (owner labels). `t` is ms from clipStartAt. */
export type ClipTruthKind =
  | 'summon' | 'set' | 'flip' | 'activate' | 'destroy' | 'tribute' | 'banish' | 'return' | 'draw' | 'mill' | 'search'
  | 'detach' | 'attach' | 'equip' | 'control' | 'token' | 'counter' | 'lp' | 'phase' | 'attack' | 'position' | 'move' | 'remove' | 'placed' | 'other';
export type ClipTruthPlace = FieldZone | 'HAND' | 'OFF';
export interface ClipTruthSide { zone: ClipTruthPlace; slot?: number; faceUp?: boolean; position?: 'attack' | 'defense'; /** Xyz material stack, counters, tokens. */ materials?: string[]; counters?: number }
export interface ClipTruthEvent {
  t: number;
  kind: ClipTruthKind;
  /** Summon kind detail (normal, special, tribute, xyz, synchro, link, fusion, pendulum) or counter/LP detail. */
  detail?: string;
  cardId?: string; name?: string; seat?: number;
  from?: ClipTruthSide; to?: ClipTruthSide;
  /** What the camera could see: whole card, one end, hidden (hand or under a stack), or a voice/tap/hold-up signal at `signalT`. */
  visibility?: 'camera' | 'partial' | 'hidden' | 'signal'; signalT?: number;
  /** Label origin: a draft from watcher/prompt events, or the owner. */
  source?: 'draft' | 'owner';
  note?: string;
}
export interface ClipTruth { version: 1; clip?: string; draft?: boolean; events: ClipTruthEvent[]; note?: string }

export const EMPTY_TRUTH: ClipTruth = { version: 1, draft: true, events: [] };

export const CLIP_README = `Dueling Domain Remote Duels clip (.ddclip)
This file was saved on your computer by the "Save last 30 s" button. It was not uploaded.
It contains your camera view of the mat (frames/), the card reader's events (events.jsonl),
settings (session.json) and a label file (truth.json). It can show your hands and sleeves.
Replay: npx tsx scripts/vision/replay-clip.ts <file>. Labels: npx tsx scripts/vision/label-clip.ts <file>.
`;

export function slimResult(result: RecognitionResult): SlimRecognitionResult {
  return { candidates: result.candidates.slice(0, 5), tier: result.tier, quality: result.quality, timingsMs: result.timingsMs, backend: result.backend, prior: result.prior, preclean: result.preclean, runtime: result.runtime, detectedCard: result.detectedCard };
}
export function slimEvent(event: FieldEvent): SlimFieldEvent {
  const { result, ...rest } = event;
  const track = { ...event.track };
  // Drop the per-track reference crop: it is a browser pixel buffer, not JSON.
  delete (track as unknown as Record<string, unknown>).crop;
  return { ...rest, track, result: result ? slimResult(result) : undefined };
}

/** Mat crop: the calibration quad's bounding box plus a margin, clamped to the frame. */
export function matCropRect(calibration: FieldCalibration | undefined, margin = .1): ClipRect | undefined {
  if (!calibration?.corners?.length) return undefined;
  const xs = calibration.corners.map(p => p.x), ys = calibration.corners.map(p => p.y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const mx = (x1 - x0) * margin, my = (y1 - y0) * margin;
  const x = Math.max(0, x0 - mx), y = Math.max(0, y0 - my), w = Math.min(1, x1 + mx) - x, h = Math.min(1, y1 + my) - y;
  if (!(w > .05 && h > .05)) return undefined;
  return { x, y, w, h };
}

/** The same grid expressed in the cropped frame's coordinates (zone overrides are mat-relative and stay). */
export function rebaseCalibration(calibration: FieldCalibration, crop: ClipRect | undefined): FieldCalibration {
  if (!crop) return calibration;
  const corners = calibration.corners.map(p => ({ x: (p.x - crop.x) / crop.w, y: (p.y - crop.y) / crop.h }));
  return createFieldCalibration(corners, calibration.orientation, calibration.zoneSpacing, calibration.zones);
}

// ---- Minimal zip (STORE) writer and reader. No dependency: browsers and Node both use it. ----

const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(data: Uint8Array): number { let c = 0xFFFFFFFF; for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

export interface ZipEntry { name: string; data: Uint8Array }
const encoder = new TextEncoder(), decoder = new TextDecoder();
export const utf8 = (text: string) => encoder.encode(text);
export const fromUtf8 = (bytes: Uint8Array) => decoder.decode(bytes);

function dosTime(date: Date) { return { time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1), date: ((date.getFullYear() - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate() }; }

/** Writes entries uncompressed (JPEG frames do not compress; JSON is small). */
export function writeZip(entries: ZipEntry[], now = new Date()): Uint8Array {
  const { time, date } = dosTime(now);
  const locals: Uint8Array[] = [], centrals: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name), crc = crc32(entry.data), size = entry.data.length;
    const local = new Uint8Array(30 + name.length); const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(4, 20, true); lv.setUint16(6, 0x0800, true); lv.setUint16(8, 0, true);
    lv.setUint16(10, time, true); lv.setUint16(12, date, true); lv.setUint32(14, crc, true); lv.setUint32(18, size, true); lv.setUint32(22, size, true);
    lv.setUint16(26, name.length, true); lv.setUint16(28, 0, true); local.set(name, 30);
    const central = new Uint8Array(46 + name.length); const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true); cv.setUint16(8, 0x0800, true); cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true); cv.setUint16(14, date, true); cv.setUint32(16, crc, true); cv.setUint32(20, size, true); cv.setUint32(24, size, true);
    cv.setUint16(28, name.length, true); cv.setUint16(30, 0, true); cv.setUint16(32, 0, true); cv.setUint16(34, 0, true); cv.setUint16(36, 0, true); cv.setUint32(38, 0, true); cv.setUint32(42, offset, true); central.set(name, 46);
    locals.push(local, entry.data); centrals.push(central); offset += local.length + size;
  }
  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array(22); const ev = new DataView(end.buffer);
  ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, entries.length, true); ev.setUint16(10, entries.length, true); ev.setUint32(12, centralSize, true); ev.setUint32(16, offset, true);
  const out = new Uint8Array(offset + centralSize + 22); let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
}

/** Reads STORE entries; DEFLATE entries (method 8) need `inflateRaw` (Node: zlib.inflateRawSync). */
export function readZip(bytes: Uint8Array, inflateRaw?: (data: Uint8Array) => Uint8Array): ZipEntry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a zip file (no end record)');
  const count = view.getUint16(eocd + 10, true); let p = view.getUint32(eocd + 16, true);
  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error('Bad zip central directory');
    const method = view.getUint16(p + 10, true), compressed = view.getUint32(p + 20, true), nameLength = view.getUint16(p + 28, true), extraLength = view.getUint16(p + 30, true), commentLength = view.getUint16(p + 32, true), local = view.getUint32(p + 42, true);
    const name = fromUtf8(bytes.subarray(p + 46, p + 46 + nameLength));
    const localName = view.getUint16(local + 26, true), localExtra = view.getUint16(local + 28, true), start = local + 30 + localName + localExtra;
    const raw = bytes.subarray(start, start + compressed);
    if (method === 0) entries.push({ name, data: raw });
    else if (method === 8) { if (!inflateRaw) throw new Error(`Zip entry ${name} is deflated: pass inflateRaw`); entries.push({ name, data: inflateRaw(raw) }); }
    else throw new Error(`Zip entry ${name}: unsupported method ${method}`);
    p += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

export interface ClipBundle { session: ClipSession; frames: ClipFrameMeta[]; events: ClipEvent[]; truth: ClipTruth; frameBytes: (name: string) => Uint8Array | undefined }

export function buildClipEntries(session: ClipSession, frames: { meta: ClipFrameMeta; bytes: Uint8Array }[], events: ClipEvent[], truth: ClipTruth = EMPTY_TRUTH): ZipEntry[] {
  return [
    { name: 'README.txt', data: utf8(CLIP_README) },
    { name: 'session.json', data: utf8(JSON.stringify(session, null, 1)) },
    { name: 'frames.json', data: utf8(JSON.stringify(frames.map(f => f.meta))) },
    { name: 'events.jsonl', data: utf8(events.map(e => JSON.stringify(e)).join('\n') + (events.length ? '\n' : '')) },
    { name: 'truth.json', data: utf8(JSON.stringify(truth, null, 1)) },
    ...frames.map(f => ({ name: f.meta.name, data: f.bytes })),
  ];
}

export function parseClip(bytes: Uint8Array, inflateRaw?: (data: Uint8Array) => Uint8Array): ClipBundle {
  const entries = new Map(readZip(bytes, inflateRaw).map(e => [e.name, e.data]));
  const text = (name: string) => { const data = entries.get(name); if (!data) throw new Error(`Clip has no ${name}`); return fromUtf8(data); };
  const session = JSON.parse(text('session.json')) as ClipSession;
  if (session.version !== CLIP_VERSION) throw new Error(`Clip version ${session.version} is not supported`);
  const frames = JSON.parse(text('frames.json')) as ClipFrameMeta[];
  const events = text('events.jsonl').split('\n').filter(Boolean).map(line => JSON.parse(line) as ClipEvent);
  const truth = entries.has('truth.json') ? JSON.parse(text('truth.json')) as ClipTruth : EMPTY_TRUTH;
  return { session, frames, events, truth, frameBytes: name => entries.get(name) };
}

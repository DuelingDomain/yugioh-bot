/** Shared code of the recording tools (replay-recording.ts, compare-recordings.ts, harvest-labels.ts): read a saved Remote Duels test
 *  recording and its sidecar, turn the saved room events into video time and a board timeline, extract frames, and replay a clip.
 *  Offline only: no network, no upload, no training. */
import { mkdtemp, mkdir, readFile, readdir, rm } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createFieldCalibration, mapFieldZone, type FieldCalibration, type FieldFormat, type FieldZone } from '../../packages/vision/src/field-zones';
import { percentile, replayClip, type ReplayEvent, type ReplayRead } from '../../packages/vision/src/clip-replay';
import type { ClipBundle, ClipFrameMeta, ClipSession } from '../../packages/vision/src/clip-format';
import type { FieldWatcherOptions } from '../../packages/vision/src/field-watcher';
import type { DetectedQuad, RecognitionResult } from '../../packages/vision/src/types';
import { jpegDecoder } from './clip-node';
import type { LoadedRecognizer } from './recognizer-switch';

export interface Sidecar {
  tableSlug?: string; seat?: number; userId?: number; serverStartMs?: number; startedAt?: string; video?: { width: number; height: number }; endReason?: string; chunks?: number; droppedChunks?: number;
  client?: { recorderStartDateNow?: number | null; videoStartDateNow?: number | null; videoStartPerfNow?: number | null; timeOrigin?: number | null; clockOffsetMs?: number | null; rttMs?: number | null; backend?: string | null; userAgent?: string | null; appVersion?: string | null };
}
export const sidecarPath = (video: string) => video.slice(0, -extname(video).length) + '.json';
export const readSidecar = async (video: string) => JSON.parse(await readFile(sidecarPath(video), 'utf8')) as Sidecar;
export const round = (n: number, digits = 2) => Math.round(n * 10 ** digits) / 10 ** digits;
export const wholeFrameCalibration = () => createFieldCalibration([{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }]);
export const loadCalibration = async (file?: string): Promise<FieldCalibration> => {
  if (!file) return wholeFrameCalibration();
  const parsed = JSON.parse(await readFile(file, 'utf8')) as FieldCalibration | { calibration?: FieldCalibration };
  return 'corners' in parsed ? parsed : parsed.calibration ?? wholeFrameCalibration();
};

/** Video time 0 on the client clock. New files carry `timeOrigin + videoStartPerfNow` (the clock the camera stamps use); older ones only the start request time, which is a little early. */
export function videoOrigin(sidecar: Sidecar): number | undefined {
  const c = sidecar.client;
  return c?.videoStartPerfNow != null && c.timeOrigin != null ? c.timeOrigin + c.videoStartPerfNow : c?.videoStartDateNow ?? c?.recorderStartDateNow ?? undefined;
}

// ---- room events -> video time -------------------------------------------------------------------------------------------------------------------

export type TimeBasis = 'cam' | 'server-offset' | 'server-start';
export interface LiveAction {
  /** Index in the saved list (after sorting by seq). */ n: number; seq?: number; key?: string; seat?: number; type: string;
  /** Best video time (ms from video start): the camera `sentAt` stamp, else the server `at` mapped with the sidecar clock offset, else `at` minus the server start of the recording (rough). */ t: number; basis: TimeBasis;
  seenT?: number; namedT?: number; sentT?: number;
  /** 'auto' = the field watcher sent it; 'player' = a person did (click, voice, typed, drawer, tray). */ origin: 'auto' | 'player'; rawSource?: string;
  zone?: string; slot?: number; ref?: string; cardId?: number; name?: string; bestMatch?: boolean; faceUp?: boolean; targetKey?: string;
}
export interface LiveParse { actions: LiveAction[]; gaps: string[]; truncated: boolean; origin?: number }

/** `raw` = the object saved from GET /api/remote/<slug> (it has `events`) or the event array. Only twin / identify / undo actions are kept. */
export function parseLiveActions(raw: unknown, sidecar: Sidecar): LiveParse {
  const list = (Array.isArray(raw) ? raw : (raw as { events?: unknown[] } | null)?.events ?? []) as { seq?: number; at?: number; action?: Record<string, unknown> }[];
  const gaps: string[] = [], origin = videoOrigin(sidecar), offset = sidecar.client?.clockOffsetMs;
  const sorted = [...list].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.at ?? 0) - (b.at ?? 0));
  const minSeq = sorted.find(e => typeof e.seq === 'number')?.seq, truncated = minSeq !== undefined && minSeq > 1;
  if (truncated) gaps.push(`The event list starts at seq ${minSeq}: earlier events are missing (GET /api/remote/<slug> returns only the last 50). Cards placed before it have no place event, so they cannot be tied to corrections, and empty zones cannot be proven.`);
  if (origin === undefined) gaps.push('The sidecar has no recorder start time, so events cannot be put on video time.');
  else if (offset == null && sidecar.serverStartMs === undefined) gaps.push('The sidecar has no clock offset and no server start: events without a camera stamp cannot get a video time.');
  const toVideo = (clientMs?: number) => clientMs === undefined || origin === undefined ? undefined : clientMs - origin;
  const actions: LiveAction[] = [];
  sorted.forEach((item, n) => {
    const a = item.action; if (!a || typeof a.type !== 'string') return;
    const type = a.type; if (!type.startsWith('twin.') && type !== 'card.identified' && type !== 'undo') return;
    if (typeof item.at !== 'number' || origin === undefined) return;
    const cam = a.cam as { seenAt?: number; namedAt?: number; sentAt?: number } | undefined;
    let t: number, basis: TimeBasis;
    if (cam?.sentAt !== undefined) { t = cam.sentAt - origin; basis = 'cam'; }
    else if (offset != null) { t = toVideo(item.at - offset)!; basis = 'server-offset'; }
    else if (sidecar.serverStartMs !== undefined) { t = item.at - sidecar.serverStartMs; basis = 'server-start'; }
    else return;
    const card = a.card as { ref?: string; cardId?: number; passcode?: number; name?: string; slot?: number; bestMatch?: boolean; faceUp?: boolean } | undefined;
    const source = typeof a.source === 'string' ? a.source : undefined;
    // `source: 'auto'` is set by the field watcher on place, move, flip, remove and identify; a person's action has none (or click/voice/typed).
    const origin2: LiveAction['origin'] = source === 'auto' ? 'auto' : 'player';
    actions.push({
      n, seq: item.seq, key: typeof a.idempotencyKey === 'string' ? a.idempotencyKey : undefined, seat: typeof a.seat === 'number' ? a.seat : typeof a.actorSeat === 'number' ? a.actorSeat : undefined,
      type, t, basis, seenT: toVideo(cam?.seenAt), namedT: toVideo(cam?.namedAt), sentT: toVideo(cam?.sentAt), origin: origin2, rawSource: source,
      zone: typeof a.zone === 'string' ? a.zone : undefined, slot: typeof (a.slot ?? card?.slot) === 'number' ? (a.slot ?? card?.slot) as number : undefined,
      ref: (card?.ref ?? a.cardRef) as string | undefined, cardId: (card?.cardId ?? card?.passcode ?? a.cardId ?? a.passcode) as number | undefined, name: (card?.name ?? a.name) as string | undefined,
      bestMatch: (card?.bestMatch ?? a.bestMatch) as boolean | undefined, faceUp: (card?.faceUp ?? a.faceUp) as boolean | undefined, targetKey: type === 'undo' ? a.targetActionId as string : undefined,
    });
  });
  return { actions, gaps, truncated, origin };
}

/** An event zone name plus slot as a mat zone; undefined off the mat (hand) or when the slot is missing. */
export function matZone(zone: string | undefined, slot: number | undefined): FieldZone | undefined {
  if (!zone) return undefined;
  if (zone === 'monster' && slot) return `M${slot}` as FieldZone;
  if (zone === 'spell-trap' && slot) return `S${slot}` as FieldZone;
  if (zone === 'extra-monster' && slot) return `EMZ${slot}` as FieldZone;
  return ({ field: 'FIELD', graveyard: 'GY', banished: 'BANISHED', deck: 'DECK', extra: 'EXTRA' } as Record<string, FieldZone | undefined>)[zone];
}
/** Zones where one physical card lies and can be cropped (not piles). */
export const SINGLE_ZONES = new Set<string>(['M1', 'M2', 'M3', 'M4', 'M5', 'S1', 'S2', 'S3', 'S4', 'S5', 'EMZ1', 'EMZ2', 'FIELD']);

export interface NameChange { t: number; cardId?: number; name?: string; origin: 'auto' | 'player'; bestMatch?: boolean; key?: string }
export type SpanEnd = 'removed-auto' | 'removed-player' | 'moved' | 'undone-player' | 'clip-end';
/** One card (twin ref) in one mat zone, from appearing to leaving. `names` is every identity event of the card in order. */
export interface TwinSpan { ref: string; zone: FieldZone; from: number; to: number; end: SpanEnd; placedAuto: boolean; placeKey?: string; names: NameChange[]; seat?: number }
export interface Timeline { spans: TwinSpan[]; gaps: string[]; /** Video time before which nothing is known about the board (the first twin event); Infinity when there are no events, so nothing counts as empty. */ knownFrom: number }

/** Builds what the room events say was on the mat (this seat only), by twin ref. `spanMs` is the clip length, for cards still on the mat at the end. */
export function buildTimeline(actions: LiveAction[], seat: number | undefined, spanMs: number): Timeline {
  const gaps: string[] = [], spans: TwinSpan[] = [], open = new Map<string, TwinSpan>(), byKey = new Map<string, LiveAction>(), nameKeys = new Map<string, { span: TwinSpan; change: NameChange }>();
  const mine = actions.filter(a => seat === undefined || a.seat === undefined || a.seat === seat);
  const knownFrom = mine.length ? Math.min(...mine.map(a => a.seenT ?? a.t)) : Infinity;
  const close = (span: TwinSpan, to: number, end: SpanEnd) => { span.to = to; span.end = end; open.delete(span.ref); };
  const begin = (ref: string, zone: FieldZone, from: number, a: LiveAction, names: NameChange[]) => { const s: TwinSpan = { ref, zone, from, to: spanMs, end: 'clip-end', placedAuto: a.origin === 'auto', placeKey: a.key, names: [...names], seat: a.seat }; spans.push(s); open.set(ref, s); return s; };
  const addName = (span: TwinSpan, a: LiveAction) => {
    if (a.cardId === undefined && !a.name) return;
    const change: NameChange = { t: a.t, cardId: a.cardId, name: a.name, origin: a.origin, bestMatch: a.bestMatch, key: a.key }; span.names.push(change); if (a.key) nameKeys.set(a.key, { span, change });
  };
  const ofZone = (zone: FieldZone) => [...open.values()].find(s => s.zone === zone);
  for (const a of mine) {
    if (a.key) byKey.set(a.key, a);
    if (a.type === 'twin.place') {
      const zone = matZone(a.zone, a.slot); if (!a.ref) continue;
      if (open.has(a.ref)) close(open.get(a.ref)!, a.seenT ?? a.t, 'moved');
      if (!zone) { gaps.push(`twin.place ${a.ref}: zone "${a.zone}" with slot ${a.slot ?? 'none'} is not a mat zone; skipped`); continue; }
      const s = begin(a.ref, zone, a.seenT ?? a.t, a, []); addName(s, a);
    } else if (a.type === 'twin.move' && a.ref) {
      const span = open.get(a.ref), zone = matZone(a.zone, a.slot);
      if (!span) { if (zone) gaps.push(`twin.move ${a.ref}: no earlier place event for this card (event list incomplete?)`); continue; }
      if (zone && zone === span.zone) { addName(span, a); continue; }
      close(span, a.t, 'moved');
      if (zone && SINGLE_ZONES.has(zone)) { const next = begin(a.ref, zone, a.t, { ...a, origin: span.placedAuto ? 'auto' : 'player' }, span.names); next.placedAuto = span.placedAuto; if (a.name || a.cardId) addName(next, a); }
    } else if (a.type === 'twin.flip' && a.ref) { const span = open.get(a.ref); if (span && a.faceUp !== false) addName(span, a); }
    else if (a.type === 'card.identified') {
      let span = a.ref ? open.get(a.ref) : undefined;
      if (!span && !a.ref) { const zone = matZone(a.zone, a.slot); span = zone ? ofZone(zone) : undefined; if (!span) gaps.push('card.identified has no cardRef and no open card in its zone: it cannot be tied to a tracked card'); }
      else if (!span) gaps.push(`card.identified for ${a.ref}: no open card with that ref (place event missing?)`);
      if (span) addName(span, a);
    } else if (a.type === 'twin.remove' && a.ref) {
      const span = open.get(a.ref); if (span) close(span, a.t, a.origin === 'auto' ? 'removed-auto' : 'removed-player');
    } else if (a.type === 'undo' && a.targetKey) {
      const target = byKey.get(a.targetKey); if (!target) { gaps.push(`undo targets ${a.targetKey}, which is not in the list`); continue; }
      if (target.type === 'twin.place') { const span = spans.find(s => s.placeKey === target.key); if (span && open.get(span.ref) === span) close(span, a.t, 'undone-player'); }
      else if (target.type === 'card.identified') { const hit = nameKeys.get(a.targetKey); if (hit) hit.span.names.splice(hit.span.names.indexOf(hit.change), 1); }
    }
  }
  return { spans, gaps, knownFrom };
}
/** Does the timeline say a card lay in `zone` at video time `t` (ms), with `slackMs` either side for event and clock lag? Unknown before the first event counts as occupied. */
export const occupiedAt = (tl: Timeline, zone: string, t: number, slackMs = 2000) => t < tl.knownFrom || tl.spans.some(s => s.zone === zone && t >= s.from - slackMs && t <= s.to + slackMs);

// ---- frames, bundle, replay -----------------------------------------------------------------------------------------------------------------------

export function extractFrames(video: string, dir: string, o: { fps: number; from?: number; duration?: number; maxWidth?: number }) {
  const args = ['-v', 'error', '-ss', String(o.from ?? 0), ...(o.duration ? ['-t', String(o.duration)] : []), '-i', video, '-an', '-vf', `fps=${o.fps},scale='min(${o.maxWidth ?? 1280},iw)':-2`, '-q:v', '4', join(dir, '%06d.jpg')];
  const ffmpeg = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (ffmpeg.status !== 0) throw new Error('ffmpeg failed (is it on PATH?)');
}
export const hasFfmpeg = () => spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;
export async function withFrames<T>(video: string, o: { fps: number; from?: number; duration?: number; keep?: string }, use: (dir: string, names: string[]) => Promise<T>): Promise<T> {
  const keep = o.keep ? resolve(o.keep) : undefined, dir = keep ?? await mkdtemp(join(tmpdir(), 'dd-recording-'));
  try {
    await mkdir(dir, { recursive: true }); extractFrames(video, dir, o);
    const names = (await readdir(dir)).filter(n => n.endsWith('.jpg')).sort();
    if (!names.length) throw new Error('No frames were extracted');
    return await use(dir, names);
  } finally { if (!keep) await rm(dir, { recursive: true, force: true }); }
}
export async function frameSize(dir: string, name: string) { const sharp = (await import('sharp')).default, m = await sharp(join(dir, name)).metadata(); return { width: m.width!, height: m.height! }; }

export interface ReadRecord { tS: number; zone: string; cardId?: string; name: string; score: number; margin: number; tier: string; sure: boolean; ms: number; top: { cardId: string; name: string; score: number }[]; error?: boolean }
export interface TrackRecord { id: string; zone: string; seenS: number; namedS?: number; toNameS?: number; cardId?: string; name?: string; removedS?: number }
export interface Stats { n: number; p50: number; p95: number; mean: number }
export const stats = (v: number[], digits = 2): Stats => ({ n: v.length, p50: round(percentile(v, .5), digits), p95: round(percentile(v, .95), digits), mean: v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, digits) : 0 });
export interface RunSummary {
  schema: 'recording-run/1'; recording: { file: string; tableSlug?: string; seat?: number; width: number; height: number };
  params: { fps: number; from: number; duration?: number; format: string; calibration: 'file' | 'whole-frame'; readScale: number };
  recognizer: { name: string; threads: number; settings: Record<string, unknown> };
  frames: number; spanS: number; wallS: number; errors: number; detects: number;
  /** Every card read, video seconds. margin = best score minus second score. */ reads: ReadRecord[]; readMs: Stats; sure: { n: number; pct: number };
  tracks: TrackRecord[];
  /** Time from a card first seen to its name, replay (tracker) and live (camera stamps of the recorded events). Seconds. */
  seenToNamed: { replay: Stats; live: { zone?: string; ref?: string; seenS: number; namedS: number; gapS: number }[]; liveStats: Stats };
  /** Reads and tracks on zones the room events say were empty. `checked` is false without events or when the event list is incomplete. */
  phantom: { checked: boolean; reason?: string; reads: ReadRecord[]; tracks: TrackRecord[] };
  live: { type: string; zone?: string; ref?: string; origin: string; basis: string; tS: number; seenS?: number; namedS?: number; sentS?: number }[];
  gaps: string[];
  /** Same as `tracks` and the sidecar, for the older --json readers. */ sidecar: Sidecar; replay: TrackRecord[];
}

export interface RunOptions {
  video: string; recognizer: LoadedRecognizer; fps?: number; from?: number; duration?: number; calibration?: FieldCalibration; calibrationFromFile?: boolean; format?: FieldFormat;
  events?: unknown; readScale?: number; keepFrames?: string;
  /** Tests: a fake frame analyzer. */ analyze?: FieldWatcherOptions['analyze'];
}

/** Replays the recording through the watcher with the chosen reader and returns the per-run summary. */
export async function runRecording(o: RunOptions): Promise<RunSummary> {
  const fps = o.fps ?? 10, from = o.from ?? 0, video = resolve(o.video), sidecar = await readSidecar(video);
  return withFrames(video, { fps, from, duration: o.duration, keep: o.keepFrames }, async (dir, names) => {
    const { width, height } = await frameSize(dir, names[0]), spanMs = (names.length - 1) * 1000 / fps;
    const frames: ClipFrameMeta[] = names.map((name, i) => ({ at: i * 1000 / fps, name, width, height, bytes: 0 }));
    const calibration = o.calibration ?? wholeFrameCalibration(), format = o.format ?? 'normal';
    const session: ClipSession = { version: 1, savedAt: new Date().toISOString(), clipStartAt: 0, clipEndAt: spanMs, windowMs: spanMs, camera: { width, height }, frame: { width, height, fps, type: 'image/jpeg' },
      calibration, frameCalibration: calibration, format, cost: { frames: names.length, bytes: 0, events: 0, encodeMsMean: 0, encodeMsMax: 0, encodeMsTotal: 0, dropped: 0, activeS: 0 }, note: 'Built from a test recording' };
    const bundle: ClipBundle = { session, frames, events: [], truth: { version: 1, draft: true, events: [] }, frameBytes: name => { try { return new Uint8Array(readFileSync(join(dir, name))); } catch { return undefined; } } };
    const decode = await jpegDecoder(), tracks = new Map<string, { zone: string; seenT: number; namedT?: number; cardId?: string; removedT?: number }>();
    const details: { read: ReplayRead; result?: RecognitionResult; card?: DetectedQuad }[] = [];
    const onEvent = (e: ReplayEvent) => {
      const track = e.event.track, entry = tracks.get(track.id) ?? { zone: track.zone, seenT: track.firstSeen };
      entry.zone = track.zone; if (track.cardId && e.event.type !== 'removed' && entry.namedT === undefined && track.state === 'identified') { entry.namedT = e.t; entry.cardId = track.cardId; }
      if (e.event.type === 'removed') entry.removedT = e.t;
      tracks.set(track.id, entry);
    };
    const result = await replayClip({ bundle, decode, recognizer: o.recognizer.recognizer, readScale: o.readScale ?? 1, answerPrompts: false, onEvent, analyze: o.analyze,
      onRead: (read, res, request) => { details.push({ read, result: res, card: request?.card }); } });
    const sec = (ms: number) => round((ms + from * 1000) / 1000, 3), nameOf = (id?: string) => o.recognizer.nameOf(id);
    const reads: ReadRecord[] = details.map(({ read, result: res, card }) => {
      const c = res?.candidates ?? [], zone = card ? mapFieldZone(card, calibration, [], format).zone : '?';
      return { tS: sec(read.t), zone, cardId: c[0]?.cardId, name: c[0] ? nameOf(c[0].cardId) : '(none)', score: round(c[0]?.score ?? 0, 4), margin: round((c[0]?.score ?? 0) - (c[1]?.score ?? 0), 4), tier: res?.tier ?? 'error',
        sure: res?.tier === 'sure', ms: round(read.ms, 1), top: c.slice(0, 3).map(x => ({ cardId: x.cardId, name: nameOf(x.cardId), score: round(x.score, 4) })), ...(read.error ? { error: true } : {}) };
    });
    const trackRows: TrackRecord[] = [...tracks.entries()].map(([id, t]) => ({ id, zone: t.zone, seenS: sec(t.seenT), namedS: t.namedT === undefined ? undefined : sec(t.namedT), toNameS: t.namedT === undefined ? undefined : round((t.namedT - t.seenT) / 1000, 3),
      cardId: t.cardId, name: t.cardId ? nameOf(t.cardId) : undefined, removedS: t.removedT === undefined ? undefined : sec(t.removedT) })).sort((a, b) => a.seenS - b.seenS);
    const parse = o.events === undefined ? undefined : parseLiveActions(o.events, sidecar), gaps = [...(parse?.gaps ?? [])];
    const timeline = parse ? buildTimeline(parse.actions, sidecar.seat, spanMs + from * 1000) : undefined;
    if (timeline) gaps.push(...timeline.gaps);
    if (timeline && timeline.knownFrom === Infinity) gaps.push('The event list holds no twin or identify events for this seat: no zone can be proven empty.');
    const phantom: RunSummary['phantom'] = { checked: false, reads: [], tracks: [] };
    if (!timeline || !parse) phantom.reason = 'no events given';
    else if (parse.truncated) phantom.reason = 'the event list is incomplete, so a zone cannot be proven empty';
    else if (parse.origin === undefined) phantom.reason = 'events cannot be put on video time';
    else {
      phantom.checked = true;
      phantom.reads = reads.filter(r => r.zone !== '?' && !r.error && !occupiedAt(timeline, r.zone, r.tS * 1000));
      phantom.tracks = trackRows.filter(t => !occupiedAt(timeline, t.zone, t.seenS * 1000));
    }
    const live = (parse?.actions ?? []).filter(a => a.type.startsWith('twin.') || a.type === 'card.identified').map(a => ({ type: a.type, zone: a.zone, ref: a.ref, origin: a.origin, basis: a.basis, tS: round(a.t / 1000, 3),
      seenS: a.seenT === undefined ? undefined : round(a.seenT / 1000, 3), namedS: a.namedT === undefined ? undefined : round(a.namedT / 1000, 3), sentS: a.sentT === undefined ? undefined : round(a.sentT / 1000, 3) }));
    const liveGaps = live.filter(l => l.seenS !== undefined && l.namedS !== undefined).map(l => ({ zone: l.zone, ref: l.ref, seenS: l.seenS!, namedS: l.namedS!, gapS: round(l.namedS! - l.seenS!, 3) }));
    if (parse && !liveGaps.length) gaps.push('No recorded event carries both cam.seenAt and cam.namedAt (older build, or no card was named): live seen-to-named time is not available.');
    const okReads = reads.filter(r => !r.error);
    return {
      schema: 'recording-run/1', recording: { file: basename(video), tableSlug: sidecar.tableSlug, seat: sidecar.seat, width, height },
      params: { fps, from, duration: o.duration, format, calibration: o.calibrationFromFile ? 'file' : 'whole-frame', readScale: o.readScale ?? 1 },
      recognizer: { name: o.recognizer.name, threads: o.recognizer.threads, settings: o.recognizer.settings },
      frames: result.frames, spanS: round(spanMs / 1000, 1), wallS: round(result.wallMs / 1000, 2), errors: result.errors, detects: result.detects,
      reads, readMs: stats(okReads.map(r => r.ms), 1), sure: { n: okReads.filter(r => r.sure).length, pct: okReads.length ? round(100 * okReads.filter(r => r.sure).length / okReads.length, 1) : 0 },
      tracks: trackRows, seenToNamed: { replay: stats(trackRows.filter(t => t.toNameS !== undefined).map(t => t.toNameS!), 3), live: liveGaps, liveStats: stats(liveGaps.map(g => g.gapS), 3) },
      phantom, live, gaps, sidecar, replay: trackRows,
    };
  });
}

// ---- compare -------------------------------------------------------------------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/["'\s]/g, '');
export interface Difference { tS: number; zone: string; names: string[]; scores: number[] }
export interface Comparison {
  recording: string; runs: { name: string; reads: number; surePct: number; readMsP50: number; readMsP95: number; wallS: number; phantomReads: number | null; toNameP50S: number; named: number; errors: number }[];
  /** For each pair of runs: reads of both within `windowS` on the same zone, how many name the same card, and the reads only one run made. */
  pairs: { a: string; b: string; aligned: number; agree: number; agreePct: number; onlyA: number; onlyB: number; differences: Difference[] }[];
}
/** Same clip required (file name, fps, from). Reads are paired by zone and time (nearest within `windowS`), agreement is by normalised card name. */
export function compareSummaries(runs: RunSummary[], windowS = 1.5): Comparison {
  if (runs.length < 2) throw new Error('Compare needs two or more run summaries');
  const first = runs[0];
  for (const r of runs) if (r.schema !== 'recording-run/1') throw new Error(`Not a run summary: schema "${String(r.schema)}"`);
  for (const r of runs.slice(1)) if (r.recording.file !== first.recording.file || r.params.fps !== first.params.fps || r.params.from !== first.params.from) throw new Error(`Runs are not of the same clip: ${first.recording.file} (fps ${first.params.fps}, from ${first.params.from}) against ${r.recording.file} (fps ${r.params.fps}, from ${r.params.from})`);
  const label = (r: RunSummary, i: number) => runs.filter(x => x.recognizer.name === r.recognizer.name).length > 1 ? `${r.recognizer.name}#${i + 1}` : r.recognizer.name;
  const names = runs.map(label);
  const out: Comparison = { recording: first.recording.file, pairs: [], runs: runs.map((r, i) => ({ name: names[i], reads: r.reads.length, surePct: r.sure.pct, readMsP50: r.readMs.p50, readMsP95: r.readMs.p95, wallS: r.wallS, phantomReads: r.phantom.checked ? r.phantom.reads.length : null,
    toNameP50S: r.seenToNamed.replay.p50, named: r.seenToNamed.replay.n, errors: r.errors })) };
  for (let i = 0; i < runs.length; i++) for (let j = i + 1; j < runs.length; j++) {
    const A = runs[i].reads.filter(r => !r.error), B = runs[j].reads.filter(r => !r.error), taken = new Set<number>(); let agree = 0, aligned = 0; const differences: Difference[] = [];
    for (const a of A) {
      let best = -1, dist = Infinity;
      B.forEach((b, k) => { const d = Math.abs(b.tS - a.tS); if (!taken.has(k) && b.zone === a.zone && d <= windowS && d < dist) { best = k; dist = d; } });
      if (best < 0) continue;
      taken.add(best); aligned++; const b = B[best];
      if (norm(a.name) === norm(b.name)) agree++; else differences.push({ tS: a.tS, zone: a.zone, names: [a.name, b.name], scores: [a.score, b.score] });
    }
    out.pairs.push({ a: names[i], b: names[j], aligned, agree, agreePct: aligned ? round(100 * agree / aligned, 1) : 0, onlyA: A.length - aligned, onlyB: B.length - aligned, differences });
  }
  return out;
}
export function formatComparison(c: Comparison): string {
  const table = (head: string[], rows: string[][]) => { const w = head.map((h, i) => Math.max(h.length, ...rows.map(r => r[i].length))); const line = (r: string[]) => r.map((x, i) => i ? x.padStart(w[i]) : x.padEnd(w[i])).join('  '); return [line(head), line(w.map(n => '-'.repeat(n))), ...rows.map(line)].join('\n'); };
  const lines = [`Clip ${c.recording}`, '', table(['recognizer', 'reads', 'sure %', 'read p50 ms', 'read p95 ms', 'wall s', 'phantom reads', 'named', 'to name p50 s', 'errors'],
    c.runs.map(r => [r.name, String(r.reads), String(r.surePct), String(r.readMsP50), String(r.readMsP95), String(r.wallS), r.phantomReads === null ? 'n/a' : String(r.phantomReads), String(r.named), String(r.toNameP50S), String(r.errors)]))];
  lines.push('', table(['pair', 'aligned', 'agree', 'agree %', 'only first', 'only second'], c.pairs.map(p => [`${p.a} vs ${p.b}`, String(p.aligned), String(p.agree), String(p.agreePct), String(p.onlyA), String(p.onlyB)])));
  for (const p of c.pairs) if (p.differences.length) {
    lines.push('', `Differences, ${p.a} vs ${p.b} (video s, zone)`);
    for (const d of p.differences) lines.push(`  ${d.tS.toFixed(2).padStart(7)}  ${d.zone.padEnd(5)} ${d.names[0]} (${d.scores[0]})  |  ${d.names[1]} (${d.scores[1]})`);
  }
  return lines.join('\n');
}

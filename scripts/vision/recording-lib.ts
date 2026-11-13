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
// ---- sidecar extras written by the recording-evidence change (PR #605); the format is read ONLY in these functions, so a change there stays small ----------------
//  client.clockSamples: [{ n, serverMs, offsetMs (server minus client clock), rttMs }], one per chunk.
//  calibrations: [{ at (client clock), serverMs, format, placed, needed, calibration: { version, layout, corners, orientation, zoneSpacing | null, zones } }], the live calibration at the start and after each change.
export interface SidecarClock {
  samples: { serverMs: number; offsetMs: number; rttMs: number }[]; /** Largest round trip seen (samples and the single client value): the safety margin for server-stamped events. */ rttMs: number;
  /** 'samples' = per-chunk samples; 'single-offset' = the one clockOffsetMs of the file; 'none' = no offset at all. */ source: 'samples' | 'single-offset' | 'none'; offsetMs?: number | null;
}
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
export function readSidecarClock(sidecar: Sidecar): SidecarClock {
  const raw = (sidecar.client as { clockSamples?: unknown } | undefined)?.clockSamples;
  const samples = (Array.isArray(raw) ? raw : []).filter((x): x is { serverMs: number; offsetMs: number; rttMs: number } => !!x && finite((x as { serverMs?: unknown }).serverMs) && finite((x as { offsetMs?: unknown }).offsetMs) && finite((x as { rttMs?: unknown }).rttMs));
  const single = sidecar.client?.clockOffsetMs, rttMs = Math.max(0, ...samples.map(x => x.rttMs), sidecar.client?.rttMs ?? 0);
  return { samples, rttMs, source: samples.length ? 'samples' : single != null ? 'single-offset' : 'none', offsetMs: single };
}
/** The clock offset (server minus client) for a server time: the sample whose serverMs is nearest, else the single value. */
export const clockOffsetAt = (clock: SidecarClock, serverMs: number): number | undefined =>
  clock.samples.length ? clock.samples.reduce((best, x) => Math.abs(x.serverMs - serverMs) < Math.abs(best.serverMs - serverMs) ? x : best).offsetMs : clock.offsetMs ?? undefined;

const FORMATS: FieldFormat[] = ['normal', 'domain', 'genesys', 'genesys-domain'];
/** One live calibration and the video time (ms) from which it was in force (-Infinity for the first). Entries that do not make a valid FieldCalibration are dropped; an unchanged repeat is merged. */
export interface SidecarCalibration { fromMs: number; format?: FieldFormat; /** false = the first-guess grid, never placed by the player. null = not said. */ placed: boolean | null; needed: boolean | null; calibration: FieldCalibration }
export function readSidecarCalibrations(sidecar: Sidecar): SidecarCalibration[] {
  const raw = (sidecar as { calibrations?: unknown }).calibrations; if (!Array.isArray(raw)) return [];
  const clock = readSidecarClock(sidecar), origin = videoOrigin(sidecar), out: (SidecarCalibration & { serverMs: number })[] = [];
  for (const e of raw as Record<string, unknown>[]) {
    const c = e?.calibration as Record<string, unknown> | null | undefined; if (!c || !Array.isArray(c.corners)) continue;
    const orientation = c.orientation as { playerSide?: never; mirrored?: boolean } | null | undefined, zones = c.zones && typeof c.zones === 'object' && Object.keys(c.zones).length ? c.zones : undefined;
    let calibration: FieldCalibration; try { calibration = createFieldCalibration(c.corners as never, (orientation ?? undefined) as never, finite(c.zoneSpacing) ? c.zoneSpacing : 1, zones as never); } catch { continue; }
    const serverMs = finite(e.serverMs) ? e.serverMs : 0, offset = clockOffsetAt(clock, serverMs), clientMs = finite(e.at) && e.at > 1e11 ? e.at : offset !== undefined ? serverMs - offset : undefined;
    const fromMs = origin !== undefined && clientMs !== undefined ? clientMs - origin : serverMs - (sidecar.serverStartMs ?? serverMs);
    out.push({ fromMs, serverMs, format: FORMATS.find(f => f === e.format), placed: typeof e.placed === 'boolean' ? e.placed : null, needed: typeof e.needed === 'boolean' ? e.needed : null, calibration });
  }
  out.sort((x, y) => x.serverMs - y.serverMs);
  const key = (x: SidecarCalibration) => JSON.stringify([x.calibration, x.format, x.placed]), merged: SidecarCalibration[] = [];
  for (const x of out) { if (merged.length && key(merged[merged.length - 1]) === key(x)) continue; merged.push({ fromMs: merged.length ? x.fromMs : -Infinity, format: x.format, placed: x.placed, needed: x.needed, calibration: x.calibration }); }
  return merged;
}
/** The live calibration in force at a video time (ms), or undefined when the sidecar has none or that one was never placed (a first-guess grid). It beats the whole-frame guess; a --calibration file beats it. */
export const sidecarCalibration = (sidecar: Sidecar, atMs = 0): FieldCalibration | undefined => {
  const list = readSidecarCalibrations(sidecar); let e: SidecarCalibration | undefined; for (const x of list) if (x.fromMs <= atMs) e = x; e ??= list[0];
  return e && e.placed !== false ? e.calibration : undefined;
};
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
/** Who did it. 'auto' = the field watcher (source 'auto', or cam.by 'camera'). 'player' = a person said so (source click/voice/typed, or cam.by 'player', or a cam.ui). 'unknown' = nothing in the event says:
 *  a button in the table UI and the watcher's own recovery send the same source-less action, so such an action is never counted as a person's. */
export type Origin = 'auto' | 'player' | 'unknown';
export interface LiveAction {
  /** Index in the saved list (after sorting by seq). */ n: number; seq?: number; key?: string; seat?: number; type: string;
  /** Best video time (ms from video start): the camera `sentAt` stamp, else the server `at` mapped with the sidecar clock offset, else `at` minus the server start of the recording (rough). */ t: number; basis: TimeBasis;
  seenT?: number; namedT?: number; sentT?: number; origin: Origin; rawSource?: string; ui?: string;
  zone?: string; slot?: number; ref?: string; /** Every card ref the action touches (card, materials, merge pair, equip target, pile cards). */ refs: string[]; cardId?: number; name?: string; bestMatch?: boolean; faceUp?: boolean; targetKey?: string;
  /** Set when the action carries instance ids and no refs (a merge by instance id): it touches cards that cannot be named. */ unnamedTargets?: boolean;
  /** Set for an action type this tool does not know (not in the handled or the harmless list): it may have moved cards, so its refs are tainted. */ unknownType?: boolean;
}
/** What the saved event list covers. A list is complete only when its seqs are exactly 1..lastSeq with no hole; GET /api/remote/<slug> alone returns the last 50, so it is rarely complete. */
export interface EventListInfo { complete: boolean; count: number; firstSeq?: number; lastSeq?: number; roomLastSeq?: number; holes: number; reason?: string }
export interface LiveParse { actions: LiveAction[]; gaps: string[]; /** True when the list is not complete (see `list`). */ truncated: boolean; origin?: number; list: EventListInfo; clock: SidecarClock; /** Action types that are neither handled nor known to be harmless, with counts (they taint the cards they name; one with no card ref stops all labels after it). */ unknownTypes: Record<string, number> }

type Raw = { seq?: number; at?: number; action?: Record<string, unknown> };
const listOf = (raw: unknown) => (Array.isArray(raw) ? raw : (raw as { events?: unknown[] } | null)?.events ?? []) as Raw[];
/** Checks the saved list against the room: exactly the seqs 1..lastSeq (`lastSeq` of the saved room object), no hole. */
export function checkEventList(raw: unknown): EventListInfo {
  const seqs = listOf(raw).map(e => e.seq).filter((s): s is number => typeof s === 'number').sort((a, b) => a - b), roomLastSeq = typeof (raw as { lastSeq?: unknown } | null)?.lastSeq === 'number' ? (raw as { lastSeq: number }).lastSeq : undefined;
  const info: EventListInfo = { complete: true, count: seqs.length, firstSeq: seqs[0], lastSeq: seqs[seqs.length - 1], roomLastSeq, holes: 0 };
  let expect = 1; for (const s of seqs) { if (s !== expect) info.holes += Math.max(1, s - expect); expect = s + 1; }
  const why: string[] = [];
  if (!seqs.length) why.push('the list is empty');
  else {
    if (info.firstSeq! > 1) why.push(`it starts at seq ${info.firstSeq} (GET /api/remote/<slug> returns only the last 50 events)`);
    if (info.holes) why.push(`${info.holes} seq number${info.holes > 1 ? 's are' : ' is'} missing between ${info.firstSeq} and ${info.lastSeq}`);
    if (roomLastSeq === undefined) why.push('the file has no room lastSeq, so its end cannot be checked (save the room object, or use export-room-events.ts)');
    else if (info.lastSeq !== roomLastSeq) why.push(`it ends at seq ${info.lastSeq} but the room reached ${roomLastSeq}`);
  }
  if (why.length) { info.complete = false; info.reason = `The event list is not complete: ${why.join('; ')}.`; }
  return info;
}

const str = (v: unknown) => typeof v === 'string' ? v : undefined, num = (v: unknown) => typeof v === 'number' ? v : undefined, strs = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];

function originOf(a: Record<string, unknown>, cam: { by?: unknown; ui?: unknown } | undefined): Origin {
  if (cam?.by === 'camera') return 'auto'; if (cam?.by === 'player' || typeof cam?.ui === 'string') return 'player';
  const source = str(a.source); return source === 'auto' ? 'auto' : source === 'click' || source === 'voice' || source === 'typed' ? 'player' : 'unknown';
}
/** The twin / identify / undo / pile actions: they say what lay on the mat; buildTimeline handles them. */
const kept = (type: string) => type.startsWith('twin.') || type === 'card.identified' || type === 'cards.identified' || type === 'undo' || type === 'pile.lift';
/** Action types known to leave every card where it is (life, phases, effects, hand, deck, notes, ...). DEFAULT DENY: any other type is treated as maybe moving cards. */
const HARMLESS = new Set(['hand.reveal', 'hand.forget', 'hand.draw', 'deck.count', 'hand.count', 'effect.activated', 'effect.choose', 'effect.announce', 'effect.context.clear', 'effect.note.dismiss', 'phase.set', 'phase.advance', 'turn.end',
  'detection.mode', 'lp.change', 'attack.declare', 'attack.resolve', 'deck.add', 'deck.flag.dismiss', 'log.note', 'pile.order', 'player.concede', 'player.leave']);
/** `hand.add` is harmless only when the card came from a pile or the deck: from the field (or an unknown place) it left a mat zone with no card ref. */
const isHarmless = (type: string, a: Record<string, unknown>) => HARMLESS.has(type) || (type === 'hand.add' && ['deck', 'extra', 'gy', 'banish'].includes(str(a.source) ?? ''));
/** Every string under a key that looks like a card ref (cardRef, materialRefs, ref, ...), for an action type this tool does not know. */
const deepRefs = (v: unknown, key = '', depth = 0, out = new Set<string>()): Set<string> => {
  if (depth > 4) return out;
  if (typeof v === 'string') { if (/ref/i.test(key)) out.add(v); } else if (Array.isArray(v)) v.forEach(x => deepRefs(x, key, depth + 1, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) deepRefs(x, k, depth + 1, out);
  return out;
};

/** `raw` = the object saved from GET /api/remote/<slug> (it has `events` and `lastSeq`), or the event array. */
export function parseLiveActions(raw: unknown, sidecar: Sidecar): LiveParse {
  const gaps: string[] = [], origin = videoOrigin(sidecar), list = checkEventList(raw), clock = readSidecarClock(sidecar), unknownTypes: Record<string, number> = {};
  const sorted = [...listOf(raw)].sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0) || (a.at ?? 0) - (b.at ?? 0));
  if (!list.complete) gaps.push(list.reason!);
  if (origin === undefined) gaps.push('The sidecar has no recorder start time, so events cannot be put on video time.');
  else if (clock.source === 'none' && sidecar.serverStartMs === undefined) gaps.push('The sidecar has no clock offset and no server start: events without a camera stamp cannot get a video time.');
  const toVideo = (clientMs?: number) => clientMs === undefined || origin === undefined ? undefined : clientMs - origin;
  const actions: LiveAction[] = []; let usedOffset = false;
  sorted.forEach((item, n) => {
    const a = item.action; if (!a || typeof a.type !== 'string') return;
    const type = a.type, unknownType = !kept(type); if (unknownType && isHarmless(type, a)) return;
    if (unknownType) unknownTypes[type] = (unknownTypes[type] ?? 0) + 1;
     if (typeof item.at !== 'number' || origin === undefined) return;
    const cam = a.cam as { seenAt?: number; namedAt?: number; sentAt?: number; by?: unknown; ui?: unknown } | undefined;
    let t: number, basis: TimeBasis;
    if (cam?.sentAt !== undefined) { t = cam.sentAt - origin; basis = 'cam'; }
    else if (clockOffsetAt(clock, item.at) !== undefined) { t = toVideo(item.at - clockOffsetAt(clock, item.at)!)!; basis = 'server-offset'; usedOffset = true; }
    else if (sidecar.serverStartMs !== undefined) { t = item.at - sidecar.serverStartMs; basis = 'server-start'; }
    else return;
    const card = a.card as { ref?: string; cardId?: number; passcode?: number; name?: string; slot?: number; bestMatch?: boolean; faceUp?: boolean } | undefined;
    const summon = (a.summon ?? (type === 'twin.attach' ? a : undefined)) as { materialRefs?: unknown } | undefined, target = a.target as { ref?: unknown } | null | undefined;
    const base = {
      n, seq: item.seq, key: str(a.idempotencyKey), seat: num(a.seat) ?? num(a.actorSeat), type, t, basis, seenT: toVideo(cam?.seenAt), namedT: toVideo(cam?.namedAt), sentT: toVideo(cam?.sentAt),
      origin: originOf(a, cam), rawSource: str(a.source), ui: str(cam?.ui),
    };
    // a batch identify is one action with several cards: one entry per card
    if (type === 'cards.identified') {
      for (const c of (Array.isArray(a.cards) ? a.cards : []) as Record<string, unknown>[]) {
        actions.push({ ...base, type: 'card.identified', zone: str(c.zone), slot: num(c.slot), ref: str(c.cardRef), refs: strs([c.cardRef]), cardId: num(c.cardId) ?? num(c.passcode), name: str(c.name), bestMatch: c.bestMatch as boolean | undefined });
      }
      return;
    }
    const ref = str(card?.ref) ?? str(a.cardRef);
    const refs = [...new Set([...strs([ref, a.cardRef, a.removeRef, a.keepRef, a.materialRef, target?.ref]), ...strs(summon?.materialRefs), ...strs(a.cardRefs), ...(unknownType ? deepRefs(a) : [])])];
    actions.push({
      ...base, zone: str(a.zone), slot: num(a.slot ?? card?.slot), ref, refs, cardId: (card?.cardId ?? card?.passcode ?? a.cardId ?? a.passcode) as number | undefined, name: (card?.name ?? a.name) as string | undefined,
      bestMatch: (card?.bestMatch ?? a.bestMatch) as boolean | undefined, faceUp: (card?.faceUp ?? a.faceUp) as boolean | undefined, targetKey: type === 'undo' ? str(a.targetActionId) : undefined,
      ...(type === 'twin.merge' && (a.keepInstanceId || a.removeInstanceId) ? { unnamedTargets: true } : {}), ...(unknownType ? { unknownType: true } : {}),
    });
  });
  if (usedOffset && clock.source === 'single-offset') gaps.push('The sidecar has no per-chunk clock samples (client.clockSamples): one clock offset for the whole clip was used for server-stamped events.');
  return { actions, gaps, truncated: !list.complete, origin, list, clock, unknownTypes };
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
/** Event zone names that need a slot to become a mat zone. */
const MAT_NAMES = new Set(['monster', 'spell-trap', 'extra-monster']);
export const SINGLE_ZONES = new Set<string>(['M1', 'M2', 'M3', 'M4', 'M5', 'S1', 'S2', 'S3', 'S4', 'S5', 'EMZ1', 'EMZ2', 'FIELD']);

export interface NameChange { t: number; cardId?: number; name?: string; origin: Origin; bestMatch?: boolean; key?: string }
export type SpanEnd = 'removed-auto' | 'removed-player' | 'removed-unknown' | 'moved' | 'undone-player' | 'undone-unknown' | 'replaced' | 'clip-end';
/** One card (twin ref) in one mat zone, from appearing to leaving. `names` is every identity event of the card (the same list for all spans of one ref, so a rename after a move still counts), in order.
 *  `overlap` = another card was put in this zone while this one was still open there (no remove or move between): when the card really left is unknown. */
export interface TwinSpan { ref: string; zone: FieldZone; from: number; to: number; end: SpanEnd; placedAuto: boolean; placeKey?: string; names: NameChange[]; seat?: number; overlap: boolean;
  /** `cam.ui` of the event that ended it, when the event carries one (newer builds): only ui 'popup-remove' (removal) and 'undo' (undo of the place) are a person taking away a card the watcher wrongly saw. */ endUi?: string }
export interface Timeline {
  spans: TwinSpan[]; gaps: string[];
  /** Video time before which nothing is known about the board (the first twin event); Infinity when there are no events, so nothing counts as empty. */ knownFrom: number;
  /** Cards (refs) an event touched in a way this tool does not follow (attach, merge, control, equip, detach, pile lift, a move or remove that was undone, an identify that was undone ...), with the reason. All their labels are dropped. */ tainted: Map<string, string>;
  /** From this video time on an event put a card in a place this tool cannot map to a zone: no zone counts as empty after it. */ blindFrom: number;
  /** From this video time on an event touched cards this tool cannot name (an action of an unknown type with no card ref, a merge by instance id, ...): spans that end after it get no label. */ opaqueFrom: number;
}

/** Builds what the room events say was on the mat (this seat only), by twin ref. `spanMs` is the clip length, for cards still on the mat at the end. */
export function buildTimeline(actions: LiveAction[], seat: number | undefined, spanMs: number): Timeline {
  const gaps: string[] = [], spans: TwinSpan[] = [], open = new Map<string, TwinSpan>(), byKey = new Map<string, LiveAction[]>(), refNames = new Map<string, NameChange[]>(), tainted = new Map<string, string>();
  let blindFrom = Infinity, opaqueFrom = Infinity;
  const mine = actions.filter(a => seat === undefined || a.seat === undefined || a.seat === seat);
  const knownFrom = mine.length ? Math.min(...mine.map(a => a.seenT ?? a.t)) : Infinity;
  const taint = (ref: string, why: string) => { if (!tainted.has(ref)) tainted.set(ref, why); };
  const taintAll = (why: string, t: number) => { for (const r of open.keys()) taint(r, why); for (const s of spans) taint(s.ref, why); blindFrom = Math.min(blindFrom, t); opaqueFrom = Math.min(opaqueFrom, t); };
  const close = (span: TwinSpan, to: number, end: SpanEnd, endUi?: string) => { span.to = to; span.end = end; span.endUi = endUi; open.delete(span.ref); };
  const namesOf = (ref: string) => { let n = refNames.get(ref); if (!n) { n = []; refNames.set(ref, n); } return n; };
  const ofZone = (zone: FieldZone) => [...open.values()].find(s => s.zone === zone);
  const begin = (ref: string, zone: FieldZone, from: number, a: LiveAction, placedAuto: boolean) => {
    const other = ofZone(zone), s: TwinSpan = { ref, zone, from, to: spanMs, end: 'clip-end', placedAuto, placeKey: a.key, names: namesOf(ref), seat: a.seat, overlap: false };
    if (other && other.ref !== ref) { close(other, from, 'replaced'); other.overlap = true; s.overlap = true; gaps.push(`${zone}: ${ref} was put there while ${other.ref} was still open (no remove or move between): both are dropped`); }
    spans.push(s); open.set(ref, s); return s;
  };
  const addName = (ref: string, a: LiveAction) => { if (a.cardId === undefined && !a.name) return; namesOf(ref).push({ t: a.t, cardId: a.cardId, name: a.name, origin: a.origin, bestMatch: a.bestMatch, key: a.key }); };
  for (const a of mine) {
    if (a.key) byKey.set(a.key, [...(byKey.get(a.key) ?? []), a]);
    if (a.unnamedTargets) { taintAll(`${a.type} by instance id: the cards it touches are not named`, a.t); gaps.push(`${a.type} at ${Math.round(a.t / 100) / 10} s names its cards by instance id: every open card is dropped`); continue; }
    if (a.type === 'twin.place') {
      const zone = matZone(a.zone, a.slot); if (!a.ref) continue;
      if (a.refs.length > 1) for (const r of a.refs.filter(r => r !== a.ref)) { taint(r, 'used as a summon material'); const o = open.get(r); if (o) close(o, a.t, 'moved'); }
      if (open.has(a.ref)) close(open.get(a.ref)!, a.seenT ?? a.t, 'moved');
      if (!zone) { if (MAT_NAMES.has(a.zone ?? '')) { gaps.push(`twin.place ${a.ref}: zone "${a.zone}" has no slot; no zone counts as empty after it`); blindFrom = Math.min(blindFrom, a.seenT ?? a.t); taint(a.ref, 'placed in a zone with no slot'); } continue; }
      begin(a.ref, zone, a.seenT ?? a.t, a, a.origin === 'auto'); addName(a.ref, a);
    } else if (a.type === 'twin.move' && a.ref) {
      const span = open.get(a.ref), zone = matZone(a.zone, a.slot);
      if (!span) { gaps.push(`twin.move ${a.ref}: no earlier place event for this card (event list incomplete?)`); taint(a.ref, 'moved without a known place'); if ((zone && SINGLE_ZONES.has(zone)) || MAT_NAMES.has(a.zone ?? '')) blindFrom = Math.min(blindFrom, a.t); continue; }
      if (!zone) { close(span, a.t, 'moved'); if (MAT_NAMES.has(a.zone ?? '')) { gaps.push(`twin.move ${a.ref}: zone "${a.zone}" has no slot; no zone counts as empty after it`); taint(a.ref, 'moved to a zone with no slot'); blindFrom = Math.min(blindFrom, a.t); } continue; }
      if (zone === span.zone) { addName(a.ref, a); continue; }
      close(span, a.t, 'moved');
      if (SINGLE_ZONES.has(zone)) { begin(a.ref, zone, a.t, a, span.placedAuto); addName(a.ref, a); }
    } else if (a.type === 'twin.flip' && a.ref) { if (open.has(a.ref) && a.faceUp !== false) addName(a.ref, a); }
    else if (a.type === 'card.identified') {
      let ref = a.ref && open.has(a.ref) ? a.ref : undefined;
      if (!a.ref) { const zone = matZone(a.zone, a.slot), span = zone ? ofZone(zone) : undefined; ref = span?.ref; if (!span) gaps.push('card.identified has no cardRef and no open card in its zone: it cannot be tied to a tracked card'); }
      else if (!ref) gaps.push(`card.identified for ${a.ref}: no open card with that ref (place event missing?)`);
      if (ref) addName(ref, a);
    } else if (a.type === 'twin.remove' && a.ref) {
      const span = open.get(a.ref); if (span) close(span, a.t, a.origin === 'auto' ? 'removed-auto' : a.origin === 'player' ? 'removed-player' : 'removed-unknown', a.ui);
    } else if (a.type === 'undo' && a.targetKey) {
      const targets = byKey.get(a.targetKey);
      if (!targets) { gaps.push(`undo targets ${a.targetKey}, which is not in the list: every open card is dropped`); taintAll(`undo of an action that is not in the list`, a.t); continue; }
      for (const target of targets) {
        if (target.type === 'twin.place' && target.ref) { const span = spans.find(s => s.placeKey === target.key); if (span && open.get(span.ref) === span) close(span, a.t, a.origin === 'player' ? 'undone-player' : 'undone-unknown', a.ui); }
        else for (const r of target.refs) taint(r, `undo of ${target.type}`);
      }
    } else if (a.type === 'twin.place' || a.type === 'twin.move' || a.type === 'twin.flip' || a.type === 'twin.remove') continue;
    else {
      // attach, detach, merge, control, equip, pile lift, ... and any action type this tool does not know: the card or its place changed in a way not followed here
      if (a.unknownType) { blindFrom = Math.min(blindFrom, a.t); gaps.push(`${a.type} at ${Math.round(a.t / 100) / 10} s is an unknown action type: the cards it names are dropped`); }
      if (!a.refs.length) { taintAll(`${a.type} with no card ref`, a.t); gaps.push(`${a.type} at ${Math.round(a.t / 100) / 10} s names no card: every open card is dropped`); }
      for (const r of a.refs) { taint(r, a.type); const o = open.get(r); if (o) close(o, a.t, 'moved'); }
    }
  }
  return { spans, gaps, knownFrom, tainted, blindFrom, opaqueFrom };
}
/** Does the timeline say a card lay in `zone` at video time `t` (ms), with `slackMs` either side for event and clock lag? Unknown before the first event (or after a card of unknown place) counts as occupied. */
export const occupiedAt = (tl: Timeline, zone: string, t: number, slackMs = 4000) => t < tl.knownFrom || t >= tl.blindFrom - slackMs || tl.spans.some(s => s.zone === zone && t >= s.from - slackMs && t <= s.to + slackMs);

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
  params: { fps: number; from: number; duration?: number; format: string; calibration: 'file' | 'sidecar' | 'whole-frame'; readScale: number };
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
    const sidecarCal = o.calibration ? undefined : sidecarCalibration(sidecar, from * 1000), calibration = o.calibration ?? sidecarCal ?? wholeFrameCalibration(), format = o.format ?? 'normal';
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
    else if (parse.truncated) phantom.reason = parse.list.reason ?? 'the event list is incomplete, so a zone cannot be proven empty';
    else if (parse.origin === undefined) phantom.reason = 'events cannot be put on video time';
    else {
      phantom.checked = true;
      phantom.reads = reads.filter(r => r.zone !== '?' && !r.error && !occupiedAt(timeline, r.zone, r.tS * 1000));
      phantom.tracks = trackRows.filter(t => !occupiedAt(timeline, t.zone, t.seenS * 1000));
    }
    const live = (parse?.actions ?? []).filter(a => a.type.startsWith('twin.') || a.type === 'card.identified').map(a => ({ type: a.type, zone: a.zone, ref: a.ref, origin: a.origin, basis: a.basis, tS: round(a.t / 1000, 3),
      seenS: a.seenT === undefined ? undefined : round(a.seenT / 1000, 3), namedS: a.namedT === undefined ? undefined : round(a.namedT / 1000, 3), sentS: a.sentT === undefined ? undefined : round(a.sentT / 1000, 3) }));
    const liveGaps = live.filter(l => l.seenS !== undefined && l.namedS !== undefined).map(l => ({ zone: l.zone, ref: l.ref, seenS: l.seenS!, namedS: l.namedS!, gapS: round(l.namedS! - l.seenS!, 3) }));
    if (!o.calibration && readSidecarCalibrations(sidecar).length > 1) gaps.push('The sidecar holds several live calibrations: this replay used the one in force at the clip start. Pass --calibration, or use harvest-labels.ts, which follows the changes.');
    if (parse && !liveGaps.length) gaps.push('No recorded event carries both cam.seenAt and cam.namedAt (older build, or no card was named): live seen-to-named time is not available.');
    const okReads = reads.filter(r => !r.error);
    return {
      schema: 'recording-run/1', recording: { file: basename(video), tableSlug: sidecar.tableSlug, seat: sidecar.seat, width, height },
      params: { fps, from, duration: o.duration, format, calibration: o.calibrationFromFile ? 'file' : sidecarCal ? 'sidecar' : 'whole-frame', readScale: o.readScale ?? 1 },
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

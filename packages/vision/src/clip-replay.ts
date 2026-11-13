// Deterministic replay of a .ddclip through the real field watcher, scoring against the label file.
// The clock is the clip's frame times: no timers, no camera. Recognition is either the recorded reads
// (tracker-only replay, no models) or a real recognizer the caller supplies (onnxruntime-node).
import { createFieldWatcher, type FieldEvent, type FieldWatcherOptions, type KnownFieldCard } from './field-watcher';
import { createFieldAnalyzer } from './field-motion';
import { createFieldIdentityGallery } from './field-gallery';
import { fieldCenter, type FieldZone } from './field-zones';
import type { GameProfile, RecognitionResult, RecognitionPriors, DetectedQuad, FractionalBox } from './types';
import { cropRGBA, resizeRGBA, type RGBAImage } from './pixels';
import { yugioh } from './games/yugioh';
import { rebaseBox, rebaseQuad, sameCrop, type ClipBundle, type ClipEvent, type ClipRect, type ClipTruth, type ClipTruthEvent, type ClipTruthPlace, type ClipSession } from './clip-format';

export interface ReplayEvent { at: number; t: number; event: FieldEvent; /** The harness answered this track's prompt from the labels. */ answered?: boolean }
export interface ReplayRead { t: number; ms: number; tier?: string; backend?: string; embeds?: number; closedSet?: boolean; error?: boolean; /** Recorded mode: no recorded read matched this request (within 1 s, same spot). */ unreplayable?: boolean }
export interface ReplayResult {
  mode: 'recorded' | 'real'; events: ReplayEvent[]; reads: ReplayRead[]; detects: number; ticks: number; frames: number; wallMs: number; errors: number;
  /** Clip time span (ms) and the watcher's own metrics at the end. */
  spanMs: number; dutyPercent: number;
  /** Recorded-mode reads with no matching recorded read, and frames skipped because their crop differs from the clip's. */
  unreplayable: number; skippedFrames: number;
  /** Median gap between replayed frames (ms). The watcher ticks once per frame here; live it ticks every 33-66 ms. */
  tickMs: number;
}
export interface ReplayOptions {
  /** Real mode: multiplies each measured read time, to stand in for a slower machine (a laptop browser reads about 8x slower than Node here). */
  readScale?: number;
  bundle: ClipBundle;
  /** JPEG bytes to RGBA pixels (Node: sharp). */
  decode: (bytes: Uint8Array) => Promise<RGBAImage>;
  /** A real recognizer; absent means the recorded detections and reads are played back. */
  recognizer?: FieldWatcherOptions['recognizer'];
  profile?: GameProfile;
  /** Answer identity prompts from the labels (default true). */
  answerPrompts?: boolean;
  /** Test injection: a fake frame analyzer (sharpness, motion, crops). */
  analyze?: FieldWatcherOptions['analyze'];
  /** Real mode runs one detect and one read on the first frame before the clock starts, so the cold first model run does not set read p95 (default on). */
  warmUp?: boolean;
  onEvent?: (event: ReplayEvent) => void;
  /** Observer only (recording tools): called after each read with its time, result (absent on a failure) and request. Changes nothing in the replay. */
  onRead?: (read: ReplayRead, result: RecognitionResult | undefined, request: Parameters<NonNullable<FieldWatcherOptions['recognizer']>['recognize']>[1]) => void;
}

const FIELD_ZONES = new Set<string>(['M1', 'M2', 'M3', 'M4', 'M5', 'S1', 'S2', 'S3', 'S4', 'S5', 'FIELD', 'EMZ1', 'EMZ2']);
export const onField = (zone: ClipTruthPlace | undefined): zone is FieldZone => !!zone && FIELD_ZONES.has(zone);
const ARRIVAL_KINDS = new Set(['summon', 'set', 'placed', 'token', 'move', 'return', 'equip', 'control', 'activate']);
const DEPARTURE_KINDS = new Set(['destroy', 'tribute', 'banish', 'return', 'remove', 'mill', 'move', 'control', 'detach']);
export const isArrival = (e: ClipTruthEvent) => ARRIVAL_KINDS.has(e.kind) && onField(e.to?.zone) && (!e.from || !onField(e.from.zone) || e.from.zone !== e.to!.zone);
export const isDeparture = (e: ClipTruthEvent) => DEPARTURE_KINDS.has(e.kind) && onField(e.from?.zone) && (!e.to || !onField(e.to.zone) || e.to.zone !== e.from!.zone);

type RecordedDetect = Extract<ClipEvent, { kind: 'detect' }>; type RecordedRead = Extract<ClipEvent, { kind: 'read' }>;
export interface RecordedRecognizer extends NonNullable<FieldWatcherOptions['recognizer']> { /** Recorded time of the read answered last (0 after a miss). */ usedMs: number; /** Requests no recorded read could answer. */ unreplayable: number }
const overlaps = (a: FractionalBox, b: FractionalBox) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Plays back the clip's own detector boxes and reads by clip time. Recorded geometry is in camera fractions; the saved frames are cropped,
 *  so every quad and region is rebased with `crop` before it meets the watcher (which runs on the frame-based calibration). */
export function recordedRecognizer(events: ClipEvent[], now: () => number, crop?: ClipRect): RecordedRecognizer {
  const detects = events.filter((e): e is RecordedDetect => e.kind === 'detect').sort((a, b) => a.at - b.at);
  const reads = events.filter((e): e is RecordedRead => e.kind === 'read').sort((a, b) => a.at - b.at);
  const regionOf = (d: RecordedDetect) => (d.opts as { region?: FractionalBox } | undefined)?.region;
  const fulls = detects.filter(d => !regionOf(d)), partials = detects.filter(d => !!regionOf(d));
  const used = new Set<RecordedRead>();
  const nearest = <T extends { at: number }>(list: T[], at: number, within: number, ok: (item: T) => boolean = () => true) => {
    let best: { item: T; d: number } | undefined;
    for (const item of list) { const d = Math.abs(item.at - at); if (d <= within && ok(item) && (!best || d < best.d)) best = { item, d }; }
    return best?.item;
  };
  const cards = (d: RecordedDetect | undefined) => d ? structuredClone(d.cards).map(c => rebaseQuad(c, crop)) : [];
  const self: RecordedRecognizer = {
    detectorBackend: 'wasm', separateDetector: true, usedMs: 0, unreplayable: 0,
    async detectCards(_frame, opts) {
      const at = now();
      // A full pass is answered only by a recorded full pass (a region answer would make every other card vanish).
      if (!opts?.region) return cards(nearest(fulls, at, 2500) ?? nearest(fulls, at, Infinity));
      // A region pass takes a recorded region pass over the same spot; none means [] and the watcher runs its own full pass.
      return cards(nearest(partials, at, 1000, d => overlaps(rebaseBox(regionOf(d)!, crop), opts.region!)));
    },
    async recognize(_frames, opts) {
      const at = now(), want = opts?.card ? fieldCenter(opts.card) : undefined;
      const candidates = reads.filter(r => !used.has(r) && Math.abs(r.at - at) <= 1000);
      const distance = (r: RecordedRead) => { if (!want || !r.card) return want || r.card ? 1 : 0; const c = fieldCenter(rebaseQuad(r.card, crop)); return Math.hypot(c.x - want.x, c.y - want.y); };
      const read = candidates.filter(r => distance(r) < .15).sort((a, b) => distance(a) - distance(b) || Math.abs(a.at - at) - Math.abs(b.at - at))[0];
      if (!read) { self.usedMs = 0; self.unreplayable++; throw new Error('unreplayable: no recorded read within 1 s at this spot'); }
      used.add(read); self.usedMs = read.ms;
      if (!read.result) throw new Error(read.error ?? 'Recorded read failed');
      const result = structuredClone(read.result) as RecognitionResult;
      if (result.detectedCard) result.detectedCard = rebaseQuad(result.detectedCard, crop);
      return result;
    },
  };
  return self;
}

/** What the live reader knew at each read (priors, known board cards), looked up by clip time: the last read at or before `at`, else the first after it. */
function knowledgeAt(reads: RecordedRead[], at: number) { let best: RecordedRead | undefined; for (const r of reads) { if (r.at <= at) best = r; else { best ??= r; break; } } return best; }

export async function replayClip(options: ReplayOptions): Promise<ReplayResult> {
  const { bundle } = options, { session, truth } = bundle;
  const crop = session.frame.crop;
  const all = [...bundle.frames].sort((a, b) => a.at - b.at), frames = all.filter(f => sameCrop(f.crop ?? crop, crop));
  if (!frames.length) throw new Error('Clip has no frames');
  let at = frames[0].at - 1, index = 0;
  const now = () => at;
  const recorded = options.recognizer ? undefined : recordedRecognizer(bundle.events, now, crop);
  const recognizer = options.recognizer ?? recorded!;
  const mode: ReplayResult['mode'] = options.recognizer ? 'real' : 'recorded';
  const recordedReads = bundle.events.filter((e): e is RecordedRead => e.kind === 'read').sort((a, b) => a.at - b.at);
  // A read's answer reaches the watcher only when the clip clock has moved on by the read's own time (recorded, or measured in real mode).
  const pending: { due: number; release: () => void }[] = [];
  const releaseDue = (all = false) => { for (let i = pending.length - 1; i >= 0; i--) if (all || pending[i].due <= at) { const [p] = pending.splice(i, 1); p.release(); } };
  const decoded = new Map<string, RGBAImage>();
  if (options.recognizer && options.warmUp !== false) {
    const bytes = bundle.frameBytes(frames[0].name); if (!bytes) throw new Error(`Clip frame ${frames[0].name} is missing`);
    const first = await options.decode(bytes); decoded.set(frames[0].name, first);
    const found = await options.recognizer.detectCards(first as unknown as ImageData);
    const patch = found[0] ? first : resizeRGBA(cropRGBA(first, 0, 0, Math.max(2, Math.round(first.width / 4)), Math.max(2, Math.round(first.height / 4))), 96, 140);
    try { await options.recognizer.recognize([patch as unknown as ImageData], found[0] ? { card: found[0], maxFrames: 1, k: 1 } : { maxFrames: 1, k: 1 }); } catch { /* A warm-up read may not match anything; only the model load matters. */ }
  }
  const buffer: FieldWatcherOptions['buffer'] = { sample: async () => { const meta = frames[Math.min(index, frames.length - 1)]; let frame = decoded.get(meta.name); if (!frame) { const bytes = bundle.frameBytes(meta.name); if (!bytes) throw new Error(`Clip frame ${meta.name} is missing`); frame = await options.decode(bytes); decoded.set(meta.name, frame); if (decoded.size > 8) decoded.delete(decoded.keys().next().value!); } return { frame: frame as unknown as ImageData, at: meta.at }; } };
  const reads: ReplayRead[] = [], events: ReplayEvent[] = [];
  let detects = 0;
  const timed: FieldWatcherOptions['recognizer'] = {
    get detectorBackend() { return recognizer.detectorBackend; }, get detectorTimingsMs() { return recognizer.detectorTimingsMs; }, get separateDetector() { return recognizer.separateDetector; },
    prepare: recognizer.prepare ? o => recognizer.prepare!(o) : undefined,
    detectCards: async (f, o) => { detects++; return recognizer.detectCards(f, o); },
    recognize: async (f, o) => {
      const start = at, t = start - session.clipStartAt, wall = performance.now(), missesBefore = recorded?.unreplayable ?? 0;
      let result: RecognitionResult | undefined, failure: unknown;
      try { result = await recognizer.recognize(f, o); } catch (e) { failure = e; }
      // Recorded mode reports the time of the read it answered with; real mode the time this machine took.
      const ms = recorded ? recorded.usedMs : (performance.now() - wall) * (options.readScale ?? 1), unreplayable = !!recorded && recorded.unreplayable > missesBefore;
      reads.push(result ? { t, ms, tier: result.tier, backend: result.backend, embeds: result.timingsMs?.embedCount ?? result.quality?.framesUsed, closedSet: ['deck','dynamic','likely'].includes(result.quality?.searchSource ?? '') } : { t, ms, error: true, unreplayable });
      options.onRead?.(reads[reads.length - 1], result, o);
      if (ms > 0) await new Promise<void>(release => pending.push({ due: start + ms, release }));
      if (failure) throw failure; return result!;
    },
  };
  const decklist = session.decklist;
  const priorsAt = (): RecognitionPriors | undefined => { const k = knowledgeAt(recordedReads, at); return k?.priors ?? (decklist ? { decklist } : undefined); };
  const knownRecorded = recordedReads.some(r => r.known), knownAt = (): KnownFieldCard[] => knowledgeAt(recordedReads, at)?.known ?? [];
  const watcher = createFieldWatcher({
    profile: options.profile ?? yugioh, recognizer: timed, buffer, now, hidden: () => false, cpuBusy: () => false, clone: async f => f,
    calibration: session.frameCalibration ?? session.calibration, format: session.format, earlyExitMargin: .02, analyze: options.analyze ?? createFieldAnalyzer({ downsampleRGBA: true }),
    getPriors: decklist || recordedReads.some(r => r.priors) ? priorsAt : undefined,
    getKnownCards: knownRecorded ? knownAt : undefined,
    gallery: mode === 'real' && session.gallery?.length ? createFieldIdentityGallery(session.gallery) : undefined,
  });
  const answered = new Set<string>();
  const truthFor = (zone: FieldZone, t: number) => truth.events.filter(e => isArrival(e) && e.to!.zone === zone && e.cardId && Math.abs(e.t - t) < 20_000).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  watcher.subscribe(event => {
    const entry: ReplayEvent = { at, t: at - session.clipStartAt, event, answered: answered.has(event.track.id) };
    events.push(entry); options.onEvent?.(entry);
    if (event.type === 'prompt' && options.answerPrompts !== false) {
      const label = truthFor(event.track.zone, entry.t);
      if (label?.cardId) { answered.add(event.track.id); watcher.confirm(event.track.id, label.cardId, undefined, true); }
    }
  });
  const wallStart = performance.now();
  const settle = async (rounds: number) => { for (let i = 0; i < rounds; i++) await new Promise<void>(r => setTimeout(r, 0)); };
  const gaps = frames.slice(1).map((f, i) => f.at - frames[i].at), tickMs = gaps.length ? percentile(gaps, .5) : 200;
  try {
    for (index = 0; index < frames.length; index++) {
      at = frames[index].at;
      releaseDue(); await settle(2);
      await watcher.tick();
      // Let read promises start before the next frame, as the browser's event loop would.
      await settle(4);
    }
    // A few extra ticks on the last frame let pending reads land and publish gates close.
    for (let i = 0; i < 10; i++) { at += tickMs; releaseDue(); await settle(2); await watcher.tick(); await settle(1); }
    releaseDue(true); await settle(2);
    const snapshot = watcher.getSnapshot();
    return { mode, events, reads, detects, ticks: frames.length + 10, frames: frames.length, wallMs: performance.now() - wallStart, errors: snapshot.metrics.errors, spanMs: frames[frames.length - 1].at - frames[0].at, dutyPercent: snapshot.metrics.dutyPercent, unreplayable: recorded?.unreplayable ?? 0, skippedFrames: all.length - frames.length, tickMs: Math.round(tickMs) };
  } finally { releaseDue(true); watcher.dispose(); }
}

export interface ReplayMetrics {
  clip: string; mode: string; /** 'owner' labels, a 'draft' made from the watcher's own events (scores are then self-referential), or 'none'. */ labels: string; frames: number; spanS: number; wallS: number;
  /** Labelled arrivals on the field, how many the watcher put on the board, how many with the right identity. */
  arrivals: number; onBoard: number; identityOk: number; identityPct: number;
  wrongAutomatic: number; falseRemovals: number; stale: number; twins: number;
  departures: number; removedOk: number;
  ttbP50: number; ttbP95: number;
  /** Median offsets (ms) from first sight: stable outline, read start, read end, board publish. */
  stableP50: number; readStartP50: number; readEndP50: number; publishP50: number;
  prompts: number; promptsAnswered: number; promptTop5: number;
  reads: number; readMsP50: number; readMsP95: number; embedsPerRead: number; closedSetPct: number; backend: string;
  /** Recorded mode: read requests no recorded read could answer. */
  unreplayable: number;
  /** Label kinds the watcher does not emit yet (hand activations, counters, LP, phases...). Listed so the gap stays visible. */
  unmeasured: number; unmeasuredKinds: string;
  errors: number;
}

export function percentile(values: number[], p: number) { if (!values.length) return 0; const sorted = [...values].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))]; }
const round = (n: number) => Math.round(n * 10) / 10;

export function scoreReplay(result: ReplayResult, truth: ClipTruth, session: ClipSession, clip = 'clip'): ReplayMetrics {
  const spanMs = result.spanMs;
  const arrivals = truth.events.filter(isArrival), departures = truth.events.filter(isDeparture);
  const live = (zone: FieldZone, t: number) => arrivals.some(a => a.to!.zone === zone && a.t <= t + 500 && !departures.some(d => d.from!.zone === zone && d.t > a.t && d.t < t - 3000));
  let onBoard = 0, identityOk = 0, wrongAutomatic = 0; const ttb: number[] = [], stable: number[] = [], readStart: number[] = [], readEnd: number[] = [], publish: number[] = [];
  for (const a of arrivals) {
    const zone = a.to!.zone as FieldZone, wantDown = a.to!.faceUp === false;
    // The hit window closes at the next labelled departure from that zone: a later card there is not this one.
    const nextLeave = departures.filter(d => d.from!.zone === zone && d.t > a.t).reduce((m, d) => Math.min(m, d.t), Infinity), windowEnd = Math.min(a.t + 20_000, nextLeave);
    const hits = result.events.filter(e => (e.event.type === 'placed' || e.event.type === 'flipped' || e.event.type === 'moved') && e.event.track.zone === zone && !e.event.track.removed && e.t >= a.t - 1000 && e.t <= windowEnd);
    const first = hits.find(e => wantDown ? e.event.track.faceDown : e.event.track.cardId) ?? hits[0];
    if (!first) continue;
    onBoard++; ttb.push(Math.max(0, first.t - a.t));
    const timing = first.event.timing?.stagesMs;
    if (timing) { const base = timing.firstOutline ?? 0; if (timing.stable !== undefined) stable.push(timing.stable - base); if (timing.embedStart !== undefined) readStart.push(timing.embedStart - base); if (timing.searchDone !== undefined) readEnd.push(timing.searchDone - base); if (timing.commit !== undefined) publish.push(timing.commit - base); }
    if (wantDown) { if (first.event.track.faceDown) identityOk++; continue; }
    if (!a.cardId) { identityOk++; continue; }
    const named = hits.find(e => e.event.track.cardId);
    if (named?.event.track.cardId === a.cardId) identityOk++;
    else if (named && !named.answered) wrongAutomatic++;
  }
  let falseRemovals = 0;
  for (const e of result.events) if (e.event.type === 'removed' && e.event.track.state === 'identified' && live(e.event.track.zone, e.t) && !departures.some(d => d.from!.zone === e.event.track.zone && Math.abs(d.t - e.t) <= 3000)) falseRemovals++;
  let stale = 0, removedOk = 0;
  for (const d of departures) {
    const zone = d.from!.zone as FieldZone;
    const tracks = result.events.filter(e => e.event.track.zone === zone && e.t < d.t + 500 && (e.event.type === 'placed' || e.event.type === 'moved')).map(e => e.event.track.id);
    if (!tracks.length) continue;
    const gone = result.events.find(e => e.event.type === 'removed' && tracks.includes(e.event.track.id) && e.t >= d.t - 3000);
    if (gone && gone.t <= d.t + 10_000) removedOk++;
    else if (spanMs - d.t >= 10_000) stale++;
  }
  // Twins: two live named tracks in one zone at the same moment, counted once per zone episode.
  let twins = 0; const liveTracks = new Map<string, { zone: FieldZone; under?: string }>(), twinZones = new Set<string>();
  for (const e of result.events) {
    const tr = e.event.track;
    if (e.event.type === 'removed') liveTracks.delete(tr.id); else if (tr.state === 'identified' && !tr.removed) liveTracks.set(tr.id, { zone: tr.zone, under: tr.under }); else if (e.event.type === 'covered') { const v = liveTracks.get(tr.id); if (v) v.under = e.event.coverRef; }
    const counts = new Map<string, number>(); for (const v of liveTracks.values()) if (!v.under) counts.set(v.zone, (counts.get(v.zone) ?? 0) + 1);
    for (const [zone, n] of counts) { if (n >= 2 && !twinZones.has(zone)) { twins++; twinZones.add(zone); } if (n < 2) twinZones.delete(zone); }
  }
  const prompts = result.events.filter(e => e.event.type === 'prompt'), promptsAnswered = prompts.filter(p => result.events.some(e => e.answered && e.event.track.id === p.event.track.id && e.t >= p.t)).length;
  const promptTop5 = prompts.filter(p => { const label = arrivals.find(a => a.to!.zone === p.event.track.zone && Math.abs(a.t - p.t) < 20_000); return !!label?.cardId && !!p.event.result?.candidates.slice(0, 5).some(c => c.cardId === label.cardId); }).length;
  const okReads = result.reads.filter(r => !r.error);
  const unmeasuredEvents = truth.events.filter(e => !isArrival(e) && !isDeparture(e) && e.kind !== 'flip' && e.kind !== 'position');
  return {
    clip, mode: result.mode, labels: truth.draft ? 'draft' : truth.events.length ? 'owner' : 'none', frames: result.frames, spanS: round(spanMs / 1000), wallS: round(result.wallMs / 1000),
    arrivals: arrivals.length, onBoard, identityOk, identityPct: arrivals.length ? round(100 * identityOk / arrivals.length) : 0,
    wrongAutomatic, falseRemovals, stale, twins, departures: departures.length, removedOk,
    ttbP50: round(percentile(ttb, .5)), ttbP95: round(percentile(ttb, .95)),
    stableP50: round(percentile(stable, .5)), readStartP50: round(percentile(readStart, .5)), readEndP50: round(percentile(readEnd, .5)), publishP50: round(percentile(publish, .5)),
    prompts: prompts.length, promptsAnswered, promptTop5,
    reads: result.reads.length, readMsP50: round(percentile(okReads.map(r => r.ms), .5)), readMsP95: round(percentile(okReads.map(r => r.ms), .95)), embedsPerRead: okReads.length ? round(okReads.reduce((n, r) => n + (r.embeds ?? 1), 0) / okReads.length) : 0, closedSetPct: okReads.length ? round(100 * okReads.filter(r => r.closedSet).length / okReads.length) : 0,
    backend: okReads[0]?.backend ?? session.backend ?? '-', unreplayable: result.unreplayable,
    unmeasured: unmeasuredEvents.length, unmeasuredKinds: [...new Set(unmeasuredEvents.map(e => e.kind))].join(','),
    errors: result.errors,
  };
}

/** A first label draft from what the watcher and the player did; the owner corrects it. */
export function draftTruth(bundle: ClipBundle, clipName?: string): ClipTruth {
  const { session, events } = bundle; const t0 = session.clipStartAt;
  const out: (ClipTruthEvent & { trackId?: string })[] = [];
  const zoneOf = new Map<string, FieldZone>();
  const card = (q: DetectedQuad | undefined) => q ? { position: q.quad && Math.hypot(q.quad[1].x - q.quad[0].x, q.quad[1].y - q.quad[0].y) > Math.hypot(q.quad[3].x - q.quad[0].x, q.quad[3].y - q.quad[0].y) ? 'defense' as const : 'attack' as const } : {};
  for (const e of events) {
    const t = Math.round(e.at - t0);
    if (e.kind === 'watcher') {
      const ev = e.event, tr = ev.track; void card;
      if (ev.type === 'placed') { zoneOf.set(tr.id, tr.zone); out.push({ t, kind: tr.faceDown ? 'set' : 'summon', cardId: tr.cardId, to: { zone: tr.zone, faceUp: !tr.faceDown, position: tr.position }, visibility: 'camera', source: 'draft', trackId: tr.id, note: tr.cardId ? undefined : 'card id unknown: fill in' }); }
      else if (ev.type === 'moved') { const from = zoneOf.get(tr.id); zoneOf.set(tr.id, tr.zone); out.push({ t, kind: from === tr.zone ? 'position' : 'move', cardId: tr.cardId, from: from ? { zone: from } : undefined, to: { zone: tr.zone, faceUp: !tr.faceDown, position: tr.position }, visibility: 'camera', source: 'draft', trackId: tr.id }); }
      else if (ev.type === 'flipped') out.push({ t, kind: 'flip', cardId: tr.cardId, to: { zone: tr.zone, faceUp: !tr.faceDown, position: tr.position }, visibility: 'camera', source: 'draft', trackId: tr.id });
      else if (ev.type === 'removed' && ev.reason !== 'phantom') out.push({ t, kind: 'remove', cardId: tr.cardId, from: { zone: tr.zone, faceUp: !tr.faceDown }, to: { zone: ev.destination ?? 'OFF' }, visibility: 'camera', source: 'draft', trackId: tr.id, note: ev.destination ? undefined : 'destination unknown: GY, BANISHED, HAND, DECK or EXTRA?' });
    } else if (e.kind === 'action') {
      const d = e.data ?? {};
      if (e.action === 'confirm' && typeof d.cardId === 'string') { const last = [...out].reverse().find(x => x.trackId === d.trackId); if (last) { last.cardId = d.cardId; last.note = undefined; last.visibility = 'signal'; last.signalT = t; } else if (typeof d.zone === 'string') out.push({ t, kind: 'summon', cardId: d.cardId, to: { zone: d.zone as FieldZone, faceUp: true }, visibility: 'signal', signalT: t, source: 'draft', trackId: typeof d.trackId === 'string' ? d.trackId : undefined }); }
      else if (e.action === 'undo' || e.action === 'dismiss') { const i = out.map((x, idx) => ({ x, idx })).reverse().find(({ x }) => t - x.t <= 10_000 && (e.action === 'undo' || x.trackId === (e.data?.trackId ?? '')))?.idx; if (i !== undefined) out.splice(i, 1); }
    }
  }
  return { version: 1, clip: clipName, draft: true, note: 'Draft from watcher events and your answers. Fix card ids, destinations and add what the watcher missed (hand activations, materials, counters, LP, phases). t is ms from the first saved frame.', events: out.map(({ trackId: _trackId, ...e }) => e) };
}

/** Baseline gate for CI: same clips in the same mode; p95 time to board or p95 read time +15 % (at least +100 / +10 ms), any new false removal or
 *  wrong automatic card, or fewer right identities than before. */
export function gateAgainstBaseline(current: ReplayMetrics[], baseline: ReplayMetrics[]): string[] {
  const failures: string[] = [];
  for (const was of baseline) if (!current.some(c => c.clip === was.clip)) failures.push(`${was.clip}: in the baseline but not in this run`);
  for (const now of current) {
    const was = baseline.find(b => b.clip === now.clip); if (!was) continue;
    if (now.mode !== was.mode) { failures.push(`${now.clip}: mode ${now.mode} differs from the baseline's ${was.mode}; numbers are not comparable`); continue; }
    if (now.ttbP95 > Math.max(was.ttbP95 * 1.15, was.ttbP95 + 100)) failures.push(`${now.clip}: p95 time to board ${now.ttbP95} ms > ${was.ttbP95} ms +15 %`);
    if (now.readMsP95 > Math.max(was.readMsP95 * 1.15, was.readMsP95 + 10)) failures.push(`${now.clip}: p95 read time ${now.readMsP95} ms > ${was.readMsP95} ms +15 %`);
    if (now.falseRemovals > was.falseRemovals) failures.push(`${now.clip}: false removals ${now.falseRemovals} > ${was.falseRemovals}`);
    if (now.wrongAutomatic > was.wrongAutomatic) failures.push(`${now.clip}: wrong automatic cards ${now.wrongAutomatic} > ${was.wrongAutomatic}`);
    if (now.identityOk < was.identityOk) failures.push(`${now.clip}: right identities ${now.identityOk} < ${was.identityOk}`);
  }
  return failures;
}

/** One line for the tools: how replay time differs from live time. */
export const replayTimingNote = (result: Pick<ReplayResult, 'tickMs' | 'mode'>) => `Replay ticks once per saved frame (~${result.tickMs} ms); live the watcher ticks every 33-66 ms, so time-to-board is coarser here. Read time: ${result.mode === 'recorded' ? 'as recorded live' : 'measured on this machine'}; each answer lands only once the clip clock has passed read start + read time.`;

const COLUMNS: [keyof ReplayMetrics, string][] = [['clip', 'clip'], ['mode', 'mode'], ['labels', 'labels'], ['spanS', 'span s'], ['arrivals', 'arrivals'], ['onBoard', 'on board'], ['identityPct', 'identity %'], ['wrongAutomatic', 'wrong auto'], ['falseRemovals', 'false rm'], ['stale', 'stale'], ['twins', 'twins'], ['ttbP50', 'ttb p50'], ['ttbP95', 'ttb p95'], ['stableP50', 'stable'], ['readStartP50', 'read start'], ['readEndP50', 'read end'], ['publishP50', 'publish'], ['prompts', 'prompts'], ['promptTop5', 'top5'], ['reads', 'reads'], ['readMsP50', 'read ms p50'], ['readMsP95', 'read ms p95'], ['unreplayable', 'unrepl'], ['embedsPerRead', 'embeds'], ['closedSetPct', 'closed %'], ['backend', 'backend'], ['unmeasured', 'unmeasured'], ['errors', 'errors']];
export function formatMetricsTable(rows: ReplayMetrics[]): string {
  const cells = rows.map(r => COLUMNS.map(([key]) => String(r[key] ?? '')));
  const widths = COLUMNS.map(([, label], i) => Math.max(label.length, ...cells.map(c => c[i].length)));
  const line = (parts: string[]) => parts.map((p, i) => p.padStart(widths[i])).join('  ');
  return [line(COLUMNS.map(([, label]) => label)), line(widths.map(w => '-'.repeat(w))), ...cells.map(line)].join('\n');
}

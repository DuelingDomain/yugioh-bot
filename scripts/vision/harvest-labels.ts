/** Turns a saved Remote Duels test recording plus its room events into a LOCAL set of warped card crops and labels for later vision work.
 *  npx tsx scripts/vision/harvest-labels.ts <recording.webm|mp4> --events room.json [--calibration cal.json] [--recognizer current|name|spec.json]
 *    [--out data/vision-harvest/<room>] [--room <name>] [--fps 2] [--agree-seconds 20] [--max-crops 8] [--empty-cap 12] [--min-sharpness 40]
 *    [--format normal] [--data data/vision] [--threads 2] [--from 0] [--duration s] [--holdout] [--allow-partial]
 *  Writes (git-ignored) crops/*.jpg, labels.jsonl, hard.jsonl, summary.json and, with --holdout, a HOLDOUT file. No network, no upload, no training, no index change.
 *  Use it only on recordings of people who agreed (the allowlisted test users, REMOTE_RECORD_USERS). A saved fixed test set must stay out of training and tuning: harvest it with --holdout.
 *
 *  Event list: it must be COMPLETE (seqs exactly 1..lastSeq; GET /api/remote/<slug> alone returns only the last 50, so save the list with export-room-events.ts). An incomplete list is refused
 *  unless --allow-partial, which then writes only corrections with a second source and hard crops. When unsure the tool writes NO label: a wrong label is worse than a missing one.
 *  Unknown action types: default deny. Only a short list of types known to leave cards alone (hand, deck, effect, phase, LP, log ...) is ignored; any other type that is not handled taints every card
 *  it names, and one with no card ref taints all cards and stops labels after it. They are counted in summary.unknownActions.
 *  Who did it: an action is "auto" when source is auto or cam.by is camera, "player" when source is click/voice/typed, cam.by is player or cam.ui is set, else "unknown" (a source-less action is never taken
 *  as a person; undo too, because the watcher sends undo itself). Unknown names block agreed labels and not-a-card. A player mark gives not-a-card only with the matching cam.ui: 'undo' for an undone place, 'popup-remove' for a removal.
 *  Dropped (no record, counted in the summary gaps): a card with an attach, detach, merge, control change, equip, pile lift or summon material; an undone identify, move or remove; a move with no known place;
 *  a place in a zone where another card is still open (overlap); several different player names. A place or move in a zone with no slot (hand, pile) stops the empty-zone check from then on.
 *  Margins: a crop starts 1 s after the card was placed and stops 1 s + half the round trip + 1.5 s before the end event (the server time of an end event is only known to about that much).
 *  Label kinds, most trusted first:
 *   correction  a player named the card (click, typed, voice) after the watcher read it wrong or not at all: the crops BEFORE the rename (on every span of the card, also after a move) carry the corrected name
 *               (`previous` = the old name). Checked per crop, always: the reader's top 5 holds the corrected card; else the crop is `hard` with label null and `proposed`. (A later watcher name does
 *               not count as a second source: if A was swapped for B and then named B, A's crops would get B's name.)
 *   not-a-card  only when ALL hold: the watcher placed it, a player removed it (explicit player mark) or undid the place, no player or unknown name, life <= 30 s, the watcher gave no name or a best guess,
 *               no other card in the zone within 5 s, and NO crop reads sure here. If any crop reads sure the crops are `hard` with label null (a person may have removed a real card).
 *   agreed      an automatic read (sure, not a best guess) with trusted names (no unknown origin) that ended by removal, move or clip end, and lay at least --agree-seconds after its last name event.
 *               A crop is labelled only if this reader's top answer is the same card; else it is `hard` with label null. No agreed label when the card gets ANY later name that differs
 *               (an automatic rename after a move, say).
 *   hard        the watcher did not name the card, or named it as a best guess: label null, with the guesses recorded. Also flagged `hard: true` (and copied to hard.jsonl): any crop the reader here
 *               does not read as sure, or reads as another card, and every correction crop.
 *   empty-zone  sampled, capped crops of mat zones the events say are empty (5 s slack plus jitter). A crop is dropped if any outline, even partial, covered or face-down, is found in the zone or the cell.
 *               Off when the event list is incomplete.
 *  Newer optional fields (cam.by, cam.ui, cam on player actions) are read when present. Sidecar (PR #605 names; the readers are one small group of functions in recording-lib.ts, so a rename is a small fix):
 *  client.clockSamples[{n, serverMs, offsetMs, rttMs}] (the sample nearest to an event is used; else the single client.clockOffsetMs, said in the gaps) and calibrations[{at, serverMs, format, placed, needed,
 *  calibration}] (the entry in force is used for each frame; frames within 3 s of a change, or on a first-guess grid the player never placed (placed false), give no crop; --calibration beats the sidecar).
 *  The app is not changed here.
 *  Safeguards: at most --max-crops crops per card per match, spread over the time it lay there; blurred crops are skipped (Laplacian variance of the crop below --min-sharpness);
 *  when the events lack what is needed to tie a correction to the earlier card, the summary says exactly what is missing. */
import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createFieldCalibration, fieldMatPoint, fieldZoneCells, hasExtraMonsterZones, mapFieldZone, type FieldCalibration, type FieldFormat } from '../../packages/vision/src/field-zones';
import { warpQuadMasked } from '../../packages/vision/src/truncation';
import type { RGBAImage } from '../../packages/vision/src/pixels';
import type { DetectedQuad, RecognitionResult } from '../../packages/vision/src/types';
import { defaultDataDir, jpegDecoder } from './clip-node';
import { buildTimeline, frameSize, type EventListInfo, occupiedAt, parseLiveActions, loadCalibration, readSidecar, readSidecarCalibrations, round, SINGLE_ZONES, withFrames, type NameChange, type TwinSpan } from './recording-lib';
import { loadRecognizer, normName, resolveRecognizerSpec, type LoadedRecognizer } from './recognizer-switch';

export type LabelKind = 'correction' | 'agreed' | 'hard' | 'empty-zone';
export interface LabelRecord {
  room: string; clipTimeS: number; zone: string; seat?: number; /** Card name; `not-a-card` for a phantom; `empty` for an empty zone; null when no label is trusted. */ label: string | null; cardId: number | null; labelKind: LabelKind;
  source: string; previous?: string | null; /** Name proposed for an unconfirmed correction. */ proposed?: string; ref?: string;
  recognizer: { name: string; top1?: { cardId: string; name: string; score: number; margin: number }; tier?: string } | null; sharpness: number; crop: string; hard: boolean;
}
export interface HarvestOptions {
  video: string; events: unknown; recognizer: LoadedRecognizer; calibration?: FieldCalibration; format?: FieldFormat; room?: string; out: string;
  fps?: number; agreeSeconds?: number; maxCrops?: number; emptyCap?: number; minSharpness?: number; holdout?: boolean; from?: number; duration?: number;
  /** Go on with an incomplete event list (see EventListInfo): only corrections with a second source and hard crops are written. */ allowPartial?: boolean;
  /** Tests: a fake frame detector and reader. */ keepFrames?: string;
}
export interface HarvestSummary {
  schema: 'recording-harvest/1'; room: string; recording: string; seat?: number; recognizer: string; holdout: boolean;
  params: { fps: number; agreeSeconds: number; maxCrops: number; emptyCap: number; minSharpness: number; format: string; calibration: 'file' | 'sidecar' | 'whole-frame' };
  /** How server-stamped events were put on video time, and the round trip used for the margins. */ clock: { source: 'samples' | 'single-offset' | 'none'; samples: number; rttMs: number };
  /** Live calibrations read from the sidecar (changes during the clip are followed; frames near a change or on a never-placed grid give no crop). */ calibrations: { entries: number; changes: number; unplaced: number };
  /** Action types this tool does not know, with counts. */ unknownActions: Record<string, number>;
  counts: { total: number; byKind: Record<string, number>; hard: number; byCard: Record<string, number>; notACard: number };
  /** The saved event list: complete only when its seqs are exactly 1..room.lastSeq. */ eventList: EventListInfo & { allowPartial: boolean };
  skipped: Record<string, number>; /** What the events lacked, and what was assumed. */ gaps: string[];
}

/** Variance of the Laplacian of the grey crop: a cheap sharpness measure (a flat or blurred crop is near 0). */
export function sharpnessOf(img: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): number {
  const { width: w, height: h, data } = img, g = new Float32Array(w * h);
  for (let i = 0, p = 0; i < g.length; i++, p += 4) g[i] = .299 * data[p] + .587 * data[p + 1] + .114 * data[p + 2];
  let n = 0, s = 0, s2 = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const i = y * w + x, l = g[i - 1] + g[i + 1] + g[i - w] + g[i + w] - 4 * g[i]; n++; s += l; s2 += l * l; }
  return n ? s2 / n - (s / n) ** 2 : 0;
}
/** Is this folder marked as a holdout (a fixed test set)? Training code must refuse such a folder. */
export const isHoldoutDir = (dir: string) => access(join(dir, 'HOLDOUT')).then(() => true, () => false);
/** `count` indices spread evenly over 0..n-1. */
export const spread = (n: number, count: number) => n <= count ? Array.from({ length: n }, (_, i) => i) : Array.from({ length: count }, (_, i) => Math.round((i + .5) * n / count - .5));

const CARD_W = 295, CARD_H = 430;
const quadPx = (q: { x: number; y: number }[], w: number, h: number) => q.map(p => ({ x: p.x * w, y: p.y * h }));
const sameCard = (label: { cardId?: number; name?: string }, idx: string | undefined, nameOf: (id?: string) => string) => !!idx && ((label.cardId !== undefined && String(label.cardId) === idx) || (!!label.name && normName(label.name) === normName(nameOf(idx))));
const centreOf = (q: { x: number; y: number }[]) => ({ x: q.reduce((t, p) => t + p.x, 0) / q.length, y: q.reduce((t, p) => t + p.y, 0) / q.length });
/** Is the point inside the convex quad (any winding)? */
const inQuad = (p: { x: number; y: number }, q: { x: number; y: number }[]) => { let pos = 0, neg = 0; for (let k = 0; k < q.length; k++) { const a = q[k], b = q[(k + 1) % q.length], c = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x); if (c > 0) pos++; else if (c < 0) neg++; } return !(pos && neg); };
const labelOf = (c?: NameChange) => c ? { cardId: c.cardId, name: c.name } : {};

export async function harvestLabels(o: HarvestOptions): Promise<{ records: LabelRecord[]; summary: HarvestSummary }> {
  const fps = o.fps ?? 2, agreeS = o.agreeSeconds ?? 20, maxCrops = o.maxCrops ?? 8, emptyCap = o.emptyCap ?? 12, minSharp = o.minSharpness ?? 40, from = o.from ?? 0, format = o.format ?? 'normal';
  const video = resolve(o.video), sidecar = await readSidecar(video), room = o.room ?? sidecar.tableSlug ?? 'room', calList = o.calibration ? [] : readSidecarCalibrations(sidecar), wholeFrame = createFieldCalibration([{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }]);
  const parse = parseLiveActions(o.events, sidecar), gaps = [...parse.gaps], skipped: Record<string, number> = {}, skip = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };
  const nameOf = (id?: string) => o.recognizer.nameOf(id), records: LabelRecord[] = [];
  /** The calibration and format in force at a video time (ms): --calibration beats the sidecar, the sidecar beats the whole frame. A string = no usable one (the reason): within 3 s of a change, or a grid the player never placed. */
  const calMarginMs = 3000;
  const envAt = (tMs: number): { calibration: FieldCalibration; format: FieldFormat } | string => {
    if (o.calibration) return { calibration: o.calibration, format };
    if (!calList.length) return { calibration: wholeFrame, format };
    let k = 0; calList.forEach((e, j) => { if (e.fromMs <= tMs) k = j; });
    if (calList.some((e, j) => j > 0 && Math.abs(tMs - e.fromMs) < calMarginMs)) return 'calibrationChange';
    return calList[k].placed === false ? 'calibrationNotPlaced' : { calibration: calList[k].calibration, format: o.format ?? calList[k].format ?? 'normal' };
  };
  if (!parse.list.complete && !o.allowPartial) throw new Error(`${parse.list.reason} Save the whole list (scripts/vision/export-room-events.ts, or GET /api/remote/<slug>?afterSeq=0 in pages) right after the match, or pass --allow-partial to harvest only corrections and hard crops.`);
  if (sidecar.seat === undefined) gaps.push('The sidecar has no seat: all seats in the events are used, so a card of another seat could be matched to a zone of this camera.');
  await rm(join(o.out, 'crops'), { recursive: true, force: true }); await mkdir(join(o.out, 'crops'), { recursive: true });
  const decode = await jpegDecoder();

  await withFrames(video, { fps, from, duration: o.duration, keep: o.keepFrames }, async (dir, names) => {
    const { width, height } = await frameSize(dir, names[0]), spanMs = from * 1000 + (names.length - 1) * 1000 / fps, tl = buildTimeline(parse.actions, sidecar.seat, spanMs);
    gaps.push(...tl.gaps);
    const sharp = (await import('sharp')).default, frameAt = (tMs: number) => Math.max(0, Math.min(names.length - 1, Math.round((tMs - from * 1000) / 1000 * fps)));
    const imgCache = new Map<number, RGBAImage>(), detCache = new Map<number, DetectedQuad[]>();
    const image = async (i: number) => { let v = imgCache.get(i); if (!v) { if (imgCache.size > 6) imgCache.delete(imgCache.keys().next().value!); v = await decode(new Uint8Array(await readFile(join(dir, names[i])))); imgCache.set(i, v); } return v; };
    const detect = async (i: number) => { let v = detCache.get(i); if (!v) { v = await o.recognizer.recognizer.detectCards(await image(i) as unknown as ImageData); detCache.set(i, v); } return v; };
    interface Crop { i: number; tS: number; img: RGBAImage; card?: DetectedQuad; sharp: number }
    const rgba = (w: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }): RGBAImage => ({ width: w.width, height: w.height, data: w.data as Uint8ClampedArray });
    const jpeg = async (w: { width: number; height: number; data: Uint8ClampedArray | Uint8Array }, file: string) => { await sharp(Buffer.from(w.data.buffer, w.data.byteOffset, w.data.byteLength), { raw: { width: w.width, height: w.height, channels: 4 } }).jpeg({ quality: 90 }).toFile(file); };
    let serial = 0;
    const save = async (c: Crop, kind: LabelKind, zone: string, ref: string) => { const rel = `crops/${String(++serial).padStart(4, '0')}-${kind}-${zone}-${Math.round(c.tS * 1000)}ms.jpg`; await jpeg(c.img, join(o.out, rel)); return rel; };
    /** Candidate frames of one card in a time window; blurred ones and ones with no outline in the zone are dropped. */
    const crops = async (zone: string, a: number, b: number, want: number): Promise<Crop[]> => {
      if (b - a < 0) return [];
      const lo = frameAt(a), hi = frameAt(b), pool = Array.from({ length: Math.max(0, hi - lo + 1) }, (_, k) => lo + k);
      const idxs = spread(pool.length, want * 2).map(k => pool[k]), out: Crop[] = [];
      for (const i of idxs) {
        const env = envAt((from + i / fps) * 1000); if (typeof env === 'string') { skip(env); continue; }
        const found = (await detect(i)).filter(d => !d.partial && !d.covered && mapFieldZone(d, env.calibration, [], env.format).zone === zone).sort((x, y) => y.confidence - x.confidence)[0];
        if (!found) { skip('noOutline'); continue; }
        if (found.kind === 'face-down') { skip('faceDown'); continue; }
        const img = await image(i), warp = warpQuadMasked(img, quadPx(found.quad, img.width, img.height) as never, CARD_W, CARD_H);
        if (!warp) { skip('noWarp'); continue; }
        const sh = sharpnessOf(warp.image); if (sh < minSharp) { skip('blurred'); continue; }
        out.push({ i, tS: from + (i / fps), img: rgba(warp.image), card: found, sharp: sh });
      }
      return spread(out.length, want).map(k => out[k]);
    };
    const read = async (c: Crop): Promise<RecognitionResult | undefined> => { try { return await o.recognizer.recognizer.recognize([await image(c.i)] as unknown as ImageData[], { card: c.card, k: 5, maxFrames: 1 }); } catch { skip('readError'); return undefined; } };
    const top1 = (r?: RecognitionResult) => { const c = r?.candidates ?? []; return c[0] ? { cardId: c[0].cardId, name: nameOf(c[0].cardId), score: round(c[0].score, 4), margin: round(c[0].score - (c[1]?.score ?? 0), 4) } : undefined; };
    const recInfo = (r?: RecognitionResult) => ({ name: o.recognizer.name, top1: top1(r), tier: r?.tier });
    const push = (r: Omit<LabelRecord, 'room' | 'recognizer'> & { recognizer?: LabelRecord['recognizer'] }) => records.push({ room, recognizer: null, ...r } as LabelRecord);
    const marginMs = 1000, jitterMs = parse.clock.rttMs / 2 + 1500, endMs = marginMs + jitterMs, nearMs = 5000, partial = !parse.list.complete;
    const named = (n: NameChange) => n.cardId !== undefined || !!n.name, nameKey = (n: { cardId?: number; name?: string }) => n.cardId !== undefined ? String(n.cardId) : normName(n.name ?? '');
    const sameName = (x: NameChange, y: NameChange) => (x.cardId !== undefined && x.cardId === y.cardId) || (!!x.name && !!y.name && normName(x.name) === normName(y.name));
    const dropped = new Map<string, number>();

    for (const span of tl.spans) {
      if (!SINGLE_ZONES.has(span.zone)) continue;
      const why = tl.tainted.get(span.ref); if (why) { skip('refUnclear'); dropped.set(why, (dropped.get(why) ?? 0) + 1); continue; }
      if (span.overlap) { skip('zoneOverlap'); continue; }
      if (span.to > tl.opaqueFrom) { skip('afterUnknownAction'); continue; }
      // every identity event of the card over ALL its spans (a rename after a move counts)
      const names = span.names.filter(named), players = names.filter(n => n.origin === 'player'), autos = names.filter(n => n.origin === 'auto'), trusted = !names.some(n => n.origin === 'unknown');
      const lastPlayer = players[players.length - 1], live = names.filter(n => n.t <= span.to).pop(), lifeS = (span.to - span.from) / 1000;
      const winEnd = span.end === 'clip-end' ? span.to : span.to - endMs, winStart = span.from + marginMs;
      if (new Set(players.map(nameKey)).size > 1) { skip('severalPlayerNames'); continue; }

      if (lastPlayer) {
        // correction: a player named the card; was the earlier name different?
        const beforePlayer = names.filter(n => n.t < lastPlayer.t).pop(), changed = !beforePlayer || !sameName(beforePlayer, lastPlayer);
        if (changed) {
          if (span.from >= lastPlayer.t - endMs) { skip('afterPlayerName'); continue; }
          const cs = await crops(span.zone, winStart, Math.min(winEnd, lastPlayer.t - endMs), maxCrops);
          if (!cs.length) { skip('correctionNoCrops'); gaps.push(`Correction at ${round(lastPlayer.t / 1000, 1)} s in ${span.zone}: no usable crop before it (the card lay there ${round((lastPlayer.t - span.from) / 1000, 1)} s, or the frames were blurred).`); continue; }
          const reads = await Promise.all(cs.map(read)), name = lastPlayer.name ?? nameOf(String(lastPlayer.cardId));
          let unconfirmed = 0;
          for (let k = 0; k < cs.length; k++) {
            // second source, ALWAYS per crop: this reader's top 5 holds the corrected card. (A later watcher name does not count: if A was swapped for B and then named B, A's crops would get B's name.)
            const second = (reads[k]?.candidates ?? []).slice(0, 5).some(c => sameCard(labelOf(lastPlayer), c.cardId, nameOf)); if (!second) unconfirmed++;
            const rel = await save(cs[k], second ? 'correction' : 'hard', span.zone, span.ref);
            push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: second ? name : null, cardId: second ? lastPlayer.cardId ?? null : null, labelKind: second ? 'correction' : 'hard',
              source: second ? 'player-rename' : 'player-rename-unconfirmed', previous: beforePlayer ? beforePlayer.name ?? String(beforePlayer.cardId) : null, ...(second ? {} : { proposed: name }), ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: true });
          }
          if (unconfirmed) skip('correctionUnconfirmed');
          continue;
        }
      }
      if (!span.placedAuto) { skip('placedByPlayer'); continue; }

      if (span.end === 'removed-player' || span.end === 'undone-player') {
        // phantom candidate: the watcher placed it and a person (explicitly marked as one) took it away soon after. Writes not-a-card only when every sign agrees; else no label.
        if (partial) { skip('phantomPartialList'); continue; }
        if (lastPlayer || !trusted) { skip('playerRemoved'); continue; }
        if (span.endUi !== (span.end === 'undone-player' ? 'undo' : 'popup-remove')) { skip('playerRemovedOtherUi'); continue; }
        if (lifeS > 30) { skip('playerRemovedLate'); continue; }
        if (live && !live.bestMatch) { skip('removalOfNamedCard'); continue; }
        if (tl.spans.some(o => o !== span && o.zone === span.zone && o.from <= span.to + nearMs && o.to >= span.from - nearMs)) { skip('zoneBusy'); continue; }
        const cs = await crops(span.zone, winStart, winEnd, maxCrops); if (!cs.length) { skip('phantomNoCrops'); continue; }
        const reads = await Promise.all(cs.map(read)), anySure = reads.some(r => !r || r.tier === 'sure');
        // not-a-card only when NO crop reads sure: a real card that the watcher could not name is read sure by this reader, and then the person removed it for another reason
        const kind: LabelKind = anySure ? 'hard' : 'correction';
        for (let k = 0; k < cs.length; k++) {
          const rel = await save(cs[k], kind, span.zone, span.ref);
          push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: anySure ? null : 'not-a-card', cardId: null, labelKind: kind, source: anySure ? 'removed-by-player-but-reader-sure' : span.end === 'undone-player' ? 'player-undo-of-auto-place' : 'player-removed-auto-place',
            previous: live?.name ?? null, ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: true });
        }
        continue;
      }
      if (span.end !== 'removed-auto' && span.end !== 'moved' && span.end !== 'clip-end') { skip('endUnclear'); continue; }

      // a later name that differs (an automatic rename after a move, say) means the earlier name was wrong or the card changed: no agreed label
      if (names.some(n => n.t > span.to && live && !sameName(n, live))) { skip('renamedLater'); continue; }
      const confident = !!live && !live.bestMatch && trusted && !!(live.cardId !== undefined || live.name);
      if (confident && !partial) {
        // agreed: only the time AFTER the last identity event, and only when the reader here does not read another card
        const a = Math.max(winStart, live!.t + endMs);
        if (winEnd - a < agreeS * 1000) { skip('agreedTooShort'); continue; }
        const cs = await crops(span.zone, a, winEnd, maxCrops); if (!cs.length) { skip('agreedNoCrops'); continue; }
        const reads = await Promise.all(cs.map(read)), name = live!.name ?? nameOf(String(live!.cardId));
        for (let k = 0; k < cs.length; k++) {
          const t1 = top1(reads[k]), agrees = !!t1 && sameCard(labelOf(live), t1.cardId, nameOf), trust = agrees;
          const rel = await save(cs[k], trust ? 'agreed' : 'hard', span.zone, span.ref);
          push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: trust ? name : null, cardId: trust ? live!.cardId ?? null : null, labelKind: trust ? 'agreed' : 'hard',
            source: trust ? (live!.origin === 'player' ? 'auto-name-confirmed-by-player' : 'auto-name') : 'auto-name-reader-disagrees', ...(trust ? {} : { proposed: name }), ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: !trust || reads[k]?.tier !== 'sure' });
        }
      } else {
        // not named, or only a best guess: a hard example with no trusted label
        const cs = await crops(span.zone, winStart, winEnd, maxCrops); if (!cs.length) { skip('hardNoCrops'); continue; }
        const reads = await Promise.all(cs.map(read));
        for (let k = 0; k < cs.length; k++) {
          const rel = await save(cs[k], 'hard', span.zone, span.ref);
          push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: null, cardId: null, labelKind: 'hard', source: live ? 'auto-best-guess' : 'auto-unnamed', ...(live?.name ? { proposed: live.name } : {}), ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: true });
        }
      }
    }
    if (Object.keys(parse.unknownTypes).length) gaps.push(`Unknown action types in the events (treated as maybe moving the cards they name; with no card ref, no label after them): ${Object.entries(parse.unknownTypes).map(([k, n]) => `${k} x${n}`).join(', ')}.`);
    if (calList.length > 1) gaps.push(`The live calibration changed ${calList.length - 1} time(s) during the recording: each frame uses the entry in force, and frames within ${calMarginMs / 1000} s of a change give no crop.`);
    if (calList.some(e => e.placed === false)) gaps.push('Part of the recording used a first-guess grid the player never placed: no crop is taken then.');
    if (parse.clock.source !== 'samples') gaps.push(`No per-chunk clock samples in the sidecar (clock: ${parse.clock.source}): margins use the single round trip value.`);
    for (const [why, n] of dropped) gaps.push(`${n} span${n > 1 ? 's' : ''} dropped: the events touch the card in a way this tool does not follow (${why}); none of its crops are labelled.`);
    if (partial) gaps.push('Partial event list (--allow-partial): only corrections with a second source and hard crops were written; no agreed label, no not-a-card, no empty-zone crop.');

    // empty zones
    if (tl.knownFrom === Infinity) gaps.push('Empty-zone crops are off: the event list holds no twin or identify events for this seat, so no zone can be proven empty.');
    else if (parse.truncated) { gaps.push('Empty-zone crops are off: the event list is incomplete, so no zone can be proven empty.'); }
    else if (parse.origin === undefined) gaps.push('Empty-zone crops are off: events cannot be put on video time.');
    else {
      const zoneNames = fieldZoneCells(format).filter(c => SINGLE_ZONES.has(c.zone) && (!c.zone.startsWith('EMZ') || hasExtraMonsterZones(format))).map(c => c.zone);
      // per zone, frames spread over the time it is empty; then all zones together, spread over time again, so the cap covers many zones and the whole clip
      const emptySlack = 5000 + jitterMs, cand: { zone: string; i: number }[] = [], perZone = Math.max(1, Math.ceil(emptyCap * 2 / zoneNames.length));
      for (const zone of zoneNames) {
        const free: number[] = []; for (let i = 0; i < names.length; i++) { const t = (from + i / fps) * 1000; if (t > tl.knownFrom + marginMs && t < spanMs - marginMs && typeof envAt(t) !== 'string' && !occupiedAt(tl, zone, t, emptySlack)) free.push(i); }
        for (const k of spread(free.length, perZone)) cand.push({ zone, i: free[k] });
      }
      cand.sort((x, y) => x.i - y.i || x.zone.localeCompare(y.zone));
      let kept = 0;
      for (const k of spread(cand.length, Math.min(cand.length, emptyCap * 2))) {
        if (kept >= emptyCap) break;
        const { zone, i } = cand[k], env = envAt((from + i / fps) * 1000) as { calibration: FieldCalibration; format: FieldFormat }, cell = fieldZoneCells(env.format, env.calibration.zoneSpacing, env.calibration.zones).find(c => c.zone === zone), img = await image(i);
        if (!cell) { skip('emptyNoCell'); continue; }
        const quad = [{ x: cell.x, y: cell.y }, { x: cell.x + cell.w, y: cell.y }, { x: cell.x + cell.w, y: cell.y + cell.h }, { x: cell.x, y: cell.y + cell.h }].map(p => fieldMatPoint(p, env.calibration));
        if (quad.some(p => !Number.isFinite(p.x) || p.x < -.05 || p.x > 1.05 || p.y < -.05 || p.y > 1.05)) { skip('emptyOffFrame'); continue; }
        // pixel check: any outline (also partial, covered or face-down) on this cell, or a detection mapped to this zone, means a card may lie there: drop the crop
        if ((await detect(i)).some(d => mapFieldZone(d, env.calibration, [], env.format).zone === zone || inQuad(centreOf(d.quad), quad) || inQuad(centreOf(quad), d.quad))) { skip('emptyZoneHasOutline'); continue; }
        const warp = warpQuadMasked(img, quadPx(quad, img.width, img.height) as never, CARD_W, CARD_H); if (!warp) { skip('noWarp'); continue; }
        const c: Crop = { i, tS: from + i / fps, img: rgba(warp.image), sharp: sharpnessOf(warp.image) }, rel = await save(c, 'empty-zone', zone, 'empty');
        push({ clipTimeS: round(c.tS, 2), zone, seat: sidecar.seat, label: 'empty', cardId: null, labelKind: 'empty-zone', source: 'events-say-empty', recognizer: null, sharpness: round(c.sharp, 1), crop: rel, hard: false }); kept++;
      }
    }
    void width; void height;
  });

  const byKind: Record<string, number> = {}, byCard: Record<string, number> = {};
  for (const r of records) { byKind[r.labelKind] = (byKind[r.labelKind] ?? 0) + 1; if (r.label && r.label !== 'empty') byCard[r.label] = (byCard[r.label] ?? 0) + 1; }
  const summary: HarvestSummary = { schema: 'recording-harvest/1', room, recording: video.split('/').pop()!, seat: sidecar.seat, recognizer: o.recognizer.name, holdout: !!o.holdout,
    params: { fps, agreeSeconds: agreeS, maxCrops, emptyCap, minSharpness: minSharp, format, calibration: o.calibration ? 'file' : calList.length ? 'sidecar' : 'whole-frame' },
    counts: { total: records.length, byKind, hard: records.filter(r => r.hard).length, byCard, notACard: records.filter(r => r.label === 'not-a-card').length }, eventList: { ...parse.list, allowPartial: !!o.allowPartial },
    clock: { source: parse.clock.source, samples: parse.clock.samples.length, rttMs: parse.clock.rttMs }, calibrations: { entries: calList.length, changes: Math.max(0, calList.length - 1), unplaced: calList.filter(e => e.placed === false).length }, unknownActions: parse.unknownTypes, skipped, gaps: [...new Set(gaps)] };
  await mkdir(o.out, { recursive: true });
  await writeFile(join(o.out, 'labels.jsonl'), records.map(r => JSON.stringify(r)).join('\n') + (records.length ? '\n' : ''));
  await writeFile(join(o.out, 'hard.jsonl'), records.filter(r => r.hard).map(r => JSON.stringify(r)).join('\n') + (records.some(r => r.hard) ? '\n' : ''));
  await writeFile(join(o.out, 'summary.json'), JSON.stringify(summary, null, 1));
  if (o.holdout) await writeFile(join(o.out, 'HOLDOUT'), `Fixed test set: never use these crops or labels for training or threshold tuning.\nWritten by harvest-labels.ts --holdout for room ${room}.\n`);
  return { records, summary };
}

if (process.argv[1]?.endsWith('harvest-labels.ts')) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    events: { type: 'string' }, calibration: { type: 'string' }, recognizer: { type: 'string' }, out: { type: 'string' }, room: { type: 'string' }, fps: { type: 'string' }, 'agree-seconds': { type: 'string' },
    'max-crops': { type: 'string' }, 'empty-cap': { type: 'string' }, 'min-sharpness': { type: 'string' }, format: { type: 'string' }, data: { type: 'string' }, threads: { type: 'string' },
    from: { type: 'string' }, duration: { type: 'string' }, holdout: { type: 'boolean' }, 'allow-partial': { type: 'boolean' }, 'keep-frames': { type: 'string' },
  } });
  const file = positionals[0];
  if (!file || !values.events) { console.error('Usage: harvest-labels.ts <recording.webm|mp4> --events room.json [--calibration cal.json] [--recognizer current|name|spec.json] [--out dir] [--fps 2] [--agree-seconds 20] [--max-crops 8] [--holdout] [--allow-partial]'); process.exit(2); }
  const data = values.data ?? defaultDataDir();
  let loaded: LoadedRecognizer;
  try { loaded = await loadRecognizer(await resolveRecognizerSpec(values.recognizer, data), Number(values.threads ?? 2), data); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
  try {
    const sidecar = await readSidecar(resolve(file)), room = values.room ?? sidecar.tableSlug ?? 'room', root = resolve(import.meta.dirname, '../..');
    const { summary } = await harvestLabels({ video: file, events: JSON.parse(await readFile(values.events, 'utf8')) as unknown, recognizer: loaded, calibration: values.calibration ? await loadCalibration(values.calibration) : undefined,
      format: (values.format ?? 'normal') as FieldFormat, room, out: resolve(values.out ?? join(root, 'data/vision-harvest', room)), fps: values.fps ? Number(values.fps) : undefined, agreeSeconds: values['agree-seconds'] ? Number(values['agree-seconds']) : undefined,
      maxCrops: values['max-crops'] ? Number(values['max-crops']) : undefined, emptyCap: values['empty-cap'] ? Number(values['empty-cap']) : undefined, minSharpness: values['min-sharpness'] ? Number(values['min-sharpness']) : undefined,
      holdout: values.holdout, allowPartial: values['allow-partial'], from: values.from ? Number(values.from) : undefined, duration: values.duration ? Number(values.duration) : undefined, keepFrames: values['keep-frames'] });
    console.log(`Harvest ${summary.room}: ${summary.counts.total} crops (${Object.entries(summary.counts.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}), ${summary.counts.hard} hard${summary.holdout ? ', HOLDOUT' : ''}`);
    if (Object.keys(summary.skipped).length) console.log(`Skipped: ${Object.entries(summary.skipped).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    for (const g of summary.gaps) console.log(`Gap: ${g}`);
  } finally { await loaded.release(); }
}

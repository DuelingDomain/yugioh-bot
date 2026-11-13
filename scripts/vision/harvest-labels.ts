/** Turns a saved Remote Duels test recording plus its room events into a LOCAL set of warped card crops and labels for later vision work.
 *  npx tsx scripts/vision/harvest-labels.ts <recording.webm|mp4> --events room.json [--calibration cal.json] [--recognizer current|name|spec.json]
 *    [--out data/vision-harvest/<room>] [--room <name>] [--fps 2] [--agree-seconds 20] [--max-crops 8] [--empty-cap 12] [--min-sharpness 40]
 *    [--format normal] [--data data/vision] [--threads 2] [--from 0] [--duration s] [--holdout]
 *  Writes (git-ignored) crops/*.jpg, labels.jsonl, hard.jsonl, summary.json and, with --holdout, a HOLDOUT file. No network, no upload, no training, no index change.
 *  Use it only on recordings of people who agreed (the allowlisted test users, REMOTE_RECORD_USERS). A saved fixed test set must stay out of training and tuning: harvest it with --holdout.
 *
 *  Label kinds, most trusted first:
 *   correction  a player named the card (click, typed, voice) after the watcher read it wrong or not at all: the crops BEFORE the rename carry the corrected name (`previous` = the old name).
 *               Kept only when a second source agrees (the reader's top 5 holds the corrected card, or a later automatic event names it); else written as `hard` with label null.
 *               A track the watcher placed and a player removed or undid within 30 s, never named by a player, and not a sure read, gives a `not-a-card` negative.
 *   agreed      an automatic read (sure, not a best guess) that stayed on the board at least --agree-seconds and was never renamed, removed or undone by a player.
 *   hard        the watcher did not name the card, or named it as a best guess: label null, with the guesses recorded. Also flagged `hard: true` (and copied to hard.jsonl): any crop the reader here
 *               does not read as sure, or reads as another card, and every correction crop.
 *   empty-zone  sampled, capped crops of mat zones the events say are empty. Switched off when the event list is incomplete.
 *  Safeguards: at most --max-crops crops per card per match, spread over the time it lay there; blurred crops are skipped (Laplacian variance of the crop below --min-sharpness);
 *  a player action that contradicts an automatic one always wins; when the events lack what is needed to tie a correction to the earlier card, the summary says exactly what is missing. */
import { mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createFieldCalibration, fieldMatPoint, fieldZoneCells, hasExtraMonsterZones, mapFieldZone, type FieldCalibration, type FieldFormat } from '../../packages/vision/src/field-zones';
import { warpQuadMasked } from '../../packages/vision/src/truncation';
import type { RGBAImage } from '../../packages/vision/src/pixels';
import type { DetectedQuad, RecognitionResult } from '../../packages/vision/src/types';
import { defaultDataDir, jpegDecoder } from './clip-node';
import { buildTimeline, frameSize, loadCalibration, occupiedAt, parseLiveActions, readSidecar, round, SINGLE_ZONES, withFrames, type NameChange, type TwinSpan } from './recording-lib';
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
  /** Tests: a fake frame detector and reader. */ keepFrames?: string;
}
export interface HarvestSummary {
  schema: 'recording-harvest/1'; room: string; recording: string; seat?: number; recognizer: string; holdout: boolean;
  params: { fps: number; agreeSeconds: number; maxCrops: number; emptyCap: number; minSharpness: number; format: string; calibration: 'file' | 'whole-frame' };
  counts: { total: number; byKind: Record<string, number>; hard: number; byCard: Record<string, number>; notACard: number };
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
const labelOf = (c?: NameChange) => c ? { cardId: c.cardId, name: c.name } : {};

export async function harvestLabels(o: HarvestOptions): Promise<{ records: LabelRecord[]; summary: HarvestSummary }> {
  const fps = o.fps ?? 2, agreeS = o.agreeSeconds ?? 20, maxCrops = o.maxCrops ?? 8, emptyCap = o.emptyCap ?? 12, minSharp = o.minSharpness ?? 40, from = o.from ?? 0, format = o.format ?? 'normal';
  const video = resolve(o.video), sidecar = await readSidecar(video), room = o.room ?? sidecar.tableSlug ?? 'room', calibration = o.calibration ?? createFieldCalibration([{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }]);
  const parse = parseLiveActions(o.events, sidecar), gaps = [...parse.gaps], skipped: Record<string, number> = {}, skip = (k: string) => { skipped[k] = (skipped[k] ?? 0) + 1; };
  const nameOf = (id?: string) => o.recognizer.nameOf(id), records: LabelRecord[] = [];
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
        const found = (await detect(i)).filter(d => !d.partial && !d.covered && mapFieldZone(d, calibration, [], format).zone === zone).sort((x, y) => y.confidence - x.confidence)[0];
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
    const marginMs = 1000, jitterMs = (sidecar.client?.rttMs ?? 0) / 2 + 1500;

    for (const span of tl.spans) {
      if (!SINGLE_ZONES.has(span.zone)) continue;
      const players = span.names.filter(n => n.origin === 'player'), autos = span.names.filter(n => n.origin === 'auto');
      const lastPlayer = players[players.length - 1], lastAuto = autos[autos.length - 1], beforePlayer = lastPlayer ? [...span.names].filter(n => n.t < lastPlayer.t).pop() : undefined;
      const lifeS = (span.to - span.from) / 1000;
      const window = (a: number, b: number): [number, number] => [a + marginMs, b - marginMs];
      if (new Set(players.map(p => String(p.cardId ?? normName(p.name ?? '')))).size > 1) { skip('severalPlayerNames'); continue; }

      if (lastPlayer && (lastPlayer.cardId !== undefined || lastPlayer.name)) {
        // correction: a player named the card; was the earlier name different?
        const changed = !beforePlayer || !(sameCard(labelOf(lastPlayer), beforePlayer.cardId !== undefined ? String(beforePlayer.cardId) : undefined, nameOf) || (!!beforePlayer.name && !!lastPlayer.name && normName(beforePlayer.name) === normName(lastPlayer.name)));
        if (changed) {
          const [a, b] = window(span.from, lastPlayer.t - jitterMs);
          const cs = await crops(span.zone, a, b, maxCrops); if (!cs.length) { skip('correctionNoCrops'); gaps.push(`Correction at ${round(lastPlayer.t / 1000, 1)} s in ${span.zone}: no usable crop before it (the card lay there ${round((lastPlayer.t - span.from) / 1000, 1)} s, or the frames were blurred).`); continue; }
          const reads = await Promise.all(cs.map(read)), name = lastPlayer.name ?? nameOf(String(lastPlayer.cardId));
          const secondSource = reads.some(r => (r?.candidates ?? []).slice(0, 5).some(c => sameCard(labelOf(lastPlayer), c.cardId, nameOf))) || autos.some(n => n.t > lastPlayer.t && sameCard(labelOf(lastPlayer), n.cardId !== undefined ? String(n.cardId) : undefined, nameOf) || (n.t > lastPlayer.t && !!n.name && normName(n.name) === normName(name)));
          for (let k = 0; k < cs.length; k++) {
            const rel = await save(cs[k], secondSource ? 'correction' : 'hard', span.zone, span.ref);
            push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: secondSource ? name : null, cardId: secondSource ? lastPlayer.cardId ?? null : null, labelKind: secondSource ? 'correction' : 'hard',
              source: secondSource ? 'player-rename' : 'player-rename-unconfirmed', previous: beforePlayer ? beforePlayer.name ?? String(beforePlayer.cardId) : null, ...(secondSource ? {} : { proposed: name }), ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: true });
          }
          if (!secondSource) skip('correctionUnconfirmed');
          continue;
        }
      }
      if (!span.placedAuto) { skip('placedByPlayer'); continue; }

      if ((span.end === 'removed-player' || span.end === 'undone-player') && !lastPlayer) {
        // phantom candidate: removed by a person soon after the watcher placed it
        if (lifeS > 30) { skip('playerRemovedLate'); continue; }
        const [a, b] = window(span.from, span.to), cs = await crops(span.zone, a, b, maxCrops); if (!cs.length) { skip('phantomNoCrops'); continue; }
        const reads = await Promise.all(cs.map(read)), sure = reads.filter(r => r?.tier === 'sure').length;
        if (lastAuto && !lastAuto.bestMatch && sure * 2 > cs.length) { skip('removalAmbiguous'); continue; }
        for (let k = 0; k < cs.length; k++) {
          const rel = await save(cs[k], 'correction', span.zone, span.ref);
          push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: 'not-a-card', cardId: null, labelKind: 'correction', source: span.end === 'undone-player' ? 'player-undo-of-auto-place' : 'player-removed-auto-place', previous: lastAuto?.name ?? null, ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: true });
        }
        continue;
      }
      if (span.end === 'removed-player' || span.end === 'undone-player') { skip('playerRemoved'); continue; }

      const live = lastAuto ?? undefined, confident = !!live && (live.cardId !== undefined || !!live.name) && !live.bestMatch;
      if (confident) {
        if (lifeS < agreeS) { skip('agreedTooShort'); continue; }
        const [a, b] = window(span.from, span.to), cs = await crops(span.zone, a, b, maxCrops); if (!cs.length) { skip('agreedNoCrops'); continue; }
        const reads = await Promise.all(cs.map(read)), name = live!.name ?? nameOf(String(live!.cardId));
        for (let k = 0; k < cs.length; k++) {
          const t1 = top1(reads[k]), agrees = !!t1 && sameCard(labelOf(live), t1.cardId, nameOf), hard = !agrees || reads[k]?.tier !== 'sure';
          const rel = await save(cs[k], 'agreed', span.zone, span.ref);
          push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: name, cardId: live!.cardId ?? null, labelKind: 'agreed', source: lastPlayer ? 'auto-name-confirmed-by-player' : 'auto-name', ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard });
        }
      } else {
        // not named, or only a best guess: a hard example with no trusted label
        const [a, b] = window(span.from, span.to), cs = await crops(span.zone, a, b, maxCrops); if (!cs.length) { skip('hardNoCrops'); continue; }
        const reads = await Promise.all(cs.map(read));
        for (let k = 0; k < cs.length; k++) {
          const rel = await save(cs[k], 'hard', span.zone, span.ref);
          push({ clipTimeS: round(cs[k].tS, 2), zone: span.zone, seat: span.seat, label: null, cardId: null, labelKind: 'hard', source: live ? 'auto-best-guess' : 'auto-unnamed', ...(live?.name ? { proposed: live.name } : {}), ref: span.ref, recognizer: recInfo(reads[k]), sharpness: round(cs[k].sharp, 1), crop: rel, hard: true });
        }
      }
    }

    // empty zones
    if (tl.knownFrom === Infinity) gaps.push('Empty-zone crops are off: the event list holds no twin or identify events for this seat, so no zone can be proven empty.');
    else if (parse.truncated) { gaps.push('Empty-zone crops are off: the event list is incomplete, so no zone can be proven empty.'); }
    else if (parse.origin === undefined) gaps.push('Empty-zone crops are off: events cannot be put on video time.');
    else {
      const cells = fieldZoneCells(format, calibration.zoneSpacing, calibration.zones).filter(c => SINGLE_ZONES.has(c.zone) && (!c.zone.startsWith('EMZ') || hasExtraMonsterZones(format)));
      // per zone, frames spread over the time it is empty; then all zones together, spread over time again, so the cap covers many zones and the whole clip
      const cand: { zone: string; i: number }[] = [], perZone = Math.max(1, Math.ceil(emptyCap * 2 / cells.length));
      for (const c of cells) {
        const free: number[] = []; for (let i = 0; i < names.length; i++) { const t = (from + i / fps) * 1000; if (t > tl.knownFrom + marginMs && t < spanMs - marginMs && !occupiedAt(tl, c.zone, t, 2500)) free.push(i); }
        for (const k of spread(free.length, perZone)) cand.push({ zone: c.zone, i: free[k] });
      }
      cand.sort((x, y) => x.i - y.i || x.zone.localeCompare(y.zone));
      let kept = 0;
      for (const k of spread(cand.length, Math.min(cand.length, emptyCap * 2))) {
        if (kept >= emptyCap) break;
        const { zone, i } = cand[k], cell = cells.find(c => c.zone === zone)!, img = await image(i);
        const quad = [{ x: cell.x, y: cell.y }, { x: cell.x + cell.w, y: cell.y }, { x: cell.x + cell.w, y: cell.y + cell.h }, { x: cell.x, y: cell.y + cell.h }].map(p => fieldMatPoint(p, calibration));
        if (quad.some(p => !Number.isFinite(p.x) || p.x < -.05 || p.x > 1.05 || p.y < -.05 || p.y > 1.05)) { skip('emptyOffFrame'); continue; }
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
    params: { fps, agreeSeconds: agreeS, maxCrops, emptyCap, minSharpness: minSharp, format, calibration: o.calibration ? 'file' : 'whole-frame' },
    counts: { total: records.length, byKind, hard: records.filter(r => r.hard).length, byCard, notACard: records.filter(r => r.label === 'not-a-card').length }, skipped, gaps: [...new Set(gaps)] };
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
    from: { type: 'string' }, duration: { type: 'string' }, holdout: { type: 'boolean' }, 'keep-frames': { type: 'string' },
  } });
  const file = positionals[0];
  if (!file || !values.events) { console.error('Usage: harvest-labels.ts <recording.webm|mp4> --events room.json [--calibration cal.json] [--recognizer current|name|spec.json] [--out dir] [--fps 2] [--agree-seconds 20] [--max-crops 8] [--holdout]'); process.exit(2); }
  const data = values.data ?? defaultDataDir();
  let loaded: LoadedRecognizer;
  try { loaded = await loadRecognizer(await resolveRecognizerSpec(values.recognizer, data), Number(values.threads ?? 2), data); } catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
  try {
    const sidecar = await readSidecar(resolve(file)), room = values.room ?? sidecar.tableSlug ?? 'room', root = resolve(import.meta.dirname, '../..');
    const { summary } = await harvestLabels({ video: file, events: JSON.parse(await readFile(values.events, 'utf8')) as unknown, recognizer: loaded, calibration: values.calibration ? await loadCalibration(values.calibration) : undefined,
      format: (values.format ?? 'normal') as FieldFormat, room, out: resolve(values.out ?? join(root, 'data/vision-harvest', room)), fps: values.fps ? Number(values.fps) : undefined, agreeSeconds: values['agree-seconds'] ? Number(values['agree-seconds']) : undefined,
      maxCrops: values['max-crops'] ? Number(values['max-crops']) : undefined, emptyCap: values['empty-cap'] ? Number(values['empty-cap']) : undefined, minSharpness: values['min-sharpness'] ? Number(values['min-sharpness']) : undefined,
      holdout: values.holdout, from: values.from ? Number(values.from) : undefined, duration: values.duration ? Number(values.duration) : undefined, keepFrames: values['keep-frames'] });
    console.log(`Harvest ${summary.room}: ${summary.counts.total} crops (${Object.entries(summary.counts.byKind).map(([k, n]) => `${k} ${n}`).join(', ') || 'none'}), ${summary.counts.hard} hard${summary.holdout ? ', HOLDOUT' : ''}`);
    if (Object.keys(summary.skipped).length) console.log(`Skipped: ${Object.entries(summary.skipped).map(([k, n]) => `${k} ${n}`).join(', ')}`);
    for (const g of summary.gaps) console.log(`Gap: ${g}`);
  } finally { await loaded.release(); }
}

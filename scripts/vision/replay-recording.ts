/** Replays a saved Remote Duels test recording (REMOTE_RECORD_USERS) through the current card reader and prints how fast it saw and named each card.
 *  npx tsx scripts/vision/replay-recording.ts <recording.webm|mp4> [--events room.json] [--fps 10] [--from 0] [--duration 600]
 *    [--calibration cal.json] [--format normal] [--data data/vision] [--threads 2] [--read-scale 1] [--keep-frames dir] [--json out.json]
 *  <recording> sits next to its sidecar <same name>.json (written by the server). Needs ffmpeg on PATH and the models in --data
 *  (scripts/vision/prepare.ts and build-index.ts); no other model is downloaded.
 *  --events: the room JSON saved from GET /api/remote/<slug> (an object with `events`, or the event array; that route returns only the last 50 events, so save it soon after the test). The recorded watcher events carry
 *  a camera stamp (cam.seenAt/namedAt, client clock `performance.timeOrigin + performance.now()`); with the sidecar's video start they become video time, and the table below shows the
 *  live times next to this replay's times. --calibration: a FieldCalibration JSON (the saved clip session.json has one in `calibration`);
 *  without it the whole frame counts as the mat, so zones are only roughly right but detect and name times still hold.
 *  Frames are extracted to a temp folder that is deleted at the end (10 fps at 720p is about 1 GB per 10 minutes). */
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, extname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createFieldCalibration, type FieldCalibration, type FieldFormat } from '../../packages/vision/src/field-zones';
import { replayClip, percentile, type ReplayEvent } from '../../packages/vision/src/clip-replay';
import type { ClipBundle, ClipFrameMeta, ClipSession } from '../../packages/vision/src/clip-format';
import { defaultDataDir, jpegDecoder, loadNodeRecognizer } from './clip-node';

const { positionals, values } = parseArgs({ allowPositionals: true, options: {
  events: { type: 'string' }, fps: { type: 'string' }, from: { type: 'string' }, duration: { type: 'string' }, calibration: { type: 'string' }, format: { type: 'string' },
  data: { type: 'string' }, threads: { type: 'string' }, 'read-scale': { type: 'string' }, 'keep-frames': { type: 'string' }, json: { type: 'string' },
} });
const file = positionals[0];
if (!file) { console.error('Usage: replay-recording.ts <recording.webm|mp4> [--events room.json] [--fps 10] [--from s] [--duration s] [--calibration cal.json] [--data dir] [--json out.json]'); process.exit(2); }
const video = resolve(file), sidecarPath = video.slice(0, -extname(video).length) + '.json';
const sidecar = JSON.parse(await readFile(sidecarPath, 'utf8')) as { tableSlug?: string; seat?: number; video?: { width: number; height: number }; client?: { recorderStartDateNow?: number | null; videoStartDateNow?: number | null; videoStartPerfNow?: number | null; timeOrigin?: number | null; backend?: string | null; userAgent?: string | null; appVersion?: string | null }; endReason?: string; chunks?: number; droppedChunks?: number };
const fps = Number(values.fps ?? 10), from = Number(values.from ?? 0), duration = values.duration ? Number(values.duration) : undefined;
const loaded = await loadNodeRecognizer(values.data ?? defaultDataDir(), Number(values.threads ?? 2));
if (!loaded) { console.error(`No models in ${values.data ?? defaultDataDir()}: run scripts/vision/prepare.ts and build-index.ts first.`); process.exit(2); }

const keep = values['keep-frames'] ? resolve(values['keep-frames']) : undefined;
const dir = keep ?? await mkdtemp(join(tmpdir(), 'dd-recording-'));
try {
  await mkdir(dir, { recursive: true });
  const args = ['-v', 'error', '-ss', String(from), ...(duration ? ['-t', String(duration)] : []), '-i', video, '-an', '-vf', `fps=${fps},scale='min(1280,iw)':-2`, '-q:v', '4', join(dir, '%06d.jpg')];
  const ffmpeg = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (ffmpeg.status !== 0) throw new Error('ffmpeg failed (is it on PATH?)');
  const names = (await readdir(dir)).filter(n => n.endsWith('.jpg')).sort();
  if (!names.length) throw new Error('No frames were extracted');
  const sharp = (await import('sharp')).default, first = await sharp(join(dir, names[0])).metadata();
  const width = first.width!, height = first.height!, spanMs = (names.length - 1) * 1000 / fps;
  const frames: ClipFrameMeta[] = names.map((name, i) => ({ at: i * 1000 / fps, name, width, height, bytes: 0 }));
  const calibration: FieldCalibration = values.calibration ? JSON.parse(await readFile(values.calibration, 'utf8')) as FieldCalibration
    : createFieldCalibration([{ x: .04, y: .04 }, { x: .96, y: .04 }, { x: .96, y: .96 }, { x: .04, y: .96 }]);
  const session: ClipSession = { version: 1, savedAt: new Date().toISOString(), clipStartAt: 0, clipEndAt: spanMs, windowMs: spanMs, camera: { width, height }, frame: { width, height, fps, type: 'image/jpeg' },
    calibration, frameCalibration: calibration, format: (values.format ?? 'normal') as FieldFormat, cost: { frames: names.length, bytes: 0, events: 0, encodeMsMean: 0, encodeMsMax: 0, encodeMsTotal: 0, dropped: 0, activeS: 0 }, note: 'Built from a test recording' };
  const bundle: ClipBundle = { session, frames, events: [], truth: { version: 1, draft: true, events: [] }, frameBytes: name => { try { return new Uint8Array(readFileSync(join(dir, name))); } catch { return undefined; } } };

  const decode = await jpegDecoder(), tracks = new Map<string, { zone: string; seenT: number; namedT?: number; cardId?: string; removedT?: number }>();
  const onEvent = (e: ReplayEvent) => {
    const track = e.event.track, entry = tracks.get(track.id) ?? { zone: track.zone, seenT: track.firstSeen };
    entry.zone = track.zone; if (track.cardId && e.event.type !== 'removed' && entry.namedT === undefined && track.state === 'identified') { entry.namedT = e.t; entry.cardId = track.cardId; }
    if (e.event.type === 'removed') entry.removedT = e.t;
    tracks.set(track.id, entry);
  };
  const result = await replayClip({ bundle, decode, recognizer: loaded.recognizer, readScale: Number(values['read-scale'] ?? 1), answerPrompts: false, onEvent });
  const meta = JSON.parse(await readFile(join(values.data ?? defaultDataDir(), 'yugioh-index.meta.json'), 'utf8')) as { entries: { cardId: string; name: string }[] };
  const nameOf = (id?: string) => id ? meta.entries.find(c => c.cardId === id)?.name ?? id : '(not named)';
  const s = (ms?: number) => ms === undefined ? '      -' : `${((ms + from * 1000) / 1000).toFixed(2).padStart(7)}`;

  // Video time 0 is when the recorder started, on the client clock. New files carry `timeOrigin + videoStartPerfNow` (the clock the camera stamps use);
  // older files only have the start request time, which is a little early.
  const c = sidecar.client, origin = c?.videoStartPerfNow != null && c.timeOrigin != null ? c.timeOrigin + c.videoStartPerfNow : c?.videoStartDateNow ?? c?.recorderStartDateNow ?? undefined;
  type Live = { type: string; zone?: string; seenT?: number; namedT?: number; sentT?: number; source?: string };
  const live: Live[] = [];
  if (values.events) {
    const raw = JSON.parse(await readFile(values.events, 'utf8')) as { events?: unknown[] } | unknown[];
    const list = (Array.isArray(raw) ? raw : raw.events ?? []) as { action?: Record<string, unknown> }[];
    for (const item of list) {
      const action = item.action, cam = action?.cam as { seenAt?: number; namedAt?: number; sentAt?: number } | undefined;
      if (!action || typeof action.type !== 'string' || !action.type.startsWith('twin.') || !cam || origin === undefined) continue;
      const t = (v?: number) => v === undefined ? undefined : v - origin - from * 1000;
      live.push({ type: String(action.type), zone: typeof action.zone === 'string' ? action.zone : undefined, seenT: t(cam.seenAt), namedT: t(cam.namedAt), sentT: t(cam.sentAt), source: action.source === 'auto' ? 'auto' : 'manual' });
    }
  }

  console.log(`Recording ${basename(video)}: ${names.length} frames at ${fps} fps (${(spanMs / 1000).toFixed(0)} s from ${from} s), ${width}x${height}, table ${sidecar.tableSlug ?? '?'} seat ${sidecar.seat ?? '?'}, ended: ${sidecar.endReason ?? 'not closed'}, chunks ${sidecar.chunks ?? '?'} (${sidecar.droppedChunks ?? 0} dropped)`);
  console.log(`Live run: backend ${sidecar.client?.backend ?? '?'}, app ${sidecar.client?.appVersion ?? '?'}. Replay: ${loaded.threads} Node CPU threads, ${result.mode} mode, wall ${(result.wallMs / 1000).toFixed(1)} s, ${result.reads.length} reads, p50/p95 read ${percentile(result.reads.map(r => r.ms), .5).toFixed(0)}/${percentile(result.reads.map(r => r.ms), .95).toFixed(0)} ms, ${result.errors} errors.`);
  console.log('\nReplay: per card (video seconds)\n  seen     named    to name  zone  card');
  const rows = [...tracks.values()].sort((a, b) => a.seenT - b.seenT), toName: number[] = [];
  for (const r of rows) {
    const gap = r.namedT === undefined ? undefined : r.namedT - r.seenT; if (gap !== undefined) toName.push(gap);
    console.log(`${s(r.seenT)}  ${s(r.namedT)}  ${gap === undefined ? '      -' : `${(gap / 1000).toFixed(2).padStart(6)}s`}  ${r.zone.padEnd(5)} ${nameOf(r.cardId)}${r.removedT !== undefined ? `  (removed ${s(r.removedT).trim()})` : ''}`);
  }
  console.log(`${rows.length} cards seen, ${toName.length} named; time to name p50 ${(percentile(toName, .5) / 1000).toFixed(2)} s, p95 ${(percentile(toName, .95) / 1000).toFixed(2)} s`);
  if (live.length) {
    console.log('\nLive (from the recorded events, video seconds)\n  seen     named    sent     action      zone  how');
    for (const l of live.sort((a, b) => (a.sentT ?? 0) - (b.sentT ?? 0))) console.log(`${s(l.seenT)}  ${s(l.namedT)}  ${s(l.sentT)}  ${l.type.padEnd(11)} ${(l.zone ?? '').padEnd(5)} ${l.source}`);
  } else if (values.events) console.log('\nNo recorded events with a camera stamp (older build, or no recorder start time in the sidecar).');
  if (values.json) await writeFile(values.json, JSON.stringify({ sidecar, replay: rows, live, reads: result.reads }, null, 1));
} finally {
  await loaded.release();
  if (!keep) await rm(dir, { recursive: true, force: true });
}

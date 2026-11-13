/** Replays a saved Remote Duels test recording (REMOTE_RECORD_USERS) through a card reader and prints how fast it saw and named each card.
 *  npx tsx scripts/vision/replay-recording.ts <recording.webm|mp4> [--events room.json] [--fps 10] [--from 0] [--duration 600]
 *    [--recognizer current|<name>|<spec.json>] [--calibration cal.json] [--format normal] [--data data/vision] [--threads 2] [--read-scale 1] [--keep-frames dir] [--json out.json]
 *  <recording> sits next to its sidecar <same name>.json (written by the server). Needs ffmpeg on PATH and the models in --data
 *  (scripts/vision/prepare.ts and build-index.ts); no model is downloaded.
 *  --recognizer: `current` (default) is the app's own reader. Another reader is a spec file (or <data>/recognizers/<name>.json) that points at its model, index or bank and says
 *  its input size, embedding and normalisation; see recognizer-switch.ts. Other readers are for offline comparison only.
 *  --events: the room JSON saved from GET /api/remote/<slug> (an object with `events`, or the event array; that route returns only the last 50 events by default, so save the complete list with export-room-events.ts; the summary says when the list is not complete). The recorded watcher events carry
 *  a camera stamp (cam.seenAt/namedAt, client clock `performance.timeOrigin + performance.now()`); with the sidecar's video start they become video time, and the table below shows the
 *  live times next to this replay's times. With events the summary also lists phantom reads (reads on zones the events say were empty). --calibration: a FieldCalibration JSON (the saved clip session.json has one in `calibration`);
 *  without it the whole frame counts as the mat, so zones are only roughly right but detect and name times still hold.
 *  --json writes the run summary (per-card reads with time, zone, name, score, margin, sure; time per read; phantom reads; seen-to-named). Compare runs with compare-recordings.ts.
 *  Frames are extracted to a temp folder that is deleted at the end (10 fps at 720p is about 1 GB per 10 minutes). */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { defaultDataDir } from './clip-node';
import { loadCalibration, runRecording, type RunSummary } from './recording-lib';
import { loadRecognizer, resolveRecognizerSpec } from './recognizer-switch';
import type { FieldFormat } from '../../packages/vision/src/field-zones';

export function printRun(s: RunSummary) {
  const t = (v?: number) => v === undefined ? '      -' : v.toFixed(2).padStart(7);
  console.log(`Recording ${s.recording.file}: ${s.frames} frames at ${s.params.fps} fps (${s.spanS.toFixed(0)} s from ${s.params.from} s), ${s.recording.width}x${s.recording.height}, table ${s.recording.tableSlug ?? '?'} seat ${s.recording.seat ?? '?'}, ended ${s.sidecar.endReason ?? '?'}`);
  console.log(`Live run: backend ${s.sidecar.client?.backend ?? '?'}, app ${s.sidecar.client?.appVersion ?? '?'}. Replay: recognizer ${s.recognizer.name}, ${s.recognizer.threads} Node CPU threads, wall ${s.wallS.toFixed(1)} s, ${s.detects} detector runs, ${s.reads.length} reads (p50 ${s.readMs.p50} ms, p95 ${s.readMs.p95} ms, sure ${s.sure.pct}%), ${s.errors} errors`);
  console.log('\nReplay: per card (video seconds)\n  seen     named    to name  zone  card');
  for (const r of s.tracks) console.log(`${t(r.seenS)}  ${t(r.namedS)}  ${r.toNameS === undefined ? '      -' : `${r.toNameS.toFixed(2).padStart(6)}s`}  ${r.zone.padEnd(5)} ${r.name ?? '(not named)'}${r.removedS !== undefined ? `  (removed ${t(r.removedS).trim()})` : ''}`);
  console.log(`${s.tracks.length} cards seen, ${s.seenToNamed.replay.n} named; time to name p50 ${s.seenToNamed.replay.p50.toFixed(2)} s, p95 ${s.seenToNamed.replay.p95.toFixed(2)} s`);
  if (s.live.length) {
    console.log('\nLive (from the recorded events, video seconds)\n  seen     named    sent     action      zone  how');
    for (const l of s.live) console.log(`${t(l.seenS)}  ${t(l.namedS)}  ${t(l.sentS)}  ${l.type.padEnd(11)} ${(l.zone ?? '').padEnd(5)} ${l.origin} (${l.basis})`);
    if (s.seenToNamed.live.length) console.log(`Live time from seen to named: ${s.seenToNamed.liveStats.n} cards, p50 ${s.seenToNamed.liveStats.p50.toFixed(2)} s, p95 ${s.seenToNamed.liveStats.p95.toFixed(2)} s`);
  }
  if (s.phantom.checked) console.log(`\nPhantom reads (zone empty according to the events): ${s.phantom.reads.length} reads, ${s.phantom.tracks.length} cards${s.phantom.reads.slice(0, 10).map(r => `\n  ${r.tS.toFixed(2)} s ${r.zone} ${r.name} (${r.score})`).join('')}`);
  else if (s.phantom.reason) console.log(`\nPhantom reads not checked: ${s.phantom.reason}.`);
  for (const g of s.gaps) console.log(`Note: ${g}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('replay-recording.ts')) {
  const { positionals, values } = parseArgs({ allowPositionals: true, options: {
    events: { type: 'string' }, fps: { type: 'string' }, from: { type: 'string' }, duration: { type: 'string' }, calibration: { type: 'string' }, format: { type: 'string' },
    data: { type: 'string' }, threads: { type: 'string' }, 'read-scale': { type: 'string' }, 'keep-frames': { type: 'string' }, json: { type: 'string' }, recognizer: { type: 'string' },
  } });
  const file = positionals[0];
  if (!file) { console.error('Usage: replay-recording.ts <recording.webm|mp4> [--recognizer current|name|spec.json] [--events room.json] [--fps 10] [--from s] [--duration s] [--calibration cal.json] [--data dir] [--json out.json]'); process.exit(2); }
  const data = values.data ?? defaultDataDir();
  let loaded;
  try { loaded = await loadRecognizer(await resolveRecognizerSpec(values.recognizer, data), Number(values.threads ?? 2), data); }
  catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }
  try {
    const events = values.events ? JSON.parse(await readFile(values.events, 'utf8')) as unknown : undefined;
    const summary = await runRecording({ video: file, recognizer: loaded, fps: Number(values.fps ?? 10), from: Number(values.from ?? 0), duration: values.duration ? Number(values.duration) : undefined,
      calibration: values.calibration ? await loadCalibration(values.calibration) : undefined, calibrationFromFile: !!values.calibration, format: (values.format ?? 'normal') as FieldFormat, events, readScale: Number(values['read-scale'] ?? 1), keepFrames: values['keep-frames'] });
    printRun(summary);
    if (values.json) await writeFile(values.json, JSON.stringify(summary, null, 1));
  } finally { await loaded.release(); }
}

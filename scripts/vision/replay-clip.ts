/** Replays one .ddclip through the real field watcher and prints its metrics.
 *  npx tsx scripts/vision/replay-clip.ts <clip.ddclip> [--labels truth.json] [--data data/vision] [--recorded] [--events] [--json out.json]
 *  Without models in --data (or VISION_DATA_DIR) the recorded detections and reads are played back (tracker-only). */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { replayClip, scoreReplay, formatMetricsTable, replayTimingNote } from '../../packages/vision/src/clip-replay';
import type { ClipTruth } from '../../packages/vision/src/clip-format';
import { clipName, defaultDataDir, jpegDecoder, loadNodeRecognizer, readClip } from './clip-node';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { labels: { type: 'string' }, data: { type: 'string' }, recorded: { type: 'boolean' }, events: { type: 'boolean' }, json: { type: 'string' }, threads: { type: 'string' } } });
const file = positionals[0]; if (!file) { console.error('Usage: replay-clip.ts <clip.ddclip> [--labels truth.json] [--data dir] [--recorded] [--events] [--json out.json]'); process.exit(2); }
const bundle = await readClip(file);
if (values.labels) bundle.truth = JSON.parse(await readFile(values.labels, 'utf8')) as ClipTruth;
const loaded = values.recorded ? null : await loadNodeRecognizer(values.data ?? defaultDataDir(), Number(values.threads ?? 2));
if (!loaded && !values.recorded) console.error(`No models in ${values.data ?? defaultDataDir()} (run scripts/vision/prepare.ts and build-index.ts): replaying the recorded reads.`);
const decode = await jpegDecoder();
try {
  const result = await replayClip({ bundle, decode, recognizer: loaded?.recognizer, onEvent: values.events ? e => console.log(`${(e.t / 1000).toFixed(2).padStart(6)} s  ${e.event.type.padEnd(8)} ${e.event.track.zone.padEnd(5)} ${e.event.track.state.padEnd(10)} ${e.event.track.cardId ?? ''} ${e.event.reason ?? ''}`) : undefined });
  const metrics = scoreReplay(result, bundle.truth, bundle.session, clipName(file));
  console.log(`Clip ${file}: ${bundle.frames.length} frames over ${metrics.spanS} s, ${bundle.truth.events.length} labels${bundle.truth.draft ? ' (draft)' : ''}, replay ${metrics.wallS} s wall, mode ${result.mode}`);
  console.log(formatMetricsTable([metrics]));
  console.log(replayTimingNote(result));
  if (result.skippedFrames) console.log(`${result.skippedFrames} frames skipped: saved with another camera crop than the clip's last frame.`);
  if (result.unreplayable) console.log(`${result.unreplayable} read requests had no recorded read within 1 s at that spot (unreplayable); rerun with models for a real read.`);
  if (bundle.truth.draft) console.log('Labels are a draft made from the watcher\'s own events: the scores only show that replay repeats the live run. Label the clip (label-clip.ts) for a true score.');
  if (values.json) await writeFile(values.json, JSON.stringify({ metrics, reads: result.reads }, null, 1));
} finally { await loaded?.release(); }

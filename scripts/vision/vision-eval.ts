/** Runs every clip in the frozen eval set and prints one summary table.
 *  npm run vision:eval [-- --data data/vision] [--recorded] [--baseline data/vision-eval/baseline.json] [--write-baseline file] [--json out.json]
 *  Layout (git-ignored): data/vision-eval/clips/<name>.ddclip + data/vision-eval/labels/<name>.json (from label-clip.ts).
 *  --baseline fails (exit 1) on p95 time to board +15 %, or any new false removal or wrong automatic card. */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { replayClip, scoreReplay, formatMetricsTable, gateAgainstBaseline, type ReplayMetrics } from '../../packages/vision/src/clip-replay';
import type { ClipTruth } from '../../packages/vision/src/clip-format';
import { clipName, defaultDataDir, evalDir, jpegDecoder, loadNodeRecognizer, readClip } from './clip-node';

const { values } = parseArgs({ options: { data: { type: 'string' }, dir: { type: 'string' }, recorded: { type: 'boolean' }, baseline: { type: 'string' }, 'write-baseline': { type: 'string' }, json: { type: 'string' }, threads: { type: 'string' } } });
const dir = values.dir ?? evalDir(), clipsDir = join(dir, 'clips'), labelsDir = join(dir, 'labels');
let files: string[] = [];
try { files = (await readdir(clipsDir)).filter(f => f.endsWith('.ddclip')).sort(); } catch { /* no set yet */ }
if (!files.length) { console.log(`No clips in ${clipsDir}. Save one with the "Save last 30 s" button at the Remote table, copy it there and run scripts/vision/label-clip.ts on it.`); process.exit(0); }
const loaded = values.recorded ? null : await loadNodeRecognizer(values.data ?? defaultDataDir(), Number(values.threads ?? 2));
if (!loaded && !values.recorded) console.error(`No models in ${values.data ?? defaultDataDir()}: replaying recorded reads (tracker-only numbers).`);
const decode = await jpegDecoder();
const rows: ReplayMetrics[] = [];
try {
  for (const file of files) {
    const name = clipName(file), bundle = await readClip(join(clipsDir, file));
    try { bundle.truth = JSON.parse(await readFile(join(labelsDir, `${name}.json`), 'utf8')) as ClipTruth; } catch { console.error(`${name}: no labels in ${labelsDir}; scoring against the clip's own truth.json (${bundle.truth.events.length} events).`); }
    const result = await replayClip({ bundle, decode, recognizer: loaded?.recognizer });
    rows.push(scoreReplay(result, bundle.truth, bundle.session, name));
  }
} finally { await loaded?.release(); }
console.log(formatMetricsTable(rows));
const total = { arrivals: rows.reduce((n, r) => n + r.arrivals, 0), identityOk: rows.reduce((n, r) => n + r.identityOk, 0), wrongAutomatic: rows.reduce((n, r) => n + r.wrongAutomatic, 0), falseRemovals: rows.reduce((n, r) => n + r.falseRemovals, 0), stale: rows.reduce((n, r) => n + r.stale, 0), twins: rows.reduce((n, r) => n + r.twins, 0), prompts: rows.reduce((n, r) => n + r.prompts, 0), unmeasured: rows.reduce((n, r) => n + r.unmeasured, 0) };
console.log(`\n${rows.length} clips: identity ${total.identityOk}/${total.arrivals}, wrong automatic ${total.wrongAutomatic}, false removals ${total.falseRemovals}, stale ${total.stale}, twins ${total.twins}, prompts ${total.prompts}, labels the watcher cannot measure yet ${total.unmeasured}.`);
if (values.json) await writeFile(values.json, JSON.stringify(rows, null, 1));
if (values['write-baseline']) { await writeFile(values['write-baseline'], JSON.stringify(rows, null, 1)); console.log(`Baseline written to ${values['write-baseline']}.`); }
if (values.baseline) {
  const baseline = JSON.parse(await readFile(values.baseline, 'utf8')) as ReplayMetrics[];
  const failures = gateAgainstBaseline(rows, baseline);
  if (failures.length) { console.error(`\nGate failed:\n${failures.map(f => `- ${f}`).join('\n')}`); process.exit(1); }
  console.log(`Gate passed against ${values.baseline}.`);
}

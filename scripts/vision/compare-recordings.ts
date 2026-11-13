/** Compares two or more run summaries of the same clip (written by replay-recording.ts --json) and prints a table: reads, sure %, time per read, wall time, phantom reads,
 *  time to name, then agreement between each pair of readers and the reads where they differ.
 *  npx tsx scripts/vision/compare-recordings.ts run-current.json run-other.json [--window 1.5] [--json compare.json]
 *  Reads are paired by zone and time (nearest within --window seconds); agreement is by card name. Offline only. */
import { readFile, writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { compareSummaries, formatComparison, type RunSummary } from './recording-lib';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { window: { type: 'string' }, json: { type: 'string' } } });
if (positionals.length < 2) { console.error('Usage: compare-recordings.ts <run.json> <run.json> [more...] [--window 1.5] [--json out.json]'); process.exit(2); }
try {
  const runs = await Promise.all(positionals.map(async f => JSON.parse(await readFile(f, 'utf8')) as RunSummary));
  const cmp = compareSummaries(runs, Number(values.window ?? 1.5));
  console.log(formatComparison(cmp));
  if (values.json) await writeFile(values.json, JSON.stringify(cmp, null, 1));
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(2); }

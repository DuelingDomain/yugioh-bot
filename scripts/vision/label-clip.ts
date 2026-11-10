/** Writes a label draft (truth.json) for a clip from its watcher events and your prompt answers; you then edit the JSON.
 *  npx tsx scripts/vision/label-clip.ts <clip.ddclip> [--out labels/<name>.json] [--show]
 *  Each event: t (ms from the first frame), kind (summon, set, flip, activate, destroy, tribute, banish, return, draw, mill,
 *  search, detach, attach, equip, control, token, counter, lp, phase, attack, position, move, remove), detail, cardId,
 *  from/to {zone, slot, faceUp, position, materials, counters}, visibility (camera, partial, hidden, signal), note. */
import { mkdir, writeFile, access } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';
import { draftTruth } from '../../packages/vision/src/clip-replay';
import { clipName, evalDir, readClip } from './clip-node';

const { positionals, values } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' }, show: { type: 'boolean' }, force: { type: 'boolean' } } });
const file = positionals[0]; if (!file) { console.error('Usage: label-clip.ts <clip.ddclip> [--out truth.json] [--show] [--force]'); process.exit(2); }
const bundle = await readClip(file), name = clipName(file);
const truth = draftTruth(bundle, name);
if (values.show) {
  for (const e of truth.events) console.log(`${(e.t / 1000).toFixed(2).padStart(6)} s  ${e.kind.padEnd(8)} ${e.cardId ?? '?'} ${e.from ? `${e.from.zone} -> ` : ''}${e.to?.zone ?? ''}${e.to?.faceUp === false ? ' face-down' : ''}${e.to?.position ? ` ${e.to.position}` : ''}${e.note ? `  // ${e.note}` : ''}`);
  console.log(`${truth.events.length} draft events. Events in the clip: ${bundle.events.length}; frames: ${bundle.frames.length}.`);
}
const out = values.out ?? join(evalDir(), 'labels', `${name}.json`);
let exists = false; try { await access(out); exists = true; } catch { /* new */ }
if (exists && !values.force) { console.error(`${out} exists: edit it, or pass --force to overwrite with a new draft.`); process.exit(1); }
await mkdir(dirname(out), { recursive: true });
await writeFile(out, JSON.stringify(truth, null, 1));
console.log(`Draft labels written to ${out}. Open it, fix card ids and destinations, add what the camera could not show, then set "draft": false.`);

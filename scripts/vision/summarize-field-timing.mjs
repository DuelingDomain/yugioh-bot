// Usage: node scripts/vision/summarize-field-timing.mjs room.json [seat]
// Input is the saved JSON from export-room-events.ts. Run per seat to compare devices.
// Post is the client wait until HTTP dispatch. postServer covers HTTP handling through preparation of the board update.
import { readFile } from 'node:fs/promises';

const [file, seat] = process.argv.slice(2);
if (!file || (seat !== undefined && !/^[0-3]$/.test(seat))) {
  console.error('Usage: node scripts/vision/summarize-field-timing.mjs room.json [seat]');
  process.exit(2);
}
const saved = JSON.parse(await readFile(file, 'utf8'));
if (!Array.isArray(saved.events)) throw new Error('Expected a room export with an events array');
const bySeat = new Map();
const seenReads = new Set();
for (const event of saved.events) {
  const action = event.action;
  const actor = action?.actorSeat ?? event.actorSeat;
  const timing = action?.cam?.timing;
  if (!timing?.stagesMs || action.cam.by !== 'camera' || (seat !== undefined && Number(seat) !== actor)) continue;
  const key = timing.id && `${actor}:${timing.id}`;
  if (key && seenReads.has(key)) continue;
  if (key) seenReads.add(key);
  const rows = bySeat.get(actor) ?? [];
  rows.push(timing.stagesMs);
  bySeat.set(actor, rows);
}
const stages = ['detectorWait', 'restGate', 'handGate', 'read', 'nameVote', 'post', 'postServer'];
for (const [actor, rows] of bySeat) {
  console.log(`Seat ${actor} (milliseconds)`);
  console.table(stages.map(stage => {
    const samples = rows.map(row => row[stage]).filter(ms => Number.isFinite(ms) && ms >= 0).sort((a, b) => a - b);
    const percentile = p => samples[Math.ceil(samples.length * p) - 1] ?? '—';
    return { stage, samples: samples.length, p50: percentile(.5), p90: percentile(.9) };
  }));
}
if (!bySeat.size) console.log('No camera stage timings in the selected events.');

/** Saves the COMPLETE room event list of a Remote Duels table to a JSON file, for replay-recording.ts and harvest-labels.ts.
 *  DD_SESSION_COOKIE='authjs.session-token=...' npx tsx scripts/vision/export-room-events.ts --base https://<app> --slug <table-slug> [--out room-<slug>.json]
 *  GET /api/remote/<slug> returns only the last 50 events; with ?afterSeq=N it returns up to 200 events after seq N. This script pages (afterSeq=0, then the last seq seen) until the room's lastSeq.
 *  Run it right after the match, signed in as a player of the table. The cookie is read from the DD_SESSION_COOKIE environment variable (the whole Cookie header value) and is never printed or written.
 *  The only network use of these tools: one authenticated read of the room you played in. The output holds the events your seat may see; keep it local (git-ignored data/ folder). */
import { writeFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { checkEventList } from './recording-lib';

const { values } = parseArgs({ options: { base: { type: 'string' }, slug: { type: 'string' }, out: { type: 'string' } } });
const cookie = process.env.DD_SESSION_COOKIE;
if (!values.base || !values.slug || !cookie) { console.error('Usage: DD_SESSION_COOKIE=<Cookie header value> export-room-events.ts --base https://<app> --slug <table-slug> [--out file.json]'); process.exit(2); }
const url = (after: number) => `${values.base!.replace(/\/+$/, '')}/api/remote/${encodeURIComponent(values.slug!)}?afterSeq=${after}`;
try {
  const events: { seq: number }[] = []; let after = 0, lastSeq = 0, room: Record<string, unknown> = {};
  for (let page = 0; page < 500; page++) {
    const res = await fetch(url(after), { headers: { cookie } });
    if (!res.ok) throw new Error(`HTTP ${res.status} from the room route (signed out, wrong slug, or not a member of the table?)`);
    room = await res.json() as Record<string, unknown>;
    const got = (room.events ?? []) as { seq: number }[]; lastSeq = typeof room.lastSeq === 'number' ? room.lastSeq : lastSeq;
    events.push(...got); if (!got.length) break; after = got[got.length - 1].seq; if (after >= lastSeq) break;
  }
  const out = values.out ?? `room-${values.slug}.json`, saved = { slug: values.slug, lastSeq, exportedAt: new Date().toISOString(), events }, info = checkEventList(saved);
  await writeFile(out, JSON.stringify(saved), { mode: 0o600 });
  console.log(`Saved ${events.length} events (seq ${info.firstSeq ?? '-'}..${info.lastSeq ?? '-'}, room lastSeq ${lastSeq}) to ${out}`);
  if (!info.complete) { console.error(info.reason); process.exit(1); }
} catch (e) { console.error(e instanceof Error ? e.message : String(e)); process.exit(1); }

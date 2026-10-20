import Database from "better-sqlite3";
import { migrate } from "../src/db/schema.js";
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";
import { interpret, buildArchetypeMatcher } from "../src/cards/effects/query.js";
import { matchCard } from "../src/cards/effects/effect-match.js";
import type { Card } from "../src/cards/effects/card.js";
import { cardSynergy } from "../src/cards/effects/synergy.js";

// Real pinned artifact rather than invented effect fixtures.
const lines = () => gunzipSync(readFileSync(new URL("../data/effects/tags.jsonl.gz", import.meta.url))).toString("utf8").trim().split("\n");
const printed: Record<string, Partial<Card>> = {
  "Ash Blossom & Joyous Spring": { monsterType: "Zombie", attribute: "FIRE", level: 3, subtypes: ["effect", "tuner"] },
  "Effect Veiler": { monsterType: "Spellcaster", attribute: "LIGHT", level: 1, subtypes: ["effect", "tuner"] },
  "D.D. Crow": { monsterType: "Winged Beast", attribute: "DARK", level: 1, subtypes: ["effect"] },
};

describe("effect reader over the pinned searchygo artifact", () => {
  it("keeps the requested card Type separate from the negated effect", () => {
    const reading = interpret("cards that negate quick effects and are spellcasters");
    expect(reading?.query.card.types).toEqual(["Spellcaster"]);
    const matches = lines().flatMap(line => {
      const row = JSON.parse(line);
      if (!printed[row.name]) return [];
      const card = { id: row.id, name: row.name, kind: "monster", subtypes: [], text: "", views: 0, ...printed[row.name] } as Card;
      return matchCard(card, CardTags.parse(fillDefaults(row.tags)), reading!.query) === null ? [] : [row.name];
    });
    expect(matches).toContain("Effect Veiler");
    expect(matches).not.toContain("Ash Blossom & Joyous Spring");
  });

  it("reads dates, eras and stats without consuming unmarked years", () => {
    for (const [text, range] of [
      ["before 2010", { to: "2009-12" }], ["since 2015", { from: "2015-01" }],
      ["after 2018", { from: "2018-01" }], ["2008-2010", { from: "2008-01", to: "2010-12" }],
      ["2008 to 2010", { from: "2008-01", to: "2010-12" }], ["in 2012", { from: "2012-01", to: "2012-12" }],
      ["GX era warriors", { from: "2004-01", to: "2007-12" }],
    ] as const) {
      const reading = interpret(text);
      expect(reading?.query.released, text).toMatchObject(range);
      expect(reading?.query.text, text).toBe("");
    }
    expect(interpret("GX era warriors")?.query.card.types).toEqual(["Warrior"]);
    for (const era of ["DM", "5D's", "ZEXAL", "ARC-V", "VRAINS", "SEVENS", "GO RUSH"]) expect(interpret(`${era} era`)?.query.released).toBeDefined();
    expect(interpret("last 3 months")?.query.released?.from).toMatch(/^\d{4}-\d{2}$/);
    expect(interpret("newest spells")?.query.sort).toBe("newest");
    expect(interpret("new cards")?.query.sort).toBe("newest");
    expect(interpret("2000 atk")?.query).toMatchObject({ card: { atkMin: 2000, atkMax: 2000 } });
    expect(interpret("2000 atk")?.query.released).toBeUndefined();
    expect(interpret("2000")).toBeNull();
    expect(interpret("before 1900")).toBeNull();
  });

  it("keeps ATK effect verbs and complete date phrases", () => {
    for (const text of ["gain 1000 ATK", "cards that increase 2000 ATK"]) {
      expect(interpret(text)?.query.does?.verbs).toContain("change_atk_def");
      expect(interpret(text)?.query.card.atkMin).toBeUndefined();
    }
    expect(interpret("spells released from 2008 to 2010")?.query.text).toBe("");
    expect(interpret("newest OCG spells")?.query).toMatchObject({ released: { region: "ocg" }, sort: "newest", text: "" });
  });

  it("reads archetype spacing and compact aliases against the same vocabulary", () => {
    const matcher = buildArchetypeMatcher(["Blue-Eyes", "Dark Magician", "Tearlaments"]);
    for (const query of ["blue eyes support", "blueeyes support", "bule eyes support", "buleeyes support"]) {
      expect(interpret(query, matcher)?.query.supports?.archetypes).toEqual(["Blue-Eyes"]);
    }
  });

  it("keeps descriptions of affected monsters on their event", () => {
    const destroy = interpret("cards that destroy monsters that are spellcasters");
    expect(destroy?.query.card.types).toEqual([]);
    expect(destroy?.query.does?.object.types).toEqual(["Spellcaster"]);
    const summon = interpret("cards that special summon monsters that are level 4 from the deck");
    expect(summon?.query.card.levelMin).toBeUndefined();
    expect(summon?.query.does?.object.levelMin).toBe(4);
    expect(summon?.query.does?.from).toEqual(["deck"]);
  });

  it("respects Level versus Rank and Extra Deck material/source feasibility in real card links", () => {
    const rows = lines().map(line => JSON.parse(line));
    const candidate = (name: string, over: Partial<Card>) => {
      const row = rows.find(row => row.name === name)!;
      return { card: { id: row.id, name, kind: "monster", text: "", subtypes: ["effect"], views: 0, ...over } as Card, tags: CardTags.parse(fillDefaults(row.tags)) };
    };
    const ash = candidate("Ash Blossom & Joyous Spring", { level: 3, subtypes: ["effect", "tuner"] });
    const formula = candidate("Formula Synchron", { level: 2, subtypes: ["synchro", "tuner"] });
    expect(cardSynergy(ash, formula).reasons.some(reason => reason.includes("supplies material"))).toBe(false);
    const monk = candidate("Summoner Monk", { level: 4, monsterType: "Spellcaster" });
    const dweller = candidate("Abyss Dweller", { rank: 4, subtypes: ["xyz"] });
    expect(cardSynergy(monk, dweller).reasons.some(reason => reason.includes("special summon"))).toBe(false);
    const foolish = candidate("Foolish Burial", { kind: "spell", subtypes: ["normal"] });
    const herald = candidate("Herald of the Arc Light", { level: 4, subtypes: ["synchro"] });
    expect(cardSynergy(foolish, herald).reasons.some(reason => reason.includes("enables"))).toBe(false);
    const blocker = candidate("Barricadeborg Blocker", { subtypes: ["link"], linkRating: 2 });
    const hangar = candidate("Union Hangar", { kind: "spell", subtypes: ["field"] });
    expect(cardSynergy(blocker, hangar).score).toBeGreaterThan(0);
  });
});

it('maps a hard phrase once through HTTP, persists across SQLite handles, and shares the tagging budget', async () => {
  const { createServer } = await import('node:http');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fallbackEffectReading } = await import('../src/cards/effects/reading-fallback.js');
  const { FileLedgerStore, createEmptyLedger, budgetUsed } = await import('../src/cards/effects/budget-ledger.js');
  const directory = mkdtempSync(join(tmpdir(), 'reading-http-'));
  const disk = new Database(join(directory, 'shared.sqlite'));
  migrate(disk);
  const store = new FileLedgerStore(join(directory, 'ledger.json'));
  await store.compareAndSwap(undefined, createEmptyLedger());
  const query = interpret('hand traps that negate')!.query;
  let calls = 0;
  const server = createServer(async (req, res) => {
    let text = ''; for await (const chunk of req) text += chunk;
    expect(req.url).toBe('/v1/messages');
    const body = JSON.parse(text);
    expect(body.model).toBe('claude-haiku-5-5');
    expect(text).not.toContain('private-user');
    expect(body.thinking).toEqual({ type: 'disabled' });
    calls++;
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ id: 'msg_fixture', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify(query) }] }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  const options = { apiKey: 'fixture-key', store, baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true, now: () => new Date('2026-10-19T12:00:00Z') };
  try {
    const results = await Promise.all(Array.from({ length: 3 }, () => fallbackEffectReading(disk, '  Stop pesky combos  ', 'private-user', options)));
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(calls).toBe(1);
    const reopened = new Database(disk.name);
    try { expect(await fallbackEffectReading(reopened, 'stop pesky combos', 'someone-else', options)).toEqual(results.find(Boolean)); }
    finally { reopened.close(); }
    expect(calls).toBe(1);
    expect(budgetUsed((await store.read())!.ledger, '2026-10')).toBe(60);
  } finally {
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    disk.close(); rmSync(directory, { recursive: true, force: true });
  }
});

async function readerFixture(reply?: (query: object) => unknown, status = 200, envelope: object = {}) {
  const { createServer } = await import('node:http');
  const { fallbackEffectReading } = await import('../src/cards/effects/reading-fallback.js');
  const ledger = await import('../src/cards/effects/budget-ledger.js');
  let durable = ledger.createEmptyLedger(), revision = 0, calls = 0;
  const store: import('../src/cards/effects/budget-ledger.js').LedgerStore = {
    read: async () => ({ revision: String(revision), ledger: structuredClone(durable) }),
    compareAndSwap: async (prior, next) => {
      if (prior !== String(revision)) throw new Error('CAS conflict');
      durable = structuredClone(ledger.validateLedger(next)); return String(++revision);
    },
  };
  const db = new Database(':memory:'); migrate(db);
  const server = createServer(async (request, response) => {
    for await (const _ of request) { /* Drain the complete HTTP request. */ }
    calls++;
    if (status === 0) return; // An uncertain paid request: never finishes.
    response.writeHead(status, { 'content-type': 'application/json' });
    const query = interpret('hand traps that negate')!.query;
    response.end(JSON.stringify({ id: 'msg_test', model: 'claude-haiku-5-5', stop_reason: 'end_turn', usage: { input_tokens: 100, output_tokens: 100 }, content: [{ type: 'text', text: JSON.stringify(reply ? reply(query) : query) }], ...envelope }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as import('node:net').AddressInfo).port;
  let instant = new Date('2026-10-19T12:00:00Z');
  const options = { apiKey: 'fixture-key', store, baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true, now: () => instant, env: {} };
  return {
    ...ledger, db, store, options, read: (phrase: string, user = 'user', overrides = {}) => fallbackEffectReading(db, phrase, user, { ...options, ...overrides }),
    calls: () => calls, durable: () => durable, advance: (date: string) => { instant = new Date(date); },
    close: async () => { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); db.close(); },
  };
}

it.each([
  ['invented role', (query: any) => ({ ...query, roles: ['wins_the_duel'] })],
  ['invented verb', (query: any) => ({ ...query, does: { ...query.does, verbs: ['counter_anything'] } })],
  ['invented archetype', (query: any) => ({ ...query, card: { ...query.card, archetypes: ['Invented Deck'] } })],
  ['invented card name', (query: any) => ({ ...query, card: { ...query.card, names: ['Imaginary Card'] } })],
  ['unenforced root archetype', (query: any) => ({ ...query, card: { ...query.card, archetypes: ['Known Deck'] } })],
  ['unenforced effect ATK', (query: any) => ({ ...query, does: { ...query.does, object: { ...query.does.object, atkMin: 2000 } } })],
  ['empty support', (query: any) => ({ ...query, supports: query.card })],
  ['unenforced support kind', (query: any) => ({ ...query, supports: { ...query.card, types: ['Dragon'], kinds: ['monster'] } })],
  ['required text', (query: any) => ({ ...query, text: 'must win' })],
  ['inverted bounds', (query: any) => ({ ...query, card: { ...query.card, atkMin: 3000, atkMax: 1000 } })],
  ['extra fields', (query: any) => ({ ...query, intent: { kind: 'similar', passcode: 1, name: 'made up' } })],
] as const)('rejects %s, settles actual spend, and never retries an invalid phrase', async (_label, reply) => {
  const context = await readerFixture(reply);
  try {
    expect(await context.read('difficult phrase')).toBeNull();
    expect(await context.read('DIFFICULT   phrase')).toBeNull();
    expect(context.calls()).toBe(1);
    expect(context.budgetUsed(context.durable(), '2026-10')).toBe(60);
  } finally { await context.close(); }
});

it('enforces the sliding per-user and global quotas across shared SQLite handles, while cache reads are free', async () => {
  const context = await readerFixture();
  try {
    for (let i = 0; i < 20; i++) expect(await context.read(`phrase ${i}`)).not.toBeNull();
    expect(await context.read('twenty-first')).toBeNull();
    expect(context.calls()).toBe(20);
    expect(await context.read('phrase 0')).not.toBeNull();
    for (let i = 20; i < 100; i++) expect(await context.read(`phrase ${i}`, `user-${i}`)).not.toBeNull();
    expect(await context.read('global limit', 'fresh-user')).toBeNull();
    expect(context.calls()).toBe(100);
    context.advance('2026-10-19T13:00:01Z');
    expect(await context.read('next hour')).not.toBeNull();
    expect(context.calls()).toBe(101);
  } finally { await context.close(); }
});

it('silently declines missing credentials, missing/corrupt ledgers, spent caps and both CAS races before HTTP', async () => {
  const context = await readerFixture();
  try {
    expect(await context.read('missing key', 'u', { apiKey: '', env: {} })).toBeNull();
    expect(await context.read('missing ledger', 'u', { store: { ...context.store, read: async () => undefined } })).toBeNull();
    expect(await context.read('corrupt ledger', 'u', { store: { ...context.store, read: async () => ({ revision: '0', ledger: { version: 1, months: { '2026-10': 10000000 }, reservations: [] } }) } })).toBeNull();
    const snapshot = (await context.store.read())!;
    snapshot.ledger.runtime = Array.from({ length: 20 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), model: 'claude-haiku-5-5' as const, month: '2026-09', createdAt: '2026-09-01T12:00:00Z', phraseHash: 'a'.repeat(64), state: 'submission_started' as const, reservedMicros: context.READING_RESERVATION_MICROS }));
    await context.store.compareAndSwap(snapshot.revision, snapshot.ledger);
    expect(context.budgetUsed(context.durable(), '2026-10')).toBeGreaterThan(10000000);
    expect(await context.read('budget used')).toBeNull();
    for (const failAt of [1, 2]) {
      let writes = 0;
      const empty = { read: async () => ({ revision: 'fixture', ledger: context.createEmptyLedger() }), compareAndSwap: async () => { if (++writes === failAt) throw new Error('CAS conflict'); return 'next'; } };
      expect(await context.read(`CAS ${failAt}`, 'u', { store: empty })).toBeNull();
    }
    expect(context.calls()).toBe(0);
  } finally { await context.close(); }
});

it('times out within two seconds, keeps uncertain spend across month rollover, and never repeats the POST', async () => {
  const context = await readerFixture(undefined, 0);
  try {
    const start = performance.now();
    expect(await context.read('slow model')).toBeNull();
    expect(performance.now() - start).toBeLessThan(2300);
    expect(context.calls()).toBe(1);
    expect(context.budgetUsed(context.durable(), '2026-11')).toBe(context.READING_RESERVATION_MICROS);
    expect(await context.read('slow model')).toBeNull();
    expect(context.calls()).toBe(1);
  } finally { await context.close(); }
});

it('silently keeps the rule path after an HTTP error without a second paid attempt', async () => {
  const context = await readerFixture(undefined, 500);
  try {
    expect(await context.read('endpoint error')).toBeNull();
    expect(await context.read('endpoint error')).toBeNull();
    expect(context.calls()).toBe(1);
    expect(context.budgetUsed(context.durable(), '2026-10')).toBe(context.READING_RESERVATION_MICROS);
  } finally { await context.close(); }
});


it('declines before spending near UTC rollover and when rollover occurs during a ledger write', async () => {
  const context = await readerFixture();
  try {
    context.advance('2026-10-31T23:59:30Z');
    expect(await context.read('near rollover')).toBeNull();
    context.advance('2026-10-31T23:58:00Z');
    const crossing = { ...context.store, compareAndSwap: async (revision: string | undefined, next: import('../src/cards/effects/budget-ledger.js').Ledger) => {
      const result = await context.store.compareAndSwap(revision, next);
      context.advance('2026-11-01T00:00:00Z'); return result;
    } };
    expect(await context.read('crossed rollover', 'user', { store: crossing })).toBeNull();
    expect(context.calls()).toBe(0);
    expect(context.budgetUsed(context.durable(), '2026-11')).toBe(0);
  } finally { await context.close(); }
});

it('silently skips SQLite writer contention without inheriting the five-second busy timeout', async () => {
  const { mkdtempSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { fallbackEffectReading } = await import('../src/cards/effects/reading-fallback.js');
  const { createEmptyLedger } = await import('../src/cards/effects/budget-ledger.js');
  const directory = mkdtempSync(join(tmpdir(), 'reader-contention-'));
  const writer = new Database(join(directory, 'shared.sqlite')); migrate(writer); writer.pragma('journal_mode=WAL');
  const reader = new Database(writer.name); reader.pragma('busy_timeout=5000');
  writer.exec('BEGIN IMMEDIATE');
  try {
    const start = performance.now();
    expect(await fallbackEffectReading(reader, 'contended phrase', 'user', { apiKey: 'mock', store: { read: async () => ({ revision: 'fixture', ledger: createEmptyLedger() }), compareAndSwap: async () => 'fixture' } })).toBeNull();
    expect(performance.now() - start).toBeLessThan(250);
    expect(reader.pragma('busy_timeout', { simple: true })).toBe(5000);
  } finally { writer.exec('ROLLBACK'); reader.close(); writer.close(); rmSync(directory, { recursive: true, force: true }); }
});

it('reads a ledger over 1 MB via Git blobs and rejects a concurrent non-fast-forward runtime CAS', async () => {
  const { createServer } = await import('node:http');
  const { RuntimeLedgerStore } = await import('../src/cards/effects/reading-fallback.js');
  const { createEmptyLedger, READING_RESERVATION_MICROS } = await import('../src/cards/effects/budget-ledger.js');
  const ledger = createEmptyLedger();
  ledger.months['2026-10'] = 0;
  ledger.runtime = Array.from({ length: 4000 }, (_, i) => ({ id: i.toString(16).padStart(32, '0'), month: '2026-10', model: 'claude-haiku-5-5', phraseHash: 'a'.repeat(64), state: 'settled', reservedMicros: READING_RESERVATION_MICROS, actualMicros: 0, messageId: `msg_${i}`, createdAt: '2026-10-19T12:00:00Z' }));
  const raw = JSON.stringify(ledger);
  expect(Buffer.byteLength(raw)).toBeGreaterThan(1_000_000);
  let head = 'a'.repeat(40), commitNumber = 1;
  const parents = new Map<string, string>(), patches: any[] = [];
  const server = createServer(async (request, response) => {
    let text = ''; for await (const chunk of request) text += chunk;
    const body = text ? JSON.parse(text) : null;
    response.setHeader('content-type', 'application/json');
    const path = request.url!.replace('/repos/fixture/repo/', '');
    let result: unknown;
    if (path === 'git/ref/heads/state/effect-tagging') result = { object: { sha: head } };
    else if (path.startsWith('contents/ledger.json?ref=')) result = { sha: 'b'.repeat(40), encoding: 'none', size: Buffer.byteLength(raw) };
    else if (path === `git/blobs/${'b'.repeat(40)}`) result = { encoding: 'base64', content: Buffer.from(raw).toString('base64'), size: Buffer.byteLength(raw) };
    else if (request.method === 'GET' && path.startsWith('git/commits/')) result = { tree: { sha: 'c'.repeat(40) } };
    else if (path === 'git/blobs') result = { sha: 'd'.repeat(40) };
    else if (path === 'git/trees') result = { sha: 'e'.repeat(40) };
    else if (path === 'git/commits') {
      const sha = String(commitNumber++).padStart(40, '0'); parents.set(sha, body.parents[0]); result = { sha };
    } else if (path === 'git/refs/heads/state/effect-tagging') {
      patches.push(body);
      if (parents.get(body.sha) !== head) { response.writeHead(422); response.end('{}'); return; }
      head = body.sha; result = { object: { sha: head } };
    } else { response.writeHead(404); response.end('{}'); return; }
    response.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    const store = new RuntimeLedgerStore('fixture/repo', 'fixture-token', AbortSignal.timeout(5000), { baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
    const snapshot = await store.read();
    expect(snapshot.ledger.runtime).toHaveLength(4000);
    const writes = await Promise.allSettled([store.compareAndSwap(snapshot.revision, snapshot.ledger), store.compareAndSwap(snapshot.revision, snapshot.ledger)]);
    expect(writes.map(result => result.status).sort()).toEqual(['fulfilled', 'rejected']);
    expect(patches).toHaveLength(2);
    expect(patches.every(body => body.force === false)).toBe(true);
  } finally { await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); }); }
});


it.each([
  ['unexpected model', { model: 'unexpected-model' }],
  ['missing usage', { usage: null }],
  ['out-of-bound usage', { usage: { input_tokens: 1_000_001, output_tokens: 1 } }],
  ['unexpected billed cache', { usage: { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 100 } }],
])('keeps the full liability for %s and does not repeat the POST', async (_label, envelope) => {
  const context = await readerFixture(undefined, 200, envelope);
  try {
    await context.read('uncertain usage');
    await context.read('uncertain usage');
    expect(context.calls()).toBe(1);
    expect(context.budgetUsed(context.durable(), '2026-10')).toBe(context.READING_RESERVATION_MICROS);
  } finally { await context.close(); }
});


it('finishes through a slow durable GitHub store without leaving a reserved row', async () => {
  const context = await readerFixture();
  const { createServer } = await import('node:http');
  const { RuntimeLedgerStore } = await import('../src/cards/effects/reading-fallback.js');
  let head = 'a'.repeat(40), serial = 0;
  const ledgers = new Map([[head, context.createEmptyLedger()]]);
  const blobs = new Map<string, string>(), trees = new Map<string, string>();
  const commits = new Map<string, { parent: string; tree: string }>();
  const nextSha = () => (++serial).toString(16).padStart(40, '0');
  const server = createServer(async (request, response) => {
    let raw = ''; for await (const chunk of request) raw += chunk;
    const body = raw ? JSON.parse(raw) : null;
    const path = request.url!.replace('/repos/fixture/repo/', '');
    let result: unknown;
    if (path === 'git/ref/heads/state/effect-tagging') result = { object: { sha: head } };
    else if (path.startsWith('contents/ledger.json?ref=')) {
      const bytes = JSON.stringify(ledgers.get(decodeURIComponent(path.split('=')[1])));
      const sha = nextSha(); blobs.set(sha, bytes); result = { sha, size: Buffer.byteLength(bytes) };
    } else if (request.method === 'GET' && path.startsWith('git/blobs/')) {
      const bytes = blobs.get(path.split('/').at(-1)!)!;
      result = { encoding: 'base64', content: Buffer.from(bytes).toString('base64'), size: Buffer.byteLength(bytes) };
    } else if (request.method === 'GET' && path.startsWith('git/commits/')) result = { tree: { sha: 'b'.repeat(40) } };
    else if (path === 'git/blobs') { const sha = nextSha(); blobs.set(sha, body.content); result = { sha }; }
    else if (path === 'git/trees') { const sha = nextSha(); trees.set(sha, body.tree[0].sha); result = { sha }; }
    else if (path === 'git/commits') { const sha = nextSha(); commits.set(sha, { parent: body.parents[0], tree: body.tree }); result = { sha }; }
    else if (path === 'git/refs/heads/state/effect-tagging') {
      const commit = commits.get(body.sha)!;
      if (commit.parent !== head || body.force) { response.writeHead(422); response.end('{}'); return; }
      head = body.sha; ledgers.set(head, JSON.parse(blobs.get(trees.get(commit.tree)!)!)); result = { object: { sha: head } };
    } else { response.writeHead(404); response.end('{}'); return; }
    await new Promise(resolve => setTimeout(resolve, 1500));
    response.setHeader('content-type', 'application/json'); response.end(JSON.stringify(result));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    const store = new RuntimeLedgerStore('fixture/repo', 'fixture-token', undefined, { baseUrl: `http://127.0.0.1:${port}`, allowLoopback: true });
    expect(await context.read('slow GitHub store', 'user', { store })).not.toBeNull();
    expect(context.calls()).toBe(1);
    expect(ledgers.get(head)!.runtime?.map(row => row.state)).toEqual(['settled']);
  } finally {
    await new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); });
    await context.close();
  }
}, 60000);

it.each(['reserve-response-lost', 'intent-conflict', 'intent-response-lost'])('releases unpaid liability after %s', async failure => {
  const context = await readerFixture();
  let writes = 0;
  const store = { ...context.store, compareAndSwap: async (revision: string | undefined, next: import('../src/cards/effects/budget-ledger.js').Ledger) => {
    writes++;
    if (writes === 2 && failure === 'intent-conflict') throw new Error('CAS conflict');
    const result = await context.store.compareAndSwap(revision, next);
    if ((writes === 1 && failure === 'reserve-response-lost') || (writes === 2 && failure === 'intent-response-lost')) throw new Error('Lost response');
    return result;
  } };
  try {
    expect(await context.read(`unpaid ${failure}`, 'user', { store })).toBeNull();
    expect(context.calls()).toBe(0);
    expect(context.durable().runtime).toEqual([]);
    expect(context.db.prepare('SELECT phrase FROM effect_readings').all()).toEqual([]);
  } finally { await context.close(); }
});


it.each([undefined, '', '   '])('requires the dedicated runtime token (%s) even when GITHUB_TOKEN is set', async token => {
  const context = await readerFixture();
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No network is permitted'));
  try {
    expect(await context.read('no dedicated token', 'user', { store: undefined,
      env: { GITHUB_TOKEN: 'broad-token-must-not-be-used', GITHUB_REPOSITORY: 'fixture/repo', EFFECT_TAGGING_LEDGER_TOKEN: token } })).toBeNull();
    expect(network).not.toHaveBeenCalled();
    expect(context.calls()).toBe(0);
    expect(context.db.prepare('SELECT phrase FROM effect_readings').all()).toEqual([]);
  } finally { network.mockRestore(); await context.close(); }
});

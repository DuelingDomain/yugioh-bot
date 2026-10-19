import Database from 'better-sqlite3';
import { migrate } from '@yugidraft/shared/db';
import { createDuelService } from '@yugidraft/shared/services';
import { afterEach, expect, it } from 'vitest';
import { seedIdentity } from './helpers/identity.js';
import { createHmac } from 'node:crypto';
import { createTestDuelHost, finishTestDiceOpening } from './support/test-opening.js';
import { buildPracticeBotDeck } from '../src/practice-bot.js';
import { engineDataDirectory as DATA } from './engine-data-dir.js';
import type { DuelEngineView } from '@yugidraft/shared/duels';
import type { DuelGameWorker } from '../src/worker-client.js';

it('keeps an exact board and journal pair during the first action and after a later spectator timeout', async () => {
  const db = new Database(':memory:'); migrate(db);
  const ids = [101, 102].map(userId => seedIdentity(db, { guildId: 'capture', userId: String(userId) }).playerId);
  const duels = createDuelService(db);
  const session = duels.create({ guildId: 'capture', organizerPlayerId: ids[0]!, name: 'capture', mode: 'normal' });
  duels.takeSeat(session.slug, 'capture', ids[1]!);
  for (const id of ids) duels.setDeck(session.slug, 'capture', id, buildPracticeBotDeck('normal', DATA));
  let revision = 0, running = true, blocked = false, hang = false, fullLogReads = 0;
  let started!: () => void, release!: () => void;
  const entered = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const never = () => new Promise<never>(() => {});
  const view = (seat: number | null, fullLog = false): DuelEngineView => ({ revision, turn: revision + 1, turnSeat: 0, phase: 'main1',
    seats: ids.map((_, seat) => ({ seat, lp: 8000, hand: [], deckCount: 40, extraCount: 0, extra: [], monsters: [], spells: [], graveyard: [], banished: [] })),
    prompt: seat === 0 ? { id: `p${revision}`, seat: 0, kind: 'choice', title: 'Act', context: { type: 'action', phase: 'main' }, options: [{ id: 'to_ep', label: 'End turn' }] } : null,
    log: Array.from({ length: revision === 0 ? 1 : 501 }, (_, index) => ({ id: index + 1, text: `Public revision ${revision} event ${index + 1}` })).slice(fullLog ? 0 : -400), events: [], chain: [], result: null });
  const worker: DuelGameWorker = { get running() { return running; }, async create() {},
    async view(seat, history) { if (history?.fullLog) fullLogReads++; if (blocked || hang) return never(); return view(seat, history?.fullLog); },
    async answer() { blocked = true; started(); await gate; blocked = false; revision += 1; },
    async search() { return []; }, async close() { running = false; } };
  const secret = 'capture-integration';
  const host = createTestDuelHost({ db, secret, dataDirectory: DATA, searchCards: () => [], createWorker: () => worker, debugReadTimeoutMs: 15, pollIntervalMs: 60_000 });
  async function post(input: Record<string, unknown>): Promise<{ status: number; data: any }> {
    const body = { guildId: 'capture', playerId: ids[0], slug: session.slug, ...input };
    const raw = JSON.stringify(body), url = 'http://localhost/internal/duel';
    const response = await host.handle(new Request(url, { method: 'POST', headers: { 'x-announce-signature': 'sha256=' + createHmac('sha256', secret).update(raw).digest('hex'), 'content-type': 'application/json' }, body: raw }));
    return finishTestDiceOpening(host, body, { status: response.status, data: await response.json() }, post);
  }
  try {
    expect((await post({ op: 'start' })).status).toBe(200);
    const observer = seedIdentity(db, { guildId: 'capture', userId: "103" });
    expect((await post({ op: 'view', playerId: observer.playerId })).status).toBe(200);
    const readsBeforeMove = fullLogReads;
    const pending = post({ op: 'respond', command: { revision: 0, promptId: 'p0', answer: { choice: 'to_ep' } } });
    await entered;
    const overlap = await post({ op: 'bug-context' });
    expect(overlap.data.board).toMatchObject({ revision: 0 });
    expect(overlap.data.moment).toMatchObject({ revision: 0, journalCount: 0 });
    release();
    expect((await pending).status).toBe(200);
    expect(fullLogReads - readsBeforeMove).toBe(2); // One blocked report read and one accepted-command capture.
    // A cached spectator view is older than the accepted action. It must not receive today's journal count.
    hang = true;
    const timedOut = await post({ op: 'bug-context' });
    expect(timedOut.data.board).toMatchObject({ revision: 1 });
    expect(timedOut.data.moment).toMatchObject({ revision: 1, journalCount: 1 });
    expect(timedOut.data.board.log).toHaveLength(501);
    hang = false;
    expect((await post({ op: 'view', playerId: observer.playerId })).data.engine.log).toHaveLength(400);
    hang = true;
    const sameRevision = await post({ op: 'bug-context' });
    expect(sameRevision.data.board.log).toHaveLength(501);
    expect(sameRevision.data.moment).toMatchObject({ revision: 1, journalCount: 1 });
    hang = false;
    expect((await post({ op: 'surrender' })).status).toBe(200);
    const final = db.prepare('select snapshot_public_json from duels where id = ?').get(session.id) as { snapshot_public_json: string };
    expect(JSON.parse(final.snapshot_public_json).log).toEqual(view(null, true).log.slice(-400));
  } finally { release(); await host.close(); db.close(); }
}, 10_000);

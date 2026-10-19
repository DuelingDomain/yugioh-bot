import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, type DuelClockState, type DuelEngineView, type DuelFormat } from "@yugidraft/shared/duels";
import { createDuelService } from "@yugidraft/shared/services";
import { createDuelHost } from "../src/host.js";
import { activeMultiScriptsHash, pinnedEngineVersion } from "../src/multi-scripts.js";
import type { DuelGameWorker } from "../src/worker-client.js";
import { seedIdentity } from "./helpers/identity.js";
import { createHostDataFixture } from "./helpers/host-data-fixture.js";
import { signedHeaders } from "./helpers/signed-request.js";

const MINUTE = 60_000;
const SWEEP = 1_000;
const SECRET = "live-idle-test";
const cleanups: Array<() => Promise<void>> = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
  vi.useRealTimers();
});

function table(format: DuelFormat = "1v1", idleMs = 0, clock: DuelClockState | null = null, ranked = false) {
  const directory = createHostDataFixture([]);
  const db = new Database(":memory:"); migrate(db);
  const players = Array.from({ length: seatCountFor(format) }, (_, seat) =>
    seedIdentity(db, { guildId: "g", name: `P${seat}` }).playerId);
  const service = createDuelService(db);
  const session = service.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Idle table", mode: "normal", format,
    ranked, bestOf: ranked ? 3 : 1, settings: { validateDeck: false, turnSeconds: clock ? 3600 : 0 } });
  for (const player of players.slice(1)) service.takeSeat(session.slug, "g", player);
  for (const player of players) service.setDeck(session.slug, "g", player, { main: Array(40).fill(1), extra: [], side: [] });
  service.activate(session.slug, "g", players[0]!, ["1", "2", "3", "4"],
    pinnedEngineVersion("fixture", players.length, activeMultiScriptsHash(directory)), clock, { firstTurnDraw: false });
  db.prepare("update duels set last_activity_at = ? where id = ?").run(new Date(Date.now() - idleMs).toISOString(), session.id);
  let running = true, revision = 1;
  const worker: DuelGameWorker = {
    get running() { return running; },
    async create() {},
    async view(viewerSeat) {
      return { revision, turn: 1, turnSeat: 0, phase: "main1", prioritySeat: 0, chain: [], events: [], log: [], result: null,
        prompt: viewerSeat === 0 ? { id: `p${revision}`, seat: 0, kind: "choice", title: "Main", options: [{ id: "pass", label: "Pass" }] } : null,
        seats: players.map((_, seat) => ({ seat, lp: 8000, hand: [], deckCount: 40, extraCount: 0, extra: [],
          monsters: [], spells: [], graveyard: [], banished: [] })) } as DuelEngineView;
    },
    async answer() { revision++; },
    async search() { return []; },
    async setChainMode() { return false; },
    async close() { running = false; },
  };
  const changes: string[] = [];
  const host = createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [], pollIntervalMs: SWEEP,
    idleWorkerMs: 24 * 60 * MINUTE, createWorker: () => worker, onChange: slug => { changes.push(slug); } });
  cleanups.push(async () => { await host.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const post = async (op: string, extra = {}) => {
    const body = JSON.stringify({ op, slug: session.slug, guildId: "g", playerId: players[0], ...extra });
    return host.handle(new Request("http://localhost/internal/duel", { method: "POST", body,
      headers: { "content-type": "application/json", ...await signedHeaders(body, SECRET, "http://localhost/internal/duel", "duel-host") } }));
  };
  return { db, service, session, changes, worker, post };
}

it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("closes a stale %s on the host sweep without a winner or match result", async format => {
  const t = table(format, 10 * MINUTE + 1);
  // A saved journal survives even when no worker is resident (including after a restart).
  t.db.prepare("insert into duel_commands (duel_id, seq, seat, command_json) values (?, 1, 0, ?)")
    .run(t.session.id, JSON.stringify({ promptId: "p1", revision: 1, answer: { choice: "pass" } }));
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, winnerPlayerId: null,
    resultReason: "No player activity for 10 minutes." });
  expect(t.service.privateState(t.session.slug, "g").commands).toHaveLength(1);
  expect(t.service.privateState(t.session.slug, "g").clock).toBeNull();
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  expect(t.changes).toEqual([t.session.slug]);
});

it("lets passive views continue without renewing activity, and saves the resident final board", async () => {
  const t = table("1v1", 9 * MINUTE);
  expect((await t.post("view")).status).toBe(200);
  await vi.advanceTimersByTimeAsync(MINUTE - 1);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  expect((await t.post("view")).status).toBe(200);
  await vi.advanceTimersByTimeAsync(SWEEP + 1);
  expect(t.service.get(t.session.slug, "g").status).toBe("interrupted");
  expect(t.worker.running).toBe(false);
  expect(t.db.prepare("select snapshot_public_json is not null as saved from duels where id = ?").get(t.session.id)).toEqual({ saved: 1 });
});

it("renews the ten-minute window on an accepted player response", async () => {
  const t = table("1v1", 9 * MINUTE);
  expect((await t.post("view")).status).toBe(200);
  expect((await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } })).status).toBe(200);
  await vi.advanceTimersByTimeAsync(MINUTE + SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  await vi.advanceTimersByTimeAsync(9 * MINUTE);
  expect(t.service.get(t.session.slug, "g").status).toBe("interrupted");
  expect(t.service.privateState(t.session.slug, "g").commands).toHaveLength(1);
});

it("counts an explicit chain response switch as activity even when it passes no window", async () => {
  const t = table("1v1", 9 * MINUTE);
  expect((await t.post("chain-mode", { mode: "always" })).status).toBe(200);
  await vi.advanceTimersByTimeAsync(MINUTE + SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
});

it("interrupts an idle ranked match without a win, rating result or automatic next game", async () => {
  const t = table("1v1", 10 * MINUTE + 1, null, true);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("interrupted");
  expect(t.db.prepare("select status, wins0, wins1, next_game_at from duel_series").get())
    .toEqual({ status: "between_games", wins0: 0, wins1: 0, next_game_at: null });
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it("rechecks a sweep candidate after a player command was accepted", async () => {
  const t = table("1v1", 10 * MINUTE + 1);
  // The startup sweep has selected the row and queued its close, but has not acquired the slug queue yet.
  t.service.recordCommand(t.session.slug, "g", 0, { promptId: "p1", revision: 1, answer: { choice: "pass" } }, null);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  expect(t.changes).toEqual([]);
});

it("protects a player thinking within their clock, then interrupts after a continue clock expires", async () => {
  const t = table("ffa4", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE,
    remainingMs: [12 * MINUTE, 12 * MINUTE, 12 * MINUTE, 12 * MINUTE] });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(t.service.get(t.session.slug, "g").status).toBe("interrupted");
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it("keeps the existing loss path for an ordinary clock shorter than ten minutes", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [MINUTE, MINUTE] });
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.timeout', 'loss') where id = ?").run(t.session.id);
  await vi.advanceTimersByTimeAsync(MINUTE + SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", winnerSeat: 1, resultReason: "Time limit" });
});

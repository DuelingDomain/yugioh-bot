import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, type DuelClockState, type DuelEngineView, type DuelFormat, type DuelVisibility } from "@yugidraft/shared/duels";
import { createDuelSeriesService, createDuelService } from "@yugidraft/shared/services";
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

function table(format: DuelFormat = "1v1", idleMs = 0, clock: DuelClockState | null = null, ranked = false, start = true, visibility: DuelVisibility = "public") {
  const directory = createHostDataFixture([]);
  const db = new Database(":memory:"); migrate(db);
  const players = Array.from({ length: seatCountFor(format) }, (_, seat) =>
    seedIdentity(db, { guildId: "g", name: `P${seat}` }).playerId);
  const service = createDuelService(db);
  const session = service.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Idle table", mode: "normal", format,
    ranked, settings: { visibility, validateDeck: false, turnSeconds: clock ? 3600 : 0, timeout: "continue" } });
  for (const player of players.slice(1)) {
    if (visibility === "private") service.admit(session.slug, "g", player, service.room(session.slug, "g", players[0]!).inviteCode!);
    service.takeSeat(session.slug, "g", player);
  }
  for (const player of players) service.setDeck(session.slug, "g", player, { main: Array(40).fill(1), extra: [], side: [] });
  const activate = (initialClock: DuelClockState | null) => service.activate(session.slug, "g", players[0]!, ["1", "2", "3", "4"],
    pinnedEngineVersion("fixture", players.length, activeMultiScriptsHash(directory)), initialClock, { firstTurnDraw: false });
  if (start) activate(clock);
  db.prepare("update duels set last_activity_at = ? where id = ?").run(new Date(Date.now() - idleMs).toISOString(), session.id);
  let running = true, revision = 1, turn = 1;
  const worker: DuelGameWorker = {
    get running() { return running; },
    async create() {},
    async view(viewerSeat) {
      return { revision, turn, turnSeat: 0, phase: "main1", prioritySeat: 0, chain: [], events: [], log: [], result: null,
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
  return { db, service, session, changes, worker, post, players, activate, nextTurn: () => { turn++; } };
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

function expectRankedLoss(t: ReturnType<typeof table>) {
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", winnerSeat: 1,
    winnerPlayerId: t.players[1], resultReason: "Time limit" });
  expect(t.db.prepare("select status, winner_id from matches").all())
    .toEqual([{ status: "approved", winner_id: t.players[1] }]);
  const ratings = t.db.prepare("select player_id, elo from player_ratings order by player_id").all();
  expect(ratings).toEqual([{ player_id: t.players[0], elo: expect.any(Number) }, { player_id: t.players[1], elo: expect.any(Number) }]);
  expect((ratings[0] as { elo: number }).elo).toBeLessThan(1000);
  expect((ratings[1] as { elo: number }).elo).toBeGreaterThan(1000);
}

it("awards a ranked AFK loss and rating changes at three minutes before idle close", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  expect(t.session.settings).toMatchObject({ turnSeconds: 180, timeout: "loss" });
  expect((await t.post("view")).status).toBe(200);
  await vi.advanceTimersByTimeAsync(3 * MINUTE - SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  await vi.advanceTimersByTimeAsync(2 * SWEEP);
  expectRankedLoss(t);
  await vi.advanceTimersByTimeAsync(10 * MINUTE);
  expectRankedLoss(t);
});

it("settles a ranked clock that expired during downtime before idle close without recovering an engine", async () => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE,
    remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  // A replacement bundle cannot recover this game, but the durable clock already proves the loss.
  t.db.prepare("update duels set bundle_version = 'unavailable-old-bundle' where id = ?").run(t.session.id);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expectRankedLoss(t);
});

it.each(["view", "respond", "chain-mode", "surrender"])("settles an expired ranked clock before %s can attempt engine recovery", async op => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  // Change the deadline after startup selected its sweep candidates, then send a request before the next sweep.
  t.db.prepare("update duels set bundle_version = 'unavailable-old-bundle', clock_json = ? where id = ?")
    .run(JSON.stringify({ turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE, remainingMs: [3 * MINUTE, 3 * MINUTE] }), t.session.id);
  const response = await t.post(op, { mode: "always", command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } });
  expect(response.status).toBe(op === "view" ? 200 : 409);
  expectRankedLoss(t);
});

it("caps an old ranked clock at three minutes even without a room read", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.turnSeconds', 3600, '$.timeout', 'continue'), clock_json = ? where id = ?")
    .run(JSON.stringify({ turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [60 * MINUTE, 60 * MINUTE] }), t.session.id);
  expect(t.service.get(t.session.slug, "g").settings).toMatchObject({ turnSeconds: 180, timeout: "loss" });
  await vi.advanceTimersByTimeAsync(3 * MINUTE + SWEEP);
  expectRankedLoss(t);
});

it("refuses to start ranked without a clock and caps clocks on start and subsequent writes", () => {
  const t = table("1v1", 0, null, true, false);
  expect(() => t.activate(null)).toThrow("Ranked duels require a clock");
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.turnSeconds', 0, '$.timeout', 'continue') where id = ?").run(t.session.id);
  const longClock = { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [60 * MINUTE, 60 * MINUTE] };
  t.activate(longClock);
  expect(t.service.privateState(t.session.slug, "g").clock?.remainingMs).toEqual([3 * MINUTE, 3 * MINUTE]);
  const row = t.db.prepare("select settings_json from duels where id = ?").get(t.session.id) as { settings_json: string };
  expect(JSON.parse(row.settings_json)).toMatchObject({ turnSeconds: 180, timeout: "loss" });
  t.service.setClock(t.session.slug, "g", longClock);
  t.service.recordCommand(t.session.slug, "g", 0, { promptId: "p1", revision: 1, answer: { choice: "pass" } }, longClock);
  expect(t.service.privateState(t.session.slug, "g").clock?.remainingMs).toEqual([3 * MINUTE, 3 * MINUTE]);
  expect(() => t.service.setClock(t.session.slug, "g", null)).toThrow("Ranked duels require a clock");
});

it("settles a legacy ranked continue clock already frozen at zero as a loss", async () => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  t.db.prepare("update duels set clock_json = ? where id = ?")
    .run(JSON.stringify({ turn: 1, activeSeat: 0, startedAt: null, remainingMs: [0, 3 * MINUTE] }), t.session.id);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expectRankedLoss(t);
});

it("starts and persists a fixed bank for a legacy unlimited ranked game", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  t.db.prepare("update duels set clock_json = null where id = ?").run(t.session.id);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.privateState(t.session.slug, "g").clock).toMatchObject({ activeSeat: 0, remainingMs: [3 * MINUTE, 3 * MINUTE] });
  await vi.advanceTimersByTimeAsync(3 * MINUTE + SWEEP);
  expectRankedLoss(t);
});

it("keeps ranked move increments and turn regain capped at three minutes", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  expect((await t.post("view")).status).toBe(200);
  await vi.advanceTimersByTimeAsync(30_000);
  expect((await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } })).status).toBe(200);
  expect(t.service.privateState(t.session.slug, "g").clock?.remainingMs).toEqual([153_000, 180_000]);
  t.nextTurn();
  expect((await t.post("respond", { command: { promptId: "p2", revision: 2, answer: { choice: "pass" } } })).status).toBe(200);
  expect(t.service.privateState(t.session.slug, "g").clock?.remainingMs).toEqual([180_000, 180_000]);
});

it("keeps the ranked clock when the next game uses legacy series settings", () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [3 * MINUTE, 3 * MINUTE] }, true);
  t.service.interrupt(t.session.slug, "g", "Fixture between games");
  const series = createDuelSeriesService(t.db).forDuel(t.session.id)!;
  t.db.prepare("update duel_series set settings_json = json_set(settings_json, '$.turnSeconds', 0, '$.timeout', 'continue') where id = ?").run(series.id);
  const next = createDuelSeriesService(t.db).createNextGame(series.id, "g");
  expect(next.settings).toMatchObject({ turnSeconds: 180, timeout: "loss" });
  const stored = t.db.prepare("select settings_json from duels where id = ?").get(next.id) as { settings_json: string };
  expect(JSON.parse(stored.settings_json)).toMatchObject({ turnSeconds: 180, timeout: "loss" });
});

it.each(["private", "public"] as const)("closes %s casual unlimited and long-clock games without a winner at ten minutes", async visibility => {
  for (const clock of [null, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [60 * MINUTE, 60 * MINUTE] }]) {
    const t = table("1v1", 0, clock, false, true, visibility);
    await vi.advanceTimersByTimeAsync(10 * MINUTE + SWEEP);
    expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null,
      winnerPlayerId: null, resultReason: "No player activity for 10 minutes." });
    expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  }
});

it.each(["tag", "ffa3", "ffa4"] as const)("rejects ranked %s because ranked multiplayer is unsupported", format => {
  const t = table();
  expect(() => t.service.create({ guildId: "g", organizerPlayerId: t.players[0]!, name: "Ranked multi", mode: "normal", format, ranked: true }))
    .toThrow("Only a 1v1 duel can be best of 3 or ranked");
});

it("rechecks a sweep candidate after a player command was accepted", async () => {
  const t = table("1v1", 10 * MINUTE + 1);
  // The startup sweep has selected the row and queued its close, but has not acquired the slug queue yet.
  t.service.recordCommand(t.session.slug, "g", 0, { promptId: "p1", revision: 1, answer: { choice: "pass" } }, null);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  expect(t.changes).toEqual([]);
});

it("interrupts an idle FFA4 at the first sweep even with a funded thirty-minute loss clock", async () => {
  const t = table("ffa4", 10 * MINUTE + 1_000, { turn: 1, activeSeat: 0, startedAt: Date.now() - 10 * MINUTE - 1_000,
    remainingMs: [30 * MINUTE, 30 * MINUTE, 30 * MINUTE, 30 * MINUTE] });
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.timeout', 'loss') where id = ?").run(t.session.id);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, winnerPlayerId: null,
    resultReason: "No player activity for 10 minutes." });
  expect(t.service.privateState(t.session.slug, "g").clock).toBeNull();
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it("keeps the existing loss path for an ordinary clock shorter than ten minutes", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [5 * MINUTE, 5 * MINUTE] });
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.timeout', 'loss') where id = ?").run(t.session.id);
  await vi.advanceTimersByTimeAsync(5 * MINUTE + SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", winnerSeat: 1, resultReason: "Time limit" });
});

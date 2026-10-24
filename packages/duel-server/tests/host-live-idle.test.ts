import Database from "better-sqlite3";
import { rmSync } from "node:fs";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { migrate } from "@yugidraft/shared/db";
import { seatCountFor, type DuelClockState, type DuelEngineView, type DuelFormat, type DuelSession, type DuelVisibility } from "@yugidraft/shared/duels";
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

function table(format: DuelFormat = "1v1", idleMs = 0, clock: DuelClockState | null = null, ranked = false, start = true, visibility: DuelVisibility = "public",
  beforeBoot?: (t: { db: Database.Database; session: DuelSession; players: number[] }) => void) {
  const directory = createHostDataFixture([]);
  const db = new Database(":memory:"); migrate(db);
  const players = Array.from({ length: seatCountFor(format) }, (_, seat) =>
    seedIdentity(db, { guildId: "g", name: `P${seat}` }).playerId);
  const service = createDuelService(db);
  let session = service.create({ guildId: "g", organizerPlayerId: players[0]!, name: "Idle table", mode: "normal", format,
    ranked, settings: { visibility, validateDeck: false, turnSeconds: clock ? 3600 : 0, timeout: "continue" } });
  for (const player of players.slice(1)) {
    if (visibility === "private") service.admit(session.slug, "g", player, service.room(session.slug, "g", players[0]!).inviteCode!);
    service.takeSeat(session.slug, "g", player);
  }
  for (const player of players) service.setDeck(session.slug, "g", player, { main: Array(40).fill(1), extra: [], side: [] });
  const activate = (initialClock: DuelClockState | null) => service.activate(session.slug, "g", players[0]!, ["1", "2", "3", "4"],
    pinnedEngineVersion("fixture", players.length, activeMultiScriptsHash(directory)), initialClock, { firstTurnDraw: false });
  if (start) session = activate(clock);
  db.prepare("update duels set last_activity_at = ? where id = ?").run(new Date(Date.now() - idleMs).toISOString(), session.id);
  let running = true, revision = 1, turn = 1;
  let promptSeat: number | null = 0;
  const worker: DuelGameWorker = {
    get running() { return running; },
    async create() {},
    async view(viewerSeat) {
      return { revision, turn, turnSeat: 0, phase: "main1", prioritySeat: 0, chain: [], events: [], log: [], result: null,
        prompt: promptSeat !== null && viewerSeat === promptSeat ? { id: `p${revision}`, seat: promptSeat, kind: "choice", title: "Main", options: [{ id: "pass", label: "Pass" }] } : null,
        seats: players.map((_, seat) => ({ seat, lp: 8000, hand: [], deckCount: 40, extraCount: 0, extra: [],
          monsters: [], spells: [], graveyard: [], banished: [] })) } as DuelEngineView;
    },
    async answer() { revision++; },
    async search() { return []; },
    async setChainMode() { return false; },
    async close() { running = false; },
  };
  const changes: string[] = [];
  beforeBoot?.({ db, session, players });
  const startHost = () => createDuelHost({ db, dataDirectory: directory, secret: SECRET, searchCards: () => [], pollIntervalMs: SWEEP,
    idleWorkerMs: 24 * 60 * MINUTE, createWorker: () => worker, onChange: slug => { changes.push(slug); } });
  let host = startHost();
  cleanups.push(async () => { await host.close(); db.close(); rmSync(directory, { recursive: true, force: true }); });
  const post = async (op: string, extra = {}) => {
    const body = JSON.stringify({ op, slug: session.slug, guildId: "g", playerId: players[0], ...extra });
    return host.handle(new Request("http://localhost/internal/duel", { method: "POST", body,
      headers: { "content-type": "application/json", ...await signedHeaders(body, SECRET, "http://localhost/internal/duel", "duel-host") } }));
  };
  return { db, service, session, changes, worker, post, players, activate, setPromptSeat: (seat: number | null) => { promptSeat = seat; }, nextTurn: () => { turn++; },
    restart: async (downtime: number) => { await host.close(); vi.setSystemTime(Date.now() + downtime); host = startHost(); } };
}

function heartbeat(db: Database.Database, at: number) {
  // Also seed the pre-migration implementation so failures exercise recovery behavior.
  db.exec("create table if not exists duel_host_heartbeat (id integer primary key check (id = 1), last_tick_at integer not null)");
  db.prepare("insert or replace into duel_host_heartbeat (id, last_tick_at) values (1, ?)").run(at);
}

function tournament({ db, session, players }: Parameters<NonNullable<Parameters<typeof table>[6]>>[0]) {
  const cup = db.prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id) select 'g', 'Cup', 'single_elim', 'active', user_id from players where id = ?").run(players[0]);
  const slot = db.prepare("insert into tournament_matches (tournament_id, player_one_id, player_two_id, round_number, status) values (?, ?, ?, 1, 'open')")
    .run(cup.lastInsertRowid, players[0], players[1]);
  db.prepare("update duel_series set tournament_match_id = ?, ranked = 0 where id = ?").run(slot.lastInsertRowid, session.seriesId);
  db.prepare("update duels set ranked = 0 where id = ?").run(session.id);
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

it("settles a ranked deadline proven before the last heartbeat without recovering an engine", async () => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE,
    remainingMs: [3 * MINUTE, 3 * MINUTE] }, true, true, "public", ({ db }) => heartbeat(db, Date.now() - 7 * MINUTE));
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

it("gives a legacy ranked continue clock frozen at zero the thirty-second regain at boot", async () => {
  const boot = Date.now();
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: boot, remainingMs: [3 * MINUTE, 3 * MINUTE] }, true, true, "public", ({ db, session }) => {
    db.prepare("update duels set clock_json = ? where id = ?")
      .run(JSON.stringify({ turn: 1, activeSeat: 0, startedAt: null, remainingMs: [0, 3 * MINUTE] }), session.id);
  });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  expect(t.service.privateState(t.session.slug, "g").clock).toMatchObject({ startedAt: boot, remainingMs: [30_000, 180_000] });
  await vi.advanceTimersByTimeAsync(30_000);
  expectRankedLoss(t);
});

it.each([null, { turn: 1, activeSeat: null, startedAt: null, remainingMs: [180_000, 180_000] }])("interrupts an idle ranked duel with an unsettleable clock %j", async clock => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [180_000, 180_000] }, true, true, "public", ({ db, session }) => {
    db.prepare("update duels set clock_json = ?, bundle_version = 'unavailable-old-bundle' where id = ?").run(clock ? JSON.stringify(clock) : null, session.id);
  });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, resultReason: "No player activity for 10 minutes." });
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it("interrupts an idle ranked duel when persisting its proven timeout fails", async () => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE, remainingMs: [180_000, 180_000] }, true, true, "public", ({ db }) => {
    heartbeat(db, Date.now() - MINUTE);
    db.exec("create trigger fail_timeout before update of status on duels when new.status = 'completed' begin select raise(abort, 'fixture timeout persistence failure'); end");
  });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, resultReason: "No player activity for 10 minutes." });
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it.each(["{", JSON.stringify({ turn: 1, remainingMs: [], activeSeat: 0, startedAt: 0 })])("starts and interrupts an idle ranked duel with malformed clock %s", async raw => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [180_000, 180_000] }, true, true, "public", ({ db, session }) => {
    db.prepare("update duels set clock_json = ? where id = ?").run(raw, session.id);
  });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null, resultReason: "No player activity for 10 minutes." });
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it.each([6 * MINUTE, 2 * MINUTE])("rebases a legacy ten-minute ranked bank after four minutes of use (bank=%i)", async bank => {
  const boot = Date.now();
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: boot, remainingMs: [180_000, 180_000] }, true, true, "public", ({ db, session }) => {
    db.prepare("update duels set clock_json = ? where id = ?").run(JSON.stringify({ turn: 1, activeSeat: 0,
      startedAt: boot - 4 * MINUTE, remainingMs: [bank + 4 * MINUTE, 10 * MINUTE] }), session.id);
  });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  expect(t.service.privateState(t.session.slug, "g").clock).toMatchObject({ startedAt: boot, remainingMs: [Math.min(180_000, bank), 180_000] });
  await vi.advanceTimersByTimeAsync(Math.min(180_000, bank));
  expectRankedLoss(t);
});

it("rebases an overdue clock with no heartbeat without awarding an unproven win", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now() - 4 * MINUTE, remainingMs: [180_000, 180_000] }, true);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  expect(t.service.privateState(t.session.slug, "g").clock?.remainingMs[0]).toBe(30_000);
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it.each(["ranked", "tournament"])("persists heartbeats and excludes restart outages from the %s clock exactly once", async kind => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [180_000, 180_000] }, true, true, "public", context => {
    if (kind === "tournament") tournament(context);
  });
  await vi.advanceTimersByTimeAsync(MINUTE);
  expect(t.db.prepare("select last_tick_at from duel_host_heartbeat where id = 1").get()).toEqual({ last_tick_at: Date.now() });
  await t.restart(4 * MINUTE);
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g").status).toBe("active");
  await vi.advanceTimersByTimeAsync(MINUTE);
  await t.restart(30_000);
  await vi.advanceTimersByTimeAsync(MINUTE);
  expectRankedLoss(t);
});

it("keeps a tournament's five-minute bank and settles a loss instead of continuing at zero", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [180_000, 180_000] }, true, true, "public", context => {
    tournament(context);
    context.db.prepare("update duels set settings_json = json_set(settings_json, '$.turnSeconds', 300, '$.timeout', 'continue'), clock_json = ? where id = ?")
      .run(JSON.stringify({ turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [5 * MINUTE, 5 * MINUTE] }), context.session.id);
  });
  await vi.advanceTimersByTimeAsync(3 * MINUTE);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "active", settings: { turnSeconds: 300, timeout: "loss" } });
  expect(t.service.privateState(t.session.slug, "g").clock?.remainingMs).toEqual([5 * MINUTE, 5 * MINUTE]);
  expect(() => t.service.setClock(t.session.slug, "g", null)).toThrow("Timed competitive duels require a clock");
  await vi.advanceTimersByTimeAsync(2 * MINUTE + SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", winnerSeat: 1, resultReason: "Time limit" });
  expect(t.db.prepare("select status, winner_id from matches").all()).toEqual([{ status: "approved", winner_id: t.players[1] }]);
});

it.each([0, 12 * MINUTE])("keeps tournament timer %i and applies a no-winner idle backstop", async bank => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [180_000, 180_000] }, true, true, "public", context => {
    tournament(context);
    context.db.prepare("update duels set settings_json = json_set(settings_json, '$.turnSeconds', ?, '$.timeout', 'continue'), clock_json = ? where id = ?")
      .run(bank / 1000, bank ? JSON.stringify({ turn: 1, activeSeat: 0, startedAt: Date.now(), remainingMs: [bank, bank] }) : null, context.session.id);
  });
  expect(t.service.get(t.session.slug, "g").settings).toMatchObject({ turnSeconds: bank / 1000, timeout: "loss" });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "interrupted", winnerSeat: null });
  expect(t.db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
});

it("settles a tournament deadline proven before the heartbeat ahead of idle cleanup and engine recovery", async () => {
  const t = table("1v1", 11 * MINUTE, { turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE, remainingMs: [180_000, 180_000] }, true, true, "public", context => {
    tournament(context);
    heartbeat(context.db, Date.now() - MINUTE);
    context.db.prepare("update duels set bundle_version = 'unavailable-old-bundle', settings_json = json_set(settings_json, '$.turnSeconds', 300, '$.timeout', 'continue'), clock_json = ? where id = ?")
      .run(JSON.stringify({ turn: 1, activeSeat: 0, startedAt: Date.now() - 11 * MINUTE, remainingMs: [5 * MINUTE, 5 * MINUTE] }), context.session.id);
  });
  await vi.advanceTimersByTimeAsync(SWEEP);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", winnerSeat: 1, resultReason: "Time limit" });
  expect(t.db.prepare("select status, winner_id from matches").all()).toEqual([{ status: "approved", winner_id: t.players[1] }]);
});

it("reaches a newer ranked deadline behind more than a sweep of unrecoverable null clocks", async () => {
  const t = table("1v1", 0, { turn: 1, activeSeat: null, startedAt: null, remainingMs: [180_000, 180_000] }, true, true, "public", ({ db, session }) => {
    for (let index = 0; index < 40; index++) {
      db.prepare("insert into duels (guild_id, web_slug, name, organizer_player_id, mode, status, ranked, bundle_version, created_at, last_activity_at) select guild_id, ?, 'Stuck', organizer_player_id, mode, 'active', 1, 'missing', datetime('now', '-1 minute'), datetime('now') from duels where id = ?")
        .run(`stuck-${index}`, session.id);
    }
    db.prepare("update duels set clock_json = '{' where web_slug = 'stuck-0'").run();
  });
  const newer = t.service.create({ guildId: "g", organizerPlayerId: t.players[0]!, name: "Newer ranked", mode: "normal", ranked: true, settings: { validateDeck: false } });
  t.service.takeSeat(newer.slug, "g", t.players[1]!);
  for (const player of t.players) t.service.setDeck(newer.slug, "g", player, { main: Array(40).fill(1), extra: [], side: [] });
  t.service.activate(newer.slug, "g", t.players[0]!, ["1"], "unavailable-old-bundle", { turn: 1, activeSeat: 0,
    startedAt: Date.now() - 4 * MINUTE, remainingMs: [180_000, 180_000] });
  await vi.advanceTimersByTimeAsync(3 * SWEEP);
  expectRankedLoss({ ...t, session: newer });
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

// Exercise the signed host request, SQLite clock and engine boundary together.
it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("charges sequential %s prompt owners, excluding server work", async format => {
  const start = Date.now();
  const count = seatCountFor(format);
  const t = table(format, 0, { turn: 1, remainingMs: Array(count).fill(MINUTE), activeSeat: 0, startedAt: start });
  for (let seat = 0; seat < count; seat++) {
    t.setPromptSeat(seat);
    vi.setSystemTime(Date.now() + 10_000);
    const nextSeat = (seat + 1) % count;
    const answer = t.worker.answer.bind(t.worker);
    t.worker.answer = async (...args) => {
      expect(t.service.privateState(t.session.slug, "g").clock?.startedAt).toBeNull();
      vi.setSystemTime(Date.now() + 4_000); // Core/auto-pass work within the prompt credit cap.
      await answer(...args);
      t.setPromptSeat(nextSeat);
    };
    const result = await t.post("respond", { playerId: t.players[seat],
      command: { promptId: `p${seat + 1}`, revision: seat + 1, answer: { choice: "pass" } } });
    expect(result.status).toBe(200);
    const clock = t.service.privateState(t.session.slug, "g").clock!;
    expect(clock.activeSeat).toBe(nextSeat); // The turn stays at seat 0 throughout.
    expect(clock.startedAt).toBe(Date.now());
    expect(clock.remainingMs).toEqual(Array.from({ length: count }, (_, i) => i <= seat ? 53_000 : MINUTE));
    t.worker.answer = answer;
  }
});

it("pauses decision time while recovering the engine and resumes the saved owner", async () => {
  const start = Date.now();
  const t = table("ffa4", 0, { turn: 1, remainingMs: Array(4).fill(MINUTE), activeSeat: 3, startedAt: start });
  t.setPromptSeat(3);
  t.worker.create = async () => { vi.setSystemTime(Date.now() + 4_000); };
  vi.setSystemTime(start + 10_000);
  const response = await t.post("view");
  expect(response.status).toBe(200);
  expect(t.service.privateState(t.session.slug, "g").clock).toEqual({
    turn: 1, remainingMs: Array(4).fill(MINUTE), activeSeat: 3, startedAt: start + 4_000,
  });
  expect((await response.json()).clock.serverNow).toBe(Date.now());
});

it("keeps all banks still when the core has no pending decision", async () => {
  const start = Date.now();
  const t = table("ffa3", 0, { turn: 1, remainingMs: Array(3).fill(MINUTE), activeSeat: 0, startedAt: start });
  t.worker.answer = async () => { t.setPromptSeat(null); };
  vi.setSystemTime(start + 10_000);
  expect((await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } })).status).toBe(200);
  const saved = t.service.privateState(t.session.slug, "g").clock!;
  expect(saved).toMatchObject({ activeSeat: null, startedAt: null, remainingMs: [53_000, MINUTE, MINUTE] });
  vi.setSystemTime(Date.now() + 2 * MINUTE);
  expect((await t.post("view")).status).toBe(200);
  expect(t.service.privateState(t.session.slug, "g").clock).toEqual(saved);
});


it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("concurrent %s room reads cannot freeze a prompt owner's bank", async format => {
  const count = seatCountFor(format);
  const t = table(format, 0, { turn: 1, remainingMs: Array(count).fill(5_000), activeSeat: 0, startedAt: Date.now() });
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.timeout', 'loss') where id = ?").run(t.session.id);
  expect((await t.post("view")).status).toBe(200); // Recover before measuring passive reads.
  const view = t.worker.view.bind(t.worker);
  const eliminated = new Set<number>();
  t.worker.eliminate = async seat => { eliminated.add(seat); t.setPromptSeat(1); };
  t.worker.view = async (...args) => {
    vi.setSystemTime(Date.now() + 250);
    const result = await view(...args);
    for (const seat of result.seats) if (eliminated.has(seat.seat)) seat.eliminated = true;
    return result;
  };
  for (let batch = 0; batch < 12; batch++) {
    await Promise.all(Array.from({ length: 5 }, () => t.post("view")));
  }
  if (format === "1v1" || format === "tag") {
    expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", resultReason: "Time limit" });
  } else {
    expect(t.service.privateState(t.session.slug, "g").setup?.eliminatedSeats).toContain(0);
    expect(t.service.privateState(t.session.slug, "g").clock?.activeSeat).not.toBe(0);
  }
});

it("resident reads perform no SQLite writes", async () => {
  const t = table("1v1", 0, { turn: 1, remainingMs: [MINUTE, MINUTE], activeSeat: 0, startedAt: Date.now() });
  await t.post("view");
  const before = (t.db.prepare("select total_changes() as n").get() as { n: number }).n;
  const view = t.worker.view.bind(t.worker);
  t.worker.view = async (...args) => { vi.setSystemTime(Date.now() + 10); return view(...args); };
  for (const op of ["view", "capabilities", "cards"]) await t.post(op, { codes: [] });
  expect((t.db.prepare("select total_changes() as n").get() as { n: number }).n).toBe(before);
});

it("caps accumulated server credit across chain-mode changes on the same prompt", async () => {
  const start = Date.now();
  const t = table("1v1", 0, { turn: 1, remainingMs: [MINUTE, MINUTE], activeSeat: 0, startedAt: start });
  await t.post("view");
  t.worker.setChainMode = async () => { vi.setSystemTime(Date.now() + 4_000); return false; };
  for (const mode of ["always", "off", "always", "off", "always"]) expect((await t.post("chain-mode", { mode })).status).toBe(200);
  const clock = t.service.privateState(t.session.slug, "g").clock!;
  expect(clock.startedAt).toBe(start + 10_000);
});

it("rejected engine answers receive no server-work credit", async () => {
  const t = table("1v1", 0, { turn: 1, remainingMs: [MINUTE, MINUTE], activeSeat: 0, startedAt: Date.now() });
  await t.post("view");
  const saved = t.service.privateState(t.session.slug, "g").clock;
  const { EngineAnswerError } = await import("../src/prompts.js");
  t.worker.answer = async () => { vi.setSystemTime(Date.now() + 1_000); throw new EngineAnswerError("Illegal answer"); };
  for (let i = 0; i < 5; i++) expect((await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } })).status).toBe(400);
  expect(t.service.privateState(t.session.slug, "g").clock).toEqual(saved);
});


it.each([false, true])("caps changed-clock server credit on the previous owner (handoff=%s)", async handoff => {
  const t = table("1v1", 0, { turn: 1, remainingMs: [MINUTE, MINUTE], activeSeat: 0, startedAt: Date.now() });
  await t.post("view");
  const answer = t.worker.answer.bind(t.worker);
  t.worker.answer = async (...args) => { vi.setSystemTime(Date.now() + 30_000); await answer(...args); if (handoff) t.setPromptSeat(1); };
  expect((await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } })).status).toBe(200);
  expect(t.service.privateState(t.session.slug, "g").clock).toMatchObject({ remainingMs: [43_000, MINUTE], startedAt: Date.now() });
});

it.each([false, true])("preserves the operation result and resumes after a final snapshot failure (rejected=%s)", async rejected => {
  const t = table("1v1", 0, { turn: 1, remainingMs: [MINUTE, MINUTE], activeSeat: 0, startedAt: Date.now() });
  await t.post("view");
  let failSnapshot = false;
  const statementPrototype = Object.getPrototypeOf(t.db.prepare("select 1"));
  const get = statementPrototype.get;
  const stackLimit = Error.stackTraceLimit;
  Error.stackTraceLimit = 50;
  const spy = vi.spyOn(statementPrototype, "get").mockImplementation(function(this: unknown, ...args: unknown[]) {
    if (failSnapshot && new Error().stack?.includes("privateSnapshot")) {
      failSnapshot = false;
      throw new Error("fixture final snapshot failure");
    }
    return get.apply(this, args);
  });
  const answer = t.worker.answer.bind(t.worker);
  const { EngineAnswerError } = await import("../src/prompts.js");
  t.worker.answer = async (...args) => {
    failSnapshot = true;
    if (rejected) throw new EngineAnswerError("Original answer error");
    await answer(...args);
  };
  try {
    const response = await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } });
    expect(response.status).toBe(rejected ? 400 : 200);
    if (rejected) expect(await response.json()).toMatchObject({ error: "Original answer error" });
    expect(failSnapshot).toBe(false);
    expect(t.service.privateState(t.session.slug, "g").clock?.startedAt).not.toBeNull();
  } finally { spy.mockRestore(); Error.stackTraceLimit = stackLimit; }
});


it("enforces a timeout after recovery exceeds the per-prompt server credit", async () => {
  const t = table("1v1", 0, { turn: 1, remainingMs: [5_000, 5_000], activeSeat: 0, startedAt: Date.now() });
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.timeout', 'loss') where id = ?").run(t.session.id);
  t.worker.create = async () => { vi.setSystemTime(Date.now() + 20_000); };
  expect((await t.post("view")).status).toBe(200);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", resultReason: "Time limit" });
});


it("settles the prior owner's exhausted credit bank before a handoff can regain it", async () => {
  const t = table("1v1", 0, { turn: 1, remainingMs: [5_000, MINUTE], activeSeat: 0, startedAt: Date.now() });
  t.db.prepare("update duels set settings_json = json_set(settings_json, '$.timeout', 'loss') where id = ?").run(t.session.id);
  await t.post("view");
  const answer = t.worker.answer.bind(t.worker);
  t.worker.answer = async (...args) => { vi.setSystemTime(Date.now() + 30_000); await answer(...args); t.setPromptSeat(1); };
  expect((await t.post("respond", { command: { promptId: "p1", revision: 1, answer: { choice: "pass" } } })).status).toBe(200);
  expect(t.service.privateState(t.session.slug, "g").clock).toMatchObject({ activeSeat: 0, remainingMs: [0, MINUTE], startedAt: Date.now() });
  expect((await t.post("view")).status).toBe(200);
  expect(t.service.get(t.session.slug, "g")).toMatchObject({ status: "completed", winnerSeat: 1, resultReason: "Time limit" });
});

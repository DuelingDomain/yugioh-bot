import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDuelService } from "../../src/services/duels.js";
import { createDuelSeriesService } from "../../src/services/duel-series.js";
import { seedIdentity } from "../helpers/identity.js";

let db: Database.Database;
let duels: ReturnType<typeof createDuelService>;
let host: number;
let guest: number;
const deck = { main: Array(40).fill(1), extra: [], side: [] };
beforeEach(() => {
  db = new Database(":memory:");
  migrate(db);
  host = seedIdentity(db, { guildId: "g", name: "Host" }).playerId;
  guest = seedIdentity(db, { guildId: "g", name: "Guest" }).playerId;
  duels = createDuelService(db);
});
afterEach(() => db.close());
const rawCreate = (extra = {}) => duels.create({ guildId: "g", organizerPlayerId: host, name: "Table", mode: "normal", ...extra });
const create = (extra = {}) => duels.createRequest({ guildId: "g", organizerPlayerId: host, fingerprint: JSON.stringify(extra) }, () => ({ session: rawCreate(extra) })).session;

describe("hosted table creation", () => {
  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("replaces an empty %s lobby without a result", (format) => {
    const old = create({ format });
    const next = create({ name: "New rules" });
    expect(next.slug).not.toBe(old.slug);
    expect(duels.get(old.slug, "g")).toMatchObject({ status: "cancelled", winnerPlayerId: null, winnerSeat: null });
    expect(duels.list("g", host).map(table => table.slug)).toEqual([next.slug]);
    expect(db.prepare("select count(*) as n from matches").get()).toEqual({ n: 0 });
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("does not count practice bots at a %s table as humans", (format) => {
    const old = create({ format });
    duels.addPracticeBot(old.slug, "g", host, deck);
    create();
    expect(duels.get(old.slug, "g").status).toBe("cancelled");
  });

  it("replaces an empty Best of 3 lobby", () => {
    const old = create({ bestOf: 3 });
    create();
    expect(duels.get(old.slug, "g").status).toBe("cancelled");
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("protects a %s lobby with another human", (format) => {
    const old = create({ format });
    duels.takeSeat(old.slug, "g", guest);
    expect(() => create()).toThrow(/another player|already started/i);
    expect(duels.get(old.slug, "g").status).toBe("lobby");
    expect(db.prepare("select count(*) as n from duels").get()).toEqual({ n: 1 });
  });

  it("protects an opening but lets an active practice game remain", () => {
    const old = create();
    duels.addPracticeBot(old.slug, "g", host, deck);
    duels.setDeck(old.slug, "g", host, deck);
    duels.startOpening(old.slug, "g", host, Date.now());
    expect(() => create()).toThrow(/already started|starting/i);
    duels.abortOpening(old.slug, "g");
    duels.activate(old.slug, "g", host, ["seed"], "bundle", null);
    expect(create().status).toBe("lobby");
    expect(duels.get(old.slug, "g").status).toBe("active");
  });

  it("rolls cancellation back when the insert fails", () => {
    const old = create();
    db.exec("create trigger fail_create before insert on duels begin select raise(abort, 'test insert failed'); end");
    expect(() => create()).toThrow("test insert failed");
    expect(duels.get(old.slug, "g").status).toBe("lobby");
  });

  it("closes all legacy empty duplicates when the host creates a new table", () => {
    const old = create();
    const id = Number(db.prepare(`insert into duels(guild_id, web_slug, name, organizer_player_id, mode, status)
      values('g', 'legacy02', 'Legacy duplicate', ?, 'normal', 'lobby')`).run(host).lastInsertRowid);
    db.prepare("insert into duel_seats(duel_id, seat, player_id, is_bot, ready) values(?,0,?,0,0)").run(id, host);
    const next = duels.createRequest({ guildId: "g", organizerPlayerId: host, fingerprint: "new" }, () => ({ session: create() }));
    expect(next.changedSlugs).toEqual([old.slug, "legacy02", next.session.slug]);
    expect(duels.list("g", host).map(table => table.slug)).toEqual([next.session.slug]);
  });

  it.each(["between_games", "lobby", "opening", "active"] as const)("allows creation while a practice series is %s and keeps its wins", (state) => {
    const old = create({ bestOf: 3 });
    duels.addPracticeBot(old.slug, "g", host, deck);
    duels.setDeck(old.slug, "g", host, deck);
    duels.activate(old.slug, "g", host, ["seed"], "bundle", null);
    duels.complete(old.slug, "g", 0, "test");
    const seriesId = duels.get(old.slug, "g").seriesId!;
    expect(duels.room(old.slug, "g", host).series).toMatchObject({ vsBot: true, wins: [1, 0], status: "between_games" });
    const game = state === "between_games" ? old : createDuelSeriesService(db).createNextGame(seriesId, "g");
    if (state === "opening") duels.startOpening(game.slug, "g", host, Date.now());
    if (state === "active") duels.activate(game.slug, "g", host, ["seed"], "bundle", null);
    const before = db.prepare("select * from duel_series where id = ?").get(seriesId);
    const retained = duels.get(game.slug, "g");
    expect(duels.waitingHostedTable("g", host)).toBeNull();
    expect(create().status).toBe("lobby");
    expect(duels.get(game.slug, "g")).toEqual(retained);
    expect(db.prepare("select * from duel_series where id = ?").get(seriesId)).toEqual(before);
  });

  it("protects a later human-series lobby with saved wins", () => {
    const series = createDuelSeriesService(db);
    const { duel: old } = series.createChallenge({ guildId: "g", challengerPlayerId: host, opponentPlayerId: guest, bestOf: 3, ranked: false, mode: "normal" });
    duels.setDeck(old.slug, "g", host, deck);
    duels.setDeck(old.slug, "g", guest, deck);
    duels.activate(old.slug, "g", host, ["seed"], "bundle", null);
    const hostSeat = duels.get(old.slug, "g").seats.find(seat => seat.playerId === host)!.seat;
    duels.complete(old.slug, "g", hostSeat, "test");
    const seriesId = duels.get(old.slug, "g").seriesId!;
    const next = series.createNextGame(seriesId, "g");
    expect(() => create()).toThrow(/already started/i);
    expect(duels.get(next.slug, "g").status).toBe("lobby");
    expect(duels.room(next.slug, "g", host).series).toMatchObject({ vsBot: false, wins: [1, 0] });
  });

  it("protects a practice-series lobby if another human occupies the bot seat", () => {
    const old = create({ bestOf: 3 });
    duels.addPracticeBot(old.slug, "g", host, deck);
    duels.setDeck(old.slug, "g", host, deck);
    duels.activate(old.slug, "g", host, ["seed"], "bundle", null);
    duels.complete(old.slug, "g", 0, "test");
    const next = createDuelSeriesService(db).createNextGame(duels.get(old.slug, "g").seriesId!, "g");
    db.prepare("update duel_seats set player_id = ?, is_bot = 0 where duel_id = ? and is_bot = 1").run(guest, next.id);
    expect(() => create()).toThrow(/another player|already started/i);
    expect(duels.get(next.slug, "g").status).toBe("lobby");
  });

  it("replays the same request across service instances and rejects changed input", () => {
    const input = { guildId: "g", organizerPlayerId: host, requestKey: "request-123", fingerprint: "same settings" };
    const action = () => ({ session: create() });
    const first = duels.createRequest(input, action);
    const other = createDuelService(db);
    const second = other.createRequest(input, () => { throw new Error("must not create twice"); });
    expect(second.session.slug).toBe(first.session.slug);
    expect(db.prepare("select count(*) as n from duels").get()).toEqual({ n: 1 });
    expect(() => other.createRequest({ ...input, fingerprint: "changed" }, action)).toThrow(/request.*different/i);
  });

  it("guards cancellation against a human who joins after the notice was read", () => {
    const old = create();
    expect(duels.waitingHostedTable("g", host)?.slug).toBe(old.slug);
    duels.takeSeat(old.slug, "g", guest);
    expect(() => duels.cancelWaiting(old.slug, "g", host)).toThrow(/another player|no longer/i);
    expect(duels.get(old.slug, "g").status).toBe("lobby");
  });

  it("keeps a linkable notice for a waiting table with another human", () => {
    const old = create(); duels.takeSeat(old.slug, "g", guest);
    expect(duels.waitingHostedTable("g", host)).toMatchObject({ slug: old.slug, canReplace: false });
  });

  it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("expires an abandoned empty %s table at 15 minutes", format => {
    const old = create({ format });
    duels.addPracticeBot(old.slug, "g", host, deck);
    db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(old.id);
    expect(duels.expireWaitingTables(Date.now(), 10).map(table => table.slug)).toEqual([old.slug]);
    expect(duels.get(old.slug, "g").status).toBe("cancelled");
  });

  it("renews the idle limit on a host room poll but not a spectator poll", () => {
    const old = create();
    const age = () => db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(old.id);
    age(); duels.touchWaiting(old.slug, "g", guest);
    expect(duels.expireWaitingTables(Date.now(), 10)).toHaveLength(1);
    const next = create();
    db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(next.id);
    duels.touchWaiting(next.slug, "g", host);
    expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
  });

  it("does not expire a lobby with another human", () => {
    const old = create(); duels.takeSeat(old.slug, "g", guest);
    db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(old.id);
    expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
    expect(duels.get(old.slug, "g").status).toBe("lobby");
  });
});


it("keeps a pending named challenge, allows a new game, and lets the host cancel explicitly", () => {
  const series = createDuelSeriesService(db);
  const challenge = series.createChallenge({ guildId: "g", challengerPlayerId: host, opponentPlayerId: guest, bestOf: 3, ranked: false, mode: "normal" });
  expect(duels.waitingHostedTable("g", host)).toMatchObject({ slug: challenge.duel.slug, canReplace: false, canCancel: true, reason: "challenge", opponentName: "Guest" });
  db.prepare("update duels set last_activity_at = datetime('now', '-16 minutes') where id = ?").run(challenge.duel.id);
  expect(duels.expireWaitingTables(Date.now(), 10)).toEqual([]);
  const open = create();
  expect(duels.get(challenge.duel.slug, "g").status).toBe("lobby");
  const next = create();
  expect(duels.get(open.slug, "g").status).toBe("cancelled");
  expect(duels.get(next.slug, "g").status).toBe("lobby");
  duels.cancelWaiting(challenge.duel.slug, "g", host);
  expect(duels.room(challenge.duel.slug, "g", host).series?.status).toBe("cancelled");
});

it("protects a named challenge once its opening starts", () => {
  const challenge = createDuelSeriesService(db).createChallenge({ guildId: "g", challengerPlayerId: host, opponentPlayerId: guest, bestOf: 1, ranked: false, mode: "normal" });
  duels.setDeck(challenge.duel.slug, "g", host, deck);
  duels.setDeck(challenge.duel.slug, "g", guest, deck);
  duels.startOpening(challenge.duel.slug, "g", host, Date.now());
  expect(() => create()).toThrow(/already started/);
  expect(() => duels.cancelWaiting(challenge.duel.slug, "g", host)).toThrow(/no longer/);
});

it("does not apply web replacement to low-level scenario and sandbox starts", () => {
  const open = create();
  const scenario = rawCreate();
  duels.addPracticeBot(scenario.slug, "g", host, deck);
  duels.setDeck(scenario.slug, "g", host, deck);
  duels.activate(scenario.slug, "g", host, ["seed"], "bundle", null, { presetId: "test-preset" });
  const sandbox = rawCreate();
  expect(duels.get(open.slug, "g").status).toBe("lobby");
  expect(sandbox.status).toBe("lobby");
  create();
  expect(duels.get(scenario.slug, "g").status).toBe("active");
});

it("rejects a repeated creation key once its table is cancelled", () => {
  const input = { guildId: "g", organizerPlayerId: host, requestKey: "cancelled-key", fingerprint: "same" };
  const first = duels.createRequest(input, () => ({ session: rawCreate() }));
  duels.cancelWaiting(first.session.slug, "g", host);
  expect(() => duels.createRequest(input, () => ({ session: rawCreate() }))).toThrow(/closed|new request/i);
});

it("removes creation request keys older than one day in the archive sweep", () => {
  const input = { guildId: "g", organizerPlayerId: host, fingerprint: "same" };
  const old = duels.createRequest({ ...input, requestKey: "retention-old" }, () => ({ session: rawCreate() }));
  duels.createRequest({ ...input, requestKey: "retention-new" }, () => ({ session: rawCreate() }));
  db.prepare("update duel_creation_requests set created_at = datetime('now', '-25 hours') where duel_id = ?").run(old.session.id);
  duels.archiveDue(10, 0);
  expect(db.prepare("select request_key from duel_creation_requests").all()).toEqual([{ request_key: "retention-new" }]);
});



it("adds request retention timestamps to an existing request table without losing its keys", () => {
  const input = { guildId: "g", organizerPlayerId: host, requestKey: "before-migration", fingerprint: "same" };
  const first = duels.createRequest(input, () => ({ session: rawCreate() }));
  db.exec("drop index duel_creation_requests_age_idx; alter table duel_creation_requests drop column created_at");
  migrate(db);
  expect(db.prepare("select created_at from duel_creation_requests").get()).toEqual({ created_at: expect.any(String) });
  const second = duels.createRequest(input, () => { throw new Error("must replay the stored request"); });
  expect(second.session.slug).toBe(first.session.slug);
  duels.archiveDue(10, 0);
  expect(db.prepare("select count(*) as n from duel_creation_requests").get()).toEqual({ n: 1 });
});

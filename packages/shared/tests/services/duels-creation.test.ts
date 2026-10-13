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
const create = (extra = {}) => duels.create({ guildId: "g", organizerPlayerId: host, name: "Table", mode: "normal", ...extra });

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

  it("protects an opening and an active practice game", () => {
    const old = create();
    duels.addPracticeBot(old.slug, "g", host, deck);
    duels.setDeck(old.slug, "g", host, deck);
    duels.startOpening(old.slug, "g", host, Date.now());
    expect(() => create()).toThrow(/already started|starting/i);
    duels.abortOpening(old.slug, "g");
    duels.activate(old.slug, "g", host, ["seed"], "bundle", null);
    expect(() => create()).toThrow(/already started/i);
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

  it("protects a later practice-series lobby with saved wins", () => {
    const old = create({ bestOf: 3 });
    duels.addPracticeBot(old.slug, "g", host, deck);
    duels.setDeck(old.slug, "g", host, deck);
    duels.activate(old.slug, "g", host, ["seed"], "bundle", null);
    duels.complete(old.slug, "g", 0, "test");
    // The next series game has bot seats but the preceding win must stay recorded.
    const seriesId = duels.get(old.slug, "g").seriesId!;
    const next = createDuelSeriesService(db).createNextGame(seriesId, "g");
    expect(() => create()).toThrow(/already started/i);
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

  it("expires abandoned empty tables at the existing 15-minute idle limit", () => {
    const old = create({ bestOf: 3 });
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

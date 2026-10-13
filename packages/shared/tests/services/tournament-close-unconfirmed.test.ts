import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createMatchService } from "../../src/services/matches.js";

/** A started three-player tournament (so one confirmed match does not finish it) where Alice reported a win that Bob has not confirmed. */
function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const tournaments = createTournamentService(db);
  const matches = createMatchService(db);
  const person = (key: string) => {
    const result = db.prepare("insert into players (guild_id, discord_user_id, display_name) values (?, ?, ?)").run("g1", key, key);
    return { userId: key, playerId: Number(result.lastInsertRowid) };
  };
  const alice = person("alice");
  const bob = person("bob");
  const carol = person("carol");
  const t = tournaments.create("g1", "Cup", "round_robin", alice.userId);
  tournaments.join(t.id, alice.playerId);
  tournaments.join(t.id, bob.playerId);
  tournaments.join(t.id, carol.playerId);
  tournaments.start(t.id);
  const report = tournaments.report(t.id, alice.playerId, bob.playerId, alice.playerId);
  const slotId = (db.prepare("select id from tournament_matches where match_id = ?").get(report.id) as { id: number }).id;
  const counts = () => ({
    awards: (db.prepare("select count(*) as c from point_awards where tournament_id = ?").get(t.id) as { c: number }).c,
    elo: (db.prepare("select elo from player_ratings where player_id = ?").get(alice.playerId) as { elo: number } | undefined)?.elo ?? null,
  });
  const matchStatus = () => (db.prepare("select status from matches where id = ?").get(report.id) as { status: string }).status;
  const slot = () => db.prepare("select status, match_id from tournament_matches where match_id = ? or id = ?").get(report.id, slotId) as { status: string; match_id: number | null };
  return { db, tournaments, matches, alice, bob, t, report, counts, matchStatus, slot };
}

describe("closing a tournament with a report nobody confirmed", () => {
  it.each([
    ["cancel", (s: ReturnType<typeof setup>) => s.tournaments.cancel(s.t.id)],
    ["end now", (s: ReturnType<typeof setup>) => s.tournaments.complete(s.t.id)],
    ["deadline close", (s: ReturnType<typeof setup>) => s.tournaments.closeForDeadline(s.t.id)],
  ])("%s denies the report, frees the slot, and a later confirm is refused without Elo", (_name, close) => {
    const s = setup();
    const before = s.counts();
    expect(s.matchStatus()).toBe("pending");
    expect(s.slot().status).toBe("pending_approval");

    close(s);

    expect(s.matchStatus()).toBe("denied");
    expect(s.slot()).toEqual({ status: "open", match_id: null });
    expect(() => s.matches.approve(s.report.id, s.bob.playerId)).toThrow(/not pending/);
    expect(s.counts()).toEqual(before);
  });

  it("keeps a result that was confirmed before the cancel", () => {
    const s = setup();
    s.matches.approve(s.report.id, s.bob.playerId);
    const after = s.counts();
    s.tournaments.cancel(s.t.id);
    expect(s.matchStatus()).toBe("approved");
    expect(s.counts()).toEqual(after);
  });

  it.each(["cancelled", "completed"])("refuses to confirm a legacy pending report of a %s tournament", (status) => {
    const s = setup();
    // A row written before the service voided reports: closed tournament, report still pending.
    s.db.prepare("update tournaments set status = ? where id = ?").run(status, s.t.id);
    const before = s.counts();
    expect(() => s.matches.approve(s.report.id, s.bob.playerId)).toThrow(/can no longer be confirmed/);
    expect(s.matchStatus()).toBe("pending");
    expect(s.counts()).toEqual(before);
  });
  it.each(["cancelled", "completed"])("refuses to deny a legacy pending report of a %s tournament", (status) => {
    const s = setup();
    s.db.prepare("update tournaments set status = ? where id = ?").run(status, s.t.id);
    const before = s.counts();
    expect(() => s.matches.deny(s.report.id, s.bob.playerId)).toThrow(/can no longer be denied/);
    expect(s.matchStatus()).toBe("pending");
    expect(s.slot().status).toBe("pending_approval");
    expect(s.counts()).toEqual(before);
  });

});

describe("approve and deny against a cancel that lands in between", () => {
  /** A match service whose db runs `hook` once, right before the statement that resolves the report. */
  function racing(s: ReturnType<typeof setup>, resolving: "approved" | "denied" | "slot", hook: () => void) {
    let fired = false;
    const db = new Proxy(s.db, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key !== "prepare") return typeof value === "function" ? value.bind(target) : value;
        return (sql: string) => {
          const needle = resolving === "slot" ? "select * from tournament_matches where match_id = ?" : `set status = '${resolving}'`;
          if (!fired && sql.includes(needle)) {
            fired = true;
            hook();
          }
          return target.prepare(sql);
        };
      },
    });
    return createMatchService(db);
  }

  it("approve refuses a report the cancel denied after it was read, and writes no Elo", () => {
    const s = setup();
    const before = s.counts();
    const matches = racing(s, "approved", () => s.tournaments.cancel(s.t.id));
    expect(() => matches.approve(s.report.id, s.bob.playerId)).toThrow(/not pending/);
    expect(s.matchStatus()).toBe("denied");
    expect(s.counts()).toEqual(before);
  });

  it("deny does not overwrite a report the cancel already denied, and leaves the slot as the cancel set it", () => {
    const s = setup();
    const matches = racing(s, "denied", () => s.tournaments.cancel(s.t.id));
    expect(() => matches.deny(s.report.id, s.bob.playerId)).toThrow(/not pending/);
    expect(s.matchStatus()).toBe("denied");
    expect(s.slot()).toEqual({ status: "open", match_id: null });
  });
  it.each([
    ["cancel", (s: ReturnType<typeof setup>) => s.tournaments.cancel(s.t.id)],
    ["end now", (s: ReturnType<typeof setup>) => s.tournaments.complete(s.t.id)],
    ["deadline close", (s: ReturnType<typeof setup>) => s.tournaments.closeForDeadline(s.t.id)],
  ])("%s keeps an approved result if the close occurs before its tournament slot is updated", (_name, close) => {
    const s = setup();
    const reference = setup();
    reference.matches.approve(reference.report.id, reference.bob.playerId);
    const expected = reference.counts();
    const matches = racing(s, "slot", () => close(s));

    matches.approve(s.report.id, s.bob.playerId);

    expect(s.matchStatus()).toBe("approved");
    expect(s.slot()).toEqual({ status: "completed", match_id: s.report.id });
    expect(s.counts()).toEqual(expected);
  });

  it("automatic approval refuses a report the cancel denied after it was read, without Elo", () => {
    const s = setup();
    const before = s.counts();
    const matches = racing(s, "approved", () => s.tournaments.cancel(s.t.id));
    expect(() => matches.autoApprove(s.report.id)).toThrow(/not pending/);
    expect(s.matchStatus()).toBe("denied");
    expect(s.slot()).toEqual({ status: "open", match_id: null });
    expect(s.counts()).toEqual(before);
  });

  it.each(["cancelled", "completed"])("refuses automatic approval of a legacy pending report of a %s tournament", (status) => {
    const s = setup();
    s.db.prepare("update tournaments set status = ? where id = ?").run(status, s.t.id);
    const before = s.counts();
    expect(() => s.matches.autoApprove(s.report.id)).toThrow(/can no longer be confirmed/);
    expect(s.matchStatus()).toBe("pending");
    expect(s.slot().status).toBe("pending_approval");
    expect(s.counts()).toEqual(before);
  });

});

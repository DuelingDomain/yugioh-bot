import { seedIdentity, seedUser } from "../helpers/identity.js";
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
    const u = seedUser(db, key);
    return { userId: u.userId, playerId: seedIdentity(db, { guildId: "g1", name: key, userId: u.userId, discordUserId: u.discordUserId ?? key }).playerId };
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

  it("refuses to confirm a legacy pending report of a closed tournament", () => {
    const s = setup();
    // A row written before the service voided reports: closed tournament, report still pending.
    s.db.prepare("update tournaments set status = 'cancelled' where id = ?").run(s.t.id);
    const before = s.counts();
    expect(() => s.matches.approve(s.report.id, s.bob.playerId)).toThrow(/can no longer be confirmed/);
    expect(s.matchStatus()).toBe("pending");
    expect(s.counts()).toEqual(before);
  });
});

describe("approve and deny against a cancel that lands in between", () => {
  /** A match service whose db runs `hook` once, right before the statement that resolves the report. */
  function racing(s: ReturnType<typeof setup>, resolving: "approved" | "denied", hook: () => void) {
    let fired = false;
    const db = new Proxy(s.db, {
      get(target, key) {
        const value = Reflect.get(target, key, target);
        if (key !== "prepare") return typeof value === "function" ? value.bind(target) : value;
        return (sql: string) => {
          if (!fired && sql.includes(`set status = '${resolving}'`)) {
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
});

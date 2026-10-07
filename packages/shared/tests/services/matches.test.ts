import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createMatchService } from "../../src/services/matches.js";
import { createTournamentService } from "../../src/services/tournaments.js";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  const p1 = seedIdentity(db, { guildId: "g1", name: "Yugi", userId: seedUser(db, "u1").userId, discordUserId: seedUser(db, "u1").discordUserId ?? "u1" }).playerId;
  const p2 = seedIdentity(db, { guildId: "g1", name: "Kaiba", userId: seedUser(db, "u2").userId, discordUserId: seedUser(db, "u2").discordUserId ?? "u2" }).playerId;
  return {
    db,
    matches: createMatchService(db),
    tournaments: createTournamentService(db),
    p1,
    p2,
  };
}

// Reports a tournament match (winner = p1) and returns its match id, with a
// controllable created_at so the confirm window can be tested deterministically.
function seedPendingTournamentMatch(
  app: ReturnType<typeof setup>,
  opts: { windowHours?: number | null; createdAt: string },
) {
  const t = app.tournaments.create("g1", "Cup", "round_robin", seedUser(app.db, "u1").userId, {
    reportConfirmWindowHours: opts.windowHours ?? null,
  });
  app.tournaments.join(t.id, app.p1);
  app.tournaments.join(t.id, app.p2);
  app.tournaments.start(t.id);
  const match = app.tournaments.report(t.id, app.p1, app.p2, app.p1); // p1 reports a win
  app.db.prepare("update matches set created_at = ? where id = ?").run(opts.createdAt, match.id);
  return { tournamentId: t.id, matchId: match.id };
}

describe("matches.autoApprove", () => {
  it("approves a pending tournament match with a null approver and completes it", () => {
    const app = setup();
    const { matchId, tournamentId } = seedPendingTournamentMatch(app, {
      createdAt: "2026-05-01T00:00:00.000Z",
    });
    const result = app.matches.autoApprove(matchId);
    expect(result.status).toBe("approved");
    expect(result.approverId).toBeNull();
    const row = app.db.prepare("select resolved_at from matches where id = ?").get(matchId) as { resolved_at: string | null };
    expect(row.resolved_at).not.toBeNull();
    // round-robin with the single match resolved -> tournament completes
    const t = app.db.prepare("select status from tournaments where id = ?").get(tournamentId) as { status: string };
    expect(t.status).toBe("completed");
  });

  it("records scoring for the approved match", () => {
    const app = setup();
    const { matchId } = seedPendingTournamentMatch(app, { createdAt: "2026-05-01T00:00:00.000Z" });
    app.matches.autoApprove(matchId);
    const awards = app.db.prepare("select count(*) as c from point_awards where match_id = ? and kind = 'match_win'").get(matchId) as { c: number };
    expect(awards.c).toBe(1);
  });

  it("is a no-op on a non-pending match", () => {
    const app = setup();
    const { matchId } = seedPendingTournamentMatch(app, { createdAt: "2026-05-01T00:00:00.000Z" });
    app.matches.autoApprove(matchId);
    const again = app.matches.autoApprove(matchId);
    expect(again.status).toBe("approved");
  });
});

describe("matches.findOverduePendingConfirmations", () => {
  it("returns matches past created_at + per-tournament window", () => {
    const app = setup();
    const { matchId } = seedPendingTournamentMatch(app, {
      windowHours: 6,
      createdAt: "2026-05-20T00:00:00.000Z",
    });
    // 5h later -> not overdue
    expect(app.matches.findOverduePendingConfirmations("2026-05-20T05:00:00.000Z")).toEqual([]);
    // 7h later -> overdue
    const overdue = app.matches.findOverduePendingConfirmations("2026-05-20T07:00:00.000Z");
    expect(overdue.map((m) => m.id)).toEqual([matchId]);
  });

  it("uses the 24h default when window is null", () => {
    const app = setup();
    const { matchId } = seedPendingTournamentMatch(app, {
      windowHours: null,
      createdAt: "2026-05-20T00:00:00.000Z",
    });
    expect(app.matches.findOverduePendingConfirmations("2026-05-20T23:00:00.000Z")).toEqual([]);
    const overdue = app.matches.findOverduePendingConfirmations("2026-05-21T01:00:00.000Z");
    expect(overdue.map((m) => m.id)).toEqual([matchId]);
  });

  it("excludes matches in non-active tournaments", () => {
    const app = setup();
    const { matchId, tournamentId } = seedPendingTournamentMatch(app, {
      windowHours: 1,
      createdAt: "2026-05-20T00:00:00.000Z",
    });
    app.db.prepare("update tournaments set status = 'completed' where id = ?").run(tournamentId);
    expect(app.matches.findOverduePendingConfirmations("2026-05-21T00:00:00.000Z").map((m) => m.id)).not.toContain(matchId);
  });

  it("excludes casual matches", () => {
    const app = setup();
    const m = app.matches.report({ guildId: "g1", reporterId: app.p1, opponentId: app.p2, winnerId: app.p1, source: "casual" });
    app.db.prepare("update matches set created_at = ? where id = ?").run("2000-01-01T00:00:00.000Z", m.id);
    expect(app.matches.findOverduePendingConfirmations("2026-05-21T00:00:00.000Z")).toEqual([]);
  });
});

describe("matches.recordConfirmedResult", () => {
  function tournamentSlot(app: ReturnType<typeof setup>, format: "round_robin" | "single_elim" = "single_elim") {
    const t = app.tournaments.create("g1", "Cup", format, seedUser(app.db, "u1").userId);
    app.tournaments.join(t.id, app.p1);
    app.tournaments.join(t.id, app.p2);
    app.tournaments.start(t.id);
    const slot = app.db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as any;
    return { t, slot };
  }

  it("writes an approved casual match and scoring with no tournament", () => {
    const app = setup();
    const match = app.matches.recordConfirmedResult({
      guildId: "g1",
      playerOneId: app.p1,
      playerTwoId: app.p2,
      winnerId: app.p2,
      source: "casual",
    });
    expect(match).toMatchObject({
      status: "approved",
      source: "casual",
      winnerId: app.p2,
      reporterId: app.p2,
      approverId: null,
      tournamentId: null,
    });
    const row = app.db.prepare("select resolved_at from matches where id = ?").get(match.id) as { resolved_at: string | null };
    expect(row.resolved_at).not.toBeNull();
    const awards = app.db.prepare("select count(*) as c from point_awards where match_id = ? and kind = 'match_win'").get(match.id) as { c: number };
    expect(awards.c).toBe(1);
  });

  it("uses recordedById as reporter and approver", () => {
    const app = setup();
    const match = app.matches.recordConfirmedResult({
      guildId: "g1",
      playerOneId: app.p1,
      playerTwoId: app.p2,
      winnerId: app.p1,
      source: "casual",
      recordedById: app.p2,
    });
    expect(match.reporterId).toBe(app.p2);
    expect(match.approverId).toBe(app.p2);
  });

  it("links and completes the slot and completes a finished bracket", () => {
    const app = setup();
    const { t, slot } = tournamentSlot(app);
    const match = app.matches.recordConfirmedResult({
      guildId: "g1",
      playerOneId: slot.player_two_id,
      playerTwoId: slot.player_one_id,
      winnerId: app.p1,
      source: "tournament",
      tournamentMatchId: slot.id,
    });
    expect(match.tournamentId).toBe(t.id);
    const after = app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id) as any;
    expect(after).toEqual({ status: "completed", match_id: match.id });
    const tournament = app.db.prepare("select status from tournaments where id = ?").get(t.id) as { status: string };
    expect(tournament.status).toBe("completed");
    expect((app.db.prepare("select count(*) as c from matches").get() as { c: number }).c).toBe(1);
  });

  it("rejects a completed slot, other players and a pending report, leaving no match behind", () => {
    const app = setup();
    const { t, slot } = tournamentSlot(app);
    const other = seedIdentity(app.db, { guildId: "g1", name: "Joey", userId: seedUser(app.db, "u3").userId, discordUserId: seedUser(app.db, "u3").discordUserId ?? "u3" }).playerId;
    const input = { guildId: "g1", playerOneId: app.p1, playerTwoId: app.p2, winnerId: app.p1, source: "tournament" as const, tournamentMatchId: slot.id };
    expect(() => app.matches.recordConfirmedResult({ ...input, playerTwoId: other })).toThrow(/do not match/i);
    expect(() => app.matches.recordConfirmedResult({ ...input, tournamentMatchId: 9999 })).toThrow(/not found/i);
    expect(() => app.matches.recordConfirmedResult({ ...input, winnerId: other })).toThrow(/winner/i);
    app.tournaments.report(t.id, app.p1, app.p2, app.p1);
    expect(() => app.matches.recordConfirmedResult(input)).toThrow(/pending/i);
    expect((app.db.prepare("select count(*) as c from matches").get() as { c: number }).c).toBe(1);

    const fresh = setup();
    const { slot: slot2 } = tournamentSlot(fresh);
    const input2 = { guildId: "g1", playerOneId: fresh.p1, playerTwoId: fresh.p2, winnerId: fresh.p1, source: "tournament" as const, tournamentMatchId: slot2.id };
    fresh.matches.recordConfirmedResult(input2);
    expect(() => fresh.matches.recordConfirmedResult(input2)).toThrow(/already completed/i);
    expect((fresh.db.prepare("select count(*) as c from matches").get() as { c: number }).c).toBe(1);
  });

  it("works inside an outer transaction and rolls back with it", () => {
    const app = setup();
    const { slot } = tournamentSlot(app);
    const run = app.db.transaction(() => {
      app.matches.recordConfirmedResult({
        guildId: "g1",
        playerOneId: app.p1,
        playerTwoId: app.p2,
        winnerId: app.p1,
        source: "tournament",
        tournamentMatchId: slot.id,
      });
      throw new Error("abort");
    });
    expect(run).toThrow("abort");
    expect((app.db.prepare("select count(*) as c from matches").get() as { c: number }).c).toBe(0);
    expect((app.db.prepare("select status from tournament_matches where id = ?").get(slot.id) as any).status).toBe("open");
  });

  it.each([
    ["confirmed", "match_win"], ["confirmed", "placement"],
    ["approve", "match_win"], ["approve", "placement"],
    ["autoApprove", "match_win"], ["autoApprove", "placement"],
  ] as const)("keeps %s scoring best-effort when %s awards fail", (caller, kind) => {
    const app = setup();
    const { t, slot } = tournamentSlot(app);
    const pending = caller === "confirmed" ? null : app.tournaments.reportTournamentMatch(slot.id, app.p1, app.p1);
    app.db.exec(`
      create temp trigger fail_scoring before insert on point_awards
      when new.kind = '${kind}'
      begin select raise(abort, 'forced scoring failure'); end;
    `);
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const match = caller === "confirmed"
        ? app.matches.recordConfirmedResult({
          guildId: "g1", playerOneId: app.p1, playerTwoId: app.p2, winnerId: app.p1,
          source: "tournament", tournamentMatchId: slot.id,
        })
        : caller === "approve" ? app.matches.approve(pending!.id, app.p2) : app.matches.autoApprove(pending!.id);
      expect(match.status).toBe("approved");
      expect(app.tournaments.findById(t.id).status).toBe("completed");
      expect(app.db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id))
        .toEqual({ status: "completed", match_id: match.id });
      expect(app.db.prepare("select * from point_awards where kind = ?").all(kind)).toEqual([]);
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });
});

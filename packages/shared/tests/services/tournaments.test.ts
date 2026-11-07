import { createTournamentVisibilityService } from "../../src/services/tournament-visibility.js";
import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createTournamentRemoteService } from "../../src/services/tournament-remote.js";
import { createRemoteDuelService } from "../../src/services/remote-duels.js";
import { createTournamentDuelService } from "../../src/services/tournament-duels.js";
import { createMatchService } from "../../src/services/matches.js";
import { DEFAULT_REPORT_CONFIRM_HOURS } from "../../src/services/constants.js";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  return { db, tournaments: createTournamentService(db) };
}

function insertPlayer(db: Database.Database, guildId: string, discordUserId: string, name: string) {
  const r = seedIdentity(db, { guildId: guildId, name: name, userId: seedUser(db, discordUserId).userId, discordUserId: seedUser(db, discordUserId).discordUserId ?? discordUserId });
  return r.playerId;
}

describe("tournaments service", () => {
  it("blocks unavailable Remote pairings and ends their tables when results or tournaments close", () => {
    const { db, tournaments } = setup();
    try {
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const bob = insertPlayer(db, "g1", "u-bob", "Bob");
      const carol = insertPlayer(db, "g1", "u-carol", "Carol");
      const host = seedUser(db, "u-alice").userId;
      const guest = seedUser(db, "u-bob").userId;
      const remote = createRemoteDuelService(db);
      const rooms = createTournamentRemoteService(db);
      const matches = createMatchService(db);
      const organizer = createTournamentDuelService(db);
      const fixture = (name: string) => {
        const tournament = tournaments.create("g1", name, "round_robin", host, { duelType: "remote", bestOf: 1 });
        for (const player of [alice, bob, carol]) tournaments.join(tournament.id, player);
        tournaments.start(tournament.id);
        const slot = tournaments.openMatches(tournament.id).find(slot =>
          [slot.playerOneId, slot.playerTwoId].includes(alice) && [slot.playerOneId, slot.playerTwoId].includes(bob))!;
        const input = { guildId: "g1", tournamentId: tournament.id, tournamentMatchId: slot.id, actorUserId: host };
        const { table } = rooms.startMatch(input);
        remote.join(table.slug, "g1", guest, "Bob");
        remote.ready(table.slug, "g1", host, true);
        remote.ready(table.slug, "g1", guest, true);
        return { tournament, slot, input, table };
      };
      const guarded = fixture("Guarded");
      const expectUnavailable = () => {
        expect(() => remote.join(guarded.table.slug, "g1", guest, "Bob"))
          .toThrow(expect.objectContaining({ code: "TOURNAMENT_MATCH_UNAVAILABLE", status: 409 }));
        expect(() => remote.start(guarded.table.slug, "g1", host))
          .toThrow(expect.objectContaining({ code: "TOURNAMENT_MATCH_UNAVAILABLE", status: 409 }));
      };
      for (const status of ["pending_approval", "completed"]) {
        db.prepare("update tournament_matches set status=? where id=?").run(status, guarded.slot.id);
        expectUnavailable();
      }
      db.prepare("update tournament_matches set status='open' where id=?").run(guarded.slot.id);
      for (const status of ["proposed", "disputed", "final", "void"]) {
        db.prepare("update tournament_remote_matches set status=? where tournament_match_id=?").run(status, guarded.slot.id);
        expectUnavailable();
      }
      db.prepare("update tournament_remote_matches set status='playing' where tournament_match_id=?").run(guarded.slot.id);
      expect(remote.start(guarded.table.slug, "g1", host).status).toBe("active");

      for (const action of ["cancel", "complete", "deadline", "organizer", "approve", "confirmed", "void"] as const) {
        for (const status of ["lobby", "active", "game"] as const) {
          const { tournament, slot, table, input } = fixture(`${action}-${status}`);
          if (status !== "lobby") {
            const started = remote.start(table.slug, "g1", host);
            if (status === "game") remote.act(table.slug, "g1", guest, { baseSeq: started.lastSeq,
              action: { type: "player.concede", actorSeat: 1, idempotencyKey: "concede" } });
          }
          if (action === "cancel") tournaments.cancel(tournament.id);
          if (action === "complete") tournaments.complete(tournament.id);
          if (action === "deadline") tournaments.closeForDeadline(tournament.id);
          if (action === "organizer") organizer.setResultByOrganizer({ tournamentMatchId: slot.id, organizerUserId: host, winnerPlayerId: alice });
          if (action === "approve") {
            const report = tournaments.reportTournamentMatch(slot.id, alice, alice);
            matches.approve(report.id, bob);
          }
          if (action === "confirmed") matches.recordConfirmedResult({ guildId: "g1", playerOneId: alice, playerTwoId: bob,
            winnerId: alice, source: "tournament", tournamentMatchId: slot.id });
          if (action === "void") {
            // A legacy completed slot can still have an open linked room when its result is voided.
            const result = matches.report({ guildId: "g1", reporterId: alice, opponentId: bob, winnerId: alice,
              source: "tournament", tournamentId: tournament.id });
            db.prepare("update tournament_matches set status='completed',match_id=? where id=?").run(result.id, slot.id);
            tournaments.reopenTournamentMatch(slot.id, host);
          }
          const ended = remote.snapshot(table.slug, "g1", host);
          expect(ended.table).toMatchObject({ status: "ended", endedAt: expect.any(Number), endReason: expect.any(String) });
          expect(ended.events.at(-1)?.action.type).toBe("table.ended");
          expect(() => remote.join(table.slug, "g1", guest, "Bob")).toThrow(expect.objectContaining({ code: "TABLE_ENDED" }));
          expect(() => remote.start(table.slug, "g1", host)).toThrow(expect.objectContaining({ code: "TABLE_ENDED" }));
          if (status === "game") expect(() => remote.act(table.slug, "g1", guest, { baseSeq: ended.table.lastSeq,
            action: { type: "undo", actorSeat: 1, idempotencyKey: "undo-result", targetActionId: "concede" } }))
            .toThrow(expect.objectContaining({ code: "TABLE_ENDED" }));
          if (action === "void") {
            expect(db.prepare("select status from tournament_remote_matches where tournament_match_id=?").get(slot.id)).toEqual({ status: "void" });
            const replacement = rooms.startMatch(input);
            expect(replacement.created).toBe(true);
            expect(replacement.table.slug).not.toBe(table.slug);
          }
        }
      }
      expect(remote.snapshot(guarded.table.slug, "g1", host).table.status).toBe("active");
    } finally {
      vi.unstubAllEnvs();
      db.close();
    }
  });

  it("enforces Remote duel type and entrant access at join and start without changing online tournaments", () => {
    const { db, tournaments } = setup();
    const alice = insertPlayer(db, "g1", "u-alice", "Alice");
    const bob = insertPlayer(db, "g1", "u-bob", "Bob");
    const aliceUser = seedUser(db, "u-alice").userId;
    const bobUser = seedUser(db, "u-bob").userId;
    try {
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", String(aliceUser));
      const online = tournaments.create("g1", "Online", "round_robin", aliceUser);
      expect(online.duelType).toBe("online");
      // Upgrade an existing row from the pre-B1 shape, then repeat migration below.
      db.exec("alter table tournaments drop column duel_type");
      migrate(db);
      expect(tournaments.findById(online.id).duelType).toBe("online");
      expect(() => tournaments.create("g1", "Invalid", "round_robin", aliceUser, { duelType: "either" as never }))
        .toThrow(/duel type/i);
      expect(() => tournaments.create("g1", "No access", "round_robin", bobUser, { duelType: "remote" }))
        .toThrow(/Ask for access/i);
      expect(() => tournaments.create("g1", "Domain", "round_robin", aliceUser, { duelType: "remote", duelRules: { mode: "domain" } }))
        .toThrow(/Advanced/i);
      const remote = tournaments.create("g1", "Remote", "round_robin", aliceUser, { duelType: "remote" });
      expect(remote.duelType).toBe("remote");
      const invites = createTournamentVisibilityService(db);
      const code = invites.invite(remote.webSlug!, "g1", aliceUser);
      expect(() => invites.admit(remote.webSlug!, "g1", bobUser, code)).toThrow(/Ask for access/i);
      tournaments.join(remote.id, alice);
      expect(() => tournaments.join(remote.id, bob)).toThrow(/Ask for access/i);
      expect(tournaments.participants(remote.id)).toEqual([alice]);
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      invites.admit(remote.webSlug!, "g1", bobUser, code);
      tournaments.join(remote.id, bob);
      vi.stubEnv("REMOTE_DUELS_USERS", String(aliceUser));
      expect(() => tournaments.start(remote.id)).toThrow(expect.objectContaining({
        code: "REMOTE_ENTRANTS_BLOCKED", status: 409, entrants: [{ playerId: bob, displayName: "Bob" }],
      }));
      expect(tournaments.findById(remote.id).status).toBe("pending");
      expect(tournaments.matches(remote.id)).toHaveLength(0);
      vi.stubEnv("REMOTE_DUELS", "0");
      expect(() => tournaments.create("g1", "Disabled", "round_robin", aliceUser, { duelType: "remote" })).toThrow(/disabled/i);
      expect(() => tournaments.start(remote.id)).toThrow(/disabled/i);
      // A closed rollout must have no effect on engine tournament entries or starts.
      tournaments.join(online.id, alice);
      tournaments.join(online.id, bob);
      expect(tournaments.start(online.id).status).toBe("active");
      vi.stubEnv("REMOTE_DUELS", "1");
      vi.stubEnv("REMOTE_DUELS_USERS", "*");
      expect(tournaments.start(remote.id).status).toBe("active");
      migrate(db); // migrations remain idempotent with linked tournament data present
      expect(tournaments.findById(remote.id).duelType).toBe("remote");
    } finally {
      vi.unstubAllEnvs();
      db.close();
    }
  });

  describe("leave", () => {
    it("removes a participant from a pending tournament", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);
      tournaments.join(t.id, alice);

      tournaments.leave(t.id, alice);

      expect(tournaments.participants(t.id)).toEqual([]);
    });

    it("throws when the tournament is not pending", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const bob = insertPlayer(db, "g1", "u-bob", "Bob");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);
      tournaments.join(t.id, alice);
      tournaments.join(t.id, bob);
      tournaments.start(t.id);

      expect(() => tournaments.leave(t.id, alice)).toThrow(/already started/i);
    });

    it("throws when the participant is not in the tournament", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);

      expect(() => tournaments.leave(t.id, alice)).toThrow(/not a participant|not joined/i);
    });
  });

  describe("kick", () => {
    it("lets the organizer remove a participant from a pending tournament", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const bob = insertPlayer(db, "g1", "u-bob", "Bob");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);
      tournaments.join(t.id, alice);
      tournaments.join(t.id, bob);

      tournaments.kick(t.id, seedUser(db, "u-alice").userId, bob);

      expect(tournaments.participants(t.id)).toEqual([alice]);
    });

    it("rejects kick when caller is not the organizer", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const bob = insertPlayer(db, "g1", "u-bob", "Bob");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);
      tournaments.join(t.id, bob);

      expect(() => tournaments.kick(t.id, seedUser(db, "u-bob").userId, bob)).toThrow(/only the organizer/i);
    });

    it("rejects kick when the tournament is not pending", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const bob = insertPlayer(db, "g1", "u-bob", "Bob");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);
      tournaments.join(t.id, alice);
      tournaments.join(t.id, bob);
      tournaments.start(t.id);

      expect(() => tournaments.kick(t.id, seedUser(db, "u-alice").userId, bob)).toThrow(/already started/i);
    });
  });

  describe("participantCount", () => {
    it("returns the number of participants", () => {
      const { db, tournaments } = setup();
      const alice = insertPlayer(db, "g1", "u-alice", "Alice");
      const bob = insertPlayer(db, "g1", "u-bob", "Bob");
      const t = tournaments.create("g1", "T", "round_robin", seedUser(db, "u-alice").userId);
      tournaments.join(t.id, alice);
      tournaments.join(t.id, bob);

      expect(tournaments.participantCount(t.id)).toBe(2);
    });
  });
});

describe("tournaments timing settings", () => {
  it("create stores deadlineAt and reportConfirmWindowHours when provided", () => {
    const { db, tournaments } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId, {
      deadlineAt: "2099-01-01T00:00:00.000Z",
      reportConfirmWindowHours: 6,
    });
    expect(t.deadlineAt).toBe("2099-01-01T00:00:00.000Z");
    expect(t.reportConfirmWindowHours).toBe(6);
  });

  it("create leaves both null when options omitted", () => {
    const { db, tournaments } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    expect(t.deadlineAt).toBeUndefined();
    expect(t.reportConfirmWindowHours).toBeUndefined();
  });

  it("updateSettings patches only provided keys", () => {
    const { db, tournaments } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId, { reportConfirmWindowHours: 6 });
    const u = tournaments.updateSettings(t.id, { deadlineAt: "2099-02-02T00:00:00.000Z" });
    expect(u.deadlineAt).toBe("2099-02-02T00:00:00.000Z");
    expect(u.reportConfirmWindowHours).toBe(6); // untouched
    const cleared = tournaments.updateSettings(t.id, { deadlineAt: null });
    expect(cleared.deadlineAt).toBeUndefined();
  });

  it("updateSettings rejects an out-of-range window", () => {
    const { db, tournaments } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    expect(() => tournaments.updateSettings(t.id, { reportConfirmWindowHours: 0 })).toThrow();
    expect(() => tournaments.updateSettings(t.id, { reportConfirmWindowHours: 721 })).toThrow();
  });

  it("updateSettings throws when tournament is completed", () => {
    const { tournaments, db } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    db.prepare("update tournaments set status = 'completed' where id = ?").run(t.id);
    expect(() => tournaments.updateSettings(t.id, { reportConfirmWindowHours: 6 })).toThrow();
  });

  it("closeForDeadline completes an active tournament and is a no-op otherwise", () => {
    const { tournaments, db } = setup();
    const p1 = insertPlayer(db, "g1", "u1", "Yugi");
    const p2 = insertPlayer(db, "g1", "u2", "Kaiba");
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    tournaments.join(t.id, p1);
    tournaments.join(t.id, p2);
    tournaments.start(t.id); // -> active
    const closed = tournaments.closeForDeadline(t.id);
    expect(closed.status).toBe("completed");
    const endedAt = db.prepare("select ended_at from tournaments where id = ?").get(t.id) as { ended_at: string | null };
    expect(endedAt.ended_at).not.toBeNull();
    // idempotent: second call no longer active -> returns completed, leaves it completed
    expect(tournaments.closeForDeadline(t.id).status).toBe("completed");
  });

  it("findOverdueActive returns only active tournaments with deadline_at <= now", () => {
    const { tournaments, db } = setup();
    const p1 = insertPlayer(db, "g1", "u1", "Yugi");
    const p2 = insertPlayer(db, "g1", "u2", "Kaiba");
    const overdue = tournaments.create("g1", "Past", "round_robin", seedUser(db, "u1").userId, { deadlineAt: "2000-01-01T00:00:00.000Z" });
    const future = tournaments.create("g1", "Future", "round_robin", seedUser(db, "u1").userId, { deadlineAt: "2999-01-01T00:00:00.000Z" });
    const noDeadline = tournaments.create("g1", "None", "round_robin", seedUser(db, "u1").userId);
    for (const t of [overdue, future, noDeadline]) {
      tournaments.join(t.id, p1);
      tournaments.join(t.id, p2);
      tournaments.start(t.id);
    }
    const found = tournaments.findOverdueActive("2026-05-20T00:00:00.000Z");
    expect(found.map((t) => t.id)).toEqual([overdue.id]);
  });

  it("DEFAULT_REPORT_CONFIRM_HOURS is 24", () => {
    expect(DEFAULT_REPORT_CONFIRM_HOURS).toBe(24);
  });
});

describe("tournaments complete (manual early finish)", () => {
  it("completes an active tournament and stamps ended_at", () => {
    const { tournaments, db } = setup();
    const p1 = insertPlayer(db, "g1", "u1", "Yugi");
    const p2 = insertPlayer(db, "g1", "u2", "Kaiba");
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    tournaments.join(t.id, p1);
    tournaments.join(t.id, p2);
    tournaments.start(t.id); // -> active

    const completed = tournaments.complete(t.id);

    expect(completed.status).toBe("completed");
    const row = db
      .prepare("select ended_at from tournaments where id = ?")
      .get(t.id) as { ended_at: string | null };
    expect(row.ended_at).not.toBeNull();
  });

  it("throws when the tournament is still pending (never started)", () => {
    const { db, tournaments } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    expect(() => tournaments.complete(t.id)).toThrow(/cannot be completed/i);
  });

  it("throws when the tournament is already completed", () => {
    const { tournaments, db } = setup();
    const t = tournaments.create("g1", "Cup", "round_robin", seedUser(db, "u1").userId);
    db.prepare("update tournaments set status = 'completed' where id = ?").run(t.id);
    expect(() => tournaments.complete(t.id)).toThrow(/cannot be completed/i);
  });
});

it.each(["manual", "deadline"])("records tournament creation, joins and %s completion atomically", finish => {
  const { db, tournaments } = setup();
  try {
    const player = insertPlayer(db, "g", "one", "One");
    const other = insertPlayer(db, "g", "two", "Two");
    const owner = seedUser(db, "one").userId;
    const t = tournaments.create("g", "Private tournament", "round_robin", owner);
    tournaments.join(t.id, player); tournaments.join(t.id, other); tournaments.start(t.id);
    db.exec("create trigger reject_event before insert on product_events when new.name='tournament_finished' begin select raise(abort, 'record failed'); end");
    const complete = () => finish === "manual" ? tournaments.complete(t.id) : tournaments.closeForDeadline(t.id);
    expect(complete).toThrow("record failed");
    expect(tournaments.findById(t.id).status).toBe("active");
    db.exec("drop trigger reject_event"); complete();
    if (finish === "deadline") complete();
    expect(db.prepare("select name,user_id,props_json from product_events order by id").all()).toEqual([
      { name: "tournament_created", user_id: owner, props_json: '{"format":"round_robin","participantCount":0}' },
      { name: "tournament_joined", user_id: owner, props_json: '{"format":"round_robin","participantCount":1}' },
      { name: "tournament_joined", user_id: seedUser(db, "two").userId, props_json: '{"format":"round_robin","participantCount":2}' },
      { name: "tournament_finished", user_id: owner, props_json: '{"format":"round_robin","participantCount":2}' },
    ]);
  } finally { db.close(); }
});

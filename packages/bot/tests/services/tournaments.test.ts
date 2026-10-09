import { createUserService } from "@yugidraft/shared/services";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createPlayerRepository } from "../../src/repositories/players.js";
import { createMatchService } from "@yugidraft/shared/services";
import { createTournamentService } from "@yugidraft/shared/services";

function setup() {
  const db = new Database(":memory:");
  migrate(db);

  return {
    db,
    matches: createMatchService(db),
    players: createPlayerRepository(db),
    tournaments: createTournamentService(db),
  };
}

describe("tournament service", () => {
  it("creates multiple tournaments in one guild", () => {
    const app = setup();

    const locals = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const finals = app.tournaments.create("guild-1", "finals", "single_elim", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    expect(locals.name).toBe("locals");
    expect(finals.name).toBe("finals");
    expect(locals.id).not.toBe(finals.id);
  });

  it("allows players to join before a tournament starts", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");

    app.tournaments.join(tournament.id, yugi.id);

    expect(app.tournaments.participants(tournament.id)).toEqual([yugi.id]);
  });

  it("does not duplicate tournament participants", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");

    app.tournaments.join(tournament.id, yugi.id);

    expect(() => app.tournaments.join(tournament.id, yugi.id)).toThrow("You have already joined this tournament");

    expect(app.tournaments.participants(tournament.id)).toEqual([yugi.id]);
  });

  it("lists tournament participant records in join order", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");
    const joey = app.players.upsert("guild-1", "900000000000000114", "Joey");

    app.tournaments.join(tournament.id, joey.id);
    app.tournaments.join(tournament.id, yugi.id);
    app.tournaments.join(tournament.id, kaiba.id);

    expect(app.tournaments.participantRecords(tournament.id)).toEqual([
      { playerId: joey.id, displayName: "Joey" },
      { playerId: yugi.id, displayName: "Yugi" },
      { playerId: kaiba.id, displayName: "Kaiba" },
    ]);
  });

  it("returns no participant records for an empty tournament", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    expect(app.tournaments.participantRecords(tournament.id)).toEqual([]);
  });

  it("prevents players from joining after a tournament starts", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");
    const joey = app.players.upsert("guild-1", "900000000000000114", "Joey");

    app.tournaments.join(tournament.id, yugi.id);
    app.tournaments.join(tournament.id, kaiba.id);
    app.tournaments.start(tournament.id);

    expect(() => app.tournaments.join(tournament.id, joey.id)).toThrow(
      "Tournament has already started",
    );
  });

  it("cancels a tournament", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    expect(app.tournaments.cancel(tournament.id).status).toBe("cancelled");
  });

  it("allows reusing a tournament name after cancellation", () => {
    const app = setup();
    const cancelled = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    app.tournaments.cancel(cancelled.id);
    const replacement = app.tournaments.create("guild-1", "locals", "single_elim", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    expect(replacement.id).not.toBe(cancelled.id);
    expect(replacement.name).toBe("locals");
    expect(replacement.status).toBe("pending");
    expect(app.tournaments.findByName("guild-1", "locals")?.id).toBe(replacement.id);
  });

  it("prevents duplicate pending tournament names", () => {
    const app = setup();

    app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    expect(() => app.tournaments.create("guild-1", "locals", "single_elim", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id)).toThrow(
      "You already have a tournament called this that hasn't finished.",
    );
  });

  it("lists tournaments by status within a guild", () => {
    const app = setup();
    const pending = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const cancelled = app.tournaments.create("guild-1", "finals", "single_elim", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    app.tournaments.create("guild-2", "remote", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    app.tournaments.cancel(cancelled.id);

    expect(app.tournaments.listByStatus("guild-1", ["pending", "cancelled"])).toEqual([
      expect.objectContaining({ id: pending.id, guildId: "guild-1", status: "pending" }),
      expect.objectContaining({ id: cancelled.id, guildId: "guild-1", status: "cancelled" }),
    ]);
  });

  it("lists active tournaments where a player participates", () => {
    const app = setup();
    const active = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const pending = app.tournaments.create("guild-1", "finals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const remote = app.tournaments.create("guild-2", "remote", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");
    const remoteYugi = app.players.upsert("guild-2", "900000000000000112", "Yugi");
    const remoteKaiba = app.players.upsert("guild-2", "900000000000000113", "Kaiba");

    for (const tournament of [active, pending]) {
      app.tournaments.join(tournament.id, yugi.id);
      app.tournaments.join(tournament.id, kaiba.id);
    }
    app.tournaments.join(remote.id, remoteYugi.id);
    app.tournaments.join(remote.id, remoteKaiba.id);
    app.tournaments.start(active.id);
    app.tournaments.start(remote.id);

    expect(app.tournaments.activeForPlayer("guild-1", yugi.id)).toEqual([
      expect.objectContaining({ id: active.id, guildId: "guild-1", status: "active" }),
    ]);
  });

  it("autocompletes at most 25 case-insensitive guild-scoped matches", () => {
    const app = setup();

    for (let index = 1; index <= 30; index += 1) {
      app.tournaments.create("guild-1", `Locals ${index.toString().padStart(2, "0")}`, "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    }
    app.tournaments.create("guild-2", "Locals remote", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);

    const results = app.tournaments.autocomplete({ guildId: "guild-1", query: "locals" });

    expect(results).toHaveLength(25);
    expect(results[0]).toEqual(expect.objectContaining({ name: "Locals 01" }));
    expect(results.at(-1)).toEqual(expect.objectContaining({ name: "Locals 25" }));
    expect(results.every((tournament) => tournament.guildId === "guild-1")).toBe(true);
  });

  it("autocompletes by status, creator, and participant", () => {
    const app = setup();
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");
    const target = app.tournaments.create("guild-1", "Spring Locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000104", displayName: "Host" }).id);
    const wrongStatus = app.tournaments.create("guild-1", "Spring Finals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000104", displayName: "Host" }).id);
    const wrongCreator = app.tournaments.create("guild-1", "Spring Remote", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000119", displayName: "Host" }).id);
    const wrongParticipant = app.tournaments.create("guild-1", "Spring Side", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000104", displayName: "Host" }).id);

    app.tournaments.join(target.id, yugi.id);
    app.tournaments.join(wrongStatus.id, yugi.id);
    app.tournaments.join(wrongCreator.id, yugi.id);
    app.tournaments.join(wrongParticipant.id, kaiba.id);
    app.tournaments.cancel(wrongStatus.id);

    expect(
      app.tournaments.autocomplete({
        guildId: "guild-1",
        query: "spring",
        statuses: ["pending"],
        createdByUserId: createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000104", displayName: "Host" }).id,
        participantPlayerId: yugi.id,
      }),
    ).toEqual([expect.objectContaining({ id: target.id, name: "Spring Locals" })]);
  });

  it("refuses to cancel a tournament that is already cancelled", () => {
    const app = setup();
    const yugi = app.players.upsert("g1", "900000000000000110", "Yugi");
    const kaiba = app.players.upsert("g1", "900000000000000111", "Kaiba");
    const t = app.tournaments.create("g1", "Locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000110", displayName: "Host" }).id);
    app.tournaments.join(t.id, yugi.id);
    app.tournaments.join(t.id, kaiba.id);
    app.tournaments.start(t.id);
    app.tournaments.cancel(t.id);

    expect(() => app.tournaments.cancel(t.id)).toThrow(/cannot be cancelled/i);
  });

  it("counts tournament stats from approved tournament matches only", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const otherTournament = app.tournaments.create("guild-1", "finals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");

    const approvedWin = app.matches.report({
      guildId: "guild-1",
      reporterId: yugi.id,
      opponentId: kaiba.id,
      winnerId: yugi.id,
      source: "tournament",
      tournamentId: tournament.id,
    });
    const pendingLoss = app.matches.report({
      guildId: "guild-1",
      reporterId: kaiba.id,
      opponentId: yugi.id,
      winnerId: kaiba.id,
      source: "tournament",
      tournamentId: tournament.id,
    });
    const otherTournamentLoss = app.matches.report({
      guildId: "guild-1",
      reporterId: kaiba.id,
      opponentId: yugi.id,
      winnerId: kaiba.id,
      source: "tournament",
      tournamentId: otherTournament.id,
    });
    const casualLoss = app.matches.report({
      guildId: "guild-1",
      reporterId: kaiba.id,
      opponentId: yugi.id,
      winnerId: kaiba.id,
      source: "casual",
    });

    app.matches.approve(approvedWin.id, kaiba.id);
    app.matches.approve(otherTournamentLoss.id, yugi.id);
    app.matches.approve(casualLoss.id, yugi.id);

    expect(pendingLoss.status).toBe("pending");
    expect(app.tournaments.stats(tournament.id, yugi.id)).toEqual({ wins: 1, losses: 0 });
  });
});

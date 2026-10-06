import { createUserService } from "@yugidraft/shared/services";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createPlayerRepository } from "../../src/repositories/players.js";
import { createMatchService } from "@yugidraft/shared/services";
import { createTournamentService } from "@yugidraft/shared/services";
import { selectTournamentReminderTargets } from "../../src/reminders/tournament-reminders.js";

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

describe("tournament reminders", () => {
  it("selects open round robin tournament matches", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");

    app.tournaments.join(tournament.id, yugi.id);
    app.tournaments.join(tournament.id, kaiba.id);
    app.tournaments.start(tournament.id);

    expect(selectTournamentReminderTargets(app.db)).toEqual([
      {
        guildId: "guild-1",
        tournamentName: "locals",
        roundNumber: 1,
        playerOneDiscordUserId: "900000000000000112",
        playerTwoDiscordUserId: "900000000000000113",
      },
    ]);
  });

  it("does not select completed tournament matches", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");

    app.tournaments.join(tournament.id, yugi.id);
    app.tournaments.join(tournament.id, kaiba.id);
    app.tournaments.start(tournament.id);
    const report = app.tournaments.report(tournament.id, yugi.id, kaiba.id, yugi.id);
    app.matches.approve(report.id, kaiba.id);

    expect(selectTournamentReminderTargets(app.db)).toEqual([]);
  });

  it("does not select matches waiting on approval", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");

    app.tournaments.join(tournament.id, yugi.id);
    app.tournaments.join(tournament.id, kaiba.id);
    app.tournaments.start(tournament.id);
    app.tournaments.report(tournament.id, yugi.id, kaiba.id, yugi.id);

    expect(selectTournamentReminderTargets(app.db)).toEqual([]);
  });

  it("can filter reminders to one guild", () => {
    const app = setup();
    const guildOneTournament = app.tournaments.create("guild-1", "locals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const guildTwoTournament = app.tournaments.create("guild-2", "regionals", "round_robin", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000114", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");
    const joey = app.players.upsert("guild-2", "900000000000000114", "Joey");
    const mai = app.players.upsert("guild-2", "900000000000000115", "Mai");

    app.tournaments.join(guildOneTournament.id, yugi.id);
    app.tournaments.join(guildOneTournament.id, kaiba.id);
    app.tournaments.start(guildOneTournament.id);
    app.tournaments.join(guildTwoTournament.id, joey.id);
    app.tournaments.join(guildTwoTournament.id, mai.id);
    app.tournaments.start(guildTwoTournament.id);

    expect(selectTournamentReminderTargets(app.db, "guild-2")).toEqual([
      expect.objectContaining({ guildId: "guild-2", tournamentName: "regionals" }),
    ]);
  });

  it("selects only active single elimination matches", () => {
    const app = setup();
    const tournament = app.tournaments.create("guild-1", "finals", "single_elim", createUserService(app.db).ensureDiscord({ discordUserId: "900000000000000112", displayName: "Host" }).id);
    const yugi = app.players.upsert("guild-1", "900000000000000112", "Yugi");
    const kaiba = app.players.upsert("guild-1", "900000000000000113", "Kaiba");
    const joey = app.players.upsert("guild-1", "900000000000000114", "Joey");
    const mai = app.players.upsert("guild-1", "900000000000000115", "Mai");

    for (const player of [yugi, kaiba, joey, mai]) {
      app.tournaments.join(tournament.id, player.id);
    }

    app.tournaments.start(tournament.id);

    expect(selectTournamentReminderTargets(app.db)).toEqual([
      expect.objectContaining({ tournamentName: "finals", playerOneDiscordUserId: "900000000000000112", playerTwoDiscordUserId: "900000000000000115" }),
      expect.objectContaining({ tournamentName: "finals", playerOneDiscordUserId: "900000000000000113", playerTwoDiscordUserId: "900000000000000114" }),
    ]);
  });
});

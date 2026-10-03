import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { eloStakes } from "../../src/scoring/elo.js";
import { projectMatch } from "../../src/scoring/projection.js";
import { createMatchService } from "../../src/services/matches.js";
import { createTournamentService } from "../../src/services/tournaments.js";

/** Plays one tournament match through the real result path and returns each side's Elo change. */
function playTournamentMatch(eloA: number, eloB: number, winner: "a" | "b") {
  const db = new Database(":memory:");
  migrate(db);
  const player = (user: string) =>
    Number(db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g', ?, ?)").run(user, user).lastInsertRowid);
  const a = player("a");
  const b = player("b");
  const setElo = db.prepare("insert into player_ratings (guild_id, player_id, elo) values ('g', ?, ?)");
  setElo.run(a, eloA);
  setElo.run(b, eloB);
  const tournaments = createTournamentService(db);
  const t = tournaments.create("g", "Cup", "single_elim", "org");
  tournaments.join(t.id, a);
  tournaments.join(t.id, b);
  tournaments.start(t.id);
  const slot = db.prepare("select * from tournament_matches where tournament_id = ?").get(t.id) as { id: number };
  createMatchService(db).recordConfirmedResult({
    guildId: "g",
    playerOneId: a,
    playerTwoId: b,
    winnerId: winner === "a" ? a : b,
    source: "tournament",
    tournamentMatchId: slot.id,
  });
  const elo = (id: number) => (db.prepare("select elo from player_ratings where player_id = ?").get(id) as { elo: number }).elo;
  const result = { a: elo(a) - eloA, b: elo(b) - eloB };
  db.close();
  return result;
}

const PAIRS: Array<[number, number]> = [[1000, 1000], [1400, 1000], [800, 1300], [1599, 1601], [1000, 1500], [1250, 1251], [2000, 900]];

describe("eloStakes", () => {
  it("matches what a rated tournament match really applies, for either winner", () => {
    for (const [eloA, eloB] of PAIRS) {
      const aWins = playTournamentMatch(eloA, eloB, "a");
      const bWins = playTournamentMatch(eloA, eloB, "b");
      const stakesA = eloStakes(eloA, eloB);
      const stakesB = eloStakes(eloB, eloA);
      expect({ pair: [eloA, eloB], a: aWins.a, b: aWins.b }).toEqual({ pair: [eloA, eloB], a: stakesA.win, b: stakesB.loss });
      expect({ pair: [eloA, eloB], a: bWins.a, b: bWins.b }).toEqual({ pair: [eloA, eloB], a: stakesA.loss, b: stakesB.win });
    }
  });

  it("gives equal players +16 and -16", () => {
    expect(eloStakes(1000, 1000)).toEqual({ win: 16, loss: -16 });
  });

  it("risks more against a weaker player and gains more against a stronger one", () => {
    const strong = eloStakes(1400, 1000);
    const weak = eloStakes(1000, 1400);
    expect(strong.win).toBeLessThan(weak.win);
    expect(Math.abs(strong.loss)).toBeGreaterThan(Math.abs(weak.loss));
  });

  it("is what the match projection reports", () => {
    for (const [mine, theirs] of PAIRS) {
      const projection = projectMatch({ myElo: mine, oppElo: theirs, seasonMultiplier: 1 });
      expect({ win: projection.winRating, loss: projection.loseRating }).toEqual(eloStakes(mine, theirs));
    }
  });
});

import Database from "better-sqlite3";
import { afterEach, expect, it } from "vitest";
import { migrate } from "../../src/db/schema.js";
import { createUserService } from "../../src/services/users.js";
import { createPlayerService } from "../../src/services/players.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createTournamentDuelService } from "../../src/services/tournament-duels.js";
import { createDraftDeckService, isTestBotDiscordId } from "../../src/services/draft-decks.js";

const handles: Database.Database[] = [];
function setup() {
  const db = new Database(":memory:");
  handles.push(db);
  migrate(db);
  db.pragma("foreign_keys=on");
  return { db, users: createUserService(db), players: createPlayerService(db) };
}
afterEach(() => { for (const db of handles.splice(0)) db.close(); });

it("shares a user across guilds and never changes a player ID", () => {
  const { db, users, players } = setup();
  const a = players.findOrCreateByDiscord("g", "900000000000000101", "A");
  const b = players.findOrCreateByDiscord("other", "900000000000000101", "B");
  expect(a.userId).toBe(b.userId);
  expect(a.id).not.toBe(b.id);
  expect(players.findOrCreate("g", a.userId, "Renamed").id).toBe(a.id);
  expect(players.findByGuildAndUser("g", a.userId)?.discordUserId).toBe("900000000000000101");
  expect(users.findById(a.userId)?.discordUserId).toBe(a.discordUserId);
  expect(db.pragma("foreign_key_check")).toEqual([]);
});

it("keeps email-only humans distinct from test bots", () => {
  const { users, players } = setup();
  const human = users.createNonLogin("Human");
  const p = players.findOrCreate("g", human.id, "Human");
  expect(p.discordUserId).toBeNull();
  expect(isTestBotDiscordId(p.discordUserId)).toBe(false);
  const bot = players.findOrCreateTestPlayer("g", "bot_player_dev_1", "Bot 1");
  expect(users.findById(bot.userId)?.discordUserId).toBeNull();
  expect(isTestBotDiscordId(bot.discordUserId)).toBe(true);
  expect(players.findOrCreateTestPlayer("g", "bot_player_dev_1", "Bot 1").id).toBe(bot.id);
  expect(players.findOrCreateTestPlayer("other", "bot_player_dev_1", "Bot 1").userId).toBe(bot.userId);
  expect(players.findOrCreate("g", bot.userId, "Bot renamed").discordUserId).toBe("bot_player_dev_1");
  expect(() => players.findOrCreateTestPlayer("g", "clerk:fake", "X")).toThrow();
  expect(() => players.findOrCreate("g", 0, "X")).toThrow("Invalid application user ID");
  expect(() => players.findOrCreate("g", 99999, "X")).toThrow("User not found");
});

it("registers an integer-owned deck and rejects another user's deck", () => {
  const { db, users, players } = setup();
  users.createNonLogin("Unseated actor");
  const a = players.findOrCreateByDiscord("g", "900000000000000101", "A");
  const b = players.findOrCreateByDiscord("g", "900000000000000102", "B");
  expect(a.userId).not.toBe(a.id);
  expect(b.userId).not.toBe(b.id);
  const tournaments = createTournamentService(db);
  const tournament = tournaments.create("g", "Cup", "round_robin", a.userId);
  tournaments.join(tournament.id, a.id);
  tournaments.join(tournament.id, b.id);
  const decks = createSavedDeckService(db);
  const deck = decks.create("g", a.userId, {
    name: "A", mode: "normal", deck: { main: [1], extra: [], side: [] },
  });
  const duels = createTournamentDuelService(db);
  expect(() => duels.registerDeck({
    tournamentId: tournament.id, playerId: b.id, savedDeckId: deck.id, deck: deck.deck,
  })).toThrow(/belongs to another player/);
  expect(() => duels.registerDeck({
    tournamentId: tournament.id, playerId: a.id, savedDeckId: deck.id, deck: deck.deck,
  })).not.toThrow();
  expect(createDraftDeckService(db).ensureForUser("g", a.userId)).toEqual([]);
});

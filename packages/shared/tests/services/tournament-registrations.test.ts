import { seedIdentity, seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createTournamentRegistrationService, deckRegistrationMark } from "../../src/services/tournament-registrations.js";

function setup() {
  const db = new Database(":memory:");
  migrate(db);
  db.pragma("foreign_keys = off");
  const player = (guild: string, user: string) =>
    seedIdentity(db, { guildId: guild, name: user, userId: seedUser(db, user).userId, discordUserId: seedUser(db, user).discordUserId ?? user }).playerId;
  const tournament = (name: string, status: string, guild = "g") =>
    Number(
      db.prepare("insert into tournaments (guild_id, name, format, status, created_by_user_id, web_slug) values (?, ?, 'single_elim', ?, ?, ?)").run(guild, name, status, seedUser(db, "org").userId, name.toLowerCase().replace(/ /g, "-")).lastInsertRowid,
    );
  const join = (tournamentId: number, playerId: number, reg?: { savedDeckId: number | null; locked?: boolean; at?: string }) => {
    db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tournamentId, playerId);
    if (reg) {
      db.prepare(
        "update tournament_participants set saved_deck_id = ?, deck_json = '{}', deck_registered_at = ?, deck_locked_at = ? where tournament_id = ? and player_id = ?",
      ).run(reg.savedDeckId, reg.at ?? "2026-10-01 10:00:00", reg.locked ? "2026-10-02 10:00:00" : null, tournamentId, playerId);
    }
  };
  return { db, service: createTournamentRegistrationService(db), player, tournament, join };
}

describe("deck registrations", () => {
  it("lists registered decks of pending and active tournaments only", () => {
    const { service, player, tournament, join } = setup();
    const me = player("g", "me");
    join(tournament("Cube cup 4", "pending"), me, { savedDeckId: 7 });
    join(tournament("Old cup", "completed"), me, { savedDeckId: 8 });
    join(tournament("Dropped cup", "cancelled"), me, { savedDeckId: 9 });
    join(tournament("No deck yet", "active"), me);
    join(tournament("Other guild", "active", "g2"), me, { savedDeckId: 10 });
    expect(service.deckRegistrations(me, "g")).toEqual([
      {
        savedDeckId: 7,
        draftId: null,
        tournament: { id: 1, slug: "cube-cup-4", name: "Cube cup 4", status: "pending" },
        registeredAt: "2026-10-01 10:00:00",
        lockedAt: null,
      },
    ]);
  });

  it("reports the draft of a draft tournament and the lock", () => {
    const { db, service, player, tournament, join } = setup();
    const me = player("g", "me");
    const t = tournament("Draft cup", "active");
    join(t, me, { savedDeckId: 3, locked: true });
    const draftId = Number(
      db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id, config_json, tournament_id) values ('g', 'c', 'D', 'completed', ?, '{}', ?)").run(seedUser(db, "org").userId, t).lastInsertRowid,
    );
    const [entry] = service.deckRegistrations(me, "g");
    expect(entry).toMatchObject({ savedDeckId: 3, draftId, lockedAt: "2026-10-02 10:00:00" });
    expect(deckRegistrationMark([entry], { draftId })).toEqual({ tournament: entry.tournament, locked: true });
  });

  it("only returns the asked player's decks, newest first", () => {
    const { service, player, tournament, join } = setup();
    const me = player("g", "me");
    const you = player("g", "you");
    join(tournament("A", "active"), me, { savedDeckId: 1, at: "2026-10-01 09:00:00" });
    join(tournament("B", "active"), me, { savedDeckId: 2, at: "2026-10-01 11:00:00" });
    join(tournament("C", "active"), you, { savedDeckId: 5 });
    expect(service.deckRegistrations(me, "g").map((entry) => entry.tournament.name)).toEqual(["B", "A"]);
    expect(service.deckRegistrations(you, "g").map((entry) => entry.savedDeckId)).toEqual([5]);
  });
});

describe("deckRegistrationMark", () => {
  const entry = (savedDeckId: number | null, name: string, status: string, lockedAt: string | null, draftId: number | null = null) => ({
    savedDeckId, draftId, registeredAt: null, lockedAt, tournament: { id: 1, slug: name, name, status },
  });

  it("is null when the deck is in no tournament", () => {
    expect(deckRegistrationMark([entry(1, "A", "active", null)], { savedDeckId: 2 })).toBeNull();
    expect(deckRegistrationMark([entry(1, "A", "active", null)], {})).toBeNull();
    expect(deckRegistrationMark([], { savedDeckId: 1 })).toBeNull();
  });

  it("prefers a locked registration, then an active tournament", () => {
    const regs = [entry(1, "pending", "pending", null), entry(1, "active", "active", null), entry(1, "locked", "active", "x")];
    expect(deckRegistrationMark(regs, { savedDeckId: 1 })?.tournament.name).toBe("locked");
    expect(deckRegistrationMark(regs.slice(0, 2), { savedDeckId: 1 })?.tournament.name).toBe("active");
    expect(deckRegistrationMark(regs.slice(0, 1), { savedDeckId: 1 })).toEqual({ tournament: regs[0].tournament, locked: false });
  });
});

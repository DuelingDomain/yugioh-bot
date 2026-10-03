import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";
import { createTournamentDuelService, TournamentDuelError } from "../../src/services/tournament-duels.js";
import { createTournamentService } from "../../src/services/tournaments.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

const deck = { main: [1, 2, 3], extra: [4], side: [5] };

function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  const tournaments = createTournamentService(db);
  const duels = createTournamentDuelService(db);
  const savedDecks = createSavedDeckService(db);
  const insertPlayer = (userId: string, name: string) =>
    Number(
      db
        .prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)")
        .run(userId, name).lastInsertRowid,
    );
  const alice = insertPlayer("u-alice", "Alice");
  const bob = insertPlayer("u-bob", "Bob");
  const carol = insertPlayer("u-carol", "Carol");
  const tournament = tournaments.create("g1", "Cup", "single_elim", "u-alice");
  tournaments.join(tournament.id, alice);
  tournaments.join(tournament.id, bob);
  return { db, tournaments, duels, savedDecks, alice, bob, carol, tournament };
}

function expectStatus(work: () => unknown, status: number) {
  try {
    work();
  } catch (error) {
    expect(error).toBeInstanceOf(TournamentDuelError);
    expect((error as TournamentDuelError).status).toBe(status);
    return;
  }
  throw new Error("expected TournamentDuelError");
}

function attachDraft(db: Database.Database, tournamentId: number) {
  const draftId = Number(
    db
      .prepare(
        `insert into drafts (guild_id, channel_id, name, status, created_by_user_id, tournament_id)
         values ('g1', 'ch', 'D', 'completed', 'u-alice', ?)`,
      )
      .run(tournamentId).lastInsertRowid,
  );
  return draftId;
}

describe("tournament duel rules", () => {
  it("defaults to best of 3 with a normal duel", () => {
    const { duels, tournament } = setup();
    const rules = duels.rules(tournament.id);
    expect(rules.bestOf).toBe(3);
    expect(rules.mode).toBe("normal");
    expect(rules.masterRule).toBe(5);
    expect(rules.settings.visibility).toBe("public");
    expect(tournament.bestOf).toBe(3);
  });

  it("stores bestOf and duel rules given at create and update", () => {
    const { db, tournaments, duels } = setup();
    const created = tournaments.create("g1", "Bo1 Cup", "round_robin", "u-alice", {
      bestOf: 1,
      duelRules: { mode: "domain", masterRule: 4 },
    });
    expect(created.bestOf).toBe(1);
    const rules = duels.rules(created.id);
    expect(rules.bestOf).toBe(1);
    expect(rules.mode).toBe("domain");
    expect(rules.masterRule).toBe(4);

    const updated = duels.setRules(created.id, "u-alice", { bestOf: 3 });
    expect(updated.bestOf).toBe(3);
    expectStatus(() => duels.setRules(created.id, "u-alice", { bestOf: 2 as never }), 400);
    expect(() => tournaments.create("g1", "Bad", "round_robin", "u-alice", { bestOf: 5 as never })).toThrow(/Best of/);
    expect(() =>
      tournaments.create("g1", "Bad2", "round_robin", "u-alice", { duelRules: { settings: { nope: 1 } } }),
    ).toThrow(/Unknown duel setting/);
    expect(db.prepare("select count(*) as c from tournaments where name like 'Bad%'").get()).toEqual({ c: 0 });
  });

  it("lets only the organizer change the rules", () => {
    const { duels, tournament } = setup();
    expectStatus(() => duels.setRules(tournament.id, "u-bob", { bestOf: 1 }), 403);
    expect(duels.setRules(tournament.id, "u-alice", { bestOf: 1 }).bestOf).toBe(1);
    expectStatus(() => duels.setRules(999, "u-alice", { bestOf: 1 }), 404);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { bestOf: 2 as never }), 400);
  });

  it("normalizes mode, master rule and settings", () => {
    const { duels, tournament } = setup();
    const rules = duels.setRules(tournament.id, "u-alice", {
      mode: "domain",
      masterRule: 3,
      settings: { startingLP: 4000 },
    });
    expect(rules.mode).toBe("domain");
    expect(rules.masterRule).toBe(3);
    expect(rules.settings.startingLP).toBe(4000);
    expect(rules.bestOf).toBe(3);

    // Only bestOf: the stored rules stay.
    const again = duels.setRules(tournament.id, "u-alice", { bestOf: 1 });
    expect(again.mode).toBe("domain");
    expect(again.settings.startingLP).toBe(4000);

    expectStatus(() => duels.setRules(tournament.id, "u-alice", { settings: { bogus: true } }), 400);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { masterRule: 9 as never }), 400);
    expect(duels.rules(tournament.id).settings.startingLP).toBe(4000);
  });

  it("refuses rule changes once a tournament game has started", () => {
    const { db, tournaments, duels, tournament, alice, bob } = setup();
    tournaments.start(tournament.id);
    // Before any game, the rules still change on an active tournament.
    expect(duels.setRules(tournament.id, "u-alice", { bestOf: 1 }).bestOf).toBe(1);

    const slot = tournaments.openMatches(tournament.id)[0]!;
    db.prepare(
      `insert into duel_series (guild_id, best_of, player0_id, player1_id, tournament_match_id, mode, settings_json, created_by_player_id)
       values ('g1', 3, ?, ?, ?, 'normal', '{}', ?)`,
    ).run(alice, bob, slot.id, alice);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { bestOf: 3 }), 409);
  });

  it("rulesLocked follows the same rule setRules uses to refuse a change", () => {
    const { db, tournaments, duels, tournament, alice, bob } = setup();
    expect(duels.rulesLocked(tournament.id)).toBe(false);
    tournaments.start(tournament.id);
    expect(duels.rulesLocked(tournament.id)).toBe(false);

    // A locked deck (a game started) locks the rules, even with no series row.
    db.prepare("update tournament_participants set deck_locked_at = datetime('now') where tournament_id = ? and player_id = ?").run(tournament.id, alice);
    expect(duels.rulesLocked(tournament.id)).toBe(true);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { bestOf: 1 }), 409);
    db.prepare("update tournament_participants set deck_locked_at = null where tournament_id = ?").run(tournament.id);
    expect(duels.rulesLocked(tournament.id)).toBe(false);

    const slot = tournaments.openMatches(tournament.id)[0]!;
    db.prepare(
      `insert into duel_series (guild_id, best_of, player0_id, player1_id, tournament_match_id, mode, settings_json, created_by_player_id)
       values ('g1', 3, ?, ?, ?, 'normal', '{}', ?)`,
    ).run(alice, bob, slot.id, alice);
    expect(duels.rulesLocked(tournament.id)).toBe(true);
    expectStatus(() => duels.rulesLocked(999), 404);
  });

  it("rulesLocked is true for a closed tournament", () => {
    const { tournaments, duels, tournament } = setup();
    tournaments.cancel(tournament.id);
    expect(duels.rulesLocked(tournament.id)).toBe(true);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { bestOf: 1 }), 409);
  });

  it("updateSettings cannot change the rules after a tournament game has started", () => {
    const { db, tournaments, tournament, alice, bob } = setup();
    tournaments.start(tournament.id);
    const slot = tournaments.openMatches(tournament.id)[0]!;
    db.prepare(
      `insert into duel_series (guild_id, best_of, player0_id, player1_id, tournament_match_id, mode, settings_json, created_by_player_id)
       values ('g1', 3, ?, ?, ?, 'normal', '{}', ?)`,
    ).run(alice, bob, slot.id, alice);
    const rulesJson = () =>
      (db.prepare("select duel_rules_json from tournaments where id = ?").get(tournament.id) as { duel_rules_json: string | null })
        .duel_rules_json;
    const before = { bestOf: tournaments.findById(tournament.id).bestOf, rulesJson: rulesJson() };
    const patch = { bestOf: 1, duelRules: { mode: "domain", masterRule: 3 }, reportConfirmWindowHours: 6 };
    const after = tournaments.updateSettings(tournament.id, patch as never);
    expect(after.bestOf).toBe(before.bestOf);
    expect(rulesJson()).toBe(before.rulesJson);
    expect(after.reportConfirmWindowHours).toBe(6);
  });

  it("refuses rule changes once a deck is locked", () => {
    const { duels, tournament, alice } = setup();
    duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck });
    duels.lockDeck(tournament.id, alice);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { bestOf: 1 }), 409);
  });

  it("refuses rule changes on a finished tournament", () => {
    const { tournaments, duels, tournament } = setup();
    tournaments.cancel(tournament.id);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { bestOf: 1 }), 409);
  });

  it("keeps fixed rules for a draft tournament and accepts only bestOf", () => {
    const { db, duels, tournament } = setup();
    const draftId = attachDraft(db, tournament.id);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { mode: "domain" }), 400);
    expectStatus(() => duels.setRules(tournament.id, "u-alice", { settings: {} }), 400);
    const rules = duels.setRules(tournament.id, "u-alice", { bestOf: 1 });
    expect(rules.bestOf).toBe(1);
    expect(rules.draftId).toBe(draftId);
    expect(rules.mode).toBe("normal");
    expect(rules.settings.validateDeck).toBe(false);
    const row = db.prepare("select duel_rules_json from tournaments where id = ?").get(tournament.id) as {
      duel_rules_json: string | null;
    };
    expect(row.duel_rules_json).toBeNull();
  });
});

describe("tournament deck registration", () => {
  it("registers, replaces and reads a deck", () => {
    const { duels, savedDecks, tournament, alice, bob } = setup();
    expect(duels.registration(tournament.id, alice)).toBeNull();
    expect(duels.registrations(tournament.id)).toEqual([
      { playerId: alice, registered: false, lockedAt: null },
      { playerId: bob, registered: false, lockedAt: null },
    ]);

    const saved = savedDecks.create("g1", "u-alice", { name: "Mine", mode: "normal", deck });
    const first = duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: saved.id, deck });
    expect(first.savedDeckId).toBe(saved.id);
    expect(first.deck).toEqual(deck);
    expect(first.lockedAt).toBeNull();
    expect(first.registeredAt).toBeTruthy();

    const next = { main: [9], extra: [], side: [] };
    duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck: next });
    expect(duels.registration(tournament.id, alice)?.deck).toEqual(next);
    expect(duels.registration(tournament.id, alice)?.savedDeckId).toBeNull();
    expect(duels.registrations(tournament.id).map((row) => row.registered)).toEqual([true, false]);
  });

  it("copies the deck at registration", () => {
    const { duels, tournament, alice } = setup();
    const mine = { main: [1], extra: [], side: [] };
    duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck: mine });
    mine.main.push(2);
    expect(duels.registration(tournament.id, alice)?.deck.main).toEqual([1]);
  });

  it("rejects non-participants, other people's saved decks and closed tournaments", () => {
    const { db, tournaments, duels, savedDecks, tournament, alice, bob, carol } = setup();
    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: carol, savedDeckId: null, deck }),
      403,
    );
    const bobsDeck = savedDecks.create("g1", "u-bob", { name: "Bob", mode: "normal", deck });
    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: bobsDeck.id, deck }),
      403,
    );
    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: 999, deck }),
      404,
    );
    expectStatus(() => duels.registerDeck({ tournamentId: 999, playerId: alice, savedDeckId: null, deck }), 404);
    // Nothing was stored by the failed calls.
    expect(duels.registration(tournament.id, alice)).toBeNull();

    tournaments.start(tournament.id);
    duels.registerDeck({ tournamentId: tournament.id, playerId: bob, savedDeckId: null, deck });
    db.prepare("update tournaments set status = 'completed' where id = ?").run(tournament.id);
    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck }),
      409,
    );
  });

  it("locks a deck until it cannot change", () => {
    const { duels, tournament, alice, bob } = setup();
    duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck });
    duels.lockDeck(tournament.id, alice);
    const lockedAt = duels.registration(tournament.id, alice)!.lockedAt;
    expect(lockedAt).toBeTruthy();
    duels.lockDeck(tournament.id, alice); // idempotent
    expect(duels.registration(tournament.id, alice)!.lockedAt).toBe(lockedAt);

    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck }),
      409,
    );
    // The other player is not locked.
    duels.registerDeck({ tournamentId: tournament.id, playerId: bob, savedDeckId: null, deck });
    expect(duels.registrations(tournament.id).find((row) => row.playerId === bob)?.lockedAt).toBeNull();
  });

  it("accepts only the player's own draft deck in a draft tournament", () => {
    const { db, duels, savedDecks, tournament, alice, bob } = setup();
    const draftId = attachDraft(db, tournament.id);
    const otherDraftId = Number(
      db
        .prepare(
          `insert into drafts (guild_id, channel_id, name, status, created_by_user_id)
           values ('g1', 'ch', 'Other', 'completed', 'u-alice')`,
        )
        .run().lastInsertRowid,
    );
    const plain = savedDecks.create("g1", "u-alice", { name: "Plain", mode: "normal", deck });
    const otherDraft = savedDecks.create("g1", "u-alice", { name: "Old", mode: "normal", deck, draftId: otherDraftId });
    const draftDeck = savedDecks.create("g1", "u-alice", { name: "Draft", mode: "normal", deck, draftId });
    const bobsDraftDeck = savedDecks.create("g1", "u-bob", { name: "BobD", mode: "normal", deck, draftId });

    expectStatus(() => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: null, deck }), 400);
    expectStatus(() => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: plain.id, deck }), 400);
    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: otherDraft.id, deck }),
      400,
    );
    expectStatus(
      () => duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: bobsDraftDeck.id, deck }),
      403,
    );
    const ok = duels.registerDeck({ tournamentId: tournament.id, playerId: alice, savedDeckId: draftDeck.id, deck });
    expect(ok.savedDeckId).toBe(draftDeck.id);
    expect(duels.registration(tournament.id, bob)).toBeNull();
  });
});

describe("setResultByOrganizer", () => {
  function startedSetup() {
    const ctx = setup();
    ctx.tournaments.start(ctx.tournament.id);
    const slot = ctx.tournaments.openMatches(ctx.tournament.id)[0]!;
    return { ...ctx, slot };
  }

  it("checks the organizer, slot state and winner before it writes", () => {
    const { db, duels, slot, alice, bob, carol } = startedSetup();
    const call = (input: Partial<{ organizerUserId: string; winnerPlayerId: number; tournamentMatchId: number }>) =>
      duels.setResultByOrganizer({
        tournamentMatchId: slot.id,
        organizerUserId: "u-alice",
        winnerPlayerId: alice,
        ...input,
      });
    expectStatus(() => call({ organizerUserId: "u-bob" }), 403);
    expectStatus(() => call({ winnerPlayerId: carol }), 400);
    expectStatus(() => call({ tournamentMatchId: 9999 }), 404);
    db.prepare("update tournament_matches set status = 'completed' where id = ?").run(slot.id);
    expectStatus(() => call({ winnerPlayerId: bob }), 409);
  });

  it("completes an open slot and finishes the tournament", () => {
    const { tournaments, duels, slot, alice, tournament, db } = startedSetup();
    const result = duels.setResultByOrganizer({
      tournamentMatchId: slot.id,
      organizerUserId: "u-alice",
      winnerPlayerId: alice,
    });
    expect(result.tournamentId).toBe(tournament.id);
    expect(result.changedDuelSlugs).toEqual([]);
    expect(result.tournamentCompleted).toBe(true);
    const row = db.prepare("select status, match_id from tournament_matches where id = ?").get(slot.id) as {
      status: string;
      match_id: number;
    };
    expect(row.status).toBe("completed");
    const match = db.prepare("select status, winner_id, source from matches where id = ?").get(row.match_id);
    expect(match).toEqual({ status: "approved", winner_id: alice, source: "tournament" });
    expect(tournaments.findById(tournament.id).status).toBe("completed");
  });

  it("cancels an open series and denies a pending report", () => {
    const { tournaments, duels, slot, alice, bob, tournament, db } = startedSetup();
    const report = tournaments.reportTournamentMatch(slot.id, alice, bob);
    db.prepare(
      `insert into duel_series (guild_id, best_of, player0_id, player1_id, tournament_match_id, mode, settings_json, created_by_player_id)
       values ('g1', 3, ?, ?, ?, 'normal', '{}', ?)`,
    ).run(alice, bob, slot.id, alice);

    duels.setResultByOrganizer({ tournamentMatchId: slot.id, organizerUserId: "u-alice", winnerPlayerId: alice });

    expect(db.prepare("select status from duel_series where tournament_match_id = ?").get(slot.id)).toEqual({
      status: "cancelled",
    });
    expect(db.prepare("select status from matches where id = ?").get(report.id)).toEqual({ status: "denied" });
    expect(
      db.prepare("select count(*) as c from matches where tournament_id = ? and status = 'approved'").get(tournament.id),
    ).toEqual({ c: 1 });
  });
});

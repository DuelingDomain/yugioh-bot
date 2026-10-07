import { seedIdentity, seedUser } from "./helpers/identity.js";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db/index.js";
import { createDraftService } from "../src/services/drafts.js";
import { createDraftTournamentService } from "../src/services/draft-tournament.js";
import { createSavedDeckService } from "../src/services/saved-decks.js";
import { createTournamentDuelService } from "../src/services/tournament-duels.js";
import { createTournamentService } from "../src/services/tournaments.js";

function seedDb(db: Database.Database) {
  seedIdentity(db, { guildId: "g1", name: "Alice", userId: seedUser(db, "u1").userId, discordUserId: seedUser(db, "u1").discordUserId ?? "u1" });
  seedIdentity(db, { guildId: "g1", name: "Bob", userId: seedUser(db, "u2").userId, discordUserId: seedUser(db, "u2").discordUserId ?? "u2" });
  for (let i = 1; i <= 40; i++) {
    db.prepare(
      `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
       values (?, ?, 'Effect Monster', 'effect', '', '', '[{"set_name":"Set A"}]', current_timestamp)`,
    ).run(i, `Card ${i}`);
  }
}

function completeDraft(db: Database.Database) {
  seedDb(db);
  const drafts = createDraftService(db);
  const alice = db.prepare("select id from players where user_id = ?").get(seedUser(db, "u1").userId) as { id: number };
  const bob = db.prepare("select id from players where user_id = ?").get(seedUser(db, "u2").userId) as { id: number };
  const cubeCardIds = drafts.resolveCubeCardIds({ setNames: ["Set A"] });
  const draft = drafts.create("g1", "ch1", "Test Draft", {
    setNames: ["Set A"], cubeCardIds, packsPerPlayer: 5, packSize: 8, pickSeconds: 45,
  }, seedUser(db, "u1").userId, alice.id);
  drafts.join(draft.id, bob.id);
  db.prepare("update drafts set status = 'completed' where id = ?").run(draft.id);
  return { draft, aliceId: alice.id, bobId: bob.id };
}

describe("createTournamentFromDraft", () => {
  it.each([
    {
      name: "uses shuffled seats for five-player tournament pairings and the bye",
      randomizeSeats: true,
      joinOrder: [1, 2, 3, 4, 5],
      seatOrder: [2, 3, 4, 5, 1],
      pairings: [[2, null], [3, 1], [4, 5]],
    },
    {
      name: "preserves main's pairings and the bye when randomizeSeats is false",
      randomizeSeats: false,
      joinOrder: [5, 1, 2, 3, 4],
      seatOrder: [5, 1, 2, 3, 4],
      pairings: [[1, null], [2, 5], [3, 4]],
    },
    {
      name: "preserves main's pairings and the bye when randomizeSeats is omitted",
      randomizeSeats: undefined,
      joinOrder: [5, 1, 2, 3, 4],
      seatOrder: [5, 1, 2, 3, 4],
      pairings: [[1, null], [2, 5], [3, 4]],
    },
  ])("$name", ({ randomizeSeats, joinOrder, seatOrder, pairings }) => {
    const db = new Database(":memory:");
    migrate(db);
    seedDb(db);
    for (let i = 3; i <= 5; i++) {
      seedIdentity(db, { guildId: "g1", name: `Player ${i}`, userId: seedUser(db, `u${i}`).userId, discordUserId: seedUser(db, `u${i}`).discordUserId ?? `u${i}` });
    }
    const drafts = createDraftService(db, { random: () => 0 });
    const config = {
      setNames: ["Set A"], packsPerPlayer: 1, packSize: 1, cardsPerPlayer: 1, randomizeSeats,
    };
    const draft = drafts.create("g1", "ch1", "Five-player draft", config, seedUser(db, "u1").userId, joinOrder[0]);
    for (const playerId of joinOrder.slice(1)) drafts.join(draft.id, playerId);
    if (randomizeSeats === undefined) {
      // Older drafts can omit the key instead of storing the normalized default.
      db.prepare("update drafts set config_json = ? where id = ?")
        .run(JSON.stringify(config), draft.id);
    }
    db.prepare("update draft_players set joined_at = ? where draft_id = ?")
      .run("2026-05-01 00:00:00", draft.id);
    drafts.start(draft.id);
    for (const playerId of [1, 2, 3, 4, 5]) {
      drafts.pickCard(draft.id, playerId, drafts.currentPackOptions(draft.id, playerId)[0].id);
    }
    expect(drafts.findById(draft.id).status).toBe("completed");
    expect(drafts.players(draft.id).map((player) => player.playerId)).toEqual(seatOrder);

    const result = createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, format: "single_elim", createdByUserId: seedUser(db, "u1").userId,
    });
    const tournaments = createTournamentService(db);
    tournaments.start(result.tournamentId);

    const matches = tournaments.matches(result.tournamentId);
    expect(matches.map((match) => [match.playerOneId, match.playerTwoId])).toEqual(pairings);
    expect(matches[0]).toEqual(expect.objectContaining({
      status: "completed", metadata: { bye: true, winnerId: pairings[0][0] },
    }));
    expect(tournaments.participants(result.tournamentId))
      .toEqual(randomizeSeats ? seatOrder : [1, 2, 3, 4, 5]);
    db.close();
  });

  it("creates a tournament and seeds all players", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    const service = createDraftTournamentService(db);

    const result = service.createTournamentFromDraft({
      draftId: draft.id,
      format: "round_robin",
      createdByUserId: seedUser(db, "u1").userId,
    });

    expect(result.tournamentName).toBe("Test Draft");
    const participants = db
      .prepare("select player_id from tournament_participants where tournament_id = ?")
      .all(result.tournamentId) as Array<{ player_id: number }>;
    expect(participants).toHaveLength(2);
  });

  it("is idempotent — second call returns existing tournament", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    const service = createDraftTournamentService(db);

    const r1 = service.createTournamentFromDraft({ draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId });
    const r2 = service.createTournamentFromDraft({ draftId: draft.id, format: "single_elim", createdByUserId: seedUser(db, "u1").userId });

    expect(r1.tournamentId).toBe(r2.tournamentId);
  });

  it("rejects a participant who is not the creator", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    expect(() => createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u2").userId,
    })).toThrow("Only the draft creator can create a tournament");
    db.close();
  });

  it("rejects a former admin who did not create or join the draft", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    expect(() => createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "admin-user").userId,
    })).toThrow("Only the draft creator can create a tournament");
    expect(db.prepare("select count(*) as count from tournaments").get()).toEqual({ count: 0 });
    db.close();
  });

  it.each(["pending", "active", "cancelled"])("rejects the creator for a %s draft", (status) => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    db.prepare("update drafts set status = ? where id = ?").run(status, draft.id);
    expect(() => createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId,
    })).toThrow("must be completed");
    expect(db.prepare("select count(*) as count from tournaments").get()).toEqual({ count: 0 });
    db.close();
  });

  it("rejects non-completed draft", () => {
    const db = new Database(":memory:");
    migrate(db);
    seedDb(db);
    const drafts = createDraftService(db);
    const alice = db.prepare("select id from players where user_id = ?").get(seedUser(db, "u1").userId) as { id: number };
    const cubeCardIds = drafts.resolveCubeCardIds({ setNames: ["Set A"] });
    const draft = drafts.create("g1", "ch1", "Pending", {
      setNames: ["Set A"], cubeCardIds, packsPerPlayer: 5, packSize: 8, pickSeconds: 45,
    }, seedUser(db, "u1").userId, alice.id);

    const service = createDraftTournamentService(db);
    expect(() =>
      service.createTournamentFromDraft({ draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId }),
    ).toThrow("must be completed");
  });

  it("stores tournament_id on the draft row", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    const service = createDraftTournamentService(db);

    const result = service.createTournamentFromDraft({ draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId });

    const row = db.prepare("select tournament_id from drafts where id = ?").get(draft.id) as { tournament_id: number };
    expect(row.tournament_id).toBe(result.tournamentId);
  });

  it("defaults to best of 3 and accepts best of 1; draft rules stay null", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft } = completeDraft(db);
    const service = createDraftTournamentService(db);

    const result = service.createTournamentFromDraft({
      draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId, bestOf: 1,
    });
    const row = db
      .prepare("select best_of, duel_rules_json from tournaments where id = ?")
      .get(result.tournamentId) as { best_of: number; duel_rules_json: string | null };
    expect(row).toEqual({ best_of: 1, duel_rules_json: null });

    const db2 = new Database(":memory:");
    migrate(db2);
    const second = completeDraft(db2);
    const r2 = createDraftTournamentService(db2).createTournamentFromDraft({
      draftId: second.draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId,
    });
    expect((db2.prepare("select best_of from tournaments where id = ?").get(r2.tournamentId) as { best_of: number }).best_of).toBe(3);

    expect(() =>
      createDraftTournamentService(db2).createTournamentFromDraft({
        draftId: second.draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId, bestOf: 2 as never,
      }),
    ).toThrow(/Best of/);
  });

  it("registers each player's existing draft deck and skips players without one", () => {
    const db = new Database(":memory:");
    migrate(db);
    const { draft, aliceId, bobId } = completeDraft(db);
    const savedDecks = createSavedDeckService(db);
    const deck = { main: [1, 2, 3], extra: [], side: [] };
    const aliceDeck = savedDecks.create("g1", seedUser(db, "u1").userId, { name: "Alice draft", mode: "normal", deck, draftId: draft.id });
    // A deck without a draft id never counts.
    savedDecks.create("g1", seedUser(db, "u2").userId, { name: "Bob plain", mode: "normal", deck });

    const result = createDraftTournamentService(db).createTournamentFromDraft({
      draftId: draft.id, format: "round_robin", createdByUserId: seedUser(db, "u1").userId,
    });

    const duels = createTournamentDuelService(db);
    const alice = duels.registration(result.tournamentId, aliceId);
    expect(alice?.savedDeckId).toBe(aliceDeck.id);
    expect(alice?.deck).toEqual(deck);
    expect(alice?.lockedAt).toBeNull();
    expect(duels.registration(result.tournamentId, bobId)).toBeNull();
    expect(duels.registrations(result.tournamentId).map((row) => row.registered)).toEqual([true, false]);
  });
});

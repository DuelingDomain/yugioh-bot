import { checkDeckAgainstPool } from "../../src/duels/pool.js";
import Database from "better-sqlite3";
import { describe, expect, it, vi } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createDraftService } from "../../src/services/drafts.js";
import { createDraftTournamentService } from "../../src/services/draft-tournament.js";
import {
  buildDraftDeck,
  createDraftDeckService,
  draftDeckName,
  draftDeckNote,
} from "../../src/services/draft-decks.js";
import { createSavedDeckService } from "../../src/services/saved-decks.js";
import { createTournamentService } from "../../src/services/tournaments.js";
import { createTournamentDuelService } from "../../src/services/tournament-duels.js";

const EXTRA_IDS = [11, 12];

function seed(db: Database.Database, cardCount = 12) {
  for (let i = 1; i <= cardCount; i++) {
    const extra = EXTRA_IDS.includes(i);
    db.prepare(
      `insert into card_catalog (ygoprodeck_id, name, type, frame_type, image_url, image_url_small, card_sets_json, cached_at)
       values (?, ?, ?, ?, '', '', '[{"set_name":"Set A"}]', current_timestamp)`,
    ).run(i, `Card ${i}`, extra ? "Fusion Monster" : "Effect Monster", extra ? "fusion" : "effect");
  }
}

function addPlayer(db: Database.Database, discordId: string, name: string): number {
  return Number(
    db.prepare("insert into players (guild_id, discord_user_id, display_name) values ('g1', ?, ?)").run(discordId, name)
      .lastInsertRowid,
  );
}

/** A real draft: every player takes the first card of their pack until the draft ends on its own. */
function playDraft(db: Database.Database, playerIds: number[], hostId: string) {
  const drafts = createDraftService(db, { random: () => 0 });
  const config = { setNames: ["Set A"], packsPerPlayer: 1, packSize: 3, cardsPerPlayer: 3 };
  const draft = drafts.create("g1", "ch1", "Friday cube", config, hostId, playerIds[0]);
  for (const id of playerIds.slice(1)) drafts.join(draft.id, id);
  drafts.start(draft.id);
  for (let guard = 0; guard < 50 && drafts.findById(draft.id).status === "active"; guard++) {
    for (const id of playerIds) {
      const options = drafts.currentPackOptions(draft.id, id);
      if (options.length > 0) drafts.pickCard(draft.id, id, options[0].id);
    }
  }
  expect(drafts.findById(draft.id).status).toBe("completed");
  return { drafts, draftId: draft.id };
}

it("leaves the fourth copy in the pool across all deck sections", () => {
  expect(buildDraftDeck([{ catalogId: 1, extra: false }, { catalogId: 1, extra: false }, { catalogId: 1, extra: true }, { catalogId: 1, extra: true }])).toEqual({ main: [1, 1], extra: [1], side: [] });
});

it("rejects a fourth copy when saved against a draft pool", () => {
  expect(checkDeckAgainstPool({ main: [1, 1], extra: [1], side: [1] }, new Map([[1, 5]]))).toEqual([{ code: 1, used: 4, available: 3 }]);
});

describe("buildDraftDeck", () => {
  it("includes forced copies by artwork identity, with one extra slot per forced pick", () => {
    const normal = { catalogId: 1, extra: false, name: "Card", type: "Effect Monster" };
    const forced = { ...normal, catalogId: 2, name: " CARD ", forced: true };
    expect(buildDraftDeck([normal, normal, normal, forced, normal]).main).toEqual([1, 1, 1, 2]);
    expect(buildDraftDeck([normal, normal, normal, forced, forced]).main).toEqual([1, 1, 1, 2, 2]);
    expect(buildDraftDeck([normal, normal, normal, { ...forced, type: "Normal Monster" }]).main)
      .toEqual([1, 1, 1, 2]);
  });

  it("puts main picks in main, extra deck monsters in extra, and keeps copies", () => {
    const deck = buildDraftDeck([
      { catalogId: 1, extra: false },
      { catalogId: 1, extra: false },
      { catalogId: 11, extra: true },
    ]);
    expect(deck).toEqual({ main: [1, 1], extra: [11], side: [] });
  });

  it("moves overflow to side so the deck stays one the duel start accepts", () => {
    const cards = [
      ...Array.from({ length: 80 }, (_, i) => ({ catalogId: i + 1, extra: false })),
      ...Array.from({ length: 16 }, (_, i) => ({ catalogId: 1000 + i, extra: true })),
    ];
    const deck = buildDraftDeck(cards);
    expect(deck.main).toHaveLength(60);
    expect(deck.extra).toHaveLength(15);
    expect(deck.side).toHaveLength(15);
  });
});

describe("draftDeckName", () => {
  it("names the deck after the draft and the day it ended", () => {
    expect(draftDeckName({ name: "Friday cube", ended_at: "2026-10-03T20:15:00.000Z" })).toBe("Friday cube draft, 2026-10-03");
    expect(draftDeckName({ name: "Spring Draft", created_at: "2026-04-01 10:00:00" })).toBe("Spring Draft, 2026-04-01");
  });
});

describe("draftDeckNote", () => {
  const deckOf = (main: number) => ({ main: Array.from({ length: main }, (_, i) => i + 1), extra: [], side: [] });
  it("is quiet at 40 cards or when the whole main pool is smaller", () => {
    expect(draftDeckNote(deckOf(40), 55)).toBeNull();
    expect(draftDeckNote(deckOf(25), 25)).toBeNull();
  });
  it("gives an optional hint above 40", () => {
    expect(draftDeckNote(deckOf(52), 52)).toMatchObject({ level: "optional", mainCount: 52 });
  });
  it("gives a required note below the minimum", () => {
    const note = draftDeckNote(deckOf(30), 55);
    expect(note).toMatchObject({ level: "required", mainCount: 30 });
    expect(note?.message).toBe("Your draft deck has 30 main deck cards; edit it to 40.");
  });
});

describe("saving a deck when a draft finishes", () => {
  it("saves one deck per human player, skips bots, and does not make a second one", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const bot = addPlayer(db, "bot_player_dev_1", "Bot 1");
    const { drafts, draftId } = playDraft(db, [alice, bob, bot], "u1");

    const decks = createSavedDeckService(db);
    for (const owner of ["u1", "u2"]) {
      const deck = decks.findByDraft("g1", owner, draftId);
      expect(deck).not.toBeNull();
      expect(deck!.name).toMatch(/^Friday cube draft, \d{4}-\d{2}-\d{2}$/);
      expect(deck!.mode).toBe("normal");
      const pool = drafts.pool(draftId, owner === "u1" ? alice : bob).map((card) => card.catalogCardId);
      expect([...deck!.deck.main, ...deck!.deck.extra].sort()).toEqual([...pool].sort());
      expect(deck!.deck.extra.every((code) => EXTRA_IDS.includes(code))).toBe(true);
      expect(deck!.deck.main.some((code) => EXTRA_IDS.includes(code))).toBe(false);
    }
    expect(decks.list("g1", "bot_player_dev_1")).toEqual([]);

    // Running it again (or backfilling) makes no new deck.
    const before = (db.prepare("select count(*) n from saved_decks").get() as { n: number }).n;
    expect(createDraftDeckService(db).saveForDraft(draftId)).toEqual([]);
    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).toEqual([]);
    expect((db.prepare("select count(*) n from saved_decks").get() as { n: number }).n).toBe(before);
    db.close();
  });

  it("backfills a finished draft that has no saved deck, for the guild of the user only", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    // A draft that ended before decks were saved: no deck and no saved mark.
    db.prepare("delete from saved_decks").run();
    db.prepare("update draft_players set deck_saved_at = null").run();

    const service = createDraftDeckService(db);
    expect(service.ensureForUser("other-guild", "u1")).toEqual([]);
    expect(createSavedDeckService(db).findByDraft("g1", "u1", draftId)).toBeNull();

    expect(service.ensureForUser("g1", "u1")).toEqual([draftId]);
    expect(createSavedDeckService(db).findByDraft("g1", "u1", draftId)).not.toBeNull();
    expect(createSavedDeckService(db).findByDraft("g1", "u2", draftId)).not.toBeNull();
    db.close();
  });
});

describe("a draft deck the player removed", () => {
  function finishedDraft() {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    return { db, draftId };
  }

  it("does not come back when the player deletes it and the decks load again", () => {
    const { db, draftId } = finishedDraft();
    const decks = createSavedDeckService(db);
    decks.delete(decks.findByDraft("g1", "u1", draftId)!.id, "g1", "u1");

    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).toEqual([]);
    expect(createDraftDeckService(db).saveForDraft(draftId)).toEqual([]);
    expect(decks.findByDraft("g1", "u1", draftId)).toBeNull();
    // The other player's deck is untouched.
    expect(decks.findByDraft("g1", "u2", draftId)).not.toBeNull();
    db.close();
  });

  it("is not copied when the player clears the draft link of the deck", () => {
    const { db, draftId } = finishedDraft();
    db.prepare("update saved_decks set draft_id = null where owner_user_id = 'u1'").run();

    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).toEqual([]);
    expect(db.prepare("select count(*) n from saved_decks where owner_user_id = 'u1'").get()).toEqual({ n: 1 });
    expect(createSavedDeckService(db).findByDraft("g1", "u1", draftId)).toBeNull();
    db.close();
  });

  it("marks a deck that exists from before the mark was added, so deleting it later sticks", () => {
    const { db, draftId } = finishedDraft();
    db.prepare("update draft_players set deck_saved_at = null").run();
    migrate(db);
    expect(db.prepare("select count(*) n from draft_players where deck_saved_at is null").get()).toEqual({ n: 0 });
    const decks = createSavedDeckService(db);
    decks.delete(decks.findByDraft("g1", "u2", draftId)!.id, "g1", "u2");
    expect(createDraftDeckService(db).ensureForUser("g1", "u2")).toEqual([]);
    db.close();
  });
});

describe("a deck made by hand for a draft", () => {
  it("counts as saved, so deleting it later is not undone", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    // A draft that ended before decks were saved; the player then saves a deck for it by hand.
    db.prepare("delete from saved_decks").run();
    db.prepare("update draft_players set deck_saved_at = null").run();
    const decks = createSavedDeckService(db);
    const made = decks.create("g1", "u1", { name: "Mine", mode: "normal", deck: { main: [1, 2, 3], extra: [], side: [] }, draftId });
    expect(db.prepare("select deck_saved_at from draft_players where player_id = ?").get(alice)).not.toEqual({ deck_saved_at: null });
    expect(db.prepare("select deck_saved_at from draft_players where player_id = ?").get(bob)).toEqual({ deck_saved_at: null });

    decks.delete(made.id, "g1", "u1");
    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).toEqual([]);
    expect(decks.findByDraft("g1", "u1", draftId)).toBeNull();
    db.close();
  });
});

describe("which finished drafts the backfill covers", () => {
  function oldDrafts() {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const old = playDraft(db, [alice, bob], "u1").draftId;
    const oldWithTournament = playDraft(db, [alice, bob], "u1").draftId;
    const recent = playDraft(db, [alice, bob], "u1").draftId;
    const tournament = createTournamentService(db).create("g1", "Cup", "round_robin", "u1");
    db.prepare("update drafts set tournament_id = ? where id = ?").run(tournament.id, oldWithTournament);
    const longAgo = new Date(Date.now() - 30 * 86_400_000).toISOString();
    db.prepare("update drafts set ended_at = ? where id in (?, ?)").run(longAgo, old, oldWithTournament);
    // Every draft finished before decks were saved.
    db.prepare("delete from saved_decks").run();
    db.prepare("update draft_players set deck_saved_at = null").run();
    return { db, old, oldWithTournament, recent };
  }

  it("saves a recent draft and an older draft that has a tournament, not an older draft without one", () => {
    const { db, old, oldWithTournament, recent } = oldDrafts();
    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).toEqual([oldWithTournament, recent].sort((a, b) => a - b));
    const decks = createSavedDeckService(db);
    expect(decks.findByDraft("g1", "u1", old)).toBeNull();
    expect(decks.findByDraft("g1", "u1", oldWithTournament)).not.toBeNull();
    expect(decks.findByDraft("g1", "u1", recent)).not.toBeNull();
    db.close();
  });

  it("auto-registers the deck of an older draft that has a live tournament", () => {
    const { db, oldWithTournament } = oldDrafts();
    const tournamentId = (db.prepare("select tournament_id from drafts where id = ?").get(oldWithTournament) as { tournament_id: number }).tournament_id;
    const alice = (db.prepare("select id from players where discord_user_id = 'u1'").get() as { id: number }).id;
    db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tournamentId, alice);
    createDraftDeckService(db).ensureForUser("g1", "u1");
    expect(createTournamentDuelService(db).registration(tournamentId, alice)?.deck.main.length).toBeGreaterThan(0);
    db.close();
  });

  it("the migration marks the rows of older drafts without a tournament as saved, and no others", () => {
    const { db, old, oldWithTournament, recent } = oldDrafts();
    migrate(db);
    const savedAt = (draftId: number) =>
      (db.prepare("select count(*) n from draft_players where draft_id = ? and deck_saved_at is not null").get(draftId) as { n: number }).n;
    expect(savedAt(old)).toBe(2);
    expect(savedAt(oldWithTournament)).toBe(0);
    expect(savedAt(recent)).toBe(0);
    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).not.toContain(old);
    db.close();
  });
});

describe("a failure while saving one player's deck", () => {
  it("keeps the decks of the other players", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    db.prepare("delete from saved_decks").run();
    db.prepare("update draft_players set deck_saved_at = null").run();
    db.exec(`create trigger fail_bob before insert on saved_decks when new.owner_user_id = 'u1'
             begin select raise(abort, 'boom'); end`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(createDraftDeckService(db).saveForDraft(draftId)).toEqual(["u2"]);
    expect(createSavedDeckService(db).findByDraft("g1", "u2", draftId)).not.toBeNull();
    expect(createSavedDeckService(db).findByDraft("g1", "u1", draftId)).toBeNull();
    expect(log).toHaveBeenCalled();

    // The failed player is tried again on the next backfill.
    db.exec("drop trigger fail_bob");
    expect(createDraftDeckService(db).ensureForUser("g1", "u1")).toEqual([draftId]);
    expect(createSavedDeckService(db).findByDraft("g1", "u1", draftId)).not.toBeNull();
    log.mockRestore();
    db.close();
  });
});

describe("linking the draft deck to the tournament entry", () => {
  it("registers every human player's drafted deck when the tournament is made from the draft", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    // The draft finished before automatic saving existed.
    db.prepare("delete from saved_decks").run();
    db.prepare("update draft_players set deck_saved_at = null").run();

    const result = createDraftTournamentService(db).createTournamentFromDraft({
      draftId, format: "round_robin", createdByUserId: "u1",
    });
    const duels = createTournamentDuelService(db);
    const decks = createSavedDeckService(db);
    for (const [playerId, owner] of [[alice, "u1"], [bob, "u2"]] as const) {
      const registration = duels.registration(result.tournamentId, playerId);
      const saved = decks.findByDraft("g1", owner, draftId)!;
      expect(registration?.savedDeckId).toBe(saved.id);
      expect(registration?.deck).toEqual(saved.deck);
      expect(registration?.lockedAt).toBeNull();
    }
    db.close();
  });

  it("keeps a deck that is already registered", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    const result = createDraftTournamentService(db).createTournamentFromDraft({
      draftId, format: "round_robin", createdByUserId: "u1",
    });
    const duels = createTournamentDuelService(db);
    const decks = createSavedDeckService(db);
    const mine = decks.findByDraft("g1", "u1", draftId)!;
    const trimmed = { ...mine.deck, main: mine.deck.main.slice(0, 2) };
    decks.update(mine.id, "g1", "u1", { name: mine.name, mode: "normal", deck: trimmed });
    duels.registerDeck({ tournamentId: result.tournamentId, playerId: alice, savedDeckId: mine.id, deck: trimmed });

    expect(createDraftDeckService(db).linkTournament(result.tournamentId)).toEqual([]);
    expect(duels.registration(result.tournamentId, alice)?.deck.main).toHaveLength(2);
    db.close();
  });

  it("registers a player who enters the draft's tournament later", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    const result = createDraftTournamentService(db).createTournamentFromDraft({
      draftId, format: "round_robin", createdByUserId: "u1",
    });
    db.prepare("update tournament_participants set deck_json = null, saved_deck_id = null, deck_registered_at = null where player_id = ?").run(bob);

    const service = createDraftDeckService(db);
    expect(service.linkTournament(result.tournamentId, bob)).toEqual([bob]);
    expect(createTournamentDuelService(db).registration(result.tournamentId, bob)).not.toBeNull();
    db.close();
  });
});

describe("making a tournament from a draft when the deck save fails", () => {
  it("still makes the tournament", () => {
    const db = new Database(":memory:");
    migrate(db);
    seed(db);
    const alice = addPlayer(db, "u1", "Alice");
    const bob = addPlayer(db, "u2", "Bob");
    const { draftId } = playDraft(db, [alice, bob], "u1");
    db.prepare("delete from saved_decks").run();
    db.prepare("update draft_players set deck_saved_at = null").run();
    // A failure outside the per-player saves: registering a deck on an entry breaks.
    db.exec(`create trigger fail_register before update of deck_json on tournament_participants
             begin select raise(abort, 'boom'); end`);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = createDraftTournamentService(db).createTournamentFromDraft({
      draftId, format: "round_robin", createdByUserId: "u1",
    });
    expect(result.tournamentId).toBeGreaterThan(0);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("[draft-tournament]"), expect.anything());
    expect(db.prepare("select tournament_id from drafts where id = ?").get(draftId)).toEqual({ tournament_id: result.tournamentId });
    log.mockRestore();
    db.close();
  });
});

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

describe("buildDraftDeck", () => {
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

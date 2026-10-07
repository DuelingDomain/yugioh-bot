import { seedUser } from "../helpers/identity.js";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { migrate } from "../../src/db/index.js";
import { createSavedDeckService, SavedDeckServiceError } from "../../src/services/saved-decks.js";

const databases: Database.Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function setup() {
  const db = new Database(":memory:");
  databases.push(db);
  migrate(db);
  migrate(db);
  return { db, decks: createSavedDeckService(db) };
}

const emptyDeck = { main: [] as number[], extra: [] as number[], side: [] as number[] };

function expectStatus(work: () => unknown, status: number) {
  try {
    work();
    throw new Error("expected SavedDeckServiceError");
  } catch (error) {
    expect(error).toBeInstanceOf(SavedDeckServiceError);
    expect((error as SavedDeckServiceError).status).toBe(status);
  }
}

describe("saved decks", () => {
  it("hides and refuses mutation of decks owned by another user or guild", () => {
    const { db, decks } = setup();
    const mine = decks.create("guild-a", seedUser(db, "user-a").userId, { name: "Mine", mode: "normal", deck: emptyDeck });

    expect(decks.list("guild-a", seedUser(db, "user-b").userId)).toEqual([]);
    expect(decks.list("guild-b", seedUser(db, "user-a").userId)).toEqual([]);
    expectStatus(() => decks.get(mine.id, "guild-a", seedUser(db, "user-b").userId), 404);
    expectStatus(() => decks.get(mine.id, "guild-b", seedUser(db, "user-a").userId), 404);
    expectStatus(
      () => decks.update(mine.id, "guild-a", seedUser(db, "user-b").userId, { name: "Hijack", mode: "domain", deck: emptyDeck }),
      404,
    );
    expectStatus(() => decks.delete(mine.id, "guild-b", seedUser(db, "user-a").userId), 404);

    expect(decks.get(mine.id, "guild-a", seedUser(db, "user-a").userId).name).toBe("Mine");
    expect(decks.list("guild-a", seedUser(db, "user-a").userId).map((row) => row.id)).toEqual([mine.id]);
  });

  it("rejects structurally unsafe names, modes, sections, and card codes", () => {
    const { db, decks } = setup();
    const tooLong = "x".repeat(101);
    const tooMany = Array.from({ length: 301 }, (_, i) => i + 1);

    expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: "  ", mode: "normal", deck: emptyDeck }), 400);
    expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: tooLong, mode: "normal", deck: emptyDeck }), 400);
    expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "goat", deck: emptyDeck }), 400);
    expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "normal", deck: { main: [], extra: [] } }), 400);
    expectStatus(
      () => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "normal", deck: { main: tooMany, extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "normal", deck: { main: [0], extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "normal", deck: { main: [1.5], extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "normal", deck: { main: [4294967296], extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", seedUser(db, "u").userId, { name: "Blue", mode: "normal", deck: { ...emptyDeck, deckMaster: 0 } }),
      400,
    );
    expect(decks.list("g", seedUser(db, "u").userId)).toEqual([]);
  });

  it("updates owned decks and deletes them without leaving a readable row", () => {
    const { db, decks } = setup();
    const created = decks.create("g", seedUser(db, "u").userId, { name: "Draft", mode: "normal", deck: emptyDeck });
    const updated = decks.update(created.id, "g", seedUser(db, "u").userId, {
      name: "  Domain WIP  ",
      mode: "domain",
      deck: { main: [8994370], extra: [], side: [14558127], deckMaster: 74677422 },
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Domain WIP");
    expect(updated.mode).toBe("domain");
    expect(updated.deck).toEqual({ main: [8994370], extra: [], side: [14558127], deckMaster: 74677422 });
    expect(decks.get(created.id, "g", seedUser(db, "u").userId)).toEqual(updated);

    decks.delete(created.id, "g", seedUser(db, "u").userId);
    expect(decks.list("g", seedUser(db, "u").userId)).toEqual([]);
    expectStatus(() => decks.get(created.id, "g", seedUser(db, "u").userId), 404);
    expectStatus(() => decks.delete(created.id, "g", seedUser(db, "u").userId), 404);
  });

  it("saves incomplete and play-illegal decks without dropping cards or reordering", () => {
    const { db, decks } = setup();
    const payload = {
      main: [14558127, 14558127, 89631139, 14558127],
      extra: Array.from({ length: 20 }, () => 23995328),
      side: [83764718, 55144522],
      deckMaster: 74677422,
    };
    const saved = decks.create("g", seedUser(db, "u").userId, { name: "WIP", mode: "domain", deck: payload });
    expect(saved.deck).toEqual(payload);
    expect(saved.deck.main).toEqual([14558127, 14558127, 89631139, 14558127]);
    expect(saved.deck.extra).toHaveLength(20);

    const boundary = decks.create("g", seedUser(db, "u").userId, {
      name: "Cap",
      mode: "normal",
      deck: { main: [1], extra: Array.from({ length: 300 }, () => 2), side: [] },
    });
    expect(boundary.deck.extra).toHaveLength(300);
    expect(boundary.deck.main).toEqual([1]);
    expect(boundary.deck.deckMaster).toBeUndefined();
  });
});

describe("saved decks built from a draft pool", () => {
  function addDraft(db: Database.Database, name = "Draft") {
    return Number(
      db.prepare("insert into drafts (guild_id, channel_id, name, status, created_by_user_id) values ('g', 'ch', ?, 'completed', ?)").run(name, seedUser(db, "u").userId).lastInsertRowid,
    );
  }

  it("stores, returns and finds a draft deck; plain decks have a null draft id", () => {
    const { db, decks } = setup();
    const draftId = addDraft(db);
    const plain = decks.create("g", seedUser(db, "u").userId, { name: "Plain", mode: "normal", deck: emptyDeck });
    expect(plain.draftId).toBeNull();

    // A draft deck may be smaller than 40 main cards.
    const small = { main: [1, 2, 3], extra: [], side: [] };
    const made = decks.create("g", seedUser(db, "u").userId, { name: "Drafted", mode: "normal", deck: small, draftId });
    expect(made.draftId).toBe(draftId);
    expect(decks.get(made.id, "g", seedUser(db, "u").userId).draftId).toBe(draftId);
    expect(decks.list("g", seedUser(db, "u").userId).find((row) => row.id === made.id)?.draftId).toBe(draftId);

    expect(decks.findByDraft("g", seedUser(db, "u").userId, draftId)?.id).toBe(made.id);
    expect(decks.findByDraft("g", seedUser(db, "other").userId, draftId)).toBeNull();
    expect(decks.findByDraft("other", seedUser(db, "u").userId, draftId)).toBeNull();
    expect(decks.findByDraft("g", seedUser(db, "u").userId, draftId + 1)).toBeNull();
  });

  it("validates the draft id", () => {
    const { db, decks } = setup();
    for (const draftId of [0, -1, 1.5, "3", NaN, {}]) {
      expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: "X", mode: "normal", deck: emptyDeck, draftId }), 400);
    }
    expect(decks.create("g", seedUser(db, "u").userId, { name: "Null", mode: "normal", deck: emptyDeck, draftId: null }).draftId).toBeNull();
  });

  it("allows one deck per owner per draft", () => {
    const { db, decks } = setup();
    const draftId = addDraft(db);
    decks.create("g", seedUser(db, "u").userId, { name: "First", mode: "normal", deck: emptyDeck, draftId });
    expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: "Second", mode: "normal", deck: emptyDeck, draftId }), 409);
    // Other owners and other drafts are separate.
    decks.create("g", seedUser(db, "v").userId, { name: "Theirs", mode: "normal", deck: emptyDeck, draftId });
    decks.create("g", seedUser(db, "u").userId, { name: "Other draft", mode: "normal", deck: emptyDeck, draftId: addDraft(db, "D2") });
    expect(decks.list("g", seedUser(db, "u").userId)).toHaveLength(2);
  });

  it("maps an unknown draft to 404 and a clash on update to 409", () => {
    const { db, decks } = setup();
    db.pragma("foreign_keys = on");
    expectStatus(() => decks.create("g", seedUser(db, "u").userId, { name: "X", mode: "normal", deck: emptyDeck, draftId: 4242 }), 404);

    const a = addDraft(db, "A");
    const b = addDraft(db, "B");
    decks.create("g", seedUser(db, "u").userId, { name: "A deck", mode: "normal", deck: emptyDeck, draftId: a });
    const two = decks.create("g", seedUser(db, "u").userId, { name: "B deck", mode: "normal", deck: emptyDeck, draftId: b });
    expectStatus(() => decks.update(two.id, "g", seedUser(db, "u").userId, { name: "B deck", mode: "normal", deck: emptyDeck, draftId: a }), 409);
    expect(decks.get(two.id, "g", seedUser(db, "u").userId).draftId).toBe(b);
  });

  it("keeps the stored draft id on update unless one is given", () => {
    const { db, decks } = setup();
    const draftId = addDraft(db);
    const made = decks.create("g", seedUser(db, "u").userId, { name: "D", mode: "normal", deck: emptyDeck, draftId });
    const kept = decks.update(made.id, "g", seedUser(db, "u").userId, { name: "Renamed", mode: "normal", deck: { main: [7], extra: [], side: [] } });
    expect(kept.draftId).toBe(draftId);
    expect(kept.name).toBe("Renamed");
    expect(kept.deck.main).toEqual([7]);
    expect(decks.update(made.id, "g", seedUser(db, "u").userId, { name: "D", mode: "normal", deck: emptyDeck, draftId: null }).draftId).toBeNull();
  });
});


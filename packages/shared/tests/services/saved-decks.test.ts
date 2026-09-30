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
    const { decks } = setup();
    const mine = decks.create("guild-a", "user-a", { name: "Mine", mode: "normal", deck: emptyDeck });

    expect(decks.list("guild-a", "user-b")).toEqual([]);
    expect(decks.list("guild-b", "user-a")).toEqual([]);
    expectStatus(() => decks.get(mine.id, "guild-a", "user-b"), 404);
    expectStatus(() => decks.get(mine.id, "guild-b", "user-a"), 404);
    expectStatus(
      () => decks.update(mine.id, "guild-a", "user-b", { name: "Hijack", mode: "domain", deck: emptyDeck }),
      404,
    );
    expectStatus(() => decks.delete(mine.id, "guild-b", "user-a"), 404);

    expect(decks.get(mine.id, "guild-a", "user-a").name).toBe("Mine");
    expect(decks.list("guild-a", "user-a").map((row) => row.id)).toEqual([mine.id]);
  });

  it("rejects structurally unsafe names, modes, sections, and card codes", () => {
    const { decks } = setup();
    const tooLong = "x".repeat(101);
    const tooMany = Array.from({ length: 301 }, (_, i) => i + 1);

    expectStatus(() => decks.create("g", "u", { name: "  ", mode: "normal", deck: emptyDeck }), 400);
    expectStatus(() => decks.create("g", "u", { name: tooLong, mode: "normal", deck: emptyDeck }), 400);
    expectStatus(() => decks.create("g", "u", { name: "Blue", mode: "goat", deck: emptyDeck }), 400);
    expectStatus(() => decks.create("g", "u", { name: "Blue", mode: "normal", deck: { main: [], extra: [] } }), 400);
    expectStatus(
      () => decks.create("g", "u", { name: "Blue", mode: "normal", deck: { main: tooMany, extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", "u", { name: "Blue", mode: "normal", deck: { main: [0], extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", "u", { name: "Blue", mode: "normal", deck: { main: [1.5], extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", "u", { name: "Blue", mode: "normal", deck: { main: [4294967296], extra: [], side: [] } }),
      400,
    );
    expectStatus(
      () => decks.create("g", "u", { name: "Blue", mode: "normal", deck: { ...emptyDeck, deckMaster: 0 } }),
      400,
    );
    expect(decks.list("g", "u")).toEqual([]);
  });

  it("updates owned decks and deletes them without leaving a readable row", () => {
    const { decks } = setup();
    const created = decks.create("g", "u", { name: "Draft", mode: "normal", deck: emptyDeck });
    const updated = decks.update(created.id, "g", "u", {
      name: "  Domain WIP  ",
      mode: "domain",
      deck: { main: [8994370], extra: [], side: [14558127], deckMaster: 74677422 },
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("Domain WIP");
    expect(updated.mode).toBe("domain");
    expect(updated.deck).toEqual({ main: [8994370], extra: [], side: [14558127], deckMaster: 74677422 });
    expect(decks.get(created.id, "g", "u")).toEqual(updated);

    decks.delete(created.id, "g", "u");
    expect(decks.list("g", "u")).toEqual([]);
    expectStatus(() => decks.get(created.id, "g", "u"), 404);
    expectStatus(() => decks.delete(created.id, "g", "u"), 404);
  });

  it("saves incomplete and play-illegal decks without dropping cards or reordering", () => {
    const { decks } = setup();
    const payload = {
      main: [14558127, 14558127, 89631139, 14558127],
      extra: Array.from({ length: 20 }, () => 23995328),
      side: [83764718, 55144522],
      deckMaster: 74677422,
    };
    const saved = decks.create("g", "u", { name: "WIP", mode: "domain", deck: payload });
    expect(saved.deck).toEqual(payload);
    expect(saved.deck.main).toEqual([14558127, 14558127, 89631139, 14558127]);
    expect(saved.deck.extra).toHaveLength(20);

    const boundary = decks.create("g", "u", {
      name: "Cap",
      mode: "normal",
      deck: { main: [1], extra: Array.from({ length: 300 }, () => 2), side: [] },
    });
    expect(boundary.deck.extra).toHaveLength(300);
    expect(boundary.deck.main).toEqual([1]);
    expect(boundary.deck.deckMaster).toBeUndefined();
  });
});

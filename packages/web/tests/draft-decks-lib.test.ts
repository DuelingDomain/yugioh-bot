import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {} as never;
const DECK = { main: [1, 2, 3], extra: [], side: [] };

describe("web draft deck helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ getDb: () => db }));
  });
  afterEach(() => {
    vi.doUnmock("@yugidraft/shared/services");
    vi.restoreAllMocks();
  });

  it("calls the shared draft deck service", async () => {
    const service = {
      ensureForUser: vi.fn(() => [1]),
      linkTournament: vi.fn(() => [7]),
      mainPoolCount: vi.fn(() => 52),
    };
    const draftDeckNote = vi.fn(() => ({ level: "optional", mainCount: 3, message: "m" }));
    vi.doMock("@yugidraft/shared/services", () => ({ createDraftDeckService: () => service, draftDeckNote }));
    const lib = await import("@/lib/draft-decks");

    lib.backfillDraftDecks("g1", 101);
    lib.linkDraftDeck(4, 7);
    expect(service.ensureForUser).toHaveBeenCalledWith("g1", 101);
    expect(service.linkTournament).toHaveBeenCalledWith(4, 7);
    expect(lib.draftDeckNoteFor(db, { draftId: 9, playerId: 7, deck: DECK })).toEqual({ level: "optional", mainCount: 3, message: "m" });
    expect(service.mainPoolCount).toHaveBeenCalledWith(9, 7);
    expect(draftDeckNote).toHaveBeenCalledWith(DECK, 52);
  });

  it("never throws when the service fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const boom = () => { throw new Error("db is locked"); };
    vi.doMock("@yugidraft/shared/services", () => ({
      createDraftDeckService: () => ({ ensureForUser: boom, linkTournament: boom, mainPoolCount: boom }),
      draftDeckNote: boom,
    }));
    const lib = await import("@/lib/draft-decks");
    expect(() => lib.backfillDraftDecks("g1", 101)).not.toThrow();
    expect(() => lib.linkDraftDeck(4, 7)).not.toThrow();
    expect(lib.draftDeckNoteFor(db, { draftId: 9, playerId: 7, deck: DECK })).toBeNull();
  });

  it("does nothing when the shared build has no draft deck service", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.doMock("@yugidraft/shared/services", () => ({}));
    const lib = await import("@/lib/draft-decks");
    expect(() => lib.backfillDraftDecks("g1", 101)).not.toThrow();
    expect(() => lib.linkDraftDeck(4, 7)).not.toThrow();
    expect(lib.draftDeckNoteFor(db, { draftId: 9, playerId: 7, deck: DECK })).toBeNull();
  });
});

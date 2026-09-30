import { describe, expect, it, vi } from "vitest";
import { generateYdk, downloadYdk } from "../src/lib/ydk.js";
import {
  applyDomainMaster,
  parseYdk,
  selectDomainMaster,
  serializeYdk,
} from "../src/components/duel/ydk.js";

describe("generateYdk", () => {
  it("generates YDK with main deck cards only", () => {
    const cards = [
      { id: 46986414, frameType: "normal" },
      { id: 53183600, frameType: "spell" },
      { id: 12580477, frameType: "trap" },
    ];

    const result = generateYdk(cards);

    expect(result).toBe(
      "#main\n46986414\n53183600\n12580477\n#extra\n\n!side\n",
    );
  });

  it("generates YDK with extra deck monsters", () => {
    const cards = [
      { id: 21123811, frameType: "fusion" },
      { id: 44508094, frameType: "synchro" },
      { id: 84013237, frameType: "xyz" },
      { id: 41420027, frameType: "link" },
    ];

    const result = generateYdk(cards);

    expect(result).toBe(
      "#main\n#extra\n21123811\n44508094\n84013237\n41420027\n\n!side\n",
    );
  });

  it("generates YDK with mixed main and extra deck cards", () => {
    const cards = [
      { id: 46986414, frameType: "normal" },
      { id: 21123811, frameType: "fusion" },
      { id: 53183600, frameType: "spell" },
      { id: 44508094, frameType: "synchro" },
      { id: 12580477, frameType: "trap" },
    ];

    const result = generateYdk(cards);

    expect(result).toBe(
      "#main\n46986414\n53183600\n12580477\n#extra\n21123811\n44508094\n\n!side\n",
    );
  });

  it("includes ritual monsters in main deck", () => {
    const cards = [{ id: 86327276, frameType: "ritual" }];

    const result = generateYdk(cards);

    expect(result).toBe("#main\n86327276\n#extra\n\n!side\n");
  });

  it("classifies pendulum extra deck variants as extra deck", () => {
    const cards = [
      { id: 10000000, frameType: "fusion_pendulum" },
      { id: 10000001, frameType: "synchro_pendulum" },
      { id: 10000002, frameType: "xyz_pendulum" },
    ];

    const result = generateYdk(cards);

    expect(result).toBe(
      "#main\n#extra\n10000000\n10000001\n10000002\n\n!side\n",
    );
  });

  it("preserves duplicate card quantities in output", () => {
    const cards = [
      { id: 46986414, frameType: "normal" },
      { id: 46986414, frameType: "normal" },
      { id: 21123811, frameType: "fusion" },
      { id: 21123811, frameType: "fusion" },
      { id: 21123811, frameType: "fusion" },
    ];

    const result = generateYdk(cards);

    expect(result).toBe(
      "#main\n46986414\n46986414\n#extra\n21123811\n21123811\n21123811\n\n!side\n",
    );
  });

  it("generates empty side section even with no cards", () => {
    const result = generateYdk([]);

    expect(result).toBe("#main\n#extra\n\n!side\n");
  });
});

describe("downloadYdk", () => {
  it("creates correct Blob and triggers download with given filename", () => {
    vi.useFakeTimers();

    const cards = [
      { id: 46986414, frameType: "normal" },
      { id: 21123811, frameType: "fusion" },
    ];

    const createObjectURLSpy = vi.fn((_: Blob) => "blob:test-url");
    const revokeObjectURLSpy = vi.fn();
    const clickSpy = vi.fn();

    vi.stubGlobal("URL", {
      createObjectURL: createObjectURLSpy,
      revokeObjectURL: revokeObjectURLSpy,
    });

    const mockAnchor = {
      href: "",
      download: "",
      click: clickSpy,
    };

    const appendChildSpy = vi.fn();
    const removeChildSpy = vi.fn();

    vi.stubGlobal("document", {
      createElement: vi.fn(() => mockAnchor),
      body: {
        appendChild: appendChildSpy,
        removeChild: removeChildSpy,
      },
    });

    downloadYdk(cards, "my-deck.ydk");

    expect(createObjectURLSpy).toHaveBeenCalledOnce();
    const blob = createObjectURLSpy.mock.calls[0][0];
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("text/plain");

    expect(mockAnchor.download).toBe("my-deck.ydk");
    expect(mockAnchor.href).toBe("blob:test-url");
    expect(appendChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(clickSpy).toHaveBeenCalledOnce();
    expect(removeChildSpy).toHaveBeenCalledWith(mockAnchor);
    expect(revokeObjectURLSpy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60000);
    expect(revokeObjectURLSpy).toHaveBeenCalledWith("blob:test-url");

    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});

function inventory(deck: { main: number[]; extra: number[]; side: number[]; deckMaster?: number }): number[] {
  return [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster != null ? [deck.deckMaster] : [])].slice().sort((a, b) => a - b);
}

describe("selectDomainMaster", () => {
  it("promotes one Main Deck card so 61 becomes 60 without mutating the input", () => {
    const main = Array.from({ length: 61 }, (_, i) => i + 1);
    const extra: number[] = [];
    const side: number[] = [];
    Object.freeze(main);
    Object.freeze(extra);
    Object.freeze(side);
    const deck = Object.freeze({ main, extra, side });
    const result = selectDomainMaster(Object.freeze({ deck, masterOrigin: null }), 61);
    expect(result.deck.main).toHaveLength(60);
    expect(result.deck.main).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    expect(result.deck.deckMaster).toBe(61);
    expect(result.masterOrigin).toEqual({ section: "main", index: 60 });
    expect(main).toHaveLength(61);
    expect(result.deck.extra).toBe(extra);
    expect(result.deck.side).toBe(side);
  });

  it("moves one Extra Deck copy into the Deck Master slot", () => {
    const main = [1];
    const extra = [7, 8, 9];
    const side: number[] = [];
    const result = selectDomainMaster({ deck: { main, extra, side }, masterOrigin: null }, 8);
    expect(result.deck.extra).toEqual([7, 9]);
    expect(result.deck.deckMaster).toBe(8);
    expect(result.masterOrigin).toEqual({ section: "extra", index: 1 });
    expect(result.deck.main).toBe(main);
    expect(result.deck.side).toBe(side);
    expect(extra).toEqual([7, 8, 9]);
  });

  it("moves one Side Deck copy into the Deck Master slot", () => {
    const main = [1];
    const extra: number[] = [];
    const side = [11, 12];
    const result = selectDomainMaster({ deck: { main, extra, side }, masterOrigin: null }, 11);
    expect(result.deck.side).toEqual([12]);
    expect(result.deck.deckMaster).toBe(11);
    expect(result.masterOrigin).toEqual({ section: "side", index: 0 });
    expect(result.deck.main).toBe(main);
    expect(result.deck.extra).toBe(extra);
    expect(side).toEqual([11, 12]);
  });

  it("removes the first Main then Extra then Side match rather than every copy", () => {
    const result = selectDomainMaster(
      { deck: { main: [5, 5], extra: [5], side: [5] }, masterOrigin: null },
      5,
    );
    expect(result.deck.main).toEqual([5]);
    expect(result.deck.extra).toEqual([5]);
    expect(result.deck.side).toEqual([5]);
    expect(result.masterOrigin).toEqual({ section: "main", index: 0 });
  });

  it("replacing or clearing a master conserves the card multiset and restores the promoted card", () => {
    const original = { main: [1, 2, 3], extra: [4, 5], side: [6] };
    const first = selectDomainMaster({ deck: original, masterOrigin: null }, 2);
    const replaced = selectDomainMaster(first, 5);
    expect(inventory(replaced.deck)).toEqual(inventory(original));
    expect(replaced.deck.main).toEqual([1, 2, 3]);
    expect(replaced.deck.extra).toEqual([4]);
    expect(replaced.deck.side).toEqual([6]);
    expect(replaced.deck.deckMaster).toBe(5);
    expect(replaced.masterOrigin).toEqual({ section: "extra", index: 1 });
    expect(original).toEqual({ main: [1, 2, 3], extra: [4, 5], side: [6] });

    const cleared = selectDomainMaster(replaced);
    expect(cleared.deck.deckMaster).toBeUndefined();
    expect(cleared.masterOrigin).toBeNull();
    expect(cleared.deck.main).toEqual([1, 2, 3]);
    expect(cleared.deck.extra).toEqual([4, 5]);
    expect(cleared.deck.side).toEqual([6]);
    expect(inventory(cleared.deck)).toEqual(inventory(original));
  });

  it("keeps a 60-card Main Deck intact when the master is chosen externally", () => {
    const main = Array.from({ length: 60 }, (_, i) => i + 1);
    const extra: number[] = [];
    const side: number[] = [];
    const result = selectDomainMaster({ deck: { main, extra, side }, masterOrigin: null }, 999);
    expect(result.deck.main).toHaveLength(60);
    expect(result.deck.main).toBe(main);
    expect(result.deck.extra).toBe(extra);
    expect(result.deck.side).toBe(side);
    expect(result.deck.deckMaster).toBe(999);
    expect(result.masterOrigin).toBeNull();
  });

  it("does not silently remove remaining duplicate copies", () => {
    const result = selectDomainMaster(
      { deck: { main: [10, 10, 20], extra: [], side: [] }, masterOrigin: null },
      10,
    );
    expect(result.deck.main).toEqual([10, 20]);
    expect(result.deck.deckMaster).toBe(10);
    expect(result.masterOrigin).toEqual({ section: "main", index: 0 });
  });

  it("selecting the current master is idempotent including when duplicates remain", () => {
    const first = selectDomainMaster(
      { deck: { main: [10, 10, 20], extra: [], side: [] }, masterOrigin: null },
      10,
    );
    const second = selectDomainMaster(first, 10);
    expect(second.deck.main).toEqual([10, 20]);
    expect(second.deck.main).toBe(first.deck.main);
    expect(second.deck.extra).toBe(first.deck.extra);
    expect(second.deck.side).toBe(first.deck.side);
    expect(second.deck.deckMaster).toBe(10);
    expect(second.masterOrigin).toEqual({ section: "main", index: 0 });
    expect(second.masterOrigin).toBe(first.masterOrigin);
  });

  it("restores a previous master at a clamped origin index after intervening edits", () => {
    const selected = selectDomainMaster(
      { deck: { main: [1, 2, 3, 4], extra: [], side: [] }, masterOrigin: null },
      3,
    );
    const edited = {
      deck: { ...selected.deck, main: [1] },
      masterOrigin: selected.masterOrigin,
    };
    const cleared = selectDomainMaster(edited);
    expect(cleared.deck.main).toEqual([1, 3]);
    expect(cleared.deck.deckMaster).toBeUndefined();
    expect(cleared.masterOrigin).toBeNull();
  });
});

describe("Domain deck imports", () => {
  it("rejects multiple Side Deck cards instead of silently discarding them when no master is embedded", () => {
    expect(() => applyDomainMaster({ main: [1], extra: [], side: [2, 3] })).toThrow();
  });

  it("extracts a sole Side card as Deck Master when the import has no embedded master", () => {
    const side = [9];
    const deck = { main: [1, 2], extra: [3], side };
    expect(applyDomainMaster(deck)).toEqual({
      main: [1, 2],
      extra: [3],
      side: [],
      deckMaster: 9,
    });
    expect(side).toEqual([9]);
    expect(deck.side).toBe(side);
  });

  it("preserves a conflicting Side Deck when a master is already embedded", () => {
    const deck = { main: [1], extra: [], side: [2, 3], deckMaster: 9 };
    expect(applyDomainMaster(deck)).toEqual(deck);
    expect(applyDomainMaster({ main: [1], extra: [], side: [2], deckMaster: 8 })).toEqual({
      main: [1],
      extra: [],
      side: [2],
      deckMaster: 8,
    });
  });
});

describe("YDK deck master serialization", () => {
  it("leaves standard YDK parse and serialize unchanged when no master is selected", () => {
    const deck = { main: [46986414, 53183600], extra: [44508094], side: [12580477] };
    const text = serializeYdk(deck);
    expect(text).toBe("#main\n46986414\n53183600\n#extra\n44508094\n!side\n12580477\n");
    expect(text.toLowerCase()).not.toContain("deckmaster");
    expect(parseYdk(text)).toEqual(deck);
    expect(parseYdk(text).deckMaster).toBeUndefined();
  });

  it("round-trips an explicit master before #main including a custom Side Deck", () => {
    const deck = { main: [1, 2], extra: [3], side: [4, 5], deckMaster: 9 };
    const text = serializeYdk(deck);
    expect(text.startsWith("#deckmaster\n9\n#main\n")).toBe(true);
    expect(parseYdk(text)).toEqual(deck);
  });

  it("rejects malformed or multiple #deckmaster entries instead of dropping them", () => {
    expect(() => parseYdk("#deckmaster\n1\n2\n#main\n3\n")).toThrow();
    expect(() => parseYdk("#deckmaster\nabc\n#main\n1\n")).toThrow();
    expect(() => parseYdk("#deckmaster\n1\n#main\n2\n#deckmaster\n3\n")).toThrow();
    expect(() => parseYdk("#deckmaster\n0\n#main\n1\n")).toThrow();
  });
});

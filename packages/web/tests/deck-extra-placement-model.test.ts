import { describe, expect, it } from "vitest";
import type { DragEvent } from "react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import type { DeckMasterSelection } from "../src/components/duel/ydk";
import {
  CARD_DETAILS_PENDING_MESSAGE,
  EXTRA_MONSTER_MAIN_MESSAGE,
  MAIN_MONSTER_EXTRA_MESSAGE,
  SPELL_TRAP_EXTRA_MESSAGE,
  cardKind,
  defaultAddSection,
  fixMisplaced,
  isExtraDeckCard,
  misplacedCards,
  placementBlock,
  placementBlockForKind,
} from "../src/components/decks/model";
import { CARD_DRAG_TYPE, dragCardKind, hasCardDrag, readCardDrag, writeCardDrag } from "../src/components/decks/drag";
import { MOVED_CARDS_FIELD, movedCardsNote } from "../src/components/decks/import";

const NORMAL = 0x11;
const SPELL = 0x2;
const TRAP = 0x4;
const FUSION = 0x41;
const SYNCHRO = 0x2001;
const XYZ = 0x800001;
const LINK = 0x4000001;
const PENDULUM_NORMAL = 0x1000021;
const PENDULUM_FUSION = 0x1000041;

function info(code: number, type: number): DeckCardInfo {
  return { code, name: `Card ${code}`, description: "", type, attack: 0, defense: 0, level: 4, attribute: 0, race: "", alias: 0, setcodes: [], lscale: 0, rscale: 0, arrows: 0, ot: 3 };
}

const catalog = new Map([
  [1, info(1, NORMAL)], [2, info(2, SPELL)], [3, info(3, TRAP)], [4, info(4, FUSION)],
  [5, info(5, SYNCHRO)], [6, info(6, XYZ)], [7, info(7, LINK)], [8, info(8, PENDULUM_NORMAL)],
]);

describe("which cards are Extra Deck cards", () => {
  it.each([FUSION, SYNCHRO, XYZ, LINK, PENDULUM_FUSION])("accepts type %i", (type) => {
    expect(isExtraDeckCard({ type })).toBe(true);
    expect(defaultAddSection({ type })).toBe("extra");
  });

  it.each([NORMAL, SPELL, TRAP, PENDULUM_NORMAL, 0x20002 /* Ritual Spell */, 0x20004 /* Counter Trap */])("rejects type %i", (type) => {
    expect(isExtraDeckCard({ type })).toBe(false);
    expect(defaultAddSection({ type })).toBe("main");
  });

  it("does not take a Spell or Trap that carries an Extra Deck bit", () => {
    expect(isExtraDeckCard({ type: SPELL | 0x40 })).toBe(false);
    expect(isExtraDeckCard({ type: TRAP | 0x800000 })).toBe(false);
  });

  it("names the kind of a card", () => {
    expect(cardKind({ type: FUSION })).toBe("extra");
    expect(cardKind({ type: SPELL })).toBe("spelltrap");
    expect(cardKind({ type: TRAP })).toBe("spelltrap");
    expect(cardKind({ type: PENDULUM_NORMAL })).toBe("monster");
  });
});

describe("placement block", () => {
  it("blocks a Spell or Trap in Extra with the clear message", () => {
    expect(placementBlockForKind("spelltrap", "extra")).toBe("Spell and Trap cards cannot go in the Extra Deck.");
    expect(placementBlock(catalog.get(2), "extra")).toBe(SPELL_TRAP_EXTRA_MESSAGE);
    expect(placementBlock(catalog.get(3), "extra", "side")).toBe(SPELL_TRAP_EXTRA_MESSAGE);
  });

  it("blocks a main-deck monster, a Pendulum one included, in Extra", () => {
    expect(placementBlock(catalog.get(1), "extra")).toBe(MAIN_MONSTER_EXTRA_MESSAGE);
    expect(placementBlock(catalog.get(8), "extra")).toBe(MAIN_MONSTER_EXTRA_MESSAGE);
  });

  it("blocks an Extra Deck monster in Main", () => {
    for (const code of [4, 5, 6, 7]) expect(placementBlock(catalog.get(code), "main")).toBe(EXTRA_MONSTER_MAIN_MESSAGE);
  });

  it("allows the legal placements and anything in Side", () => {
    expect(placementBlock(catalog.get(4), "extra")).toBeNull();
    expect(placementBlock(catalog.get(2), "main")).toBeNull();
    expect(placementBlock(catalog.get(8), "main")).toBeNull();
    for (const code of catalog.keys()) expect(placementBlock(catalog.get(code), "side")).toBeNull();
  });

  it("does not guess for a card without details", () => {
    expect(placementBlock(undefined, "extra")).toBe(CARD_DETAILS_PENDING_MESSAGE);
    expect(placementBlock(undefined, "main", "side")).toBe(CARD_DETAILS_PENDING_MESSAGE);
    expect(placementBlock(undefined, "side", "extra")).toBeNull();
    expect(placementBlock(undefined, "extra", "extra")).toBeNull();
  });
});

describe("misplaced cards of a deck", () => {
  it("lists the cards in a section that does not take them", () => {
    const found = misplacedCards({ main: [1, 4, 2], extra: [2, 4, 8, 3, 7], side: [2, 4] }, catalog);
    expect(found).toEqual({ inExtra: [2, 8, 3], inMain: [4] });
  });

  it("leaves cards without details alone", () => {
    expect(misplacedCards({ main: [99], extra: [98], side: [] }, catalog)).toEqual({ inExtra: [], inMain: [] });
  });
});

describe("fix misplaced cards", () => {
  const selection = (deck: DeckMasterSelection["deck"], masterOrigin: DeckMasterSelection["masterOrigin"] = null): DeckMasterSelection => ({ deck, masterOrigin });

  it("moves non-Extra cards from Extra to the end of Main and keeps their order", () => {
    const fixed = fixMisplaced(selection({ main: [1], extra: [2, 4, 8, 3], side: [2] }), catalog, "extra");
    expect(fixed.deck).toEqual({ main: [1, 2, 8, 3], extra: [4], side: [2] });
  });

  it("moves Extra monsters from Main to the end of Extra", () => {
    const fixed = fixMisplaced(selection({ main: [4, 1, 5], extra: [7], side: [] }), catalog, "main");
    expect(fixed.deck).toEqual({ main: [1], extra: [7, 4, 5], side: [] });
  });

  it("returns the same selection when nothing is misplaced", () => {
    const clean = selection({ main: [1, 2], extra: [4], side: [] });
    expect(fixMisplaced(clean, catalog, "extra")).toBe(clean);
    expect(fixMisplaced(clean, catalog, "main")).toBe(clean);
  });

  it("keeps the Deck Master position in the section it leaves", () => {
    const fixed = fixMisplaced(selection({ main: [], extra: [2, 4, 5], side: [] }, { section: "extra", index: 2 }), catalog, "extra");
    expect(fixed.deck.extra).toEqual([4, 5]);
    expect(fixed.masterOrigin).toEqual({ section: "extra", index: 1 });
  });
});

describe("card kind in a drag", () => {
  function fakeEvent(): DragEvent<Element> {
    const data = new Map<string, string>();
    const dataTransfer = {
      effectAllowed: "all",
      get types() { return [...data.keys()]; },
      setData: (type: string, value: string) => void data.set(type, value),
      getData: (type: string) => data.get(type) ?? "",
    };
    return { dataTransfer } as unknown as DragEvent<Element>;
  }

  it("tells the kind at dragover time through the types", () => {
    for (const kind of ["extra", "spelltrap", "monster"] as const) {
      const event = fakeEvent();
      writeCardDrag(event, { code: 5, from: "list" }, kind);
      expect(hasCardDrag(event)).toBe(true);
      expect(dragCardKind(event)).toBe(kind);
      expect(readCardDrag(event)).toEqual({ code: 5, from: "list" });
    }
  });

  it("says nothing when the kind is not known", () => {
    const event = fakeEvent();
    writeCardDrag(event, { code: 5, from: "main", index: 1 });
    expect(dragCardKind(event)).toBeNull();
    expect(event.dataTransfer?.types).toContain(CARD_DRAG_TYPE);
  });

  it("refuses by kind the same way as by card", () => {
    expect(placementBlockForKind("spelltrap", "extra")).toBe(SPELL_TRAP_EXTRA_MESSAGE);
    expect(placementBlockForKind("extra", "main")).toBe(EXTRA_MONSTER_MAIN_MESSAGE);
    expect(placementBlockForKind("monster", "main")).toBeNull();
  });
});

describe("moved-cards note of an import", () => {
  it("counts a number", () => {
    expect(movedCardsNote({ [MOVED_CARDS_FIELD]: 1 })).toMatch(/^1 card was moved to the Main Deck\./);
    expect(movedCardsNote({ [MOVED_CARDS_FIELD]: 4 })).toMatch(/^4 cards were moved to the Main Deck\./);
  });

  it("names up to three cards of a list", () => {
    expect(movedCardsNote({ [MOVED_CARDS_FIELD]: ["A", "B"] })).toContain("(A, B)");
    expect(movedCardsNote({ [MOVED_CARDS_FIELD]: ["A", "B", "C", "D"] })).toContain("(A, B, C, …)");
  });

  it("is null when nothing moved or the field is missing", () => {
    for (const value of [null, undefined, {}, { [MOVED_CARDS_FIELD]: 0 }, { [MOVED_CARDS_FIELD]: [] }, { [MOVED_CARDS_FIELD]: "x" }, "text"]) {
      expect(movedCardsNote(value)).toBeNull();
    }
  });
});

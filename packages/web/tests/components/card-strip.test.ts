import { describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelPrompt } from "@yugidraft/shared/duels";

vi.mock("next/font/google", () => {
  const font = () => ({ className: "font", variable: "font-var", style: {} });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

import { cardsPerRow, stripOverflow, stripOverflowY, stripPageScroll, stripPageScrollY, stripScrollLeft, stripScrollTop } from "@/components/duel/card-strip";
import { choiceStripItems, isChainStripPrompt, isStripPrompt } from "@/components/duel/prompt-center";
import { rowStep } from "@/components/duel/multi-seat";
import { nextAnswerableId } from "@/components/duel/prompt-reveal";

const card = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior",
});
const cardOptions = [1, 2, 3].map((code) => ({ id: `select:${code}`, label: `Card ${code}`, card: card(code) }));

function prompt(overrides: Partial<DuelPrompt>): DuelPrompt {
  return { id: "p", seat: 0, kind: "toggle", title: "Select the card(s) to add to your hand", options: cardOptions, ...overrides };
}

describe("isStripPrompt", () => {
  it("shows a pick among cards as a strip", () => {
    expect(isStripPrompt(prompt({ kind: "toggle" }))).toBe(true);
    expect(isStripPrompt(prompt({ kind: "cards", min: 1, max: 2 }))).toBe(true);
    expect(isStripPrompt(prompt({ kind: "tribute" }))).toBe(true);
    expect(isStripPrompt(prompt({ kind: "sum" }))).toBe(true);
    expect(isStripPrompt(prompt({ kind: "order" }))).toBe(true);
  });

  it("leaves option lists without cards, and the other layouts, alone", () => {
    expect(isStripPrompt(prompt({ options: [] }))).toBe(false);
    expect(isStripPrompt(prompt({ options: [...cardOptions, { id: "x", label: "Zone" }] }))).toBe(false);
    expect(isStripPrompt(prompt({ kind: "places" }))).toBe(false);
    expect(isStripPrompt(prompt({ kind: "counters" }))).toBe(false);
    expect(isStripPrompt(prompt({ kind: "number" }))).toBe(false);
    expect(isStripPrompt(prompt({ kind: "choice", context: { type: "chain", forced: false } }))).toBe(false);
    expect(isStripPrompt(prompt({ kind: "choice", context: { type: "position" } }))).toBe(false);
    expect(isStripPrompt(prompt({ kind: "choice", context: { type: "action", phase: "main" } }))).toBe(false);
    expect(isStripPrompt(prompt({
      kind: "choice",
      options: [{ id: "yes", label: "Yes", card: card(1) }, { id: "no", label: "No", card: card(1) }],
    }))).toBe(false);
  });
});

describe("isChainStripPrompt", () => {
  const chain = { type: "chain", forced: false } as const;
  const chainOptions = [1, 2].map((code) => ({ id: `card:${code}`, label: `Card ${code}: Special Summon`, card: card(code) }));

  it("shows every chain response made of cards as a strip, optional or forced", () => {
    expect(isChainStripPrompt(prompt({ kind: "choice", context: chain, options: chainOptions }))).toBe(true);
    expect(isChainStripPrompt(prompt({ kind: "choice", context: { type: "chain", forced: true }, options: chainOptions }))).toBe(true);
  });

  it("keeps rows when an option is not a card, and ignores other prompts", () => {
    expect(isChainStripPrompt(prompt({ kind: "choice", context: chain, options: [...chainOptions, { id: "x", label: "Pass" }] }))).toBe(false);
    expect(isChainStripPrompt(prompt({ kind: "choice", context: chain, options: [] }))).toBe(false);
    expect(isChainStripPrompt(prompt({ kind: "choice", options: chainOptions }))).toBe(false);
    expect(isChainStripPrompt(prompt({ kind: "toggle", context: chain, options: chainOptions }))).toBe(false);
  });
});

describe("choiceStripItems", () => {
  const chain = { type: "chain", forced: false } as const;
  const option = (id: string, code: number, label: string, extra: object = {}) =>
    ({ id, label, card: card(code), ...extra });

  it("shows only the name for a card with one option", () => {
    const items = choiceStripItems(prompt({
      kind: "choice",
      context: chain,
      options: [option("a", 1, "Card 1: Special Summon"), option("b", 2, "Card 2: Set 1 Spell/Trap")],
    }));
    expect(items.map((item) => item.label)).toEqual(["Card 1", "Card 2"]);
    expect(items.every((item) => item.detail === undefined)).toBe(true);
  });

  it("labels the options of one card with the short effect, full text as the tooltip", () => {
    const items = choiceStripItems(prompt({
      kind: "choice",
      context: chain,
      options: [
        option("a", 1, "Card 1", { effectText: 'Special Summon 1 "Blue-Eyes White Dragon". Your opponent cannot target it.' }),
        option("b", 1, "Card 1", { effectText: 'Set 1 Spell/Trap that lists "Blue-Eyes White Dragon"' }),
        option("c", 2, "Card 2: Negate"),
      ],
    }));
    expect(items[0].detail).toBe('Special Summon 1 "Blue-Eyes White Dragon"');
    expect(items[0].detailTitle).toBe('Special Summon 1 "Blue-Eyes White Dragon". Your opponent cannot target it.');
    expect(items[1].detail).toBe('Set 1 Spell/Trap that lists "Blue-Eyes White Dragon"');
    expect(items[2].detail).toBeUndefined();
  });
});

describe("stripScrollLeft", () => {
  const view = { scrollLeft: 200, clientWidth: 500 };

  it("keeps the scroll when the card is fully in view", () => {
    expect(stripScrollLeft(view, { left: 300, width: 124 })).toBe(200);
  });

  it("scrolls left to a card cut off at the left edge", () => {
    expect(stripScrollLeft(view, { left: 150, width: 124 })).toBe(138);
    expect(stripScrollLeft(view, { left: 4, width: 124 })).toBe(0);
  });

  it("scrolls right to a card cut off at the right edge", () => {
    expect(stripScrollLeft(view, { left: 640, width: 124 })).toBe(276);
  });
});

describe("stripScrollTop", () => {
  const view = { scrollTop: 200, clientHeight: 300 };

  it("keeps the scroll when the row is fully in view", () => {
    expect(stripScrollTop(view, { top: 260, height: 180 })).toBe(200);
  });

  it("scrolls up to a row cut off at the top, and down to a row cut off at the bottom", () => {
    expect(stripScrollTop(view, { top: 150, height: 180 })).toBe(138);
    expect(stripScrollTop(view, { top: 4, height: 180 })).toBe(0);
    expect(stripScrollTop(view, { top: 380, height: 180 })).toBe(272);
  });
});

describe("stripScrollTop, a row taller than the list", () => {
  it("shows the top of the row, with the pad, when the row can not fit with the pad", () => {
    expect(stripScrollTop({ scrollTop: 0, clientHeight: 150 }, { top: 400, height: 180 })).toBe(388);
    expect(stripScrollTop({ scrollTop: 900, clientHeight: 150 }, { top: 400, height: 180 })).toBe(388);
    expect(stripScrollTop({ scrollTop: 0, clientHeight: 150 }, { top: 5, height: 180 })).toBe(0);
  });
});

describe("stripPageScrollY", () => {
  const view = { scrollTop: 100, clientHeight: 300, scrollHeight: 800 };

  it("moves most of a page and stops at both ends", () => {
    expect(stripPageScrollY(view, 1)).toBe(340);
    expect(stripPageScrollY({ ...view, scrollTop: 450 }, 1)).toBe(500);
    expect(stripPageScrollY(view, -1)).toBe(0);
    expect(stripPageScrollY({ scrollTop: 0, clientHeight: 300, scrollHeight: 300 }, 1)).toBe(0);
  });
});

describe("cardsPerRow", () => {
  it("counts the cards that share the first card's row", () => {
    expect(cardsPerRow([0, 0, 0, 200, 200, 200, 400])).toBe(3);
    expect(cardsPerRow([0, 1, 2, 200])).toBe(3);
    expect(cardsPerRow([0, 200, 400])).toBe(1);
    expect(cardsPerRow([0, 0])).toBe(2);
    expect(cardsPerRow([])).toBe(1);
  });
});

describe("stripOverflowY", () => {
  it("shows no fade when every row fits", () => {
    expect(stripOverflowY({ scrollTop: 0, clientHeight: 300, scrollHeight: 301 })).toEqual({ up: false, down: false });
  });

  it("shows only the side that has more rows beyond it", () => {
    expect(stripOverflowY({ scrollTop: 0, clientHeight: 300, scrollHeight: 700 })).toEqual({ up: false, down: true });
    expect(stripOverflowY({ scrollTop: 150, clientHeight: 300, scrollHeight: 700 })).toEqual({ up: true, down: true });
    expect(stripOverflowY({ scrollTop: 400, clientHeight: 300, scrollHeight: 700 })).toEqual({ up: true, down: false });
  });
});

describe("stripOverflow", () => {
  it("shows no arrows and no fade when every card fits", () => {
    expect(stripOverflow({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 })).toEqual({ prev: false, next: false });
    expect(stripOverflow({ scrollLeft: 0, clientWidth: 900, scrollWidth: 901 })).toEqual({ prev: false, next: false });
  });

  it("shows only the side that has more cards beyond it", () => {
    expect(stripOverflow({ scrollLeft: 0, clientWidth: 500, scrollWidth: 1200 })).toEqual({ prev: false, next: true });
    expect(stripOverflow({ scrollLeft: 300, clientWidth: 500, scrollWidth: 1200 })).toEqual({ prev: true, next: true });
    expect(stripOverflow({ scrollLeft: 700, clientWidth: 500, scrollWidth: 1200 })).toEqual({ prev: true, next: false });
  });
});

describe("stripPageScroll", () => {
  const view = { scrollLeft: 300, clientWidth: 500, scrollWidth: 1200 };

  it("moves most of a page and keeps the last card seen in view", () => {
    expect(stripPageScroll(view, 1)).toBe(700);
    expect(stripPageScroll(view, -1)).toBe(0);
  });

  it("stops at both ends of the scrollable range", () => {
    expect(stripPageScroll({ ...view, scrollLeft: 600 }, 1)).toBe(700);
    expect(stripPageScroll({ ...view, scrollLeft: 100 }, -1)).toBe(0);
    expect(stripPageScroll({ scrollLeft: 0, clientWidth: 900, scrollWidth: 900 }, 1)).toBe(0);
  });
});

describe("nextAnswerableId", () => {
  it("remembers a prompt the first time the room is settled", () => {
    expect(nextAnswerableId(null, "p1", true)).toBe("p1");
  });

  it("does not remember a prompt that appears while an answer is in flight or the room re-syncs", () => {
    expect(nextAnswerableId(null, "p1", false)).toBeNull();
    expect(nextAnswerableId("p0", "p1", false)).toBe("p0");
  });

  it("keeps a prompt answerable through a later short sync", () => {
    const seen = nextAnswerableId(null, "p1", true);
    expect(nextAnswerableId(seen, "p1", false)).toBe("p1");
  });

  it("ignores a missing prompt", () => {
    expect(nextAnswerableId("p0", null, true)).toBe("p0");
  });
});

describe("rowStep", () => {
  const options = Array.from({ length: 8 }, (_, i) => ({ id: `c${i}`, label: `Card ${i}` }));
  const list = { options } as Pick<DuelPrompt, "options">;

  it("moves one row down or up, and stays put at the first and last row", () => {
    expect(rowStep(list, undefined, 1, 3, 1)).toBe(4);
    expect(rowStep(list, undefined, 4, 3, -1)).toBe(1);
    expect(rowStep(list, undefined, 6, 3, 1)).toBe(6);
    expect(rowStep(list, undefined, 2, 3, -1)).toBe(2);
  });

  it("skips a disabled card in the target row, and stays when no card is left that way", () => {
    expect(rowStep(list, new Set(["c4"]), 1, 3, 1)).toBe(5);
    expect(rowStep(list, new Set(["c4", "c5", "c6", "c7"]), 1, 3, 1)).toBe(1);
  });
});

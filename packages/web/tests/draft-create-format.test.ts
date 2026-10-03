import { describe, expect, it } from "vitest";
import { loadedPoolHint, packsSentence, poolRowText, savedPoolIds, secondsText, tallyPool, themeSelectionText } from "../src/components/draft/create/format";
import type { CardSummary } from "../src/lib/card-types";

const card = (type: string, qty?: number) => ({ id: 1, name: "x", type, frameType: "normal", qty }) as CardSummary;

describe("new draft summary helpers", () => {
  it.each([
    [600, "10 min"], [90, "1 min 30 s"],
  ])("formats a %i-second pick clock as %s", (seconds, text) => {
    expect(secondsText(seconds)).toBe(text);
  });

  it("describes the pool from live counts", () => {
    expect(poolRowText(2, 36)).toBe("2 sets, 36 passcodes");
    expect(poolRowText(1, 0)).toBe("1 set");
    expect(poolRowText(0, 1)).toBe("1 passcode");
    expect(poolRowText(0, 0)).toBe("Nothing yet");
  });

  it("loads a saved pool as its config passcodes plus its main-pool cards, once per copy", () => {
    expect(savedPoolIds([5, 5, 6], [{ id: 6, copies: 3 }, { id: 7, copies: 2 }, { id: 8, copies: 1 }])).toEqual([
      5, 5, 6, 7, 7, 8,
    ]);
    expect(savedPoolIds([], [{ id: 7, copies: 1 }, { id: 8, copies: 12 }])).toEqual([7, ...Array(12).fill(8)]);
    expect(savedPoolIds([5, 6])).toEqual([5, 6]);
    expect(savedPoolIds(undefined, undefined)).toEqual([]);
  });

  it("counts every copy in the loaded pool summary", () => {
    const ids = savedPoolIds([], [{ id: 7, copies: 5 }, { id: 8, copies: 4 }]);
    expect(poolRowText(0, ids.length)).toBe("9 passcodes");
    expect(loadedPoolHint("Stun", 0, ids.length)).toBe("Loaded Stun: 9 passcodes. Loading replaces the pool below.");
  });

  it("reports the real count when a saved pool loads", () => {
    expect(loadedPoolHint("Dark Magician", 0, 100)).toBe(
      "Loaded Dark Magician: 100 passcodes. Loading replaces the pool below.",
    );
    expect(loadedPoolHint("Mixed", 2, 3, 1)).toBe(
      "Loaded Mixed: 2 sets, 3 passcodes. 1 Extra Deck card isn't loaded; cube drafts deal main-deck cards. Loading replaces the pool below.",
    );
    expect(loadedPoolHint("Mixed", 0, 3, 8)).toContain("8 Extra Deck cards aren't loaded");
  });

  it("says what the pack numbers add up to, dropping the leftover sentence when there is none", () => {
    expect(packsSentence(40, 3, 15)).toBe(
      "Each player drafts 40 cards across 3 packs of 15. The last 5 cards of pack 3 aren't picked.",
    );
    expect(packsSentence(45, 3, 15)).toBe("Each player drafts 45 cards across 3 packs of 15.");
    expect(packsSentence(40, 3, 14)).toContain("The last 2 cards of pack 3 aren't picked.");
    expect(packsSentence(41, 3, 14)).toContain("The last card of pack 3 isn't picked.");
  });

  it("tallies copies by kind", () => {
    const t = tallyPool([card("Effect Monster", 3), card("Spell Card"), card("Trap Card", 2), card("Skill Card")]);
    expect(t).toEqual({ total: 7, monsters: 3, spells: 1, traps: 2 });
  });

  it("names the theme selection", () => {
    expect(themeSelectionText("player_pick", true)).toBe("Players pick, all different");
    expect(themeSelectionText("random", false)).toBe("Random, can repeat");
  });
});

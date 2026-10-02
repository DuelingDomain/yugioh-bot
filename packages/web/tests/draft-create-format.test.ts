import { describe, expect, it } from "vitest";
import { packsSentence, poolRowText, tallyPool, themeSelectionText } from "../src/components/draft/create/format";
import type { CardSummary } from "../src/lib/card-types";

const card = (type: string, qty?: number) => ({ id: 1, name: "x", type, frameType: "normal", qty }) as CardSummary;

describe("new draft summary helpers", () => {
  it("describes the pool from live counts", () => {
    expect(poolRowText(2, 36)).toBe("2 sets, 36 passcodes");
    expect(poolRowText(1, 0)).toBe("1 set");
    expect(poolRowText(0, 1)).toBe("1 passcode");
    expect(poolRowText(0, 0)).toBe("Nothing yet");
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

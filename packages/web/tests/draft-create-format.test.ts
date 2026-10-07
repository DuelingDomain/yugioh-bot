import { describe, expect, it } from "vitest";
import { packsSentence, secondsText, tallyPool, themeSelectionText } from "../src/components/draft/create/format";
import type { CardSummary } from "../src/lib/card-types";
import { configFromFields, fieldsFromConfig, validateFields } from "../src/components/draft/draft-config-fields";

const card = (type: string, qty?: number) => ({ id: 1, name: "x", type, frameType: "normal", qty }) as CardSummary;

describe("new draft summary helpers", () => {
  it.each([
    [600, "10 min"], [90, "1 min 30 s"],
  ])("formats a %i-second pick clock as %s", (seconds, text) => {
    expect(secondsText(seconds)).toBe(text);
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

describe("pack fields and config", () => {
  it("derives rounds from the cards and the pile when the fields carry none, as the older forms do", () => {
    const fields = { cardsPerPlayerText: "40", packSizeText: "15", pickSecondsText: "45" };
    const config = configFromFields(fields);
    expect(config).toMatchObject({ cardsPerPlayer: 40, packSize: 15, packsPerPlayer: 3 });
    expect("lobbySeats" in config).toBe(false);
  });

  it("reads rounds and the seat target back from a saved config, and writes the same values", () => {
    const saved = { cardsPerPlayer: 40, packSize: 15, packsPerPlayer: 3, lobbySeats: 6 };
    const fields = fieldsFromConfig(saved);
    expect(fields).toMatchObject({ roundsText: "3", lobbySeatsText: "6" });
    expect(configFromFields(fields)).toMatchObject(saved);
  });

  it("falls back to derived rounds when a saved config's rounds cannot deal its picks", () => {
    const fields = fieldsFromConfig({ cardsPerPlayer: 45, packSize: 5, packsPerPlayer: 3 });
    expect(fields.roundsText).toBeUndefined();
    expect(configFromFields(fields).packsPerPlayer).toBe(9);
    expect(validateFields(fields)).toBeNull();
  });
});

import { describe, expect, it } from "vitest";
import {
  defaultDuelSettings,
  duelClockBankMs,
  duelClockRulesText,
  isCustomDomain,
  normalizeDuelSettings,
  parseStoredDuelSettings,
  PINNED_TCG_BANLIST_ID,
} from "../../src/duels/settings.js";

describe("normalizeDuelSettings", () => {
  it("fills omitted fields and rejects unknown or illegal values", () => {
    const filled = normalizeDuelSettings("domain", { startingLP: 1 });
    expect(filled.startingLP).toBe(1);
    expect(filled.banlist).toBe("none");
    expect(filled.turnSeconds).toBe(240);

    expect(() => normalizeDuelSettings("normal", { turnSeconds: 29 })).toThrow(/turnSeconds/);
    expect(() => normalizeDuelSettings("normal", { startingHand: 41 })).toThrow(/startingHand/);
    expect(() => normalizeDuelSettings("normal", { cardPool: "goat" })).toThrow(/cardPool/);
    expect(() => normalizeDuelSettings("normal", { timeout: "skip" })).toThrow(/timeout/);
    expect(() => normalizeDuelSettings("normal", { validateDeck: "yes" })).toThrow(/validateDeck/);
    expect(() => normalizeDuelSettings("normal", { banlist: "made-up" })).toThrow(/banlist/);
    expect(() => normalizeDuelSettings("normal", { visibility: "public", foo: 1 })).toThrow(/Unknown duel setting: foo/);
    expect(() => normalizeDuelSettings("normal", [])).toThrow(/settings must be an object/);
  });

  it("pins the current TCG list for new standard games", () => {
    expect(normalizeDuelSettings("normal", undefined).banlist).toBe(PINNED_TCG_BANLIST_ID);
    expect(defaultDuelSettings("normal").turnSeconds).toBe(240);
  });
});

describe("isCustomDomain", () => {
  it("ignores visibility and clock while flagging gameplay overrides", () => {
    const baseline = defaultDuelSettings("domain");
    expect(isCustomDomain(5, baseline)).toBe(false);
    expect(isCustomDomain(5, { ...baseline, visibility: "private", turnSeconds: 30, timeout: "continue" })).toBe(false);
    expect(isCustomDomain(4, baseline)).toBe(true);
    expect(isCustomDomain(5, { ...baseline, banlist: PINNED_TCG_BANLIST_ID })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, cardPool: "tcg" })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, startingLP: 1 })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, startingHand: 4 })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, drawPerTurn: 2 })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, validateDeck: false })).toBe(true);
    expect(isCustomDomain(5, { ...baseline, shuffleDeck: false })).toBe(true);
  });
});

describe("unlimited turn time", () => {
  it("accepts 0 as unlimited and keeps it in stored settings", () => {
    expect(normalizeDuelSettings("normal", { turnSeconds: 0 }).turnSeconds).toBe(0);
    expect(parseStoredDuelSettings(JSON.stringify({ turnSeconds: 0 })).turnSeconds).toBe(0);
    expect(duelClockBankMs(0)).toBeNull();
    expect(duelClockRulesText(0)).toBe("");
  });
});

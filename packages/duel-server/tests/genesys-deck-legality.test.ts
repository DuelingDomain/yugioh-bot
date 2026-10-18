import { rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { normalizeDuelSettings, type DuelMode } from "@yugidraft/shared/duels";
import { inspectDeck, validateDeck } from "../src/deck-legality.js";
import { GENESYS_ART, GENESYS_FORBIDDEN, GENESYS_FUSION, GENESYS_LINK, GENESYS_MASTER, GENESYS_PENDULUM, genesysDeck, genesysFixture } from "./helpers/genesys-fixture.js";

let fixture: ReturnType<typeof genesysFixture>;
beforeEach(() => { fixture = genesysFixture(); });
afterEach(() => rmSync(fixture.directory, { recursive: true, force: true }));
const variants = (["normal", "domain"] as const).flatMap(mode =>
  (["1v1", "tag", "ffa3", "ffa4"] as const).map(table => ({ mode, table })));

describe("Genesys deck admission", () => {
  it.each(variants)("checks each player's $mode $table deck at the cap, above it, and at zero", ({ mode, table }) => {
    const deck = genesysDeck(mode);
    const inspect = (pointCap = 100) => inspectDeck(mode, deck, fixture.directory,
      normalizeDuelSettings(mode, { genesys: { pointCap } }, table), { table, genesysPoints: fixture.points });
    fixture.points.set(1001, 100);
    expect(inspect().issues).toEqual([]);
    fixture.points.set(1001, 101);
    expect(inspect().issues).toEqual([{ message: expect.stringMatching(/101.*points; the cap is 100/), cards: [] }]);
    expect(inspect(101).issues).toEqual([]);
    fixture.points.set(1001, 0);
    expect(inspect(0).issues).toEqual([]);
    fixture.points.set(1001, 1);
    expect(inspect(0).issues[0]?.message).toMatch(/1.*points; the cap is 0/);
  });

  it("counts copies and canonical artwork points across Main, Extra and Side", () => {
    const deck = genesysDeck("normal");
    deck.main[0] = GENESYS_MASTER;
    deck.main[1] = GENESYS_ART;
    deck.extra = [GENESYS_FUSION];
    deck.side = [GENESYS_ART];
    fixture.points.set(GENESYS_MASTER, 30);
    fixture.points.set(GENESYS_ART, 0);
    fixture.points.set(GENESYS_FUSION, 22);
    expect(() => validateDeck("normal", deck, fixture.directory, normalizeDuelSettings("normal", { genesys: {} }),
      { genesysPoints: fixture.points })).toThrow(/112.*points; the cap is 100/);
  });

  it("includes the separate Domain Master in the points total", () => {
    fixture.points.set(1001, 100);
    fixture.points.set(GENESYS_MASTER, 1);
    expect(inspectDeck("domain", genesysDeck("domain"), fixture.directory,
      normalizeDuelSettings("domain", { genesys: {} }), { genesysPoints: fixture.points }).issues)
      .toContainEqual({ message: expect.stringMatching(/101.*points; the cap is 100/), cards: [] });
  });

  it.each(["main", "extra", "side", "deckMaster"] as const)("forbids Link and Pendulum cards in %s even with validation off", section => {
    for (const code of [GENESYS_LINK, GENESYS_PENDULUM]) {
      const deck = genesysDeck("domain");
      if (section === "deckMaster") deck.deckMaster = code;
      else deck[section] = [code];
      const report = inspectDeck("domain", deck, fixture.directory,
        normalizeDuelSettings("domain", { genesys: {}, validateDeck: false, startingHand: 1 }), { genesysPoints: fixture.points });
      expect(report.issues).toContainEqual({ message: expect.stringMatching(/Genesys.*Link or Pendulum/),
        cards: [expect.objectContaining({ section, code, index: 0 })] });
    }
  });

  it.each(["normal", "domain"] as const)("fails closed for unknown canonical points in %s with validation off", mode => {
    const deck = genesysDeck(mode);
    deck.main[0] = GENESYS_ART;
    fixture.points.delete(GENESYS_MASTER);
    const settings = normalizeDuelSettings(mode, { genesys: {}, validateDeck: false });
    expect(inspectDeck(mode, deck, fixture.directory, settings, { genesysPoints: fixture.points }).issues)
      .toContainEqual({ message: expect.stringMatching(/Genesys points are unknown/),
        cards: expect.arrayContaining([expect.objectContaining({ code: GENESYS_ART })]) });
    expect(inspectDeck(mode, deck, fixture.directory, settings).issues.some(issue => /points are unknown/.test(issue.message))).toBe(true);
  });

  it.each(["normal", "domain"] as const)("ignores F&L but retains the %s copy rule and sizes", (mode: DuelMode) => {
    const deck = genesysDeck(mode);
    deck.main[0] = GENESYS_FORBIDDEN;
    // Even a caller with unnormalized settings cannot re-enable F&L for Genesys.
    const settings = { ...normalizeDuelSettings(mode, { genesys: {} }), banlist: "tcg-2026-09" };
    const inspect = () => inspectDeck(mode, deck, fixture.directory, settings, { genesysPoints: fixture.points });
    expect(inspect().issues).toEqual([]);
    deck.main.splice(1, mode === "normal" ? 3 : 1, ...Array(mode === "normal" ? 3 : 1).fill(GENESYS_FORBIDDEN));
    expect(inspect().issues.some(issue => /3 copies|Duplicate card/.test(issue.message))).toBe(true);
    deck.main.pop();
    if (mode === "domain") expect(inspect().issues.some(issue => /exactly 60/.test(issue.message))).toBe(true);
    else {
      deck.main.splice(0, 10);
      expect(inspect().issues.some(issue => /40-60/.test(issue.message))).toBe(true);
    }
  });

  it("keeps old non-Genesys decks independent of points availability", () => {
    expect(inspectDeck("normal", genesysDeck("normal"), fixture.directory, normalizeDuelSettings("normal", undefined)).issues).toEqual([]);
  });
});

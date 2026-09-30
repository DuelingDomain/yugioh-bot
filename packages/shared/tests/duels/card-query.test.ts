import { describe, expect, it } from "vitest";
import {
  CardQueryError,
  cardLimit,
  emptyCardQuery,
  foldCardText,
  inArchetype,
  parseCardQuery,
  parseCardSearchTerms,
} from "../../src/duels/card-query.js";

describe("parseCardQuery", () => {
  it("fills defaults for an empty body", () => {
    expect(parseCardQuery({})).toEqual(emptyCardQuery());
  });

  it("keeps valid filters and removes duplicates", () => {
    const query = parseCardQuery({
      text: "blue eyes",
      kind: "monster",
      monsterTypes: ["tuner", "tuner", "synchro"],
      attributes: [0x10, 0x10],
      races: [0x2000],
      level: { min: 8, max: 4 },
      arrows: 0x80 | 0x2,
      archetypes: [0xdd, 0xdd],
      archetypeMode: "related",
      banlist: "tcg-2026-09",
      limits: ["forbidden"],
      sort: "atk",
      order: "desc",
      offset: 60,
      limit: 60,
    });
    expect(query.monsterTypes).toEqual(["tuner", "synchro"]);
    expect(query.attributes).toEqual([0x10]);
    expect(query.level).toEqual({ min: 4, max: 8 });
    expect(query.archetypes).toEqual([0xdd]);
    expect(query.sort).toBe("atk");
  });

  it.each([
    ["a non-object", "x"],
    ["an unknown kind", { kind: "token" }],
    ["an unknown attribute bit", { attributes: [0x80] }],
    ["an unknown race bit", { races: [0x4000000] }],
    ["a negative ATK", { atk: { min: -1, max: null } }],
    ["too long text", { text: "x".repeat(201) }],
    ["a page that is too large", { limit: 500 }],
    ["a setcode that is too large", { archetypes: [0x10000] }],
    ["a strange banlist id", { banlist: "../etc" }],
  ])("rejects %s", (_label, body) => {
    expect(() => parseCardQuery(body)).toThrow(CardQueryError);
  });
});

describe("card search helpers", () => {
  it("folds punctuation, case and accents", () => {
    expect(foldCardText("Blue-Eyes White Dragon")).toBe("blue eyes white dragon");
    expect(foldCardText("Pharaoh's Servant")).toBe("pharaohs servant");
    expect(foldCardText("Évil★Twin")).toBe("evil twin");
  });

  it("splits words, quoted phrases and exclusions", () => {
    expect(parseCardSearchTerms('destroy "negate the activation" -draw')).toEqual([
      { text: "destroy", negate: false },
      { text: "negate the activation", negate: false },
      { text: "draw", negate: true },
    ]);
    expect(parseCardSearchTerms('-"special summon"')).toEqual([{ text: "special summon", negate: true }]);
  });

  it("matches base archetypes and their sub-archetypes like the core", () => {
    expect(inArchetype([0x10dd], 0xdd)).toBe(true);
    expect(inArchetype([0xdd], 0x10dd)).toBe(false);
    expect(inArchetype([0x20dd], 0x10dd)).toBe(false);
  });

  it("gives an alternate artwork its original's limit", () => {
    const limits = { 100: 1 as const };
    expect(cardLimit(limits, { code: 101, alias: 100 })).toBe(1);
    expect(cardLimit(limits, { code: 102 })).toBe(3);
    expect(cardLimit(undefined, { code: 100 })).toBe(3);
  });
});

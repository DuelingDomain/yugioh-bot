import { describe, expect, it } from "vitest";
import { CARD_TYPE_BITS as T, emptyCardQuery, inArchetype, type CardQuery } from "@yugidraft/shared/duels";
import { banlistLimitsFor } from "../src/banlists/index.js";
import { cardFacets, queryCards } from "../src/card-search.js";
import { loadCardDatabase } from "../src/cards.js";
import { engineDataDirectory } from "./engine-data-dir.js";

const cards = loadCardDatabase(engineDataDirectory);
const search = (over: Partial<CardQuery>) => queryCards(cards, { ...emptyCardQuery(), limit: 120, ...over });
const blueEyes = () => {
  const archetype = cardFacets(cards).archetypes.find((entry) => entry.name === "Blue-Eyes");
  if (!archetype) throw new Error("Blue-Eyes archetype missing");
  return archetype;
};

describe("deck editor card search", () => {
  it("lists archetypes by name with their member counts", () => {
    const archetype = blueEyes();
    expect(archetype.codes).toContain(0xdd);
    expect(archetype.count).toBeGreaterThan(10);
  });

  it("finds archetype members, and related cards that only mention the archetype", () => {
    const { codes } = blueEyes();
    const members = search({ archetypes: codes });
    expect(members.cards.every((card) => codes.some((code) => inArchetype(card.setcodes, code)))).toBe(true);
    expect(members.cards.map((card) => card.name)).toContain("Blue-Eyes White Dragon");
    expect(members.cards.map((card) => card.name)).not.toContain("Sage with Eyes of Blue");

    const related = search({ archetypes: codes, archetypeMode: "related" });
    expect(related.total).toBeGreaterThan(members.total);
    const names = related.cards.map((card) => card.name);
    expect(names).toContain("Sage with Eyes of Blue");
    // Members come before cards that only mention the archetype.
    expect(names.indexOf("Blue-Eyes White Dragon")).toBeLessThan(names.indexOf("Sage with Eyes of Blue"));
  });

  it("shows one entry per card: alternate artworks only by exact passcode", () => {
    const byName = search({ text: "dark magician", scope: "name" });
    expect(byName.cards.filter((card) => card.name === "Dark Magician")).toHaveLength(1);
    expect(byName.cards[0]?.name).toBe("Dark Magician");
    expect(search({ text: "46986415" }).cards[0]?.code).toBe(46986415);
  });

  it("matches loose names and card text", () => {
    expect(search({ text: "blue eyes", scope: "name" }).cards[0]?.name).toBe("Blue-Eyes White Dragon");
    const text = search({ text: '"negate the activation" -draw', kind: "trap" });
    expect(text.total).toBeGreaterThan(0);
    for (const card of text.cards) {
      const body = card.description.toLowerCase();
      expect(body).toContain("negate the activation");
      expect(body).not.toContain("draw");
    }
  });

  it("keeps Level and Rank apart from Link Rating", () => {
    const level = search({ level: { min: 4, max: 4 }, monsterTypes: ["tuner"] });
    expect(level.total).toBeGreaterThan(0);
    expect(level.cards.every((card) => card.level === 4 && (card.type & T.tuner) && !(card.type & T.link))).toBe(true);
    const link = search({ link: { min: 3, max: 3 } });
    expect(link.cards.every((card) => (card.type & T.link) && card.level === 3)).toBe(true);
  });

  it("filters Link Arrows with any or all", () => {
    const both = 0x80 | 0x2;
    const all = search({ arrows: both, arrowMatch: "all" });
    expect(all.total).toBeGreaterThan(0);
    expect(all.cards.every((card) => (card.arrows & both) === both)).toBe(true);
    expect(search({ arrows: both }).total).toBeGreaterThan(all.total);
  });

  it("filters Spell and Trap types", () => {
    const quick = search({ kind: "spell", spellTypes: ["quick-play"] });
    expect(quick.cards.every((card) => (card.type & T.spell) && (card.type & T.quickPlay))).toBe(true);
    const counter = search({ kind: "trap", trapTypes: ["counter"] });
    expect(counter.cards.every((card) => (card.type & T.trap) && (card.type & T.counter))).toBe(true);
  });

  it("filters attribute, monster Type and ATK, and sorts by ATK", () => {
    const found = search({ attributes: [0x10], races: [0x2000], atk: { min: 3000, max: null }, sort: "atk", order: "desc" });
    expect(found.total).toBeGreaterThan(0);
    const attacks = found.cards.map((card) => card.attack);
    expect(attacks).toEqual([...attacks].sort((a, b) => b - a));
    expect(found.cards.every((card) => card.attribute === 0x10 && card.race === "dragon" && card.attack >= 3000)).toBe(true);
  });

  it("filters by limit status on a banlist", () => {
    const limits = banlistLimitsFor("tcg-2026-09") ?? {};
    const forbidden = search({ banlist: "tcg-2026-09", limits: ["forbidden"] });
    expect(forbidden.total).toBeGreaterThan(0);
    expect(forbidden.cards.every((card) => limits[card.code] === 0 || limits[card.alias] === 0)).toBe(true);
  });

  it("pages through results", () => {
    const first = search({ kind: "monster", limit: 10 });
    const second = search({ kind: "monster", limit: 10, offset: 10 });
    expect(second.total).toBe(first.total);
    expect(second.offset).toBe(10);
    expect(second.cards[0]?.code).not.toBe(first.cards[0]?.code);
  });
});

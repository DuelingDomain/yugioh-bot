import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CardTags, fillDefaults } from "../src/cards/effects/tags.js";
import { interpret, buildArchetypeMatcher } from "../src/cards/effects/query.js";
import { matchCard } from "../src/cards/effects/effect-match.js";
import type { Card } from "../src/cards/effects/card.js";
import { cardSynergy } from "../src/cards/effects/synergy.js";

// Real pinned artifact rather than invented effect fixtures.
const lines = () => gunzipSync(readFileSync(new URL("../data/effects/tags.jsonl.gz", import.meta.url))).toString("utf8").trim().split("\n");
const printed: Record<string, Partial<Card>> = {
  "Ash Blossom & Joyous Spring": { monsterType: "Zombie", attribute: "FIRE", level: 3, subtypes: ["effect", "tuner"] },
  "Effect Veiler": { monsterType: "Spellcaster", attribute: "LIGHT", level: 1, subtypes: ["effect", "tuner"] },
  "D.D. Crow": { monsterType: "Winged Beast", attribute: "DARK", level: 1, subtypes: ["effect"] },
};

describe("effect reader over the pinned searchygo artifact", () => {
  it("keeps the requested card Type separate from the negated effect", () => {
    const reading = interpret("cards that negate quick effects and are spellcasters");
    expect(reading?.query.card.types).toEqual(["Spellcaster"]);
    const matches = lines().flatMap(line => {
      const row = JSON.parse(line);
      if (!printed[row.name]) return [];
      const card = { id: row.id, name: row.name, kind: "monster", subtypes: [], text: "", views: 0, ...printed[row.name] } as Card;
      return matchCard(card, CardTags.parse(fillDefaults(row.tags)), reading!.query) === null ? [] : [row.name];
    });
    expect(matches).toContain("Effect Veiler");
    expect(matches).not.toContain("Ash Blossom & Joyous Spring");
  });

  it("reads archetype spacing and compact aliases against the same vocabulary", () => {
    const matcher = buildArchetypeMatcher(["Blue-Eyes", "Dark Magician", "Tearlaments"]);
    for (const query of ["blue eyes support", "blueeyes support", "bule eyes support", "buleeyes support"]) {
      expect(interpret(query, matcher)?.query.supports?.archetypes).toEqual(["Blue-Eyes"]);
    }
  });

  it("keeps descriptions of affected monsters on their event", () => {
    const destroy = interpret("cards that destroy monsters that are spellcasters");
    expect(destroy?.query.card.types).toEqual([]);
    expect(destroy?.query.does?.object.types).toEqual(["Spellcaster"]);
    const summon = interpret("cards that special summon monsters that are level 4 from the deck");
    expect(summon?.query.card.levelMin).toBeUndefined();
    expect(summon?.query.does?.object.levelMin).toBe(4);
    expect(summon?.query.does?.from).toEqual(["deck"]);
  });

  it("respects Level versus Rank and Extra Deck material/source feasibility in real card links", () => {
    const rows = lines().map(line => JSON.parse(line));
    const candidate = (name: string, over: Partial<Card>) => {
      const row = rows.find(row => row.name === name)!;
      return { card: { id: row.id, name, kind: "monster", text: "", subtypes: ["effect"], views: 0, ...over } as Card, tags: CardTags.parse(fillDefaults(row.tags)) };
    };
    const ash = candidate("Ash Blossom & Joyous Spring", { level: 3, subtypes: ["effect", "tuner"] });
    const formula = candidate("Formula Synchron", { level: 2, subtypes: ["synchro", "tuner"] });
    expect(cardSynergy(ash, formula).reasons.some(reason => reason.includes("supplies material"))).toBe(false);
    const monk = candidate("Summoner Monk", { level: 4, monsterType: "Spellcaster" });
    const dweller = candidate("Abyss Dweller", { rank: 4, subtypes: ["xyz"] });
    expect(cardSynergy(monk, dweller).reasons.some(reason => reason.includes("special summon"))).toBe(false);
    const foolish = candidate("Foolish Burial", { kind: "spell", subtypes: ["normal"] });
    const herald = candidate("Herald of the Arc Light", { level: 4, subtypes: ["synchro"] });
    expect(cardSynergy(foolish, herald).reasons.some(reason => reason.includes("enables"))).toBe(false);
    const blocker = candidate("Barricadeborg Blocker", { subtypes: ["link"], linkRating: 2 });
    const hangar = candidate("Union Hangar", { kind: "spell", subtypes: ["field"] });
    expect(cardSynergy(blocker, hangar).score).toBeGreaterThan(0);
  });
});

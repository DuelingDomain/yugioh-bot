import { describe, expect, it } from "vitest";
import { KNOWN_LIMITS, matchKnownLimits } from "@/lib/bug-reports/known-limits";

const ids = (text: string, context?: Parameters<typeof matchKnownLimits>[1]) => matchKnownLimits(text, context).map((l) => l.id);

describe("known limits", () => {
  it("has a title and an explanation for every entry", () => {
    for (const limit of KNOWN_LIMITS) {
      expect(limit.title.length).toBeGreaterThan(10);
      expect(limit.explanation.length).toBeGreaterThan(20);
      expect(limit.patterns.length).toBeGreaterThan(0);
    }
    expect(new Set(KNOWN_LIMITS.map((l) => l.id)).size).toBe(KNOWN_LIMITS.length);
  });

  it("matches surrender in 3-way and 4-way duels only", () => {
    const text = "I surrendered but my monsters stayed on the field";
    expect(ids(text, { format: "ffa3" })).toEqual(["ffa-surrender-end-of-turn"]);
    expect(ids(text, { format: "ffa4" })).toEqual(["ffa-surrender-end-of-turn"]);
    expect(ids(text, { format: "1v1" })).toEqual([]);
    expect(ids(text, { format: "tag" })).toEqual([]);
  });

  it("matches a Domain 3-way report in either word order", () => {
    expect(ids("Cannot start a Domain 3-way duel on the site")).toEqual(["domain-multiplayer-not-live"]);
    expect(ids("four player table with domain rules does not exist")).toEqual(["domain-multiplayer-not-live"]);
    expect(ids("Domain FFA is missing")).toEqual(["domain-multiplayer-not-live"]);
    expect(ids("Domain duel froze on my turn")).toEqual([]);
  });

  it("matches the wrong Graveyard after an elimination", () => {
    expect(ids("The player was eliminated and his card went to my graveyard", { format: "ffa3" })).toEqual(["eliminated-card-wrong-graveyard"]);
    expect(ids("my graveyard got a card after he was eliminated", { format: "ffa4" })).toEqual(["eliminated-card-wrong-graveyard"]);
    expect(ids("eliminated card in graveyard", { format: "tag" })).toEqual([]);
  });

  it("matches Extra Monster Zone problems in Tag duels", () => {
    expect(ids("I cannot use the Extra Monster Zone", { format: "tag" })).toEqual(["tag-extra-monster-zone"]);
    expect(ids("EMZ is blocked for my partner", { format: "tag" })).toEqual(["tag-extra-monster-zone"]);
    expect(ids("Extra Monster Zone looks wrong", { format: "1v1" })).toEqual([]);
  });

  it("matches on text alone when the report has no duel", () => {
    expect(ids("Tag Extra Monster Zone rules are wrong")).toEqual(["tag-extra-monster-zone"]);
  });

  it("returns only the public fields and nothing for an unrelated report", () => {
    const [match] = matchKnownLimits("Extra Monster Zone", { format: "tag" });
    expect(Object.keys(match).sort()).toEqual(["explanation", "id", "title"]);
    expect(ids("The card art is blurry on my phone")).toEqual([]);
  });
});

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

  it("does not list surrender as a known problem (it is immediate now)", () => {
    const text = "I surrendered but my monsters stayed on the field";
    expect(KNOWN_LIMITS.map((l) => l.id)).not.toContain("ffa-surrender-end-of-turn");
    for (const format of ["ffa3", "ffa4", "1v1", "tag"] as const) expect(ids(text, { format })).toEqual([]);
  });

  it("does not hide Domain 3-way and 4-way reports (those tables are live)", () => {
    expect(ids("Cannot start a Domain 3-way duel on the site")).toEqual([]);
    expect(ids("Domain FFA froze on my turn", { format: "ffa4", duelMode: "domain" })).toEqual([]);
  });

  it("matches the wrong Graveyard after an elimination", () => {
    expect(ids("The player was eliminated and his card went to my graveyard", { format: "ffa3" })).toEqual(["eliminated-card-wrong-graveyard"]);
    expect(ids("my graveyard got a card after he was eliminated", { format: "ffa4" })).toEqual(["eliminated-card-wrong-graveyard"]);
    expect(ids("eliminated card in graveyard", { format: "tag" })).toEqual([]);
  });

  it("no longer lists the Tag Extra Monster Zone problem (the rules are right now)", () => {
    expect(KNOWN_LIMITS.map((l) => l.id)).not.toContain("tag-extra-monster-zone");
    expect(ids("I cannot use the Extra Monster Zone", { format: "tag" })).toEqual([]);
    expect(ids("EMZ is blocked for my partner", { format: "tag" })).toEqual([]);
    expect(ids("Extra Monster Zone looks wrong", { format: "1v1" })).toEqual([]);
    expect(ids("Tag Extra Monster Zone rules are wrong")).toEqual([]);
  });

  it("still matches on text alone when the report has no duel", () => {
    expect(ids("A card of the eliminated player went to my graveyard")).toEqual(["eliminated-card-wrong-graveyard"]);
  });

  it("returns only the public fields and nothing for an unrelated report", () => {
    const [match] = matchKnownLimits("eliminated card in my graveyard", { format: "ffa3" });
    expect(Object.keys(match).sort()).toEqual(["explanation", "id", "title"]);
    expect(ids("The card art is blurry on my phone")).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import type { DuelPrompt, DuelPromptOption } from "@yugidraft/shared/duels";
import { candidates, matchesSel, pickOne } from "../src/prompt-match.js";

function option(id: string, code: number, extra: Partial<DuelPromptOption> = {}): DuelPromptOption {
  return { id, label: `Option ${id}`, card: { code, name: `Card ${code}` } as DuelPromptOption["card"], ...extra } as DuelPromptOption;
}

const prompt = {
  id: "p1",
  seat: 0,
  kind: "choice",
  title: "Main",
  options: [
    option("summon:0", 100, { controller: 0, location: 0x02, sequence: 0, label: "Summon A" }),
    option("summon:1", 100, { controller: 2, location: 0x02, sequence: 1, label: "Summon A" }),
    option("activate:2", 200, { controller: 1, location: 0x04, sequence: 3, label: "Activate B", effectText: "Destroy one card" }),
    { id: "to_ep", label: "End" } as DuelPromptOption,
  ],
} as DuelPrompt;

describe("matchesSel", () => {
  it("picks an Xyz material by from: overlay, and not a card on the Xyz's zone", () => {
    const material = option("card:0", 100, { controller: 0, location: 0x80, sequence: 1 });
    expect(matchesSel(material, { code: 100, from: "overlay", seq: 1 })).toBe(true);
    expect(matchesSel(material, { code: 100, from: "mzone" })).toBe(false);
    expect(matchesSel(option("card:1", 100, { controller: 0, location: 0x04, sequence: 1 }), { code: 100, from: "overlay" })).toBe(false);
  });
  it("needs the passcode and a card on the option", () => {
    expect(matchesSel(prompt.options[0], { code: 100 })).toBe(true);
    expect(matchesSel(prompt.options[0], { code: 101 })).toBe(false);
    expect(matchesSel(prompt.options[3], { code: 100 })).toBe(false);
  });

  it("filters by owner seat, location, sequence and effect text", () => {
    expect(matchesSel(prompt.options[1], { code: 100, owner: 2 })).toBe(true);
    expect(matchesSel(prompt.options[1], { code: 100, owner: 0 })).toBe(false);
    expect(matchesSel(prompt.options[0], { code: 100, from: "hand" })).toBe(true);
    expect(matchesSel(prompt.options[0], { code: 100, from: "mzone" })).toBe(false);
    expect(matchesSel(prompt.options[2], { code: 200, seq: 3 })).toBe(true);
    expect(matchesSel(prompt.options[2], { code: 200, seq: 2 })).toBe(false);
    expect(matchesSel(prompt.options[2], { code: 200, effect: "DESTROY" })).toBe(true);
    expect(matchesSel(prompt.options[2], { code: 200, effect: "negate" })).toBe(false);
  });
});

describe("candidates", () => {
  it("keeps only the id prefixes asked for", () => {
    expect(candidates(prompt, ["summon:"], { code: 100 }).map((o) => o.id)).toEqual(["summon:0", "summon:1"]);
    expect(candidates(prompt, ["activate:"], { code: 100 })).toEqual([]);
  });

  it("applies the extra filter", () => {
    expect(candidates(prompt, ["summon:"], { code: 100 }, (o) => o.controller === 2).map((o) => o.id)).toEqual(["summon:1"]);
  });
});

describe("pickOne", () => {
  it("reports no match", () => {
    expect(pickOne([], { code: 5 }, "summon")).toEqual({ error: expect.stringContaining("No legal option matches summon") });
  });

  it("takes the nth match and reports a range error", () => {
    const hits = candidates(prompt, ["summon:"], { code: 100 });
    expect(pickOne(hits, { code: 100, nth: 1 }, "x")).toEqual({ option: hits[1] });
    expect(pickOne(hits, { code: 100, nth: 5 }, "x")).toEqual({ error: expect.stringContaining("out of range") });
  });

  it("accepts several options with the same label, but not different labels", () => {
    const same = candidates(prompt, ["summon:"], { code: 100 });
    expect(pickOne(same, { code: 100 }, "x")).toEqual({ option: same[0] });
    const mixed = [prompt.options[0], option("summon:9", 100, { label: "Other" })];
    expect(pickOne(mixed, { code: 100 }, "x")).toEqual({ error: expect.stringContaining("Add nth, owner, from, seq or effect") });
  });

  it("uses the describe text in messages", () => {
    expect(pickOne([], { code: 5 }, "summon", '"Raigeki"')).toEqual({ error: 'No legal option matches summon "Raigeki".' });
  });
});

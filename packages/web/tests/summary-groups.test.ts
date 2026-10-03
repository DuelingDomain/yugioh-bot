import { describe, expect, it } from "vitest";
import type { CardSummary } from "../src/lib/card-types";
import { monsterTypeBreakdown } from "../src/components/draft/summary/groups";

const card = (type: string): CardSummary => ({
  id: 1, name: type, type, frameType: "", effectText: "", imageUrl: "", imageUrlSmall: "",
});

describe("finished sheet monster types", () => {
  it.each([
    ["Normal Monster", "Normal"], ["Effect Monster", "Effect"],
    ["Flip Effect Monster", "Flip"], ["Ritual Monster", "Ritual"], ["Ritual Effect Monster", "Ritual"],
    ["Fusion Monster", "Fusion"], ["Synchro Monster", "Synchro"], ["Synchro Effect Monster", "Synchro"],
    ["XYZ Monster", "Xyz"], ["XYZ Effect Monster", "Xyz"], ["Link Monster", "Link"],
    ["Tuner Monster", "Tuner"], ["Normal Tuner Monster", "Tuner"], ["Synchro Tuner Monster", "Synchro"],
    ["Union Effect Monster", "Union"], ["Spirit Monster", "Spirit"], ["Toon Monster", "Toon"],
    ["Gemini Monster", "Gemini"], ["Pendulum Effect Monster", "Pendulum"], ["Pendulum Normal Monster", "Pendulum"],
    ["Pendulum Effect Fusion Monster", "Fusion"], ["XYZ Pendulum Effect Monster", "Xyz"],
    ["Flip Tuner Effect Monster", "Flip"],
  ])("shortens %s to %s", (type, label) => {
    expect(monsterTypeBreakdown([card(type)])).toEqual([{ label, count: 1 }]);
  });

  it("merges labels, then orders by count and name", () => {
    expect(monsterTypeBreakdown([
      card("Ritual Monster"), card("Ritual Effect Monster"), card("Normal Monster"),
      card("Tuner Monster"), card("Normal Tuner Monster"), card("Effect Monster"),
    ])).toEqual([
      { label: "Ritual", count: 2 }, { label: "Tuner", count: 2 },
      { label: "Effect", count: 1 }, { label: "Normal", count: 1 },
    ]);
  });

  it("excludes spells, traps, skills and other non-monster cards", () => {
    expect(monsterTypeBreakdown([
      "Spell Card", "Trap Card", "Skill Card", "Quick-Play Spell Card", "Counter Trap Card", "Token", "",
    ].map(card))).toEqual([]);
    expect(monsterTypeBreakdown([])).toEqual([]);
  });
});

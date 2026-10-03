import { describe, expect, it } from "vitest";

import { optionNotes, shortEffectLabel } from "@/components/duel/option-strip";

describe("shortEffectLabel", () => {
  it("keeps a short effect as it is", () => {
    expect(shortEffectLabel("Special Summon")).toBe("Special Summon");
    expect(shortEffectLabel("Set 1 Spell/Trap")).toBe("Set 1 Spell/Trap");
  });

  it("stops at the first sentence end, colon or semicolon", () => {
    expect(shortEffectLabel("Special Summon 1 monster. Then draw 1 card.")).toBe("Special Summon 1 monster");
    expect(shortEffectLabel("Cost: send 1 card to the GY")).toBe("Cost");
    expect(shortEffectLabel("Negate the attack; destroy it")).toBe("Negate the attack");
  });

  it("cuts a long phrase at a word and adds an ellipsis", () => {
    const out = shortEffectLabel("Special Summon 1 Level 8 or lower monster from your Deck, hand or Graveyard in Defense Position", 40);
    expect(out.endsWith("…")).toBe(true);
    expect(out.length).toBeLessThanOrEqual(40);
    expect(out).not.toMatch(/\s…$/);
  });

  it("joins white space and returns an empty string for no text", () => {
    expect(shortEffectLabel("  Draw \n 1  card ")).toBe("Draw 1 card");
    expect(shortEffectLabel("   ")).toBe("");
  });
});

describe("optionNotes", () => {
  it("gives no note to a card with one option", () => {
    expect(optionNotes([{ code: 1, effect: "A" }, { code: 2, effect: "B" }])).toEqual([null, null]);
  });

  it("gives no note to an option that names no card", () => {
    expect(optionNotes([{ code: null, effect: "A" }, { code: null, effect: "B" }])).toEqual([null, null]);
  });

  it("labels each option of a repeated card with its short effect", () => {
    const notes = optionNotes([
      { code: 1, effect: "Special Summon. Many words follow." },
      { code: 2, effect: "Negate" },
      { code: 1, effect: "Set 1 Spell/Trap" },
    ]);
    expect(notes[0]).toEqual({ detail: "Special Summon", title: "Special Summon. Many words follow." });
    expect(notes[1]).toBeNull();
    expect(notes[2]).toEqual({ detail: "Set 1 Spell/Trap", title: "Set 1 Spell/Trap" });
  });

  it("falls back to Effect N when there is no text or two lines would match", () => {
    const none = optionNotes([{ code: 1, effect: "" }, { code: 1, effect: "" }]);
    expect(none.map((note) => note?.detail)).toEqual(["Effect 1", "Effect 2"]);
    const same = optionNotes([{ code: 1, effect: "Draw 1 card. A" }, { code: 1, effect: "Draw 1 card. B" }]);
    expect(same.map((note) => note?.detail)).toEqual(["Effect 1 · Draw 1 card", "Effect 2 · Draw 1 card"]);
  });
});

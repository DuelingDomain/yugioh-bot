import { describe, expect, it } from "vitest";
import { nextStep } from "../src/components/remote/ui/next-step";

/** Real card texts (cards.cdb): the follow-up chip after a card was activated or placed. */
const CASES: [string, string, string | null][] = [
  ["Gameciel, the Sea Turtle Kaiju", "You can Special Summon this card (from your hand) to your opponent's field in Attack Position, by Tributing 1 monster they control.", "Place on opponent's field"],
  ["Lava Golem", "Cannot be Normal Summoned/Set. Must first be Special Summoned (from your hand) to your opponent's field by Tributing 2 monsters they control.", "Place on opponent's field"],
  ["Dandylion", "If this card is sent to the Graveyard: Special Summon 2 \"Fluff Tokens\" (Plant-Type/WIND/Level 1/ATK 0/DEF 0) in Defense Position.", "Add 2 Fluff Tokens"],
  ["Mithra the Thunder Vassal", "Special Summon 1 \"Vassal Token\" (Fairy/LIGHT/Level 4/ATK 800/DEF 1000) to your opponent's field in Defense Position.", "Add a Vassal Token for the opponent"],
  ["Some Maker", "Special Summon 3 Tokens (Machine/DARK/Level 1/ATK 0/DEF 0).", "Add 3 Tokens"],
  // The table already makes these tokens by itself when the card is played, so no second prompt.
  ["Scapegoat", "Special Summon 4 \"Sheep Tokens\" (Beast/EARTH/Level 1/ATK 0/DEF 0) in Defense Position.", null],
  ["Nibiru, the Primal Being", "Special Summon 1 \"Primal Being Token\" (Rock/LIGHT/Level 11/ATK ?/DEF ?) to your opponent's field.", null],
  // Not a follow-up: a monster summoned to the opponent's field by someone else, or no text.
  ["Slifer the Sky Dragon", "If a monster(s) is Special Summoned to your opponent's field: ...", null],
  ["Mystic Tomato", "When this card is destroyed by battle: Special Summon 1 DARK monster from your Deck.", null],
];

describe("remote follow-up chip", () => {
  it("suggests the typical next step from the card text, and only then", () => {
    for (const [name, text, label] of CASES) expect(nextStep(name, text)?.label ?? null, name).toBe(label);
    expect(nextStep("Unknown", undefined)).toBeNull();
    const ask = nextStep("Number C43", "Special Summon 1 \"Manipulator Token\" (Fiend/DARK/Level 1/ATK ?/DEF ?)");
    expect(ask).toMatchObject({ kind: "tokens", token: { ask: true, count: 1 } });
    expect(nextStep("Dandylion", "Special Summon 2 \"Fluff Tokens\" (Plant/WIND/Level 1/ATK 0/DEF 0)")).toMatchObject({ token: { artId: 15341822, position: "defense", count: 2 } });
  });
});

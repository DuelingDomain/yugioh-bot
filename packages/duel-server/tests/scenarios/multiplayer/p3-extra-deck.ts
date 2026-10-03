import {
  activate, choose, expectBoard, expectPickSeats, expectPrompt, pickOpponent, select, yes,
  type BoardExpect, type DuelistId, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";

const UTOPIA = "Number 39: Utopia";
const LEVIATHAN = "Number 17: Leviathan Dragon";
const seats: DuelistId[] = ["p0", "p1", "p2", "p3"];

function extraDeck(format: "1v1" | "ffa3" | "ffa4" | "tag", own: boolean): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const last = seats[count - 1];
  const setup: Scenario["setup"] = { format, deckSize: 3 };
  const board: BoardExpect = {};
  for (const seat of seats.slice(0, count)) {
    setup[seat] = { monsters: ["Mystical Elf"], extra: [UTOPIA, LEVIATHAN] };
    board[seat] = {
      lp: format === "tag" ? 16000 : 8000, hand: [], deckCount: 3,
      monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: [UTOPIA, LEVIATHAN],
    };
  }
  const steps: Step[] = [];
  setup.p0 = { ...setup.p0, spells: ["Branded in Central Dogmatika"],
    hand: ["Black Illusion Ritual", "Relinquished", "Giant Rat"] };
  board.p0 = { ...board.p0, spells: ["Branded in Central Dogmatika"],
    monsters: ["Mystical Elf", "Relinquished"], grave: ["Black Illusion Ritual", "Giant Rat"] };
  steps.push(activate("Black Illusion Ritual", "p0"));
  // The Ritual summon does not declare an opponent. Branded uses a new Chain Link.
  steps.push(select("Giant Rat"), yes("p0"));
  if (format !== "1v1") {
    steps.push(expectPrompt({ by: "p0", context: "opponent" }),
      expectPickSeats(format === "tag" ? ["p1", "p3"] : seats.slice(1, count), "p0"),
      pickOpponent(last, "p0"));
  }
  const subject = own ? "p0" : last;
  steps.push(choose(own ? "your Extra Deck" : "opponent's Extra Deck", "p0"),
    expectPrompt({ by: "p0" }), select({ card: UTOPIA, owner: subject, from: "extra" }));
  board[subject] = { ...board[subject], extra: [LEVIATHAN],
    grave: [...(board[subject]?.grave as string[]), UTOPIA] };
  steps.push(expectBoard(board));
  return defineScenario({
    id: `p3-extra-deck-branded-${format}-${own ? "own" : "declared"}`,
    title: `${format}: Branded sends Utopia from ${subject} and keeps every other Extra Deck`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-FFA-OPP-ONE], C3/C4 final expectations",
    rules: ["R-COMMON-OPP-PICK", "R-FFA-OPP-ONE"],
    tags: ["multiplayer", "p3", "extra-deck", format, "card:14220547"], setup, steps,
  });
}

const standard = (["1v1", "ffa3", "ffa4", "tag"] as const).flatMap(format =>
  [extraDeck(format, false), extraDeck(format, true)]);
export const P3_EXTRA_DECK_SCENARIOS: Scenario[] = [
  ...standard,
  ...standard.filter(scenario => scenario.setup.format !== "1v1").map(scenario => {
    const variant = domainVariant(scenario);
    const masters: BoardExpect = {};
    for (const seat of seats) if (variant.setup[seat]?.deckMaster) {
      masters[seat] = { deckMaster: { inZone: true, returns: 0, nextCost: 0 } };
    }
    variant.steps = [expectBoard(masters), ...variant.steps, expectBoard(masters)];
    return variant;
  }),
];

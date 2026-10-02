import { activate, defineScenario, expectBoard, expectNotOffered, expectPickOptions, expectPrompt, pickOpponent, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
const HANDS = ["Giant Rat", "Battle Ox", "Axe Raider", "Silver Fang"];
function grass(format: "1v1" | "ffa3" | "ffa4" | "tag", noOpponent = false, multiple = false): Scenario {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format, deckSize: 12 };
  const board: BoardExpect = {};
  for (let seat = 0; seat < count; seat++) {
    const length = seat === 0 ? 8 : seat === count - 1 && !noOpponent ? 3 : multiple && seat === 1 ? 5 : 12;
    setup[SEATS[seat]] = { hand: [HANDS[seat]], monsters: ["Mystical Elf"], deck: Array<string>(length).fill(seat === 0 ? "Blue-Eyes White Dragon" : HANDS[seat]) };
    board[SEATS[seat]] = { lp: format === "tag" ? 16000 : 8000, hand: [HANDS[seat]], monsters: ["Mystical Elf"], spells: [], grave: [], banished: [], extra: [], deckCount: length };
  }
  setup.p0!.hand!.push("That Grass Looks Greener");
  if (noOpponent) board.p0!.hand = [HANDS[0], "That Grass Looks Greener"];
  else { board.p0!.deckCount = 3; board.p0!.grave = ["That Grass Looks Greener", ...Array<string>(5).fill("Blue-Eyes White Dragon")]; }
  const steps: Step[] = [noOpponent ? expectNotOffered("activate", "That Grass Looks Greener", "p0") : activate("That Grass Looks Greener", "p0")];
  if (multiple) steps.push(expectPickOptions([{seat:"p1"},{seat:SEATS[count-1]}],"p0"), pickOpponent(SEATS[count-1],"p0"));
  else if (!noOpponent) steps.push(expectPrompt({by:"p0",context:"action"}));
  steps.push(expectBoard(board));
  return defineScenario({
    id: `grass-deck-counts-${format}-${noOpponent ? "no-eligible-opponent" : multiple ? "multiple-eligible-late-picked" : "late-eligible-opponent"}`,
    title: `${format}: Grass ${noOpponent ? "has no smaller opposing Deck" : "mills five against the later smaller Deck"}`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [Q2]", rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "card:11110587", format], setup, steps,
  });
}
export const GRASS_DECK_COUNTS_SCENARIOS: Scenario[] = [
  ...(["1v1", "ffa3", "ffa4", "tag"] as const).map(format => grass(format)),
  ...(["ffa3", "ffa4", "tag"] as const).map(format => grass(format, true)),
  ...(["ffa3", "ffa4", "tag"] as const).map(format => grass(format, false, true)),
];

// Both rivals qualify. The selected Deck, not the joined Decks or the smallest Deck, sets the mill count.
export const GRASS_TAG_DECLARED_DECK_SCENARIOS: Scenario[] = (["p1", "p3"] as const).map(recipient => {
  const scenario = structuredClone(grass("tag", false, true));
  const remaining = recipient === "p1" ? 5 : 3;
  const final = scenario.steps.find(step => step.op === "expectBoard")!;
  if (final.op !== "expectBoard") throw new Error("Grass needs a final board");
  final.board.p0!.deckCount = remaining;
  final.board.p0!.grave = ["That Grass Looks Greener", ...Array<string>(8 - remaining).fill("Blue-Eyes White Dragon")];
  for (const step of scenario.steps) if (step.op === "pickOpponent") step.seat = recipient;
  scenario.id = `grass-tag-declared-deck-${recipient}-sizes-5-and-3`;
  scenario.title = `Tag: Grass declares ${recipient} and mills ${8 - remaining} cards from its own Deck`;
  scenario.source = "docs/adr/0002-multiplayer-duel-rules.md [R-TAG-SHARED-CARDS]; owner answer 2026-10-02";
  scenario.rules = ["R-COMMON-OPP-PICK", "R-TAG-SHARED-CARDS"];
  return defineScenario(scenario);
});

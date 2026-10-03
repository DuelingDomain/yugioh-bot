import { expectBoard, select, yes, type BoardExpect, type DuelistId, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
const SEATS: DuelistId[] = ["p0", "p1", "p2", "p3"];
export const UNDERWORLD_CIRCLE_STANDBY_SCENARIOS: Scenario[] = (["1v1", "ffa3", "ffa4", "tag"] as const).map((format) => {
  const count = format === "1v1" ? 2 : format === "ffa3" ? 3 : 4;
  const setup: Scenario["setup"] = { format, deckSize: 2 };
  const board: BoardExpect = {};
  const steps: Step[] = [];
  for (let i = 0; i < count; i++) {
    const seat = SEATS[i];
    setup[seat] = { grave: ["Mystical Elf"], deck: ["Raigeki", "Raigeki"] };
    board[seat] = { lp: format === "tag" ? 16000 : 8000, hand: [], deckCount: 2, monsters: ["Mystical Elf"], spells: i === 0 ? ["Underworld Circle"] : [], grave: [], banished: [], extra: [] };
    steps.push(yes(seat));
    // Tag shares each team's GY. The first chooser selects its own Elf; the partner has one Elf left.
    if (format === "tag" && i < 2) steps.push(select({ card: "Mystical Elf", owner: seat }));
  }
  setup.p0!.spells = ["Underworld Circle"];
  steps.push(expectBoard(board));
  return defineScenario({
    id: `underworld-circle-standby-${format}`, title: `${format}: each living duelist gets a Standby summon`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]", rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "all-player-zone-gaps", "card:73443672", format], setup, steps,
  });
});

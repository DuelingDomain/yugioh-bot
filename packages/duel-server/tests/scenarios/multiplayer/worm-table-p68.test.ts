import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { select } from "../../support/dsl.js";
import { runScenarios } from "../../support/runner.js";
import { WORM_CONTROLLER_SCENARIOS } from "./worm-controller.js";

// P68 selects an equip target from all opponent fields; the declared-opponent core patch is not installed yet.
describeWithCores("live Worm Millidith table proof on P68", liveNseat, () => {
  runScenarios("multiplayer/worm-table-p68", WORM_CONTROLLER_SCENARIOS.map(scenario => ({
    ...scenario,
    id: `${scenario.id}-table-p68`,
    steps: scenario.steps.map(step => {
      if (step.op === "pickOpponent") return select({ card: "Mystical Elf", owner: step.seat });
      if (step.op !== "expectBoard") return step;
      return { ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, {
        ...state,
        extra: [],
        deckCount: seat === "p1" ? 19 : 20,
      }])) };
    }),
  })));
});

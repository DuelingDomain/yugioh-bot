import { describeWithCores } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { WORM_CONTROLLER_SCENARIOS } from "./worm-controller.js";

// Keep the scenario's opponent declaration before the equip target. The file name records the older P68 proof.
describeWithCores("live Worm Millidith table proof on the current core", liveNseat, () => {
  runScenarios("multiplayer/worm-table-p68", WORM_CONTROLLER_SCENARIOS.map(scenario => ({
    ...scenario,
    id: `${scenario.id}-table-p68`,
    steps: scenario.steps.map(step => {
      if (step.op !== "expectBoard") return step;
      return { ...step, board: Object.fromEntries(Object.entries(step.board).map(([seat, state]) => [seat, {
        ...state,
        extra: [],
        deckCount: seat === "p1" ? 19 : 20,
      }])) };
    }),
  })));
});

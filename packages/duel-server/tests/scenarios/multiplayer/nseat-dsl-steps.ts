// One real-engine smoke for the P6 DSL steps (expectPickOptions, expectLabel, expectRetry, eliminate). Plain data like nseat-scenarios.ts.
// The unit tests of each step on a fake game are in nseat.test.ts. Registered in nseat-live.test.ts (live gate).

import {
  attack, changePhase, eliminate, endTurn, expectEliminated, expectLabel, expectLog, expectLp, expectNoLog,
  expectPickOptions, expectPrompt, expectRetry, type Scenario,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { ELF, ELF_ATK, SOURCE } from "./nseat-scenarios.js";

export const DSL_STEP_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "nseat-ffa3-dsl-steps-pick-retry-eliminate",
    title: "FFA3: a direct-attack pick offers both opponents, refuses wrong answers, and surrender immediately removes a seat and picks the last opponent",
    source: `${SOURCE} [R-FFA-ATTACK]`,
    rules: ["R-FFA-ATTACK", "R-FFA-ELIMINATION"],
    tags: ["multiplayer", "dsl", "direct-attack", "elimination", "ffa3"],
    setup: { format: "ffa3", p0: { monsters: [ELF] } },
    steps: [
      endTurn("p0"), endTurn("p1"), endTurn("p2"),
      changePhase("battle", "p0"),
      attack(ELF, "direct", "p0"),
      expectPickOptions([{ seat: "p1" }, { seat: "p2" }], "p0"),
      expectLabel({ seat: "p2" }, "Attack Player 3 directly", "p0"),
      // An option that the prompt does not have, and an answer from a seat that does not hold the prompt: refused, nothing changes.
      expectRetry({ choice: "opt:9" }, { error: "Invalid answer", by: "p0" }),
      expectRetry({ choice: "opt:0" }, { as: "p1", error: "Wrong seat", by: "p0" }),
      // p1 gives up while p0 holds the pick: removal is immediate and the sole remaining option hits p2 automatically.
      eliminate("p1"),
      expectEliminated("p1"),
      expectLog("Player 2 is eliminated (Surrender)", "Player 3 is attacked directly"),
      expectNoLog("Player 2 is attacked directly"),
      expectLp({ seat: "p2" }, 8000 - ELF_ATK),
      expectLp({ seat: "p0" }, 8000),
      expectPrompt({ by: "p0", title: "Choose a battle action", context: "action" }),
      expectPickOptions([{ id: "to_m2" }, { id: "to_ep" }], "p0"),
    ],
  }),
];

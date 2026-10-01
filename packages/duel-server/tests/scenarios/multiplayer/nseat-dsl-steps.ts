// One real-engine smoke for the P6 DSL steps (expectPickOptions, expectLabel, expectRetry, eliminate). Plain data like nseat-scenarios.ts.
// The unit tests of each step on a fake game are in nseat.test.ts. Registered in nseat-live.test.ts (live gate).

import {
  attack, changePhase, defineScenario, eliminate, endTurn, expectEliminated, expectLabel, expectLp, expectPickOptions, expectRetry,
  pickOpponent, type Scenario,
} from "../../support/dsl.js";
import { ELF, ELF_ATK, SOURCE } from "./nseat-scenarios.js";

export const DSL_STEP_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "nseat-ffa3-dsl-steps-pick-retry-eliminate",
    title: "FFA3: a direct-attack pick offers both opponents, refuses wrong answers, and an elimination during the pick lands after the answer",
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
      // p1 gives up while p0 holds the pick: the loss lands after p0 answers, and the pick still hits p2.
      eliminate("p1"),
      pickOpponent("p2", "p0"),
      expectEliminated("p1"),
      expectLp({ seat: "p2" }, 8000 - ELF_ATK),
      expectLp({ seat: "p0" }, 8000),
    ],
  }),
];

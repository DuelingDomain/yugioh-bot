// Live scenarios of core fix OQ3 (patch "gone bound opponent"): a bound opponent that is eliminated means "no effect on that seat", never a Lua error.
// Stock cores returned NO Lua value from Duel.GetLocationCount (and the other count and group functions) when the bound seat was dead, so a script
// that compares the result ("nothing > 0") stopped the duel. The scenarios run the STOCK script of Snake-Eyes Diabellstar: the test file
// (dead-bound-opponent.test.ts) loads an overlay folder without the c27260347.lua workaround, so the core alone must keep the duel running.
// Plain data, also read by scripts/rule-coverage.ts. They need a core with the OQ3 patch (NSEAT_WASM, see the test file).
// Every scenario ends with the state of every seat.

import {
  attack, changePhase, defineScenario, endTurn, expectEliminated, expectPrompt, surrender, yes,
  type Scenario,
} from "../../support/dsl.js";
import { OPP_PICK, everySeat } from "./table-cards.js";

type Seat = "p0" | "p1" | "p2" | "p3";

/** The card code whose overlay file the test file removes. */
export const STOCK_SCRIPT_CARD = 27260347;

export const DEAD_BOUND_OPPONENT_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "oq3-ffa3-stock-diabellstar-bound-opponent-eliminated-gives-no-effect-and-no-lua-error",
    title: "FFA3, stock Snake-Eyes Diabellstar script (no overlay): p1 is eliminated after p0 attacked its monster and before the trigger is checked: the zone count of the dead bound seat is 0 for the script, the effect does not apply and no script fails",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "trigger", "elimination", "oq3", "stock-script", "ffa3", `card:${STOCK_SCRIPT_CARD}`],
    setup: {
      format: "ffa3",
      p0: { monsters: ["Snake-Eyes Diabellstar"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Giant Rat"] },
    },
    steps: [
      ...["p0", "p1", "p2"].map((seat) => endTurn(seat as Seat)),
      changePhase("battle", "p0"),
      attack("Snake-Eyes Diabellstar", { card: "Battle Ox", owner: "p1" }, "p0"),
      surrender("p1"),
      yes("p0"),
      expectEliminated("p1"),
      expectPrompt({ by: "p0", title: "replay occurred" }),
      everySeat("ffa3", { p0: { monsters: ["Snake-Eyes Diabellstar"] }, p2: { monsters: ["Giant Rat"] } }),
    ],
  }),
  defineScenario({
    id: "oq3-ffa4-stock-diabellstar-bound-opponent-eliminated-gives-no-effect-and-no-lua-error",
    title: "FFA4, stock Snake-Eyes Diabellstar script (no overlay): p1 is eliminated after p0 attacked its monster and before the trigger is checked: the effect does not apply, no script fails, and p0, p2 and p3 keep their monsters",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "trigger", "elimination", "oq3", "stock-script", "ffa4", `card:${STOCK_SCRIPT_CARD}`],
    setup: {
      format: "ffa4",
      p0: { monsters: ["Snake-Eyes Diabellstar"] },
      p1: { monsters: ["Battle Ox"] },
      p2: { monsters: ["Giant Rat"] },
      p3: { monsters: ["Axe Raider"] },
    },
    steps: [
      ...["p0", "p1", "p2", "p3"].map((seat) => endTurn(seat as Seat)),
      changePhase("battle", "p0"),
      attack("Snake-Eyes Diabellstar", { card: "Battle Ox", owner: "p1" }, "p0"),
      surrender("p1"),
      yes("p0"),
      expectEliminated("p1"),
      expectPrompt({ by: "p0", title: "replay occurred" }),
      everySeat("ffa4", { p0: { monsters: ["Snake-Eyes Diabellstar"] }, p2: { monsters: ["Giant Rat"] }, p3: { monsters: ["Axe Raider"] } }),
    ],
  }),
];

import { activate, expectChain, expectEliminated, expectPrompt, expectResult, pass, pickOpponent, select, surrender, type Scenario } from "../../support/dsl.js";
import { stressBoard as board, stressScenario as scenario, stressSetup as setup } from "./domain-nseat-stress.js";

const OUT = { inZone: false, returns: 0, nextCost: 0 };
export const DOMAIN_NSEAT_STRESS_CHAIN: Scenario[] = [];
for (const format of ["ffa3", "ffa4", "tag"] as const) {
  DOMAIN_NSEAT_STRESS_CHAIN.push(scenario(format, "pending-loss-keeps-other-seat-chain-window", {
    setup: setup(format, {
      p0: { hand: ["Pot of Greed"], spells: [{ card: "Swords of Revealing Light", pos: "up" }] },
      p1: { spells: [{ card: "Dust Tornado", pos: "set" }] },
      p2: { spells: [{ card: "Dust Tornado", pos: "set" }] },
    }),
    rules: format === "tag" ? ["R-TAG-LOSS"] : ["R-FFA-CHAIN", "R-FFA-ELIMINATION"],
    steps: [activate("Pot of Greed", "p0"), activate("Dust Tornado", "p1"), ...(format === "tag" ? [] : [pickOpponent("p0", "p1")]), select("Swords of Revealing Light"),
      expectPrompt({ by: "p2", context: "chain" }), surrender("p1"),
      // FFA removes the leaver's unresolved Dust Tornado; p2 keeps its response.
      ...(format === "tag" ? [] : [expectChain("Pot of Greed"), expectPrompt({ by: "p2", context: "chain" }), pass("p2")]),
      expectEliminated(format === "tag" ? ["p1", "p3"] : ["p1"]),
      ...(format === "tag" ? [expectResult({ team: 0 })] : []),
      board(format, {
        p0: format === "tag" ? { hand: [], deckCount: 20, spells: ["Swords of Revealing Light", "Pot of Greed"] }
          : { hand: { count: 2 }, deckCount: 18, grave: ["Pot of Greed"], spells: ["Swords of Revealing Light"] },
        p1: { hand: [], deckMaster: OUT },
        p2: { spells: ["Dust Tornado"] },
        ...(format === "tag" ? { p3: { hand: [], deckMaster: OUT } } : {}),
      })],
  }));
}

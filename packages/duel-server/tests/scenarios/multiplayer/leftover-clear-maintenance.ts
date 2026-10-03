import { choose, endTurn, expectPrompt, expectTurn, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format } from "./seat-kit.js";

export const LEFTOVER_CLEAR_MAINTENANCE_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const holder = format === "ffa3" ? "p2" : "p3";
  const lp = format === "tag" ? 16000 : 8000;
  const state = (paid: boolean) => everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
    lp: lp - (paid && (seat === holder || (format === "tag" && seat === "p1")) ? 500 : 0),
    spells: seat === holder ? ["Clear World"] : [],
  }])));
  return defineScenario({
    id: `leftover-clear-world-${format}-maintenance-controller-turn`,
    title: `${format}: Clear World maintenance runs only in its controller's End Phase`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-CONTROLLER-TURN] [R-COMMON-SEP-FIELDS] [R-TAG-LP]",
    rules: ["R-COMMON-CONTROLLER-TURN", "R-COMMON-SEP-FIELDS", ...(format === "tag" ? ["R-TAG-LP"] : [])],
    tags: ["multiplayer", format, "card:33900648"],
    setup: baseSetup(format, { [holder]: { field: "Clear World" } }),
    steps: [
      endTurn("p0"), expectTurn("p1", 2), expectPrompt({ by: "p1", context: "action" }),
      endTurn("p1"), expectTurn("p2", 3), expectPrompt({ by: "p2", context: "action" }), state(false),
      ...(holder === "p3" ? [endTurn("p2"), expectTurn("p3", 4), expectPrompt({ by: "p3", context: "action" })] : []),
      endTurn(holder), choose("Pay 500 LP", holder), expectTurn("p0", SEATS[format].length + 1),
      expectPrompt({ by: "p0", context: "action" }), state(true),
    ],
  });
});

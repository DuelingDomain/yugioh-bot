import {
  activate, attack, changePhase, endTurn, expectBoard, expectEliminated, expectPickSeats,
  expectPrompt, expectResult, expectTurn, pickOpponent, surrender, type DuelistId, type Scenario,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { domainVariant } from "./domain-variants.js";

const standard: Scenario[] = [];
for (const format of ["ffa3", "ffa4"] as const) {
  const seats: DuelistId[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const livingOpponents = seats.slice(2);
  const nextRound = seats.map((seat) => endTurn(seat));
  for (const loss of ["surrender", "lp"] as const) {
    standard.push(defineScenario({
      id: `eliminated-targets-${format}-${loss}-before-attack`,
      title: `${format}: ${loss} removes cards, direct targets and future turns`,
      source: "docs/adr/0002-multiplayer-duel-rules.md",
      rules: ["R-FFA-ELIMINATION", "R-COMMON-SURRENDER-EOT"], tags: ["multiplayer", format, "elimination", "battle"],
      setup: { format, p0: { monsters: ["Mystical Elf"], hand: ["Hinotama"] },
        p1: { lp: 500, monsters: ["Mystical Elf"], hand: ["Mystical Elf"], grave: ["Raigeki"] } },
      steps: [
        ...nextRound,
        ...(loss === "surrender" ? [surrender("p1")] : [activate("Hinotama", "p0"), pickOpponent("p1", "p0")]),
        expectEliminated("p1"), expectBoard({ p1: { monsters: [], spells: [], hand: [], grave: [], deckCount: 0 } }),
        changePhase("battle", "p0"), attack("Mystical Elf", "direct", "p0"),
        ...(format === "ffa4" ? [expectPickSeats(livingOpponents, "p0"), pickOpponent("p2", "p0")] : []),
        expectBoard({ p2: { lp: 7200 }, ...(format === "ffa4" ? { p3: { lp: 8000 } } : {}) }),
        endTurn("p0"), expectTurn("p2"),
      ],
    }));
  }
  standard.push(defineScenario({
    id: `eliminated-targets-${format}-surrender-open-direct-pick`,
    title: `${format}: surrender removes an option from an open direct attack pick`,
    source: "docs/adr/0002-multiplayer-duel-rules.md", rules: ["R-FFA-ELIMINATION", "R-COMMON-SURRENDER-EOT"],
    tags: ["multiplayer", format, "elimination", "battle"], setup: { format, p0: { monsters: ["Mystical Elf"] } },
    steps: [...nextRound, changePhase("battle", "p0"), attack("Mystical Elf", "direct", "p0"),
      expectPickSeats(seats.slice(1), "p0"), surrender("p1"), expectEliminated("p1"),
      ...(format === "ffa4" ? [expectPickSeats(livingOpponents, "p0"), pickOpponent("p2", "p0")] : []),
      expectBoard({ p2: { lp: 7200 } }), expectPrompt({ by: "p0", title: "battle action" })],
  }));
  standard.push(defineScenario({
    id: `eliminated-targets-${format}-surrender-open-effect-pick`,
    title: `${format}: surrender removes a player from an open effect opponent pick`,
    source: "docs/adr/0002-multiplayer-duel-rules.md", rules: ["R-COMMON-OPP-PICK", "R-COMMON-SURRENDER-EOT"],
    tags: ["multiplayer", format, "elimination"], setup: { format, p0: { hand: ["Hinotama"] } },
    steps: [activate("Hinotama", "p0"), expectPickSeats(seats.slice(1), "p0"), surrender("p1"),
      expectEliminated("p1"),
      ...(format === "ffa4" ? [expectPickSeats(livingOpponents, "p0"), pickOpponent("p2", "p0")] : []),
      expectBoard({ p2: { lp: 7500 } }), expectPrompt({ by: "p0", title: "action" })],
  }));
  for (const loss of ["surrender", "lp"] as const) {
    standard.push(defineScenario({
      id: `eliminated-targets-${format}-${loss}-last-seat-wins`,
      title: `${format}: the last living duelist wins at once after ${loss}`,
      source: "docs/adr/0002-multiplayer-duel-rules.md", rules: ["R-FFA-WINNER", "R-COMMON-SURRENDER-EOT"],
      tags: ["multiplayer", format, "elimination"],
      setup: { format, p0: { hand: Array(seats.length - 1).fill("Hinotama") },
        p1: { lp: 500 }, p2: { lp: 500 }, ...(format === "ffa4" ? { p3: { lp: 500 } } : {}) },
      steps: [...seats.slice(1).flatMap((seat, index) => loss === "surrender" ? [surrender(seat)] :
        [activate("Hinotama", "p0"), ...(index < seats.length - 2 ? [pickOpponent(seat, "p0")] : [])]),
        expectEliminated(...seats.slice(1)), expectResult("p0")],
    }));
  }
}

export const ELIMINATED_TARGET_SCENARIOS = [...standard, ...standard.map(domainVariant)];

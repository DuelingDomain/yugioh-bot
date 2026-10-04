import { activate, attack, changePhase, endTurn, expectPickSeats, expectPrompt, pickOpponent, yes, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Format } from "./seat-kit.js";

const HAMA = "Battlewasp - Hama the Conquering Bow", TWIN = "Battlewasp - Twinbow the Attacker";
export const LEFTOVER_HAMA_TURN_SCENARIOS: Scenario[] = [
  ...(["ffa3", "ffa4"] as Format[]).map((format) => {
    const holder = format === "ffa3" ? "p2" : "p3";
    return defineScenario({
      id: `leftover-hama-${format}-undamaged-opponent-only`,
      title: `${format}: Hama offers an undamaged opponent after damaging p0`,
      source: "docs/adr/0002-multiplayer-duel-rules.md [R-FFA-OPP-ONE] [R-COMMON-SEAT-STATE]",
      rules: ["R-FFA-OPP-ONE", "R-COMMON-SEAT-STATE"], tags: ["multiplayer", format, "card:80949182"],
      setup: baseSetup(format, { [holder]: { monsters: [HAMA], grave: [TWIN] } }),
      steps: [
        ...turnsBefore(format, holder), attack(HAMA, "direct", holder), pickOpponent("p0", holder),
        changePhase("main2", holder), yes(holder),
        ...(format === "ffa4" ? [expectPickSeats(SEATS[format].filter((seat) => seat !== "p0" && seat !== holder), holder), pickOpponent("p1", holder)] : []),
        expectPrompt({ by: holder, context: "action" }),
        everySeat(format, { p0: { lp: 5200 }, p1: { lp: 7700 }, [holder]: { monsters: [HAMA], grave: [TWIN] } }),
      ],
    });
  }),
  defineScenario({
    id: "leftover-hama-tag-no-partner-battle-phase-trigger",
    title: "Tag: Hama of p3 does not burn in the Battle Phase of p1",
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-CONTROLLER-TURN] [R-COMMON-SEP-FIELDS] [R-TAG-PARTNER]",
    rules: ["R-COMMON-CONTROLLER-TURN", "R-COMMON-SEP-FIELDS", "R-TAG-PARTNER"], tags: ["multiplayer", "tag", "card:80949182"],
    setup: baseSetup("tag", { p3: { monsters: [HAMA], grave: [TWIN] } }),
    steps: [endTurn("p0"), changePhase("battle", "p1"), changePhase("main2", "p1"),
      expectPrompt({ by: "p1", context: "action" }), everySeat("tag", { p3: { monsters: [HAMA], grave: [TWIN] } })],
  }),
  ...(["ffa3", "ffa4"] as Format[]).map((format) => defineScenario({
    id: `leftover-hama-${format}-stolen-controller-turn`,
    title: `${format}: stolen Hama burns in p0's Battle Phase and not in its owner p1's Battle Phase`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-CONTROLLER-TURN] [R-COMMON-SEP-FIELDS] [R-FFA-OPP-ONE]",
    rules: ["R-COMMON-CONTROLLER-TURN", "R-COMMON-SEP-FIELDS", "R-FFA-OPP-ONE"], tags: ["multiplayer", format, "card:80949182"],
    setup: baseSetup(format, { p0: { hand: ["Snatch Steal"], grave: [TWIN] }, p1: { monsters: [HAMA] } }),
    steps: [activate("Snatch Steal", "p0"), changePhase("battle", "p0"), changePhase("main2", "p0"), yes("p0"), pickOpponent("p2", "p0"),
      expectPrompt({ by: "p0", context: "action" }),
      everySeat(format, { p0: { monsters: [HAMA], spells: ["Snatch Steal"], grave: [TWIN] }, p2: { lp: 7700 } }),
      endTurn("p0"), changePhase("battle", "p1"), changePhase("main2", "p1"), expectPrompt({ by: "p1", context: "action" }),
      everySeat(format, { p0: { monsters: [HAMA], spells: ["Snatch Steal"], grave: [TWIN] }, p1: { lp: 9000 }, p2: { lp: 7700 } })],
  })),
];

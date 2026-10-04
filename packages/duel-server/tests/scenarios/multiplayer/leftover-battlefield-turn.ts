import { attack, endTurn, expectPrompt, expectTurn, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format } from "./seat-kit.js";

export const LEFTOVER_BATTLEFIELD_TURN_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const holder = format === "ffa3" ? "p2" : "p3";
  const mills = format === "tag" ? 10 : 5;
  return defineScenario({
    id: `leftover-battlefield-${format}-off-turn-late-holder`,
    title: `${format}: off-turn Battlefield Tragedy sends cards from p1's Deck only`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-SEP-FIELDS] [R-COMMON-SEAT-STATE]",
    rules: ["R-COMMON-SEP-FIELDS", "R-COMMON-SEAT-STATE"], tags: ["multiplayer", format, "card:42228966"],
    setup: baseSetup(format, { p0: { monsters: ["Mystical Elf"] }, p1: { monsters: ["Blue-Eyes White Dragon"] },
      [holder]: { spells: ["Battlefield Tragedy"] }, ...(format === "tag" ? { p2: { spells: ["Battlefield Tragedy"] } } : {}) }),
    steps: [endTurn("p0"), attack("Blue-Eyes White Dragon", { card: "Mystical Elf", owner: "p0" }, "p1"),
      endTurn("p1"), expectTurn("p2", 3), expectPrompt({ by: "p2", context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        lp: (format === "tag" ? 16000 : 8000) - (seat === "p0" || (format === "tag" && seat === "p2") ? 2200 : 0),
        hand: seat === "p1" || seat === "p2" ? ["Mystical Elf"] : [], deckCount: seat === "p1" ? 19 - mills : seat === "p2" ? 19 : 20,
        monsters: seat === "p1" ? ["Blue-Eyes White Dragon"] : [],
        spells: seat === holder || (format === "tag" && seat === "p2") ? ["Battlefield Tragedy"] : [],
        grave: Array.from({ length: seat === "p0" ? 1 : seat === "p1" ? mills : 0 }, () => "Mystical Elf"),
      }]))),
    ],
  });
});

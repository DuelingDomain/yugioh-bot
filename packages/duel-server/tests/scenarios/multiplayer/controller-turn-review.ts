import { activate, endTurn, expectPrompt, expectTurn, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format } from "./seat-kit.js";

export const CONTROLLER_TURN_REVIEW_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => {
  const tag = format === "tag", lp = tag ? 16000 : 8000, damage = tag ? 6000 : 3000;
  const nova = "Crimson Nova the Dark Cubic Lord", snake = "Dark Snake Syndrome", elf = "Mystical Elf";
  return [defineScenario({
    id: `controller-turn-${format}-stolen-crimson-nova`, title: `${format}: stolen Crimson Nova damages only in its controller's End Phase`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-CONTROLLER-TURN] [R-COMMON-EACH-PLAYER] [R-COMMON-SEP-FIELDS]",
    rules: ["R-COMMON-CONTROLLER-TURN", "R-COMMON-EACH-PLAYER", "R-COMMON-SEP-FIELDS"], tags: ["multiplayer", format, "card:30270176"],
    setup: baseSetup(format, { p0: { hand: ["Snatch Steal"] }, p1: { monsters: [nova] } }),
    steps: [
      activate("Snatch Steal", "p0"), endTurn("p0"), expectTurn("p1", 2), expectPrompt({ by: "p1", context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        lp: lp - damage + (tag ? Number(seat === "p1" || seat === "p3") * 1000 : Number(seat === "p1") * 1000),
        hand: seat === "p1" ? [elf] : [], monsters: seat === "p0" ? [nova] : [],
        spells: seat === "p0" ? ["Snatch Steal"] : [], grave: [],
      }]))),
      endTurn("p1"), expectTurn("p2", 3), expectPrompt({ by: "p2", context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        lp: lp - damage + (tag ? Number(seat === "p1" || seat === "p3") * 1000 : Number(seat === "p1") * 1000),
        hand: seat === "p1" || seat === "p2" ? [elf] : [], monsters: seat === "p0" ? [nova] : [],
        spells: seat === "p0" ? ["Snatch Steal"] : [], grave: [],
      }]))),
    ],
  }), defineScenario({
    id: `controller-turn-${format}-exchanged-dark-snake`, title: `${format}: Dark Snake Syndrome received by Exchange uses its controller's Standby Phase`,
    source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-CONTROLLER-TURN] [R-COMMON-EACH-PLAYER] [R-COMMON-SEP-FIELDS]",
    rules: ["R-COMMON-CONTROLLER-TURN", "R-COMMON-EACH-PLAYER", "R-COMMON-SEP-FIELDS"], tags: ["multiplayer", format, "card:47233801"],
    setup: baseSetup(format, { p0: { hand: ["Exchange", elf] }, p1: { hand: [snake] } }),
    steps: [
      activate("Exchange", "p0"),
      activate(snake, "p0"), endTurn("p0"), expectTurn("p1", 2), expectPrompt({ by: "p1", context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        lp, hand: seat === "p1" ? [elf, elf] : [], spells: seat === "p0" ? [snake] : [],
        grave: seat === "p0" ? ["Exchange"] : [],
      }]))),
      ...SEATS[format].slice(1).map((seat) => endTurn(seat)), expectTurn("p0", SEATS[format].length + 1),
      expectPrompt({ by: "p0", context: "action" }),
      everySeat(format, Object.fromEntries(SEATS[format].map((seat) => [seat, {
        lp: lp - (tag ? 400 : 200), hand: seat === "p1" ? [elf, elf] : [elf],
        spells: seat === "p0" ? [snake] : [], grave: seat === "p0" ? ["Exchange"] : [],
      }]))),
    ],
  })];
});

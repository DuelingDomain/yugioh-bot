import { endTurn, expectPickOptions, expectPrompt, no, select, yes, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format } from "./seat-kit.js";

const PAIRS = [["Celtic Guardian", "Beaver Warrior"], ["Battle Ox", "Axe Raider"], ["Silver Fang", "Giant Soldier of Stone"], ["Mystical Elf", "Neo the Magic Swordsman"]];
export const LEFTOVER_UNDERWORLD_ORDER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => defineScenario({
  id: `leftover-underworld-${format}-p1-standby-first`, title: `${format}: Underworld Circle choices start with p1 in p1's Standby Phase`,
  source: "docs/adr/0002-multiplayer-duel-rules.md [R-COMMON-EACH-PLAYER]", rules: ["R-COMMON-EACH-PLAYER"],
  tags: ["multiplayer", format, "card:73443672"],
  setup: baseSetup(format, Object.fromEntries(SEATS[format].map((seat, i) => [seat, { grave: PAIRS[i], ...(seat === "p0" ? { spells: ["Underworld Circle"] } : {}) }]))),
  steps: [
    ...SEATS[format].map((seat) => no(seat)), endTurn("p0"),
    ...[...SEATS[format].slice(1), "p0" as const].flatMap((seat) => {
      const pair = PAIRS[Number(seat[1])];
      return [expectPrompt({ by: seat }), yes(seat), ...(format === "tag" ? [] : [expectPickOptions(pair.map((card) => ({ seat, card })), seat)]), select({ card: pair[0], owner: seat })];
    }), expectPrompt({ by: "p1", context: "action" }),
    everySeat(format, Object.fromEntries(SEATS[format].map((seat, i) => [seat, { hand: seat === "p1" ? ["Mystical Elf"] : [], deckCount: seat === "p1" ? 19 : 20, monsters: [PAIRS[i][0]], grave: [PAIRS[i][1]], spells: seat === "p0" ? ["Underworld Circle"] : [] }]))),
  ],
}));

// Kyoro Ryu-Ge Kaiva (93509766): two destroyed cards enable its hand summon.
// Dark Hole destroys cards at two different seats; a later holder uses the
// global counter. One destruction must leave the holder's card in its hand.
import { activate, defineScenario, endTurn, expectPrompt, expectTurn, type DuelistExpect, type Scenario } from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, SEATS, type Format, type Seat } from "./seat-kit.js";

const CARD = "Kyoro Ryu-Ge Kaiva";
const HOLE = "Dark Hole";
const ELF = "Mystical Elf";
const OX = "Battle Ox";

function summon(format: Format, holder: Seat, count: 1 | 2): Scenario {
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [], deckCount: 20 };
  spec.p0 = { ...spec.p0, grave: count === 2 ? [HOLE, OX] : [HOLE] };
  spec.p1 = { ...spec.p1, grave: [ELF], ...(count === 1 ? { hand: [ELF], deckCount: 19 } : {}) };
  spec[holder] = { ...spec[holder], ...(count === 2 ? { monsters: [CARD] } : { hand: [...(holder === "p1" ? [ELF] : []), CARD] }) };
  return defineScenario({
    id: `kyoro-ryu-ge-kaiva-${format}-${holder}-${count}-cards-destroyed-${count === 2 ? "summons" : "stays-in-hand"}`,
    title: `${label(format)}: ${count} destroyed card(s) ${count === 2 ? "enable" : "do not enable"} the Kaiva of ${holder}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the global destruction counter reaches every real seat and Tag team`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "flag", format, "card:93509766"],
    setup: baseSetup(format, {
      p0: { hand: [HOLE], ...(count === 2 ? { monsters: [OX] } : {}) },
      p1: { monsters: [ELF] }, [holder]: { hand: [CARD] },
    }),
    steps: [
      activate(HOLE, "p0"),
      ...(count === 2 ? [activate({ card: CARD, from: "hand" }, holder), expectPrompt({ by: "p0", context: "action" })] : [endTurn("p0"), expectTurn("p1", 2)]),
      everySeat(format, spec),
    ],
  });
}

export const KYORO_RYU_GE_KAIVA_SCENARIOS: Scenario[] = [
  summon("ffa3", "p2", 2), summon("ffa4", "p2", 2), summon("ffa4", "p3", 2),
  summon("tag", "p2", 2), summon("tag", "p3", 2),
  summon("ffa3", "p2", 1), summon("ffa4", "p3", 1), summon("tag", "p3", 1),
];

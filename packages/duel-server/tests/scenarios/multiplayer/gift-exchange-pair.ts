import { activate, endTurn, pickOpponent, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
const GIFT = "Gift Exchange";
const OX = "Battle Ox";
const BLUE = "Blue-Eyes White Dragon";
const ELF = "Mystical Elf";
export const GIFT_EXCHANGE_PAIR_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const target: Seat = format === "ffa3" ? "p2" : "p3";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { hand: [BLUE], grave: [GIFT] };
  spec.p1 = { hand: [ELF] };
  spec[target] = { hand: [OX] };
  return defineScenario({
    id: `gift-exchange-pair-${format}-${target}`,
    title: `${format}: p0 exchanges Deck cards with picked ${target}; each gets the other's card in its own hand`,
    source: `${SOURCE} [R-COMMON-OPP-PICK] keep the picked pair for the delayed hand effect`,
    rules: ["R-COMMON-OPP-PICK"], tags: ["multiplayer", "delayed-effect", format, "card:82257940"],
    setup: baseSetup(format, { p0: { hand: [GIFT], deck: [OX] }, [target]: { deck: [BLUE] } }),
    steps: [activate(GIFT, "p0"), pickOpponent(target, "p0"), { op: "select", sels: [OX], by: "p0" },
      { op: "select", sels: [BLUE], by: target }, endTurn("p0"), everySeat(format, spec)],
  });
});

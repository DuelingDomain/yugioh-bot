import { activate, defineScenario, endTurn, pickOpponent, type Scenario } from "../../support/dsl.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";
const OMEGA = "PSY-Framelord Omega";
const RAT = "Giant Rat";
const ELF = "Mystical Elf";
export const OMEGA_HAND_RETURN_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).map((format) => {
  const target: Seat = format === "ffa3" ? "p2" : "p3";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { hand: format === "tag" ? [] : [ELF], monsters: [OMEGA] };
  spec.p1 = { hand: [ELF, ELF] };
  if (format === "ffa4") spec.p2 = { hand: [ELF, ELF] };
  if (format === "tag") spec.p2 = { hand: [ELF] };
  spec[target] = { hand: format === "tag" ? [RAT] : [RAT, ELF] };
  return defineScenario({
    id: `omega-hand-return-${format}-${target}`,
    title: `${format}: Omega banishes a card in picked ${target}'s hand and returns it to that hand at the next own-side Standby Phase`,
    source: `${SOURCE} [R-COMMON-OPP-PICK] retain the hand seat for the delayed return`,
    rules: ["R-COMMON-OPP-PICK"], tags: ["multiplayer", "delayed-effect", format, "card:74586817"],
    setup: baseSetup(format, { p0: { monsters: [OMEGA] }, p1: { hand: [ELF] },
      ...(format === "ffa4" ? { p2: { hand: [ELF] } } : {}), [target]: { hand: [RAT] } }),
    steps: [activate({ card: OMEGA, effect: "Banish" }, "p0"), pickOpponent(target, "p0"),
      ...(format === "tag" ? SEATS[format].slice(0, 2) : SEATS[format]).map((seat) => endTurn(seat)), everySeat(format, spec)],
  });
});

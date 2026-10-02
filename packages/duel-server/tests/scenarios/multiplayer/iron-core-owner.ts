// A real Give and Take sends a later owner's Doom to p0. Its End Phase upkeep destroys it, and Lab must give the search to that owner.
import { activate, defineScenario, endTurn, faceDown, normalSummon, pickOpponent, yes, type Scenario } from "../../support/dsl.js";
import { baseSetup, everySeat, SEATS, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const LAB = "Iron Core Specimen Lab";
const GIVE = "Give and Take";
const DOOM = "Koa'ki Meiru Doom";
const GUARDIAN = "Koa'ki Meiru Guardian";
const ELF = "Mystical Elf";
const OX = "Battle Ox";

function lab(format: Format, owner: Seat): Scenario {
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: [] };
  spec.p0 = { monsters: [OX], hand: [] };
  spec.p1 = { hand: [ELF] };
  spec[owner] = { monsters: [ELF], spells: [LAB], grave: [GIVE, DOOM], hand: owner === "p1" ? [GUARDIAN, ELF] : [GUARDIAN] };
  return defineScenario({
    id: `iron-core-owner-${format}-${owner}-doom-destroyed-on-p0-field`,
    title: `${format}: ${owner} gives Doom to p0; its upkeep destroys it in p0's End Phase, and ${owner} searches with Iron Core Specimen Lab`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the owner in a global event is a real seat`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "owner", format, "card:53039326"],
    setup: baseSetup(format, {
      p0: { hand: [OX] },
      [owner]: { field: LAB, monsters: [ELF], spells: [faceDown(GIVE)], grave: [DOOM], deck: [GUARDIAN] },
    }),
    steps: [
      normalSummon(OX, "p0"),
      activate(GIVE, owner),
      pickOpponent("p0", owner),
      endTurn("p0"),
      yes(owner),
      everySeat(format, spec),
    ],
  });
}

export const IRON_CORE_OWNER_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [
  lab(format, "p1"), lab(format, format === "ffa3" ? "p2" : "p3"),
]);

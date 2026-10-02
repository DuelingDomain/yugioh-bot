// A real Xyz cost checks the shared detach record with one and two Ahashima holders.
import { activate, faceDown, pickOpponent, yes, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { baseSetup, everySeat, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";
import { SOURCE } from "./nseat-scenarios.js";

const AHASHIMA = "Bujinki Ahashima";
const COWBOY = "Gagaga Cowboy";
const ELF = "Mystical Elf";

function detach(format: Format, two: boolean): Scenario {
  const actor: Seat = format === "ffa3" ? "p2" : "p3";
  const spec: Parameters<typeof everySeat>[1] = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: seat === "p0" ? [] : [ELF] };
  spec.p0 = { monsters: two ? [AHASHIMA] : [], grave: ["Raigeki"], hand: [], lp: (format === "tag" ? 16000 : 8000) - 800 };
  spec[actor] = { monsters: [COWBOY, AHASHIMA], grave: [ELF], hand: [ELF] };
  return defineScenario({
    id: `bujinki-detach-state-${format}-${actor}-${two ? "two" : "one"}-holders`,
    title: `${format}: ${actor}'s Ahashima sees its linked Cowboy detach${two ? " with a first holder at p0" : " as the only holder"}`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] each holder reads the real detach controller`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "global-effect", "seat-state", format, "card:71095768"],
    setup: baseSetup(format, {
      p0: { monsters: two ? [AHASHIMA] : [], spells: [faceDown("Raigeki")] },
      [actor]: { monsters: [null, null, { card: COWBOY, pos: "def", materials: [ELF] }, null, null, AHASHIMA] },
    }),
    steps: [
      ...turnsBefore(format, actor),
      activate(COWBOY, actor),
      ...(format === "tag" ? [] : [pickOpponent("p0", actor)]),
      yes(actor),
      everySeat(format, spec),
    ],
  });
}

export const BUJINKI_DETACH_STATE_SCENARIOS: Scenario[] = (["ffa3", "ffa4", "tag"] as Format[]).flatMap((format) => [detach(format, false), detach(format, true)]);

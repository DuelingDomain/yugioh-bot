// Artifact Lancea (34267821): after one copy resolves, a second holder at another seat cannot activate it that turn.
// Waboku keeps a real response prompt open for the second holder, so the absence of Lancea is checked in that holder's prompt.
import { activate, endTurn, expectNotOffered, expectOffered, expectResolved, faceDown, pass, pickOpponent, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, type Format, type Seat } from "./seat-kit.js";

const LANCEA = "Artifact Lancea";
const POT = "Pot of Greed";
const CURE = "Dian Keto the Cure Master";
const WABOKU = "Waboku";
const ELF = "Mystical Elf";

function secondLancea(format: Format, second: Seat): Scenario {
  return defineScenario({
    id: `artifact-lancea-${format}-p1-resolution-blocks-second-holder-${second}`,
    title: `${label(format)}: Lancea of p1 resolves, then Lancea of ${second} is absent from its real Waboku response prompt`,
    source: `${SOURCE} [R-COMMON-EACH-PLAYER] Lancea prevents every duelist from banishing, and its resolved flag blocks another holder`,
    rules: ["R-COMMON-EACH-PLAYER", "R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "flag", format, "card:34267821"],
    setup: baseSetup(format, {
      p0: { hand: [POT, CURE] },
      p1: { hand: [LANCEA] },
      [second]: { hand: [LANCEA], spells: [faceDown(WABOKU)] },
    }),
    steps: [
      activate(POT, "p0"),
      expectOffered("activate", LANCEA, "p1"),
      activate(LANCEA, "p1"),
      ...(format === "tag" ? [pickOpponent("p0", "p1")] : []),
      pass(second),
      expectResolved(LANCEA, POT),
      expectOffered("activate", WABOKU, second),
      expectNotOffered("activate", LANCEA, second),
      activate(WABOKU, second),
      activate(CURE, "p0"),
      everySeat(format, {
        p0: { lp: baseLp(format) + 1000, hand: [ELF, ELF], deckCount: 18, grave: [POT, CURE] },
        p1: { hand: [], deckCount: 20, grave: [LANCEA] },
        ...(format === "ffa4" || format === "tag" ? { p2: { hand: [], deckCount: 20 } } : {}),
        [second]: { hand: [LANCEA], deckCount: 20, grave: [WABOKU] },
      }),
      endTurn("p0"),
      ...(format === "tag" ? [endTurn("p1")] : []),
      // The first effect has expired. The second holder may now activate its copy in the next opposing turn.
      expectOffered("activate", LANCEA, second),
      activate(LANCEA, second),
      ...(format === "tag" ? [pickOpponent("p0", second)] : []),
      everySeat(format, {
        p0: { lp: baseLp(format) + 1000, hand: [ELF, ELF], deckCount: 18, grave: [POT, CURE] },
        p1: { hand: [ELF], deckCount: 19, grave: [LANCEA] },
        ...(format === "ffa4" || format === "tag" ? { p2: { hand: format === "tag" ? [ELF] : [], deckCount: format === "tag" ? 19 : 20 } } : {}),
        [second]: { hand: [], deckCount: 20, grave: [WABOKU, LANCEA] },
      }),
    ],
  });
}

export const ARTIFACT_LANCEA_SCENARIOS: Scenario[] = [secondLancea("ffa3", "p2"), secondLancea("ffa4", "p3"), secondLancea("tag", "p3")];

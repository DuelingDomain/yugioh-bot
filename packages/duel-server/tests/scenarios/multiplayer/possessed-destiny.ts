// Possessed Destiny (45508030, issue #686): the stock filter passes one player argument too many to Card.IsCanBeSpecialSummoned,
// so the multi core read the position mask as the target player and no monster qualified: the Spell was never offered.
import { activate, expectOffered, no, zone, type Scenario } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseSetup, everySeat, label, type Format } from "./seat-kit.js";

const DESTINY = "Possessed Destiny";
const LYNA = "Familiar-Possessed - Lyna"; // LIGHT: the face-up Lyna on the field names the Attribute, the second Lyna in the Deck is summoned.

function possessedDestiny(format: Format): Scenario {
  return defineScenario({
    id: `possessed-destiny-${format}-spell-is-offered-and-summons`,
    title: `${label(format)}: p0 activates Possessed Destiny on its face-up Lyna, Special Summons a second Lyna from the Deck, and keeps the first Lyna face-up`,
    source: `${SOURCE} [R-COMMON-OPP-PICK] a script that passes a bad player argument must not hide the card (issue #686)`,
    rules: ["R-COMMON-OPP-PICK"], tags: ["multiplayer", "script-fix", format, "card:45508030"],
    setup: baseSetup(format, { p0: { hand: [DESTINY], monsters: [LYNA], deck: [LYNA] } }),
    steps: [
      expectOffered("activate", DESTINY, "p0"),
      activate(DESTINY, "p0"),
      zone("p0", "s0", "p0"),
      no("p0"),
      everySeat(format, { p0: { hand: [], monsters: [LYNA, LYNA], spells: [], grave: [DESTINY] } }),
    ],
  });
}

export const POSSESSED_DESTINY_SCENARIOS: Scenario[] = [possessedDestiny("ffa3")];

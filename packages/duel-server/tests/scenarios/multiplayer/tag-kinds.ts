// Tag scenarios of two overlay kinds that had a live scenario only at FFA3: a trigger (Core Blast, kind "trig") and a chooser (Dark Coffin,
// kind "chooser"). Review B (test proof quality): every overlay kind needs a live proof in FFA3 and in Tag, and in a Domain duel
// (tests/scenarios/multiplayer/domain-variants.test.ts runs these too). Tag: team 0 is p0 and p2, team 1 is p1 and p3. The opposing side of a
// duelist is the joined field of the other team, and the picked opposing duelist chooses (docs/adr/0002-multiplayer-duel-rules.md, R-COMMON-OPP-PICK).

import {
  activate, defineScenario, expectBoard, expectPickSeats, pickOpponent, select, yes, type Scenario,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

const WITCH = "Witch of the Black Forest";
const BUG = "Man-Eater Bug";
const SANGAN = "Sangan";
const OX = "Battle Ox";

export const TAG_KIND_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "tag-kinds-core-blast-trigger-joined-field-picked-duelist",
    title: "Tag: the Core Blast trigger of p0 (kind trig) is offered when the joined opposing field has more monsters and p0 destroys cards of the joined opposing field (no pick: the field of both opposing duelists is one pool)",
    source: `${SOURCE} [R-COMMON-OPP-PICK]`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "compare", "trigger", "tag", "card:18517177"],
    // p0 controls 1 monster; p1 has 1 and p3 has 2: the joined opposing field of 3 is more than 1. Core Blast destroys 3 - 1 = 2 cards.
    setup: {
      format: "tag",
      p0: { monsters: ["Koa'ki Meiru Wall"], spells: ["Core Blast"] },
      p1: { monsters: [WITCH] },
      p3: { monsters: [BUG, OX] },
    },
    steps: [
      yes("p0"),
      // No opponent pick in Tag: the trigger reads the joined opposing field, and p0 chooses among the monsters of both opposing duelists.
      expectPickSeats(["p1", "p3"], "p0"),
      select(WITCH, BUG),
      expectBoard({
        p0: { lp: 16000, monsters: ["Koa'ki Meiru Wall"], spells: ["Core Blast"], grave: [] },
        p1: { lp: 16000, monsters: [], grave: [WITCH] },
        p2: { lp: 16000, monsters: [], grave: [] },
        p3: { lp: 16000, monsters: [OX], grave: [BUG] },
      }),
    ],
  }),
  defineScenario({
    id: "tag-kinds-dark-coffin-picked-duelist-chooses",
    title: "Tag: Dark Coffin of p0 (kind chooser) asks which opposing duelist when it is destroyed face-down, and only that duelist chooses and loses a monster",
    source: `${SOURCE} [R-COMMON-OPP-PICK]`,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "chooser", "trigger", "tag", "card:1804528"],
    setup: {
      format: "tag",
      p0: { hand: ["Heavy Storm"], spells: [{ card: "Dark Coffin", pos: "set" }] },
      p1: { monsters: [SANGAN] },
      p3: { monsters: [BUG, OX] },
    },
    steps: [
      activate("Heavy Storm", "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      // p3 has no card in the hand, so only "destroy a monster" is left and p3 picks the monster.
      select(OX),
      expectBoard({
        p0: { lp: 16000, monsters: [], spells: [], grave: ["Heavy Storm", "Dark Coffin"] },
        p1: { lp: 16000, monsters: [SANGAN], grave: [] },
        p2: { lp: 16000, monsters: [], grave: [] },
        p3: { lp: 16000, monsters: [BUG], grave: [OX] },
      }),
    ],
  }),
];

// FFA4 live scenarios of the Deck Master in a Domain duel (review gap: Domain was proven at FFA4 only through the overlay-card variants, and the
// Deck Master recall only at 2 seats). Each of the 4 seats has its own Deck Master and its own Deck Master zone [R-COMMON-SEP-FIELDS]. A Dark Hole
// destroys the Deck Masters on the field and the monsters of the other seats. Each owner gets its own recall prompt, and the
// Deck Masters in the zones of the other seats stay. Every scenario asserts the state of every seat. Plain data (scripts/rule-coverage.ts reads it);
// domain-ffa4-deck-master.test.ts runs it on a live Domain core. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, endTurn, expectBoard, expectPrompt, no, normalSummon, yes,
  type Scenario,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

const RULE = `${SOURCE} [R-COMMON-SEP-FIELDS]: in Domain each duelist has their own Deck Master and Deck Master zone`;
const MASTERS = { p0: "Axe Raider", p1: "Celtic Guardian", p2: "Battle Ox", p3: "Giant Soldier of Stone" } as const;

export const DOMAIN_FFA4_DECK_MASTER_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "domain-ffa4-deck-master-recall-by-the-owner-p0-others-keep-their-zone",
    title: "Domain FFA4: p0 summons its Deck Master, a Dark Hole destroys it and the 3 monsters of the others, p0 recalls it for the first time, the Deck Masters of p1, p2 and p3 stay in their zones",
    source: RULE,
    rules: ["R-COMMON-SEP-FIELDS"],
    tags: ["multiplayer", "domain", "deck-master", "recall", "ffa4", "card:53129443"],
    setup: {
      mode: "domain",
      format: "ffa4",
      p0: { deckMaster: MASTERS.p0, hand: ["Dark Hole"] },
      p1: { deckMaster: MASTERS.p1, monsters: [ELF] },
      p2: { deckMaster: MASTERS.p2, monsters: [ELF] },
      p3: { deckMaster: MASTERS.p3, monsters: [ELF] },
    },
    steps: [
      normalSummon({ card: MASTERS.p0, from: "dmz" }, "p0"),
      activate("Dark Hole", "p0"),
      expectPrompt({ by: "p0", context: "deck-master-recall" }),
      yes("p0"),
      expectBoard({
        p0: { lp: 8000, hand: [], monsters: [], grave: ["Dark Hole"], deckMaster: { inZone: true, returns: 1, nextCost: 500 } },
        p1: { lp: 8000, hand: [], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0 } },
        p2: { lp: 8000, hand: [], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0 } },
        p3: { lp: 8000, hand: [], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "domain-ffa4-deck-master-recall-refused-by-p1-in-its-own-turn",
    title: "Domain FFA4: in the turn of p1 its Deck Master is destroyed by a Dark Hole, only p1 is asked for the recall, p1 refuses and the Deck Master stays in its Graveyard, the zones of p0, p2 and p3 stay",
    source: RULE,
    rules: ["R-COMMON-SEP-FIELDS", "R-FFA-ORDER"],
    tags: ["multiplayer", "domain", "deck-master", "recall", "ffa4", "card:53129443"],
    setup: {
      mode: "domain",
      format: "ffa4",
      p0: { deckMaster: MASTERS.p0, monsters: [ELF] },
      p1: { deckMaster: MASTERS.p1, hand: ["Dark Hole"] },
      p2: { deckMaster: MASTERS.p2, monsters: [ELF] },
      p3: { deckMaster: MASTERS.p3 },
    },
    steps: [
      endTurn("p0"),
      normalSummon({ card: MASTERS.p1, from: "dmz" }, "p1"),
      activate("Dark Hole", "p1"),
      expectPrompt({ by: "p1", context: "deck-master-recall" }),
      no("p1"),
      expectBoard({
        p0: { lp: 8000, hand: [], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0 } },
        p1: { lp: 8000, hand: [ELF], monsters: [], grave: [MASTERS.p1, "Dark Hole"], deckMaster: { inZone: false, returns: 0 } },
        p2: { lp: 8000, hand: [], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0 } },
        p3: { lp: 8000, hand: [], monsters: [], grave: [], deckMaster: { inZone: true, returns: 0 } },
      }),
    ],
  }),
  defineScenario({
    id: "domain-ffa4-two-deck-masters-destroyed-recall-answers-stay-with-each-owner",
    title: "Domain FFA4: one Dark Hole destroys the Deck Masters of p0 and p2; p0 recalls, p2 refuses, and each seat keeps its own return count and cost",
    source: RULE,
    rules: ["R-COMMON-SEP-FIELDS", "R-FFA-ORDER"],
    tags: ["multiplayer", "domain", "deck-master", "recall", "ffa4", "card:53129443"],
    setup: {
      mode: "domain",
      format: "ffa4",
      p0: { deckMaster: MASTERS.p0, hand: ["Dark Hole"] },
      p1: { deckMaster: MASTERS.p1, monsters: [ELF] },
      p2: { deckMaster: MASTERS.p2 },
      p3: { deckMaster: MASTERS.p3, monsters: [ELF] },
    },
    steps: [
      normalSummon({ card: MASTERS.p0, from: "dmz" }, "p0"),
      endTurn("p0"),
      endTurn("p1"),
      normalSummon({ card: MASTERS.p2, from: "dmz" }, "p2"),
      endTurn("p2"),
      endTurn("p3"),
      expectBoard({
        p0: { monsters: [MASTERS.p0], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
        p1: { monsters: [ELF], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
        p2: { monsters: [MASTERS.p2], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
        p3: { monsters: [ELF], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
      }),
      activate("Dark Hole", "p0"),
      expectPrompt({ by: "p0", context: "deck-master-recall" }),
      expectBoard({
        p0: { deckMaster: { returns: 0, nextCost: 0 } },
        p1: { deckMaster: { returns: 0, nextCost: 0 } },
        p2: { deckMaster: { returns: 0, nextCost: 0 } },
        p3: { deckMaster: { returns: 0, nextCost: 0 } },
      }),
      yes("p0"),
      expectPrompt({ by: "p2", context: "deck-master-recall" }),
      expectBoard({
        p0: { deckMaster: { returns: 1, nextCost: 500 } },
        p1: { deckMaster: { returns: 0, nextCost: 0 } },
        p2: { deckMaster: { returns: 0, nextCost: 0 } },
        p3: { deckMaster: { returns: 0, nextCost: 0 } },
      }),
      no("p2"),
      expectBoard({
        p0: { lp: 8000, hand: [ELF], monsters: [], grave: ["Dark Hole"], deckMaster: { inZone: true, returns: 1, nextCost: 500 } },
        p1: { lp: 8000, hand: [ELF], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
        p2: { lp: 8000, hand: [ELF], monsters: [], grave: [MASTERS.p2], deckMaster: { inZone: false, returns: 0, nextCost: 0 } },
        p3: { lp: 8000, hand: [ELF], monsters: [], grave: [ELF], deckMaster: { inZone: true, returns: 0, nextCost: 0 } },
      }),
    ],
  }),
];

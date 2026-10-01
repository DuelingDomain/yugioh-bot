// Live scenarios of the "each opponent" chooser cards (F7 design, class CH-EACH, test row F6): The Shallow Grave lets the activator and
// then every opposing duelist pick 1 monster from their OWN Graveyard. Plain data, also read by scripts/rule-coverage.ts;
// tests/scenarios/multiplayer/each-opponent.test.ts runs them on a live core (NSEAT_LIVE=1) with the overlay of domain-core/multi-scripts.
// Decisions: docs/adr/0002-multiplayer-duel-rules.md (R1 "each player", question 5: only "all/each opponent" cards let every opponent choose).
// The Shallow Grave is a Normal Spell: it is activated in the own Main Phase from the hand, with an empty chain.

import {
  activate, defineScenario, expectBoard, expectPickOptions, select, zone, type Scenario,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

const GRAVE = "The Shallow Grave";
// Vanilla monsters with no effect that matters here. Every Graveyard below holds two, so a pick is a real choice.
const RAT = "Giant Rat";
const GUARDIAN = "Celtic Guardian";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const BEAVER = "Beaver Warrior";
const BUG = "Man-Eater Bug";
const ELF = "Mystical Elf";
const EACH = `${SOURCE} [R-COMMON-EACH-PLAYER]`;

export const EACH_OPPONENT_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "each-opponent-ffa3-shallow-grave-own-graveyards",
    title: "FFA3: The Shallow Grave: p0 picks from its own Graveyard, then p1 and p2 each pick from their OWN Graveyard (F6)",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "ffa3", "card:43434803"],
    setup: {
      format: "ffa3",
      p0: { hand: [GRAVE], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
      p2: { grave: [FANG, BEAVER] },
    },
    steps: [
      activate(GRAVE, "p0"),
      // A Spell from the hand asks for its Spell/Trap Zone first.
      zone("p0", "s0", "p0"),
      // The pick of the activator lists the cards of its own Graveyard only.
      expectPickOptions([{ seat: "p0", card: RAT }, { seat: "p0", card: GUARDIAN }], "p0"),
      select(GUARDIAN),
      // Each opponent is asked in turn and sees the monsters of its own Graveyard only.
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(AXE),
      expectPickOptions([{ seat: "p2", card: FANG }, { seat: "p2", card: BEAVER }], "p2"),
      select(BEAVER),
      // Every picked monster is Special Summoned by its own controller, face-down in Defense Position.
      expectBoard({
        p0: { monsters: [GUARDIAN], grave: [RAT, GRAVE] },
        p1: { monsters: [AXE], grave: [OX] },
        p2: { monsters: [BEAVER], grave: [FANG] },
      }),
    ],
  }),
  defineScenario({
    id: "each-opponent-ffa4-shallow-grave-own-graveyards",
    title: "FFA4: The Shallow Grave: p0, p1, p2 and p3 each pick from their OWN Graveyard (F6)",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "ffa4", "card:43434803"],
    setup: {
      format: "ffa4",
      p0: { hand: [GRAVE], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
      p2: { grave: [FANG, BEAVER] },
      p3: { grave: [BUG, ELF] },
    },
    steps: [
      activate(GRAVE, "p0"),
      zone("p0", "s0", "p0"),
      expectPickOptions([{ seat: "p0", card: RAT }, { seat: "p0", card: GUARDIAN }], "p0"),
      select(RAT),
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(OX),
      expectPickOptions([{ seat: "p2", card: FANG }, { seat: "p2", card: BEAVER }], "p2"),
      select(FANG),
      expectPickOptions([{ seat: "p3", card: BUG }, { seat: "p3", card: ELF }], "p3"),
      select(ELF),
      expectBoard({
        p0: { monsters: [RAT], grave: [GUARDIAN, GRAVE] },
        p1: { monsters: [OX], grave: [AXE] },
        p2: { monsters: [FANG], grave: [BEAVER] },
        p3: { monsters: [ELF], grave: [BUG] },
      }),
    ],
  }),
  defineScenario({
    id: "each-opponent-ffa3-shallow-grave-skips-empty-graveyard",
    title: "FFA3: The Shallow Grave: an opponent with no monster in its Graveyard is not asked, the others still pick (F6)",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "ffa3", "card:43434803"],
    setup: {
      format: "ffa3",
      p0: { hand: [GRAVE], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
    },
    steps: [
      activate(GRAVE, "p0"),
      zone("p0", "s0", "p0"),
      select(RAT),
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(OX),
      expectBoard({
        p0: { monsters: [RAT], grave: [GUARDIAN, GRAVE] },
        p1: { monsters: [OX], grave: [AXE] },
        p2: { monsters: [], grave: [] },
      }),
    ],
  }),
  defineScenario({
    id: "each-opponent-tag-shallow-grave-own-graveyards",
    title: "Tag: The Shallow Grave: p0 picks, then each of the two opposing duelists (p1 and p3) picks from its OWN Graveyard (F6)",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "tag", "card:43434803"],
    // Team 0 is p0 and p2, team 1 is p1 and p3. The partner p2 has an empty Graveyard: "each player" for the partner is a later part (P3b).
    setup: {
      format: "tag",
      p0: { hand: [GRAVE], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
      p3: { grave: [FANG, BEAVER] },
    },
    steps: [
      activate(GRAVE, "p0"),
      zone("p0", "s0", "p0"),
      expectPickOptions([{ seat: "p0", card: RAT }, { seat: "p0", card: GUARDIAN }], "p0"),
      select(GUARDIAN),
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(AXE),
      expectPickOptions([{ seat: "p3", card: FANG }, { seat: "p3", card: BEAVER }], "p3"),
      select(BEAVER),
      expectBoard({
        p0: { lp: 16000, monsters: [GUARDIAN], spells: [], grave: [RAT, GRAVE], banished: [] },
        p1: { lp: 16000, monsters: [AXE], spells: [], grave: [OX], banished: [] },
        p2: { lp: 16000, monsters: [], spells: [], grave: [], banished: [] },
        p3: { lp: 16000, monsters: [BEAVER], spells: [], grave: [FANG], banished: [] },
      }),
    ],
  }),
];

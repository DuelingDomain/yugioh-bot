// Live scenarios of Spear Cretin (c58551308, overlay kind chooser, class CH-EACH): after it was flipped face-up and is sent to the Graveyard,
// "each player" (every living duelist) picks 1 monster from its OWN Graveyard and Special Summons it. Plain data, also read by scripts/rule-coverage.ts;
// tests/scenarios/multiplayer/spear-cretin.test.ts runs them on a live core (NSEAT_LIVE=1) with the overlay of domain-core/multi-scripts.
// The stock target asks PLAYER_ALL for a group of 2 cards only (the core raises a Lua error for any other size), and the stock operation
// summons every target for the controller value 0 or 1, so the target of a second opponent went to the wrong field.

import {
  activate, changePosition, defineScenario, expectBoard, expectPickOptions, select, zone, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

const CRETIN = "Spear Cretin";
const HOLE = "Dark Hole";
const RAT = "Giant Rat";
const GUARDIAN = "Celtic Guardian";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const BEAVER = "Beaver Warrior";
const BUG = "Man-Eater Bug";
const ELF = "Mystical Elf";
const EACH = `${SOURCE} [R-COMMON-EACH-PLAYER]`;

/** p0 flips Spear Cretin, then Dark Hole destroys it. The trigger asks each duelist, in seat order, for a monster of its own Graveyard. */
const flipAndDestroy: Step[] = [changePosition(CRETIN, "p0"), activate(HOLE, "p0"), zone("p0", "s0", "p0")];

export const SPEAR_CRETIN_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "spear-cretin-ffa3-each-duelist-summons-from-its-own-graveyard",
    title: "FFA3: Spear Cretin: p0, p1 and p2 each pick a monster from their OWN Graveyard and Special Summon it to their own field",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "spear-cretin", "ffa3", "card:58551308"],
    setup: {
      format: "ffa3",
      p0: { hand: [HOLE], monsters: [{ card: CRETIN, pos: "set" }], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
      p2: { grave: [FANG, BEAVER] },
    },
    steps: [
      ...flipAndDestroy,
      expectPickOptions([{ seat: "p0", card: RAT }, { seat: "p0", card: GUARDIAN }], "p0"),
      select(GUARDIAN),
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(AXE),
      expectPickOptions([{ seat: "p2", card: FANG }, { seat: "p2", card: BEAVER }], "p2"),
      select(BEAVER),
      expectBoard({
        p0: { monsters: [GUARDIAN], grave: [RAT, CRETIN, HOLE] },
        p1: { monsters: [AXE], grave: [OX] },
        p2: { monsters: [BEAVER], grave: [FANG] },
      }),
    ],
  }),
  defineScenario({
    id: "spear-cretin-ffa4-each-duelist-summons-from-its-own-graveyard",
    title: "FFA4: Spear Cretin: p0, p1, p2 and p3 each pick a monster from their OWN Graveyard and Special Summon it to their own field",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "spear-cretin", "ffa4", "card:58551308"],
    setup: {
      format: "ffa4",
      p0: { hand: [HOLE], monsters: [{ card: CRETIN, pos: "set" }], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
      p2: { grave: [FANG, BEAVER] },
      p3: { grave: [BUG, ELF] },
    },
    steps: [
      ...flipAndDestroy,
      expectPickOptions([{ seat: "p0", card: RAT }, { seat: "p0", card: GUARDIAN }], "p0"),
      select(RAT),
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(OX),
      expectPickOptions([{ seat: "p2", card: FANG }, { seat: "p2", card: BEAVER }], "p2"),
      select(BEAVER),
      expectPickOptions([{ seat: "p3", card: BUG }, { seat: "p3", card: ELF }], "p3"),
      select(ELF),
      expectBoard({
        p0: { monsters: [RAT], grave: [GUARDIAN, CRETIN, HOLE] },
        p1: { monsters: [OX], grave: [AXE] },
        p2: { monsters: [BEAVER], grave: [FANG] },
        p3: { monsters: [ELF], grave: [BUG] },
      }),
    ],
  }),
  defineScenario({
    id: "spear-cretin-ffa4-two-targets-two-opponents-only",
    title: "FFA4: Spear Cretin: p0 has no monster in its Graveyard, p1 and p3 pick from their own, p2 has none: 2 targets, both summoned for their owner",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "spear-cretin", "ffa4", "card:58551308"],
    setup: {
      format: "ffa4",
      p0: { hand: [HOLE], monsters: [{ card: CRETIN, pos: "set" }] },
      p1: { grave: [OX, AXE] },
      p3: { grave: [BUG, ELF] },
    },
    steps: [
      ...flipAndDestroy,
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(AXE),
      expectPickOptions([{ seat: "p3", card: BUG }, { seat: "p3", card: ELF }], "p3"),
      select(BUG),
      expectBoard({
        p0: { monsters: [], grave: [CRETIN, HOLE] },
        p1: { monsters: [AXE], grave: [OX] },
        p2: { monsters: [], grave: [] },
        p3: { monsters: [BUG], grave: [ELF] },
      }),
    ],
  }),
  defineScenario({
    id: "spear-cretin-ffa4-one-target-of-the-last-opponent",
    title: "FFA4: Spear Cretin: only p3 has a monster in its Graveyard: the one target is summoned for p3, not for another opponent",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "spear-cretin", "ffa4", "card:58551308"],
    setup: {
      format: "ffa4",
      p0: { hand: [HOLE], monsters: [{ card: CRETIN, pos: "set" }] },
      p3: { grave: [BUG, ELF] },
    },
    steps: [
      ...flipAndDestroy,
      expectPickOptions([{ seat: "p3", card: BUG }, { seat: "p3", card: ELF }], "p3"),
      select(ELF),
      expectBoard({
        p0: { monsters: [], grave: [CRETIN, HOLE] },
        p1: { monsters: [], grave: [] },
        p2: { monsters: [], grave: [] },
        p3: { monsters: [ELF], grave: [BUG] },
      }),
    ],
  }),
  defineScenario({
    id: "spear-cretin-tag-each-duelist-summons-from-its-own-graveyard",
    title: "Tag: Spear Cretin: p0 and each of the two opposing duelists (p1 and p3) pick from their OWN Graveyard and Special Summon to their own field",
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER"],
    tags: ["multiplayer", "chooser", "each-opponent", "spear-cretin", "tag", "card:58551308"],
    // Team 0 is p0 and p2, team 1 is p1 and p3. The partner p2 has an empty Graveyard, as in the Shallow Grave scenario.
    setup: {
      format: "tag",
      p0: { hand: [HOLE], monsters: [{ card: CRETIN, pos: "set" }], grave: [RAT, GUARDIAN] },
      p1: { grave: [OX, AXE] },
      p3: { grave: [FANG, BEAVER] },
    },
    steps: [
      ...flipAndDestroy,
      expectPickOptions([{ seat: "p0", card: RAT }, { seat: "p0", card: GUARDIAN }], "p0"),
      select(GUARDIAN),
      expectPickOptions([{ seat: "p1", card: OX }, { seat: "p1", card: AXE }], "p1"),
      select(AXE),
      expectPickOptions([{ seat: "p3", card: FANG }, { seat: "p3", card: BEAVER }], "p3"),
      select(BEAVER),
      expectBoard({
        p0: { lp: 16000, monsters: [GUARDIAN], spells: [], grave: [RAT, CRETIN, HOLE], banished: [] },
        p1: { lp: 16000, monsters: [AXE], spells: [], grave: [OX], banished: [] },
        p2: { lp: 16000, monsters: [], spells: [], grave: [], banished: [] },
        p3: { lp: 16000, monsters: [BEAVER], spells: [], grave: [FANG], banished: [] },
      }),
    ],
  }),
];

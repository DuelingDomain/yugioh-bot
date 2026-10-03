// FFA4 live scenarios of the three duel-style cards that were proven at FFA3 and Tag only (review B, cards area): Soul Exchange (Tribute of a
// monster of any opponent), Snatch Steal (takes a monster of any opponent; the 1000 LP go to its owner in the Standby Phase of the owner) and
// Fire Ejection (asks for an opponent, then a token goes to that opponent). The seat that holds the monster or that is picked is p3, the LAST of 3
// opponents, so a loop or a pick list that stops at p2 shows. Plain data (scripts/rule-coverage.ts reads it); duel-style-ffa4.test.ts runs it on a live core.
// Every scenario asserts the state of EVERY seat that the rule touches: p1 and p2 hold a monster that must stay. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, choose, endTurn, expectBoard, expectLp, expectPickSeats, normalSummon, pickOpponent, select, yes,
  type Scenario,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

const SKULL = "Summoned Skull";
const Q8 = `${SOURCE} [R-COMMON-OPP-FIELD], answers to the ten triage questions, 8 (Tribute of an opponent monster)`;
const NO_WRAPPER = `${SOURCE} [R-COMMON-OPP-FIELD], the other cards use the defaults`;
const OWNER_LP = `${SOURCE} [R-COMMON-OPP-FIELD], finding s2-duelstyle-swap-1: Snatch Steal gives the LP to the owner of the stolen monster, in the Standby Phase of that owner`;
const SUMMON = `${SOURCE} [R-COMMON-OPP-PICK], a summon to the field of an opponent: the summoning player picks one opponent`;

export const DUEL_STYLE_FFA4_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "tribute-soul-exchange-ffa4-tributes-a-monster-of-the-last-opponent",
    title: "FFA4: Soul Exchange targets a monster of the third opponent p3 and a Tribute Summon uses it, p1 and p2 keep all",
    source: Q8,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "tribute", "ffa4", "card:68005187"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Soul Exchange", SKULL] },
      p1: { monsters: [ELF] },
      p2: { monsters: [ELF] },
      p3: { monsters: [ELF] },
    },
    steps: [
      activate("Soul Exchange", "p0"),
      // R-COMMON-OPP-ONE: the bound field has one target, which the engine selects.
      pickOpponent("p3", "p0"),
      normalSummon(SKULL, "p0"),
      select({ card: ELF, owner: "p3" }),
      expectBoard({
        p0: { hand: [], monsters: [SKULL], spells: [], grave: ["Soul Exchange"], banished: [] },
        p1: { hand: [], monsters: [ELF], spells: [], grave: [], banished: [] },
        p2: { hand: [], monsters: [ELF], spells: [], grave: [], banished: [] },
        p3: { hand: [], monsters: [], spells: [], grave: [ELF], banished: [] },
      }),
    ],
  }),
  defineScenario({
    id: "no-wrapper-snatch-steal-ffa4-takes-a-monster-of-the-last-opponent",
    title: "FFA4: Snatch Steal equips a monster of the third opponent p3 and takes control of it, p1 and p2 keep all",
    source: NO_WRAPPER,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "no-wrapper", "equip", "steal", "ffa4", "card:45986603"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Snatch Steal"] },
      p1: { monsters: [ELF] },
      p2: { monsters: [ELF] },
      p3: { monsters: [SKULL] },
    },
    steps: [
      activate("Snatch Steal", "p0"),
      select({ card: SKULL, owner: "p3" }),
      expectBoard({
        p0: { hand: [], monsters: [SKULL], spells: ["Snatch Steal"], grave: [], banished: [] },
        p1: { hand: [], monsters: [ELF], spells: [], grave: [], banished: [] },
        p2: { hand: [], monsters: [ELF], spells: [], grave: [], banished: [] },
        p3: { hand: [], monsters: [], spells: [], grave: [], banished: [] },
      }),
    ],
  }),
  defineScenario({
    id: "owner-lp-snatch-steal-ffa4-only-the-owner-gains-the-lp-in-its-own-standby-phase",
    title: "FFA4: the 1000 LP of Snatch Steal go to the owner of the stolen monster (p3) in its own Standby Phase, with no pick, and to nobody else",
    source: OWNER_LP,
    rules: ["R-COMMON-OPP-FIELD", "R-FFA-ORDER"],
    tags: ["multiplayer", "equip", "steal", "lp", "ffa4", "card:45986603"],
    setup: {
      format: "ffa4",
      p0: { hand: ["Snatch Steal"] },
      p1: { monsters: [ELF] },
      p2: { monsters: [ELF] },
      p3: { monsters: [SKULL] },
    },
    steps: [
      activate("Snatch Steal", "p0"),
      select({ card: SKULL, owner: "p3" }),
      endTurn("p0"),
      // The Standby Phases of p1 and p2 (not the owner): nobody is asked and nobody gains LP.
      expectLp({ seat: "p0" }, 8000), expectLp({ seat: "p1" }, 8000), expectLp({ seat: "p2" }, 8000), expectLp({ seat: "p3" }, 8000),
      endTurn("p1"),
      endTurn("p2"),
      // The Standby Phase of p3 (the owner): p3 gains 1000 LP, nobody is asked.
      expectLp({ seat: "p0" }, 8000), expectLp({ seat: "p1" }, 8000), expectLp({ seat: "p2" }, 8000), expectLp({ seat: "p3" }, 9000),
      endTurn("p3"),
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      // The next Standby Phase of p3: the effect gives the LP again, once more to p3 only.
      expectLp({ seat: "p0" }, 8000), expectLp({ seat: "p1" }, 8000), expectLp({ seat: "p2" }, 8000), expectLp({ seat: "p3" }, 10000),
      expectBoard({
        p0: { monsters: [SKULL], spells: ["Snatch Steal"], grave: [], banished: [] },
        p1: { monsters: [ELF], spells: [], grave: [], banished: [] },
        p2: { monsters: [ELF], spells: [], grave: [], banished: [] },
        p3: { monsters: [], spells: [], grave: [], banished: [] },
      }),
    ],
  }),
  defineScenario({
    id: "opponent-field-summon-fire-ejection-ffa4-yes-no-prompt-then-a-token-to-the-last-opponent",
    title: "FFA4: Fire Ejection (a yes/no prompt) asks for one of 3 opponents, then the yes answer Special Summons the token to the picked p3 only",
    source: SUMMON,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "opponent-field-summon", "yes-no", "token", "ffa4", "card:11654067"],
    setup: { format: "ffa4", p0: { hand: ["Fire Ejection"], deck: [ELF, "Volcanic Rat"] } },
    steps: [
      activate("Fire Ejection", "p0"),
      expectPickSeats(["p1", "p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      yes("p0"),
      choose("token", "p0"),
      expectBoard({
        p0: { hand: [], monsters: [], spells: [], grave: ["Fire Ejection", "Volcanic Rat"], banished: [] },
        p1: { hand: [], monsters: [], spells: [], grave: [], banished: [] },
        p2: { hand: [], monsters: [], spells: [], grave: [], banished: [] },
        p3: { hand: [], monsters: { count: 1 }, spells: [], grave: [], banished: [] },
      }),
    ],
  }),
];

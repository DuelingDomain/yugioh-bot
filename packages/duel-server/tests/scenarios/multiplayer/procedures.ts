// Summon procedures that Tribute the monsters of ONE opponent (design rows F5a, T4, W6 Kaiju part and Q8), on a real engine
// (NSEAT_LIVE=1, see procedures.test.ts). Plain data, also read by scripts/rule-coverage.ts. Owner decisions Q8 (2026-10-01): the
// Kaiju, Lava Golem and Volcanic Queen Tribute monsters of ONE opponent and go to the field of that opponent. The Kaiju summon
// with no Tribute needs a face-up Kaiju on the field of ANY opponent and goes to the own field. Every scenario asserts the FINAL
// state of every seat (field, hand, Graveyard, banished, LP) after an action.
//
// The Winged Dragon of Ra - Sphere Mode is a Normal Summon procedure (EFFECT_LIMIT_SUMMON_PROC) that Tributes 3 monsters of ONE
// opponent (Q8), and Ra goes to the field of that opponent. A mixed Tribute of two opponents is not offered.

import {
  activate, choose, defineScenario, endTurn, eliminate, expectBoard, expectEliminated, expectNotOffered, expectPickOptions, expectPrompt,
  faceDown, normalSummon, pickOpponent, select, specialSummon, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Cards = string[];

const KAIJU = "Gameciel, the Sea Turtle Kaiju";
const RADIAN = "Radian, the Multidimensional Kaiju";
const LAVA = "Lava Golem";
const QUEEN = "Volcanic Queen";
const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const VORSE = "Vorse Raider";
const RA = "The Winged Dragon of Ra - Sphere Mode";
const LEOGUN = "Leogun";

/** The exact final state of one seat. Everything not named is empty. */
const seat = (o: { monsters?: Cards; hand?: Cards; grave?: Cards; banished?: Cards; spells?: Cards } = {}, lp = 8000) => ({
  lp, hand: [], monsters: [], spells: [], grave: [], banished: [], ...o,
});
/** What the seat projection shows for a surrendered seat: no cards (the LP is not zeroed by a surrender, so it is not checked). */
const GONE = { hand: { count: 0 }, spells: { count: 0 }, monsters: { count: 0 }, grave: { count: 0 } };

const SRC = `${SOURCE} [R-COMMON-OPP-FIELD]`;
/** Gameciel has two summon procedures. With no Kaiju on an opponent field only the Tribute one is legal and the first prompt is the pick. */
const kaijuTribute: Step[] = [specialSummon({ card: KAIJU, nth: 0 }, "p0")];
/** With a Kaiju on an opponent field the core asks which procedure: "Option 1" Tributes an opponent monster, "Option 2" needs no Tribute. */
const kaijuNoTribute: Step[] = [specialSummon({ card: KAIJU, nth: 0 }, "p0"), choose("Option 2", "p0")];

export const PROCEDURE_SCENARIOS: Scenario[] = [
  // --- F5a: Kaiju with a Tribute ---------------------------------------------------------------------------------------
  defineScenario({
    id: "procedures-ffa3-kaiju-tribute-goes-to-tributed-field",
    title: "FFA3: Gameciel Tributes a monster of the picked opponent (p2) and is Special Summoned to the field of p2",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "ffa3", "card:55063751"],
    setup: { format: "ffa3", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
    steps: [
      ...kaijuTribute,
      pickOpponent("p2", "p0"),
      // The Tribute list holds the monsters of p2 only: the monster of p1 is not offered.
      expectPickOptions({ count: 2, exclude: [{ card: ELF }] }, "p0"),
      select(OX),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT, KAIJU], grave: [OX] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa4-kaiju-tribute-goes-to-tributed-field",
    title: "FFA4: Gameciel Tributes the only monster of the picked opponent (p3) and goes to the field of p3, p1 and p2 are unchanged",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "ffa4", "card:55063751"],
    setup: { format: "ffa4", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] }, p3: { monsters: [AXE] } },
    steps: [
      ...kaijuTribute,
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: AXE }] }, "p0"),
      select(AXE),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT, OX] }),
        p3: seat({ monsters: [KAIJU], grave: [AXE] }),
      }),
    ],
  }),
  // --- F5a: Kaiju with no Tribute --------------------------------------------------------------------------------------
  defineScenario({
    id: "procedures-ffa3-kaiju-no-tribute-needs-opponent-kaiju",
    title: "FFA3: a face-up Kaiju on the field of p2 lets p0 Special Summon Gameciel with no Tribute, to the own field",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "ffa3", "card:55063751", "card:28674152"],
    setup: { format: "ffa3", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RADIAN] } },
    steps: [
      ...kaijuNoTribute,
      expectBoard({
        p0: seat({ monsters: [KAIJU] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RADIAN] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa4-kaiju-no-tribute-kaiju-on-third-opponent",
    title: "FFA4: the only Kaiju is on the field of p3 (not the first opponent): p0 summons Gameciel with no Tribute to the own field",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "ffa4", "card:55063751", "card:28674152"],
    setup: { format: "ffa4", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [RADIAN] } },
    steps: [
      ...kaijuNoTribute,
      expectBoard({
        p0: seat({ monsters: [KAIJU] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT] }),
        p3: seat({ monsters: [RADIAN] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa3-kaiju-own-kaiju-gives-no-free-summon",
    title: "FFA3: a Kaiju on the own field is not enough: no 'no Tribute' choice, p0 must Tribute and Gameciel goes to the picked opponent",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "ffa3", "card:55063751", "card:28674152"],
    setup: { format: "ffa3", p0: { hand: [KAIJU], monsters: [RADIAN] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: KAIJU, nth: 0 }, "p0"),
      // No 'Select an option' prompt: the first prompt is the opponent pick.
      expectPrompt({ context: "opponent" }),
      pickOpponent("p1", "p0"),
      select(ELF),
      expectBoard({
        p0: seat({ monsters: [RADIAN] }),
        p1: seat({ monsters: [KAIJU], grave: [ELF] }),
        p2: seat({ monsters: [RAT] }),
      }),
    ],
  }),
  // --- F5a: Lava Golem -------------------------------------------------------------------------------------------------
  defineScenario({
    id: "procedures-ffa3-lava-golem-split-rejected",
    title: "FFA3: p1 and p2 control one monster each: Lava Golem is not offered (2 Tributes of ONE opponent are not possible)",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:102380"],
    setup: { format: "ffa3", p0: { hand: [LAVA] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
    steps: [
      expectNotOffered("specialSummon", LAVA, "p0"),
      endTurn("p0"),
      expectBoard({
        // p1 starts its turn and draws its only Deck card (a Mystical Elf).
        p0: seat({ hand: [LAVA] }),
        p1: seat({ monsters: [ELF], hand: [ELF] }),
        p2: seat({ monsters: [RAT] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa3-lava-golem-one-opponent-accepted",
    title: "FFA3: p2 controls 2 monsters (p1 controls 1): Lava Golem Tributes both monsters of p2 only and goes to the field of p2",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:102380"],
    setup: { format: "ffa3", p0: { hand: [LAVA] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
    steps: [
      specialSummon(LAVA, "p0"),
      // Only p2 can pay: the opponent is bound with no pick, and the Tribute list holds the 2 monsters of p2.
      expectPickOptions({ count: 2, exclude: [{ card: ELF }] }, "p0"),
      select(RAT, OX),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [LAVA], grave: [RAT, OX] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa4-lava-golem-picked-opponent",
    title: "FFA4: p2 and p3 can both pay: p0 picks p3, Lava Golem Tributes both monsters of p3 and goes to the field of p3",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa4", "card:102380"],
    setup: {
      format: "ffa4",
      p0: { hand: [LAVA] },
      p1: { monsters: [ELF] },
      p2: { monsters: [RAT, VORSE] },
      p3: { monsters: [AXE, OX] },
    },
    steps: [
      specialSummon(LAVA, "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 2, exclude: [{ card: ELF }, { card: RAT }, { card: VORSE }] }, "p0"),
      select(AXE, OX),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT, VORSE] }),
        p3: seat({ monsters: [LAVA], grave: [AXE, OX] }),
      }),
    ],
  }),
  // --- F5a: Volcanic Queen ---------------------------------------------------------------------------------------------
  defineScenario({
    id: "procedures-ffa3-volcanic-queen-goes-to-tributed-field",
    title: "FFA3: Volcanic Queen Tributes a monster of the picked opponent (p2) and goes to the field of p2",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:63014935"],
    setup: { format: "ffa3", p0: { hand: [QUEEN] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
    steps: [
      specialSummon(QUEEN, "p0"),
      pickOpponent("p2", "p0"),
      expectPickOptions({ count: 2, exclude: [{ card: ELF }] }, "p0"),
      select(RAT),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [OX, QUEEN], grave: [RAT] }),
      }),
    ],
  }),
  // --- Q8: The Winged Dragon of Ra - Sphere Mode ------------------------------------------------------------------------
  defineScenario({
    id: "procedures-ffa3-ra-sphere-mode-split-rejected",
    title: "FFA3: p1 and p2 control 2 monsters each (4 in all): Ra Sphere Mode is not offered (3 Tributes of ONE opponent are not possible)",
    source: `${SRC} [Q8]`,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "ra", "q8", "ffa3", "card:10000080"],
    setup: { format: "ffa3", p0: { hand: [RA] }, p1: { monsters: [ELF, RAT] }, p2: { monsters: [OX, AXE] } },
    steps: [
      expectNotOffered("normalSummon", RA, "p0"),
      endTurn("p0"),
      expectBoard({
        // p1 starts its turn and draws its only Deck card (a Mystical Elf).
        p0: seat({ hand: [RA] }),
        p1: seat({ monsters: [ELF, RAT], hand: [ELF] }),
        p2: seat({ monsters: [OX, AXE] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa3-ra-sphere-mode-one-opponent-accepted",
    title: "FFA3: only p2 controls 3 monsters: Ra Sphere Mode Tributes all 3 and goes to the field of p2, p1 is unchanged",
    source: `${SRC} [Q8]`,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "ra", "q8", "ffa3", "card:10000080"],
    setup: { format: "ffa3", p0: { hand: [RA] }, p1: { monsters: [ELF, RAT] }, p2: { monsters: [OX, AXE, VORSE] } },
    steps: [
      normalSummon(RA, "p0"),
      // Only p2 can pay: the opponent is bound with no pick, and the Tribute list holds the 3 monsters of p2.
      expectPickOptions({ count: 3, exclude: [{ card: ELF }, { card: RAT }] }, "p0"),
      select(OX, AXE, VORSE),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF, RAT] }),
        p2: seat({ monsters: [RA], grave: [OX, AXE, VORSE] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa3-ra-sphere-mode-picked-opponent",
    title: "FFA3: p1 and p2 can both pay: p0 picks p2, Ra Sphere Mode Tributes the 3 monsters of p2 and goes to the field of p2",
    source: `${SRC} [Q8]`,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "ra", "q8", "ffa3", "card:10000080"],
    setup: { format: "ffa3", p0: { hand: [RA] }, p1: { monsters: [ELF, RAT, LEOGUN] }, p2: { monsters: [OX, AXE, VORSE] } },
    steps: [
      normalSummon(RA, "p0"),
      pickOpponent("p2", "p0"),
      // The Tribute list holds the monsters of p2 only: a mixed Tribute is not offered.
      expectPickOptions({ count: 3, exclude: [{ card: ELF }, { card: RAT }, { card: LEOGUN }] }, "p0"),
      select(OX, AXE, VORSE),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF, RAT, LEOGUN] }),
        p2: seat({ monsters: [RA], grave: [OX, AXE, VORSE] }),
      }),
    ],
  }),
  // --- W6 (Kaiju part): the bound seat is eliminated before the summon resolves -----------------------------------------
  defineScenario({
    id: "procedures-ffa3-kaiju-bound-seat-eliminated-no-widening",
    title: "FFA3: p2 is bound for the Tribute and is eliminated before the summon resolves: Gameciel is not summoned to p1",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "elimination", "ffa3", "card:55063751"],
    setup: { format: "ffa3", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
    steps: [
      ...kaijuTribute,
      pickOpponent("p2", "p0"),
      eliminate("p2"),
      select(OX),
      expectEliminated("p2"),
      // The summon fails for the dead seat and does not move to the other opponent: p1 keeps its monster and gets no Kaiju.
      expectBoard({
        p0: seat({ hand: [KAIJU] }),
        p1: seat({ monsters: [ELF] }),
        p2: GONE,
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa4-kaiju-bound-seat-eliminated-no-widening",
    title: "FFA4: p2 is bound for the Tribute and is eliminated before the summon resolves: Gameciel is not summoned to p1 or p3",
    source: `${SOURCE} [R-FFA-ELIMINATION]`,
    rules: ["R-FFA-ELIMINATION", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "elimination", "ffa4", "card:55063751"],
    setup: { format: "ffa4", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] }, p3: { monsters: [AXE] } },
    steps: [
      ...kaijuTribute,
      pickOpponent("p2", "p0"),
      eliminate("p2"),
      select(OX),
      expectEliminated("p2"),
      expectBoard({
        p0: seat({ hand: [KAIJU] }),
        p1: seat({ monsters: [ELF] }),
        p2: GONE,
        p3: seat({ monsters: [AXE] }),
      }),
    ],
  }),
  // --- Q8: Tribute of a monster of opponent 2 (the only target) --------------------------------------------------------
  defineScenario({
    id: "procedures-ffa3-tainted-of-the-tistina-tributes-opponent-two",
    title: "FFA3: Tainted of the Tistina Tributes the only face-down monster, which p2 controls (p1 has none): the Tribute works",
    source: `${SOURCE} [Q8]`,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "tribute", "q8", "ffa3", "card:50281477"],
    setup: { format: "ffa3", p0: { hand: ["Tainted of the Tistina"] }, p2: { monsters: [faceDown(RAT)] } },
    steps: [
      normalSummon("Tainted of the Tistina", "p0"),
      expectBoard({
        p0: seat({ monsters: ["Tainted of the Tistina"] }),
        p1: seat(),
        p2: seat({ grave: [RAT] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-ffa3-monarchs-stormforth-tributes-opponent-two",
    title: "FFA3: The Monarchs Stormforth lets p0 Tribute the only opponent monster, which p2 controls, for a Tribute Summon",
    source: `${SOURCE} [Q8]`,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "tribute", "q8", "ffa3", "card:79844764"],
    setup: { format: "ffa3", p0: { hand: ["The Monarchs Stormforth", "Leogun"] }, p2: { monsters: [RAT] } },
    steps: [
      activate("The Monarchs Stormforth", "p0"),
      normalSummon("Leogun", "p0"),
      select(RAT),
      expectBoard({
        p0: seat({ monsters: ["Leogun"], grave: ["The Monarchs Stormforth"] }),
        p1: seat(),
        p2: seat({ grave: [RAT] }),
      }),
    ],
  }),
];

// --- T4: Tag regression of the same procedures (p0 and p2 are team 0, p1 and p3 are team 1) -------------------------------
// The `exclusive` hook reads ONE opposing member in Tag. A partner is never an opponent: it can neither pay nor take the card.
// In Tag the LP of a seat is the team total: 16000.
const TAG_LP = 16000;
const tagSeat = (o: Parameters<typeof seat>[0] = {}) => seat(o, TAG_LP);

export const PROCEDURE_TAG_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "procedures-tag-lava-golem-split-rejected",
    title: "Tag: p1 and p3 control one monster each: Lava Golem is not offered (2 Tributes of ONE opposing member are not possible)",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:102380"],
    setup: { format: "tag", p0: { hand: [LAVA] }, p1: { monsters: [ELF] }, p3: { monsters: [RAT] } },
    steps: [
      expectNotOffered("specialSummon", LAVA, "p0"),
      endTurn("p0"),
      expectBoard({
        p0: tagSeat({ hand: [LAVA] }),
        p1: tagSeat({ monsters: [ELF], hand: [ELF] }),
        p2: tagSeat(),
        p3: tagSeat({ monsters: [RAT] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-tag-lava-golem-one-opposing-member-accepted",
    title: "Tag: p1 and p3 can both pay: p0 picks p3, Lava Golem Tributes both monsters of p3 and goes to the field of p3",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:102380"],
    setup: { format: "tag", p0: { hand: [LAVA] }, p1: { monsters: [ELF, AXE] }, p3: { monsters: [RAT, OX] } },
    steps: [
      specialSummon(LAVA, "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 2, exclude: [{ card: ELF }, { card: AXE }] }, "p0"),
      select(RAT, OX),
      expectBoard({
        p0: tagSeat(),
        p1: tagSeat({ monsters: [ELF, AXE] }),
        p2: tagSeat(),
        p3: tagSeat({ monsters: [LAVA], grave: [RAT, OX] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-tag-lava-golem-partner-monsters-do-not-pay",
    title: "Tag: only the partner (p2) controls 2 monsters, p1 controls 1: Lava Golem is not offered, a partner is not an opponent",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:102380"],
    setup: { format: "tag", p0: { hand: [LAVA] }, p1: { monsters: [RAT] }, p2: { monsters: [ELF, AXE] } },
    steps: [
      expectNotOffered("specialSummon", LAVA, "p0"),
      endTurn("p0"),
      expectBoard({
        p0: tagSeat({ hand: [LAVA] }),
        p1: tagSeat({ monsters: [RAT], hand: [ELF] }),
        p2: tagSeat({ monsters: [ELF, AXE] }),
        p3: tagSeat(),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-tag-kaiju-tribute-goes-to-opposing-member",
    title: "Tag: Gameciel Tributes the monster of the picked opposing member (p3) and goes to the field of p3",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "tag", "card:55063751"],
    setup: { format: "tag", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p3: { monsters: [RAT] } },
    steps: [
      ...kaijuTribute,
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: RAT }] }, "p0"),
      select(RAT),
      expectBoard({
        p0: tagSeat(),
        p1: tagSeat({ monsters: [ELF] }),
        p2: tagSeat(),
        p3: tagSeat({ monsters: [KAIJU], grave: [RAT] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-tag-kaiju-no-tribute-kaiju-on-opposing-member",
    title: "Tag: a face-up Kaiju on the field of the opposing member p3 lets p0 summon Gameciel with no Tribute, to the own field",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "tag", "card:55063751", "card:28674152"],
    setup: { format: "tag", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p3: { monsters: [RADIAN] } },
    steps: [
      ...kaijuNoTribute,
      expectBoard({
        p0: tagSeat({ monsters: [KAIJU] }),
        p1: tagSeat({ monsters: [ELF] }),
        p2: tagSeat(),
        p3: tagSeat({ monsters: [RADIAN] }),
      }),
    ],
  }),
  defineScenario({
    id: "procedures-tag-kaiju-partner-kaiju-gives-no-free-summon",
    title: "Tag: the only Kaiju is on the field of the partner p2: no 'no Tribute' choice, the only opposing monster (p1) is Tributed",
    source: `${SOURCE} [R-TAG-PARTNER]`,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "kaiju", "tag", "card:55063751", "card:28674152"],
    setup: { format: "tag", p0: { hand: [KAIJU] }, p1: { monsters: [ELF] }, p2: { monsters: [RADIAN] } },
    steps: [
      specialSummon({ card: KAIJU, nth: 0 }, "p0"),
      // Only p1 can pay, so it is bound with no pick and no option prompt: the Tribute list opens at once.
      expectPickOptions({ count: 1, include: [{ card: ELF }] }, "p0"),
      select(ELF),
      expectBoard({
        p0: tagSeat(),
        p1: tagSeat({ monsters: [KAIJU], grave: [ELF] }),
        p2: tagSeat({ monsters: [RADIAN] }),
        p3: tagSeat(),
      }),
    ],
  }),
];

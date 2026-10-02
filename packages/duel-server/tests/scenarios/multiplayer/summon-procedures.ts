// Summon procedures that Tribute or bind ONE opponent, for every card that the testers listed as pending: the 6 Kaiju that are not
// Gameciel (Radian, Kumongous, Gadarla, Thunder King, Jizukiru, Dogoran). Plain data, run by summon-procedures.test.ts on a real
// engine (NSEAT_LIVE=1) and read by scripts/rule-coverage.ts. Owner rule (Q8): the Tribute is taken from ONE opponent and the Kaiju
// goes to the field of that opponent; the summon with no Tribute needs a face-up Kaiju on the field of ANY opponent and goes to the own
// field. In Tag the opponent is an opposing member: the partner is never an opponent. Every scenario asserts the FINAL state of
// every seat.

import {
  changePhase, choose, defineScenario, endTurn, expectBoard, expectPickOptions, expectPickSeats, pickOpponent, select, specialSummon, yes, type Scenario, type Step,
} from "../../support/dsl.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Cards = string[];

const GAMECIEL = "Gameciel, the Sea Turtle Kaiju";
const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";

/** The exact final state of one seat. Everything not named is empty. */
const seat = (o: { monsters?: Cards; hand?: Cards; grave?: Cards; banished?: Cards; spells?: Cards } = {}, lp = 8000) => ({
  lp, hand: [], monsters: [], spells: [], grave: [], banished: [], ...o,
});
const TAG_LP = 16000;
const tagSeat = (o: Parameters<typeof seat>[0] = {}) => seat(o, TAG_LP);

const SRC = `${SOURCE} [R-COMMON-OPP-FIELD]`;
const TAG_SRC = `${SOURCE} [R-TAG-PARTNER]`;

/** The 6 Kaiju. They share one procedure (AddKaijuProcedure), so the only difference is the card. */
const KAIJU: Array<{ slug: string; name: string; code: number }> = [
  { slug: "radian", name: "Radian, the Multidimensional Kaiju", code: 28674152 },
  { slug: "kumongous", name: "Kumongous, the Sticky String Kaiju", code: 29726552 },
  { slug: "gadarla", name: "Gadarla, the Mystery Dust Kaiju", code: 36956512 },
  { slug: "thunder-king", name: "Thunder King, the Lightningstrike Kaiju", code: 48770333 },
  { slug: "jizukiru", name: "Jizukiru, the Star Destroying Kaiju", code: 63941210 },
  { slug: "dogoran", name: "Dogoran, the Mad Flame Kaiju", code: 93332803 },
];

const kaijuScenarios = ({ slug, name, code }: (typeof KAIJU)[number]): Scenario[] => {
  const tags = (format: string, extra: string[] = []) => ["multiplayer", "summon", "procedure", "kaiju", format, `card:${code}`, ...extra];
  // With no Kaiju on an opponent field only the Tribute procedure is legal and the first prompt is the pick.
  const tribute = [specialSummon({ card: name, nth: 0 }, "p0")];
  // With a Kaiju on an opponent field the core asks which procedure: "Option 2" needs no Tribute.
  const noTribute = [specialSummon({ card: name, nth: 0 }, "p0"), choose("Option 2", "p0")];
  return [
    defineScenario({
      id: `summon-procedures-ffa3-${slug}-tribute-goes-to-tributed-field`,
      title: `FFA3: ${name} Tributes a monster of the picked opponent (p2) and goes to the field of p2, p1 is unchanged`,
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("ffa3"),
      setup: { format: "ffa3", p0: { hand: [name] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
      steps: [
        ...tribute,
        pickOpponent("p2", "p0"),
        expectPickOptions({ count: 2, exclude: [{ card: ELF }] }, "p0"),
        select(OX),
        expectBoard({
          p0: seat(),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT, name], grave: [OX] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-ffa4-${slug}-tribute-goes-to-tributed-field`,
      title: `FFA4: ${name} Tributes the only monster of the picked opponent (p3) and goes to the field of p3, p1 and p2 are unchanged`,
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("ffa4"),
      setup: { format: "ffa4", p0: { hand: [name] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
      steps: [
        ...tribute,
        pickOpponent("p3", "p0"),
        expectPickOptions({ count: 1, include: [{ card: AXE }] }, "p0"),
        select(AXE),
        expectBoard({
          p0: seat(),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT] }),
          p3: seat({ monsters: [name], grave: [AXE] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-tag-${slug}-tribute-goes-to-opposing-member`,
      title: `Tag: ${name} Tributes the monster of the picked opposing member (p3) and goes to the field of p3, the partner p2 and p1 are unchanged`,
      source: TAG_SRC,
      rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("tag"),
      setup: { format: "tag", p0: { hand: [name] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
      steps: [
        ...tribute,
        pickOpponent("p3", "p0"),
        expectPickOptions({ count: 1, include: [{ card: RAT }] }, "p0"),
        select(RAT),
        expectBoard({
          p0: tagSeat(),
          p1: tagSeat({ monsters: [ELF] }),
          p2: tagSeat({ monsters: [OX] }),
          p3: tagSeat({ monsters: [name], grave: [RAT] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-ffa3-${slug}-no-tribute-with-kaiju-on-opponent`,
      title: `FFA3: a Kaiju on the field of p2: p0 summons ${name} with no Tribute to the own field and no seat loses a card`,
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD"],
      tags: tags("ffa3", ["no-tribute"]),
      setup: { format: "ffa3", p0: { hand: [name] }, p1: { monsters: [ELF] }, p2: { monsters: [GAMECIEL] } },
      steps: [
        ...noTribute,
        expectBoard({
          p0: seat({ monsters: [name] }),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [GAMECIEL] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-ffa4-${slug}-no-tribute-with-kaiju-on-opponent`,
      title: `FFA4: the only Kaiju is on the field of p3: p0 summons ${name} with no Tribute to the own field and no seat loses a card`,
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD"],
      tags: tags("ffa4", ["no-tribute"]),
      setup: { format: "ffa4", p0: { hand: [name] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [GAMECIEL] } },
      steps: [
        ...noTribute,
        expectBoard({
          p0: seat({ monsters: [name] }),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT] }),
          p3: seat({ monsters: [GAMECIEL] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-tag-${slug}-no-tribute-with-kaiju-on-opposing-member`,
      title: `Tag: a Kaiju on the field of the opposing member p3: p0 summons ${name} with no Tribute to the own field and no seat loses a card`,
      source: TAG_SRC,
      rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD"],
      tags: tags("tag", ["no-tribute"]),
      setup: { format: "tag", p0: { hand: [name] }, p1: { monsters: [ELF] }, p3: { monsters: [GAMECIEL] } },
      steps: [
        ...noTribute,
        expectBoard({
          p0: tagSeat({ monsters: [name] }),
          p1: tagSeat({ monsters: [ELF] }),
          p2: tagSeat(),
          p3: tagSeat({ monsters: [GAMECIEL] }),
        }),
      ],
    }),
  ];
};

export const KAIJU_SCENARIOS: Scenario[] = KAIJU.flatMap(kaijuScenarios);

// --- Alien Skull and Santa Claws: Lava procedure (Tribute from ONE opponent, the card goes to that opponent) ---------------------

const ALIEN_SKULL = "Alien Skull";
const SANTA = "Santa Claws";
/** Level 2 vanilla monsters: the only monsters that the Alien Skull procedure accepts (face-up Level 3 or lower). */
const DORON = "Doron";
const VIPER = "Flame Viper";
const HAMP = "Surgical Striker - H.A.M.P.";
/** A face-up Sky Striker Ace monster: the condition of both H.A.M.P. procedures. */
const RAYE = "Sky Striker Ace - Raye";

export const LAVA_SCENARIOS: Scenario[] = [
  defineScenario({
    id: "summon-procedures-ffa3-alien-skull-tribute-goes-to-tributed-field",
    title: "FFA3: Alien Skull Tributes a Level 3 or lower monster of the picked opponent (p2), the Level 4 monster of p2 is not offered, and it goes to the field of p2",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:25920413"],
    setup: { format: "ffa3", p0: { hand: [ALIEN_SKULL] }, p1: { monsters: [DORON] }, p2: { monsters: [VIPER, RAT] } },
    steps: [
      specialSummon({ card: ALIEN_SKULL, nth: 0 }, "p0"),
      pickOpponent("p2", "p0"),
      expectPickOptions({ count: 1, include: [{ card: VIPER }], exclude: [{ card: RAT }, { card: DORON }] }, "p0"),
      select(VIPER),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [DORON] }),
        p2: seat({ monsters: [RAT, ALIEN_SKULL], grave: [VIPER] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa4-alien-skull-tribute-goes-to-tributed-field",
    title: "FFA4: Alien Skull Tributes the only Level 3 or lower monster of the picked opponent (p3) and goes to the field of p3, p1 and p2 are unchanged",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa4", "card:25920413"],
    setup: { format: "ffa4", p0: { hand: [ALIEN_SKULL] }, p1: { monsters: [DORON] }, p2: { monsters: [VIPER] }, p3: { monsters: [DORON, AXE] } },
    steps: [
      specialSummon({ card: ALIEN_SKULL, nth: 0 }, "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: DORON }], exclude: [{ card: AXE }, { card: VIPER }] }, "p0"),
      select(DORON),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [DORON] }),
        p2: seat({ monsters: [VIPER] }),
        p3: seat({ monsters: [AXE, ALIEN_SKULL], grave: [DORON] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-tag-alien-skull-tribute-goes-to-opposing-member",
    title: "Tag: Alien Skull Tributes the Level 3 or lower monster of the picked opposing member (p3) and goes to the field of p3, the partner p2 is not offered",
    source: TAG_SRC,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:25920413"],
    setup: { format: "tag", p0: { hand: [ALIEN_SKULL] }, p1: { monsters: [DORON] }, p2: { monsters: [VIPER] }, p3: { monsters: [DORON, RAT] } },
    steps: [
      specialSummon({ card: ALIEN_SKULL, nth: 0 }, "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: DORON }], exclude: [{ card: RAT }, { card: VIPER }] }, "p0"),
      select(DORON),
      expectBoard({
        p0: tagSeat(),
        p1: tagSeat({ monsters: [DORON] }),
        p2: tagSeat({ monsters: [VIPER] }),
        p3: tagSeat({ monsters: [RAT, ALIEN_SKULL], grave: [DORON] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa3-santa-claws-tribute-goes-to-tributed-field-and-it-draws",
    title: "FFA3: Santa Claws Tributes a monster of the picked opponent (p2), goes to the field of p2, and in the End Phase p2 (its controller) draws 1 card, nobody else does",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:46565218"],
    setup: { format: "ffa3", p0: { hand: [SANTA] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
    steps: [
      specialSummon({ card: SANTA, nth: 0 }, "p0"),
      pickOpponent("p2", "p0"),
      expectPickOptions({ count: 2, exclude: [{ card: ELF }] }, "p0"),
      select(OX),
      endTurn("p0"),
      yes("p2"),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF], hand: [ELF] }), // the Draw Phase of p1: the turn goes on to p1 after the End Phase of p0
        p2: seat({ monsters: [RAT, SANTA], grave: [OX], hand: [ELF] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa4-santa-claws-tribute-goes-to-tributed-field-and-it-draws",
    title: "FFA4: Santa Claws Tributes the only monster of the picked opponent (p3), goes to the field of p3, and in the End Phase p3 draws 1 card, p1 and p2 do not",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa4", "card:46565218"],
    setup: { format: "ffa4", p0: { hand: [SANTA] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
    steps: [
      specialSummon({ card: SANTA, nth: 0 }, "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: AXE }] }, "p0"),
      select(AXE),
      endTurn("p0"),
      yes("p3"),
      expectBoard({
        p0: seat(),
        p1: seat({ monsters: [ELF], hand: [ELF] }), // the Draw Phase of p1: the turn goes on to p1 after the End Phase of p0
        p2: seat({ monsters: [RAT] }),
        p3: seat({ monsters: [SANTA], grave: [AXE], hand: [ELF] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-tag-santa-claws-tribute-goes-to-opposing-member-and-it-draws",
    title: "Tag: Santa Claws Tributes the monster of the picked opposing member (p3), goes to the field of p3, and in the End Phase p3 draws 1 card, the partner p2 and p1 do not",
    source: TAG_SRC,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:46565218"],
    setup: { format: "tag", p0: { hand: [SANTA] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: SANTA, nth: 0 }, "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: RAT }] }, "p0"),
      select(RAT),
      endTurn("p0"),
      yes("p3"),
      expectBoard({
        p0: tagSeat(),
        p1: tagSeat({ monsters: [ELF], hand: [ELF] }), // the Draw Phase of p1: the turn goes on to p1 after the End Phase of p0
        p2: tagSeat({ monsters: [OX] }),
        p3: tagSeat({ monsters: [SANTA], grave: [RAT], hand: [ELF] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa3-hamp-tribute-goes-to-tributed-field",
    title: "FFA3: H.A.M.P. (with a Sky Striker Ace on the own field) Tributes a monster of the picked opponent (p2) and goes to the field of p2, p1 and the own field are unchanged",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:33331231"],
    setup: { format: "ffa3", p0: { hand: [HAMP], monsters: [RAYE] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT, OX] } },
    steps: [
      specialSummon({ card: HAMP, nth: 0 }, "p0"),
      choose("opponent's field", "p0"),
      pickOpponent("p2", "p0"),
      expectPickOptions({ count: 2, exclude: [{ card: ELF }, { card: RAYE }] }, "p0"),
      select(OX),
      expectBoard({
        p0: seat({ monsters: [RAYE] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT, HAMP], grave: [OX] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa4-hamp-tribute-goes-to-tributed-field",
    title: "FFA4: H.A.M.P. Tributes the only monster of the picked opponent (p3) and goes to the field of p3, p1 and p2 are unchanged",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa4", "card:33331231"],
    setup: { format: "ffa4", p0: { hand: [HAMP], monsters: [RAYE] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
    steps: [
      specialSummon({ card: HAMP, nth: 0 }, "p0"),
      choose("opponent's field", "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: AXE }] }, "p0"),
      select(AXE),
      expectBoard({
        p0: seat({ monsters: [RAYE] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT] }),
        p3: seat({ monsters: [HAMP], grave: [AXE] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-tag-hamp-tribute-goes-to-opposing-member",
    title: "Tag: H.A.M.P. Tributes the monster of the picked opposing member (p3) and goes to the field of p3, the partner p2 and p1 are unchanged",
    source: TAG_SRC,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:33331231"],
    setup: { format: "tag", p0: { hand: [HAMP], monsters: [RAYE] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: HAMP, nth: 0 }, "p0"),
      choose("opponent's field", "p0"),
      pickOpponent("p3", "p0"),
      expectPickOptions({ count: 1, include: [{ card: RAT }] }, "p0"),
      select(RAT),
      expectBoard({
        p0: tagSeat({ monsters: [RAYE] }),
        p1: tagSeat({ monsters: [ELF] }),
        p2: tagSeat({ monsters: [OX] }),
        p3: tagSeat({ monsters: [HAMP], grave: [RAT] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa3-hamp-own-field-tributes-own-monster",
    title: "FFA3: H.A.M.P. summoned to the own field Tributes a monster of the own field only and no opponent is asked or changes",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa3", "card:33331231"],
    setup: { format: "ffa3", p0: { hand: [HAMP], monsters: [RAYE, VIPER] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: HAMP, nth: 0 }, "p0"),
      choose("your field", "p0"),
      select(VIPER),
      expectBoard({
        p0: seat({ monsters: [RAYE, HAMP], grave: [VIPER] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa4-hamp-own-field-tributes-own-monster",
    title: "FFA4: H.A.M.P. summoned to the own field Tributes a monster of the own field only and no opponent is asked or changes",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "lava", "ffa4", "card:33331231"],
    setup: { format: "ffa4", p0: { hand: [HAMP], monsters: [RAYE, VIPER] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
    steps: [
      specialSummon({ card: HAMP, nth: 0 }, "p0"),
      choose("your field", "p0"),
      select(VIPER),
      expectBoard({
        p0: seat({ monsters: [RAYE, HAMP], grave: [VIPER] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT] }),
        p3: seat({ monsters: [AXE] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-tag-hamp-own-field-tributes-own-monster",
    title: "TAG: H.A.M.P. summoned to the own field Tributes a monster of the own field only and no opponent is asked or changes",
    source: TAG_SRC,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD"],
    tags: ["multiplayer", "summon", "procedure", "lava", "tag", "card:33331231"],
    setup: { format: "tag", p0: { hand: [HAMP], monsters: [RAYE, VIPER] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: HAMP, nth: 0 }, "p0"),
      choose("your field", "p0"),
      select(VIPER),
      expectBoard({
        p0: tagSeat({ monsters: [RAYE, HAMP], grave: [VIPER] }),
        p1: tagSeat({ monsters: [ELF] }),
        p2: tagSeat({ monsters: [OX] }),
        p3: tagSeat({ monsters: [RAT] }),
      }),
    ],
  }),
];

// --- Nordic cards: Jormungardr and Fenrir Special Summon themselves to the field of ONE opponent ---------------------------------
// The procedure has no Tribute: SetTargetRange(POS_FACEUP_DEFENSE, 1) makes the core bind one opponent, and the card goes to the field of
// that opponent. It needs a face-up Aesir monster on ANY field and a free Monster Zone on the opponent field, so an opponent with a full
// field is not offered. Fenrir can be summoned in Main Phase 2 only. In Tag the partner is never offered.

const ODIN = "Odin, Father of the Aesir";
const JORMUNGARDR = "Jormungardr the Nordic Serpent";
const FENRIR = "Fenrir the Nordic Wolf";

const nordicScenarios = (name: string, slug: string, code: number, before: Step[], firstTurnBattle = false): Scenario[] => {
  const flags = firstTurnBattle ? { attackFirstTurn: true } : {};
  const tags = (format: string) => ["multiplayer", "summon", "procedure", "nordic", format, `card:${code}`];
  return [
    defineScenario({
      id: `summon-procedures-ffa3-${slug}-goes-to-picked-opponent`,
      title: `FFA3: ${name} (Aesir monster on the own field) is Special Summoned to the field of the picked opponent p2 and p1 is unchanged`,
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("ffa3"),
      setup: { ...flags, format: "ffa3", p0: { hand: [name], monsters: [ODIN] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
      steps: [
        ...before,
        specialSummon({ card: name, nth: 0 }, "p0"),
        expectPickSeats(["p1", "p2"], "p0"),
        pickOpponent("p2", "p0"),
        expectBoard({
          p0: seat({ monsters: [ODIN] }),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT, name] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-ffa4-${slug}-opponent-with-full-field-is-not-offered`,
      title: `FFA4: p1 has a full field, so only p2 and p3 are offered for ${name}; it goes to the field of the picked p3 and p1 and p2 are unchanged`,
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("ffa4"),
      setup: { ...flags, format: "ffa4", p0: { hand: [name], monsters: [ODIN] }, p1: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
      steps: [
        ...before,
        specialSummon({ card: name, nth: 0 }, "p0"),
        expectPickSeats(["p2", "p3"], "p0"),
        pickOpponent("p3", "p0"),
        expectBoard({
          p0: seat({ monsters: [ODIN] }),
          p1: seat({ monsters: [ELF, ELF, ELF, ELF, ELF] }),
          p2: seat({ monsters: [RAT] }),
          p3: seat({ monsters: [AXE, name] }),
        }),
      ],
    }),
    defineScenario({
      id: `summon-procedures-tag-${slug}-goes-to-opposing-member-not-partner`,
      title: `Tag: ${name} offers the opposing members p1 and p3 and not the partner p2, and goes to the field of the picked p3`,
      source: TAG_SRC,
      rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("tag"),
      setup: { ...flags, format: "tag", p0: { hand: [name], monsters: [ODIN] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
      steps: [
        ...before,
        specialSummon({ card: name, nth: 0 }, "p0"),
        expectPickSeats(["p1", "p3"], "p0"),
        pickOpponent("p3", "p0"),
        expectBoard({
          p0: tagSeat({ monsters: [ODIN] }),
          p1: tagSeat({ monsters: [ELF] }),
          p2: tagSeat({ monsters: [OX] }),
          p3: tagSeat({ monsters: [RAT, name] }),
        }),
      ],
    }),
  ];
};

export const NORDIC_SCENARIOS: Scenario[] = [
  ...nordicScenarios(JORMUNGARDR, "jormungardr", 64203620, []),
  // Fenrir is offered in Main Phase 2 only.
  // (the Battle Phase of the first turn is opened by attackFirstTurn; the card is summoned in Main Phase 2).
  ...nordicScenarios(FENRIR, "fenrir", 91697229, [changePhase("battle", "p0"), changePhase("main2", "p0")], true),
];

// --- Grinder Golem and Fallen of Argyros: Special Summon procedures to the field of ONE opponent ---------------------------------
// Grinder Golem puts 2 Grinder Tokens on the OWN field and goes itself to the field of the picked opponent (the own field needs 2 free
// zones, the opponent field 1). Fallen of Argyros has two procedures: "Special Summon to your field" and "Special Summon to your
// opponent's field" (needs a face-up Level, Rank or Link 2 monster on a field). In Tag the partner is never offered.

const GOLEM = "Grinder Golem";
const GRINDER_TOKEN = "Grinder Token";
const FALLEN = "Fallen of Argyros";

const grinderScenarios = (): Scenario[] => [
  defineScenario({
    id: "summon-procedures-ffa3-grinder-golem-goes-to-picked-opponent-and-tokens-to-the-own-field",
    title: "FFA3: Grinder Golem asks for an opponent, goes to the field of the picked p2 and the 2 Grinder Tokens go to the own field; p1 is unchanged",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "grinder-golem", "ffa3", "card:75732622"],
    setup: { format: "ffa3", p0: { hand: [GOLEM] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: GOLEM, nth: 0 }, "p0"),
      expectPickSeats(["p1", "p2"], "p0"),
      pickOpponent("p2", "p0"),
      expectBoard({
        p0: seat({ monsters: [GRINDER_TOKEN, GRINDER_TOKEN] }),
        p1: seat({ monsters: [ELF] }),
        p2: seat({ monsters: [RAT, GOLEM] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-ffa4-grinder-golem-opponent-with-full-field-is-not-offered",
    title: "FFA4: p1 has a full field, so only p2 and p3 are offered for Grinder Golem; it goes to the field of the picked p3 and the tokens to the own field, p1 and p2 are unchanged",
    source: SRC,
    rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "grinder-golem", "ffa4", "card:75732622"],
    setup: { format: "ffa4", p0: { hand: [GOLEM] }, p1: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
    steps: [
      specialSummon({ card: GOLEM, nth: 0 }, "p0"),
      expectPickSeats(["p2", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectBoard({
        p0: seat({ monsters: [GRINDER_TOKEN, GRINDER_TOKEN] }),
        p1: seat({ monsters: [ELF, ELF, ELF, ELF, ELF] }),
        p2: seat({ monsters: [RAT] }),
        p3: seat({ monsters: [AXE, GOLEM] }),
      }),
    ],
  }),
  defineScenario({
    id: "summon-procedures-tag-grinder-golem-goes-to-opposing-member-not-partner",
    title: "Tag: Grinder Golem offers the opposing members p1 and p3 and not the partner p2; it goes to the field of the picked p3 and the tokens to the own field of p0",
    source: TAG_SRC,
    rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "summon", "procedure", "grinder-golem", "tag", "card:75732622"],
    setup: { format: "tag", p0: { hand: [GOLEM] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
    steps: [
      specialSummon({ card: GOLEM, nth: 0 }, "p0"),
      expectPickSeats(["p1", "p3"], "p0"),
      pickOpponent("p3", "p0"),
      expectBoard({
        p0: tagSeat({ monsters: [GRINDER_TOKEN, GRINDER_TOKEN] }),
        p1: tagSeat({ monsters: [ELF] }),
        p2: tagSeat({ monsters: [OX] }),
        p3: tagSeat({ monsters: [RAT, GOLEM] }),
      }),
    ],
  }),
];

const fallenScenarios = (): Scenario[] => {
  const tags = (format: string) => ["multiplayer", "summon", "procedure", "fallen-of-argyros", format, "card:82090807"];
  return [
    defineScenario({
      id: "summon-procedures-ffa3-fallen-of-argyros-opponent-field-goes-to-picked-opponent",
      title: "FFA3: Fallen of Argyros (Level 2 monster on the own field), the procedure to the opponent's field asks for an opponent and the card goes to the field of the picked p2; p1 is unchanged",
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("ffa3"),
      setup: { format: "ffa3", p0: { hand: [FALLEN], monsters: [DORON] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
      steps: [
        specialSummon({ card: FALLEN, nth: 0 }, "p0"),
        choose("opponent's field", "p0"),
        expectPickSeats(["p1", "p2"], "p0"),
        pickOpponent("p2", "p0"),
        expectBoard({
          p0: seat({ monsters: [DORON] }),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT, FALLEN] }),
        }),
      ],
    }),
    defineScenario({
      id: "summon-procedures-ffa4-fallen-of-argyros-opponent-field-goes-to-picked-opponent",
      title: "FFA4: p1 has a full field, so only p2 and p3 are offered for the opponent-field procedure of Fallen of Argyros; it goes to the field of the picked p3, p1 and p2 are unchanged",
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("ffa4"),
      setup: { format: "ffa4", p0: { hand: [FALLEN], monsters: [DORON] }, p1: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
      steps: [
        specialSummon({ card: FALLEN, nth: 0 }, "p0"),
        choose("opponent's field", "p0"),
        expectPickSeats(["p2", "p3"], "p0"),
        pickOpponent("p3", "p0"),
        expectBoard({
          p0: seat({ monsters: [DORON] }),
          p1: seat({ monsters: [ELF, ELF, ELF, ELF, ELF] }),
          p2: seat({ monsters: [RAT] }),
          p3: seat({ monsters: [AXE, FALLEN] }),
        }),
      ],
    }),
    defineScenario({
      id: "summon-procedures-tag-fallen-of-argyros-opponent-field-goes-to-opposing-member",
      title: "Tag: the opponent-field procedure of Fallen of Argyros offers the opposing members p1 and p3 and not the partner p2; it goes to the field of the picked p3",
      source: TAG_SRC,
      rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD", "R-COMMON-OPP-PICK"],
      tags: tags("tag"),
      setup: { format: "tag", p0: { hand: [FALLEN], monsters: [DORON] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
      steps: [
        specialSummon({ card: FALLEN, nth: 0 }, "p0"),
        choose("opponent's field", "p0"),
        expectPickSeats(["p1", "p3"], "p0"),
        pickOpponent("p3", "p0"),
        expectBoard({
          p0: tagSeat({ monsters: [DORON] }),
          p1: tagSeat({ monsters: [ELF] }),
          p2: tagSeat({ monsters: [OX] }),
          p3: tagSeat({ monsters: [RAT, FALLEN] }),
        }),
      ],
    }),
    defineScenario({
      id: "summon-procedures-ffa3-fallen-of-argyros-own-field-asks-no-opponent",
      title: "FFA3: the own-field procedure of Fallen of Argyros asks for no opponent and puts the card on the own field; p1 and p2 are unchanged",
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD"],
      tags: tags("ffa3"),
      setup: { format: "ffa3", p0: { hand: [FALLEN], monsters: [DORON] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] } },
      steps: [
        specialSummon({ card: FALLEN, nth: 0 }, "p0"),
        choose("your field", "p0"),
        expectBoard({
          p0: seat({ monsters: [DORON, FALLEN] }),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT] }),
        }),
      ],
    }),
    defineScenario({
      id: "summon-procedures-ffa4-fallen-of-argyros-own-field-asks-no-opponent",
      title: "FFA4: the own-field procedure of Fallen of Argyros asks for no opponent and puts the card on the own field; p1, p2 and p3 are unchanged",
      source: SRC,
      rules: ["R-COMMON-OPP-FIELD"],
      tags: tags("ffa4"),
      setup: { format: "ffa4", p0: { hand: [FALLEN], monsters: [DORON] }, p1: { monsters: [ELF] }, p2: { monsters: [RAT] }, p3: { monsters: [AXE] } },
      steps: [
        specialSummon({ card: FALLEN, nth: 0 }, "p0"),
        choose("your field", "p0"),
        expectBoard({
          p0: seat({ monsters: [DORON, FALLEN] }),
          p1: seat({ monsters: [ELF] }),
          p2: seat({ monsters: [RAT] }),
          p3: seat({ monsters: [AXE] }),
        }),
      ],
    }),
    defineScenario({
      id: "summon-procedures-tag-fallen-of-argyros-own-field-asks-no-opponent",
      title: "Tag: the own-field procedure of Fallen of Argyros asks for no opponent and puts the card on the own field; the partner p2 and the opposing members are unchanged",
      source: TAG_SRC,
      rules: ["R-TAG-PARTNER", "R-COMMON-OPP-FIELD"],
      tags: tags("tag"),
      setup: { format: "tag", p0: { hand: [FALLEN], monsters: [DORON] }, p1: { monsters: [ELF] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
      steps: [
        specialSummon({ card: FALLEN, nth: 0 }, "p0"),
        choose("your field", "p0"),
        expectBoard({
          p0: tagSeat({ monsters: [DORON, FALLEN] }),
          p1: tagSeat({ monsters: [ELF] }),
          p2: tagSeat({ monsters: [OX] }),
          p3: tagSeat({ monsters: [RAT] }),
        }),
      ],
    }),
  ];
};

export const OPPONENT_FIELD_PROCEDURE_SCENARIOS: Scenario[] = [...grinderScenarios(), ...fallenScenarios()];


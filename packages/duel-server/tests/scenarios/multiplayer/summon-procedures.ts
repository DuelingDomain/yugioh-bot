// Summon procedures that Tribute or bind ONE opponent, for every card that the testers listed as pending: the 6 Kaiju that are not
// Gameciel (Radian, Kumongous, Gadarla, Thunder King, Jizukiru, Dogoran). Plain data, run by summon-procedures.test.ts on a real
// engine (NSEAT_LIVE=1) and read by scripts/rule-coverage.ts. Owner rule (Q8): the Tribute is taken from ONE opponent and the Kaiju
// goes to the field of that opponent; the summon with no Tribute needs a face-up Kaiju on the field of ANY opponent and goes to the own
// field. In Tag the opponent is an opposing member: the partner is never an opponent. Every scenario asserts the FINAL state of
// every seat.

import {
  choose, defineScenario, expectBoard, expectPickOptions, pickOpponent, select, specialSummon, type Scenario,
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

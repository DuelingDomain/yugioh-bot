// Tag Synchro material includes a partner monster. Both teams and FFA3/FFA4 controls run on Standard and Domain cores.
// Every scenario checks the state of every seat after real core prompts. Core patch: gap-tag2/0001.
import {
  endTurn, expectBoard, expectNotOffered, expectOffered, expectPickOptions,
  select, specialSummon, type BoardExpect, type DuelistExpect, type OptionRef, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { ELF, SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";

const COST = `${SOURCE} [R-TAG-PARTNER-COST]`;
const STARDUST = "Stardust Dragon"; // Synchro, Level 8: 1 Tuner + non-Tuners
const ZETA = "The Magical King of Dimension Zeta"; // Level 4 Tuner
const AXE = "Axe Raider"; // Level 4, 1700 ATK
const OX = "Battle Ox"; // Level 4
const RAT = "Giant Rat"; // Level 4
const STARDUST_CODE = 44508094;

const cards = (...names: string[]): OptionRef[] => names.map((card) => ({ card }));
const passTurns = (...seats: Seat[]): Step[] => seats.map((seat) => endTurn(seat));

/** The state of EVERY seat of a Tag duel (16000 LP per team unless given). A seat that the spec leaves out is empty. */
function everyTagSeat(spec: Partial<Record<Seat, DuelistExpect>>, lp: { team0?: number; team1?: number } = {}): Step {
  const board: BoardExpect = {};
  for (const seat of ["p0", "p1", "p2", "p3"] as Seat[]) {
    const team = seat === "p0" || seat === "p2" ? lp.team0 : lp.team1;
    board[seat] = { lp: team ?? 16000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  }
  return expectBoard(board);
}

/** The state of EVERY seat of a free-for-all duel with `seats` seats (8000 LP each unless given). */
function everyFfaSeat(seats: 3 | 4, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of (["p0", "p1", "p2", "p3"] as Seat[]).slice(0, seats)) board[seat] = { lp: 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const synchro = (id: string, title: string, setup: Record<string, unknown>, steps: Step[], format: "tag" | "ffa3" | "ffa4" = "tag"): Scenario =>
  defineScenario({
    id: `tag-team-synchro-${id}`,
    title: `${format === "tag" ? "Tag" : format === "ffa3" ? "FFA3" : "FFA4"}: ${title}`,
    source: COST,
    rules: ["R-TAG-PARTNER-COST"],
    tags: ["multiplayer", format, "synchro", `card:${STARDUST_CODE}`],
    setup: { format, ...setup } as Scenario["setup"],
    steps,
  });

export const TAG_TEAM_RULES_SCENARIOS: Scenario[] = [
  // ---- Synchro material of the partner ----
  synchro(
    "tuner-of-the-partner-team-0",
    "p0 Synchro Summons Stardust Dragon from its own Axe Raider and the Tuner (Zeta) of the partner p2; the Battle Ox of p1 and the Giant Rat of p3 are no choice and stay",
    { p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [OX] }, p2: { monsters: [ZETA] }, p3: { monsters: [RAT] } },
    [
      expectOffered("specialSummon", STARDUST, "p0"),
      specialSummon(STARDUST, "p0"),
      expectPickOptions({ include: cards(ZETA), exclude: cards(OX, RAT) }, "p0"), // the Tuner prompt: the partner Tuner, no opposing monster
      select(ZETA, AXE),
      everyTagSeat({ p0: { monsters: [STARDUST], grave: [AXE], extra: [] }, p1: { monsters: [OX] }, p2: { grave: [ZETA] }, p3: { monsters: [RAT] } }),
    ],
  ),
  synchro(
    "non-tuner-of-the-partner-team-0",
    "p0 Synchro Summons Stardust Dragon from its own Tuner (Zeta) and the Axe Raider of the partner p2 (a non-Tuner); the Battle Ox of p1 and the Giant Rat of p3 are no choice and stay",
    { p0: { monsters: [ZETA], extra: [STARDUST] }, p1: { monsters: [OX] }, p2: { monsters: [AXE] }, p3: { monsters: [RAT] } },
    [
      expectOffered("specialSummon", STARDUST, "p0"),
      specialSummon(STARDUST, "p0"),
      select(ZETA, AXE),
      everyTagSeat({ p0: { monsters: [STARDUST], grave: [ZETA], extra: [] }, p1: { monsters: [OX] }, p2: { grave: [AXE] }, p3: { monsters: [RAT] } }),
    ],
  ),
  synchro(
    "tuner-of-the-partner-team-1",
    "p1 (team 1) Synchro Summons Stardust Dragon from its own Axe Raider and the Tuner (Zeta) of the partner p3; the Battle Ox of p0 and the Giant Rat of p2 are no choice and stay",
    { p0: { monsters: [OX] }, p1: { monsters: [AXE], extra: [STARDUST] }, p2: { monsters: [RAT] }, p3: { monsters: [ZETA] } },
    [
      ...passTurns("p0"),
      expectOffered("specialSummon", STARDUST, "p1"),
      specialSummon(STARDUST, "p1"),
      expectPickOptions({ include: cards(ZETA), exclude: cards(OX, RAT) }, "p1"), // the Tuner prompt: the partner Tuner, no opposing monster
      select(ZETA, AXE),
      everyTagSeat({ p0: { monsters: [OX] }, p1: { monsters: [STARDUST], grave: [AXE], extra: [] }, p2: { monsters: [RAT] }, p3: { grave: [ZETA] } }),
    ],
  ),
  synchro(
    "non-tuner-of-the-partner-team-1",
    "p3 (team 1) Synchro Summons Stardust Dragon from its own Tuner (Zeta) and the Axe Raider of the partner p1 (a non-Tuner); the Battle Ox of p0 and the Giant Rat of p2 are no choice and stay",
    { p0: { monsters: [OX] }, p1: { monsters: [AXE] }, p2: { monsters: [RAT] }, p3: { monsters: [ZETA], extra: [STARDUST] } },
    [
      ...passTurns("p0", "p1", "p2"),
      expectOffered("specialSummon", STARDUST, "p3"),
      specialSummon(STARDUST, "p3"),
      select(ZETA, AXE),
      everyTagSeat({ p0: { monsters: [OX] }, p1: { grave: [AXE] }, p2: { monsters: [RAT] }, p3: { monsters: [STARDUST], grave: [ZETA], extra: [] } }),
    ],
  ),
  synchro(
    "tuner-of-an-opponent-is-no-material",
    "p0 holds Axe Raider and the Stardust Dragon; the only Tuner (Zeta) belongs to the opponent p1: the Synchro Summon is not offered, nothing moves",
    { p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [ZETA] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } },
    [
      expectNotOffered("specialSummon", STARDUST, "p0"),
      endTurn("p0"),
      everyTagSeat({ p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [ZETA] }, p2: { monsters: [OX] }, p3: { monsters: [RAT] } }),
    ],
  ),
  synchro(
    "ffa3-tuner-of-another-seat-is-no-material",
    "p0 holds Axe Raider and the Stardust Dragon; the Tuner (Zeta) is on the field of p2, who is no partner in free for all: the Synchro Summon is not offered, nothing moves",
    { p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [OX] }, p2: { monsters: [ZETA] } },
    [
      expectNotOffered("specialSummon", STARDUST, "p0"),
      endTurn("p0"),
      everyFfaSeat(3, { p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [OX] }, p2: { monsters: [ZETA] } }),
    ],
    "ffa3",
  ),
  synchro(
    "ffa4-tuner-of-another-seat-is-no-material",
    "p0 holds Axe Raider and the Stardust Dragon; the Tuner (Zeta) is on the field of p2 (the seat across the table, no partner in free for all): the Synchro Summon is not offered, nothing moves",
    { p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [OX] }, p2: { monsters: [ZETA] }, p3: { monsters: [RAT] } },
    [
      expectNotOffered("specialSummon", STARDUST, "p0"),
      endTurn("p0"),
      everyFfaSeat(4, { p0: { monsters: [AXE], extra: [STARDUST] }, p1: { monsters: [OX] }, p2: { monsters: [ZETA] }, p3: { monsters: [RAT] } }),
    ],
    "ffa4",
  ),

  // ---- direct attack: the partner guards the duelist ----
];

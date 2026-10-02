// Live scenarios of Primathmech Laplacian 88021907 (the Xyz Summon trigger: detach up to 3 materials, then choose that many effects among: send 1 random
// card of the opponent's hand, 1 monster, 1 Spell/Trap of the opponent to the GY; the opponent is picked by the activator). The maximum of the detach is
// the number of kinds of card that the PICKED opponent has (hand, monster, Spell/Trap): the overlay reads it in the window of the picked opponent (FFA)
// and for the picked opponent of the joined side (Tag), so the activator cannot detach more materials than the picked opponent gives effects to choose.
// Plain data (scripts/rule-coverage.ts reads it); laplacian.test.ts runs it on a live core (NSEAT_LIVE=1) with the real card scripts and the overlay.
// Every scenario ends with the state of EVERY seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  choose, defineScenario, expectBoard, expectPrompt, expectRetry, faceDown, pickOpponent, select, specialSummon, yes,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "tag";

const LAPLACIAN = "Primathmech Laplacian";
const ELF = "Mystical Elf"; // Level 4, the 3 Xyz materials
const RAT = "Giant Rat"; // the hand card of the opponent
const OX = "Battle Ox"; // the monster
const AXE = "Axe Raider";
const POT = "Pot of Greed"; // the set Spell
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);
const label = (format: Format): string => (format === "tag" ? "Tag" : "FFA3");

/** The state of EVERY seat (a seat that the spec leaves out is empty with 8000 LP; Tag: 16000 for the team). */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) {
    board[seat] = { monsters: [], spells: [], grave: [], banished: [], extra: [], hand: [], ...spec[seat], lp: format === "tag" ? 16000 : 8000 };
  }
  return expectBoard(board);
}

/** p0 Xyz Summons Laplacian from the 3 Elves, activates the trigger and picks the opponent. */
function summon(pick: Seat): Step[] {
  return [
    specialSummon(LAPLACIAN, "p0"),
    select({ card: ELF, nth: 0 }), select({ card: ELF, nth: 0 }), select({ card: ELF, nth: 0 }),
    yes("p0"),
    pickOpponent(pick, "p0"),
  ];
}
/** Detaches `count` materials (every selection takes the first one that is left). */
const detach = (count: number): Step => select(...Array.from({ length: count }, () => ({ card: ELF, nth: 0 })));
/** The answer that detaches `count` materials of the prompt (the ids are card:0, card:1, ...). */
const detachAnswer = (count: number) => ({ selected: Array.from({ length: count }, (_, i) => `card:${i}`) });

const p0End = (detached: number): DuelistExpect => ({ monsters: [LAPLACIAN], grave: Array.from({ length: detached }, () => ELF) });

function scenario(
  id: string, format: Format, title: string, setup: Partial<Record<Seat, object>>, steps: Step[],
): Scenario {
  const full: Record<string, unknown> = { format, p0: { monsters: [ELF, ELF, ELF], extra: [LAPLACIAN] } };
  for (const seat of seatsOf(format)) if (!(seat in full)) full[seat] = setup[seat] ?? {};
  return defineScenario({
    id: `laplacian-${format}-${id}`,
    title: `${label(format)}: ${title}`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK"],
    tags: ["multiplayer", "laplacian", "trigger", "xyz", format, "card:88021907"],
    setup: full as Scenario["setup"],
    steps,
  });
}

const OPP_ALL = { hand: [RAT], monsters: [OX], spells: [faceDown(POT)] };
const OPP_ALL_STAYS: DuelistExpect = { hand: [RAT], monsters: [OX], spells: [POT] };

export const LAPLACIAN_SCENARIOS: Scenario[] = [
  // FFA3: p1 has the 3 kinds (hand, monster, Spell/Trap), p2 has 1 kind (a monster). The picked opponent sets the maximum and takes the effects.
  scenario(
    "picked-opponent-with-3-kinds-detach-3-all-3-effects-on-that-opponent-only",
    "ffa3",
    "p0 picks p1 (hand card, monster, set Spell: 3 kinds): up to 3 materials can be detached; all 3 are detached and all 3 effects hit p1 only (p2 is untouched)",
    { p1: OPP_ALL, p2: { monsters: [AXE] } },
    [
      ...summon("p1"),
      detach(3),
      choose("opt:0", "p0"), choose("opt:0", "p0"), // the 3rd effect is the only one left: the engine takes it
      everySeat("ffa3", { p0: p0End(3), p1: { grave: [RAT, OX, POT] }, p2: { monsters: [AXE] } }),
    ],
  ),
  scenario(
    "picked-opponent-with-1-kind-detach-is-capped-at-1",
    "ffa3",
    "p0 picks p2 (only a monster: 1 kind): the detach of 2 materials is refused, the detach of 1 is taken and its effect hits p2 only (p1, with 3 kinds, is untouched)",
    { p1: OPP_ALL, p2: { monsters: [AXE] } },
    [
      ...summon("p2"),
      expectPrompt({ by: "p0", title: "Xyz Material(s) to detach" }),
      expectRetry(detachAnswer(2), { error: "Invalid answer", by: "p0" }),
      detach(1),
      everySeat("ffa3", { p0: p0End(1), p1: OPP_ALL_STAYS, p2: { grave: [AXE] } }),
    ],
  ),
  // Tag: the opponents are p1 (hand) and p3 (monster, Spell/Trap), one joined side for the field. The pick of the opponent binds the hand.
  scenario(
    "picked-opponent-with-no-hand-detach-is-capped-at-2",
    "tag",
    "p0 picks p3 (a monster and a set Spell on the joined side, no hand card): the detach of 3 materials is refused, 2 are detached and the monster and the Spell/Trap go to the Graveyard (the hand card of p1 stays)",
    { p1: { hand: [RAT] }, p3: { monsters: [OX], spells: [faceDown(POT)] } },
    [
      ...summon("p3"),
      expectRetry(detachAnswer(3), { error: "Invalid answer", by: "p0" }),
      detach(2),
      choose("opt:0", "p0"), // the 2nd effect is the only one left: the engine takes it
      everySeat("tag", { p0: p0End(2), p1: { hand: [RAT] }, p3: { grave: [OX, POT] } }),
    ],
  ),
  scenario(
    "picked-opponent-with-a-hand-detach-3-all-3-effects",
    "tag",
    "p0 picks p1 (a hand card; the monster and the set Spell of the joined side count too: 3 kinds): all 3 materials are detached and the hand card, the monster and the Spell/Trap go to the Graveyard",
    { p1: { hand: [RAT] }, p3: { monsters: [OX], spells: [faceDown(POT)] } },
    [
      ...summon("p1"),
      detach(3),
      choose("opt:0", "p0"), choose("opt:0", "p0"), // the 3rd effect is the only one left: the engine takes it
      everySeat("tag", { p0: p0End(3), p1: { grave: [RAT] }, p3: { grave: [OX, POT] } }),
    ],
  ),
];

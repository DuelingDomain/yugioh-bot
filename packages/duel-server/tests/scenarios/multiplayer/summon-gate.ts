// Live scenarios of Summon Gate 29724053 ("each player can Special Summon only 3 monsters from the Extra Deck per turn"). The card counts per
// summoning duelist (FFA the seat, Tag the team) and the count is reset at the end of every turn (aux.AddValuesReset). A count that is shared by
// two opposing seats would stop the 4th summon of two opponents that summon in the SAME turn, so every "opposing seats" scenario below makes the
// summons of several seats in one turn: the turn player in its Main Phase, the other seats in its Battle Phase with Urgent Tuning (a Trap that
// Synchro Summons from the Extra Deck, any Battle Phase). Plain data (scripts/rule-coverage.ts reads it); summon-gate.test.ts runs it on a live
// core (NSEAT_LIVE=1) with the real card scripts and the overlay. Every scenario ends with the state of EVERY seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.
//
// The turn player (p1) makes 3 Extra Deck summons in its Main Phase, a Synchro chain that fits in 5 monster zones and asks no question:
//   1. Armory Arm (Level 4)     = Kagemusha of the Six Samurai (Tuner, 2) + Flame Viper (2)
//   2. Mighty Warrior (Level 6) = Hop Ear Squadron (Tuner, 2) + Armory Arm (4)
//   3. Stardust Dragon (Level 8) = Cherry Inmato (Tuner, 2) + Mighty Warrior (6)
// The 4th summon is the Xyz Summon of Number 39: Utopia from 2 Level 4 monsters (two Mystical Elf).
// Another seat has Urgent Tuning and makes the first two links of the same chain (Kagemusha + Flame Viper, then Hop Ear Squadron + Armory Arm).

import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPrompt, faceDown, normalSummon, pass, select, specialSummon,
  type BoardExpect, type DuelistExpect, type DuelistSetup, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const GATE = "Summon Gate";
const URGENT = "Urgent Tuning";
const ELF = "Mystical Elf";
const UTOPIA = "Number 39: Utopia";
const K = "Kagemusha of the Six Samurai";
const FV = "Flame Viper";
const HE = "Hop Ear Squadron";
const CI = "Cherry Inmato";
const AA = "Armory Arm";
const MW = "Mighty Warrior";
const SD = "Stardust Dragon";
const STATE = `${SOURCE} [R-COMMON-SEAT-STATE]`;

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);
const label = (format: Format): string => (format === "tag" ? "Tag" : format.toUpperCase());
const up = { pos: "up" as const };

/** The state of EVERY seat (a seat that the spec leaves out is empty with 8000 LP; Tag: 16000 for the team, the partner reads the LP of the first seat). */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  const partner: Record<Seat, Seat> = { p0: "p2", p1: "p3", p2: "p0", p3: "p1" };
  for (const seat of seatsOf(format)) {
    const lp = format === "tag" ? (spec[seat]?.lp ?? spec[partner[seat]]?.lp ?? 16000) : (spec[seat]?.lp ?? 8000);
    board[seat] = { monsters: [], spells: [], grave: [], banished: [], extra: [], hand: [], ...spec[seat], lp };
  }
  return expectBoard(board);
}

/** The turn player: 3 Extra Deck summons in the Main Phase (the chain above), the Xyz Summon after them is (not) offered. */
function turnPlayer(): DuelistSetup {
  return { monsters: [K, FV, HE, CI, ELF], hand: [ELF], extra: [AA, MW, SD, UTOPIA] };
}
function threeSummons(seat: Seat): Step[] {
  return [
    specialSummon(AA, seat), select(K, FV),
    specialSummon(MW, seat), select(HE, AA),
    specialSummon(SD, seat), select(CI, MW),
  ];
}
function fourth(seat: Seat, offered: boolean): Step[] {
  return [normalSummon(ELF, seat), offered ? expectOffered("specialSummon", UTOPIA, seat) : expectNotOffered("specialSummon", UTOPIA, seat)];
}
/** The state of the turn player after the 3 summons and the Normal Summon of the second Elf (one Elf of the hand is the card of its Draw Phase). */
const turnPlayerEnd: DuelistExpect = { hand: [ELF], monsters: [SD, ELF, ELF], grave: [K, FV, HE, CI, AA, MW], extra: [UTOPIA] };

/** A seat with Urgent Tuning (`traps` copies) and the first links of the chain. */
function responder(traps: number, spells: DuelistSetup["spells"] = []): DuelistSetup {
  return { monsters: [K, FV, HE], extra: [AA, MW], spells: [...spells, ...Array.from({ length: traps }, () => faceDown(URGENT))] };
}
/** What a seat that made `links` links with Urgent Tuning (`traps` copies at start) has. */
function responderEnd(traps: number, links: number, gate = false): DuelistExpect {
  const used = Math.min(traps, links);
  const base: DuelistExpect =
    links === 0 ? { monsters: [K, FV, HE], extra: [AA, MW] }
    : links === 1 ? { monsters: [AA, HE], grave: [K, FV], extra: [MW] }
    : { monsters: [MW], grave: [K, FV, HE, AA], extra: [] };
  const grave = [...((base.grave as string[] | undefined) ?? []), ...Array.from({ length: used }, () => URGENT)];
  const spells = [...(gate ? [GATE] : []), ...Array.from({ length: traps - used }, () => URGENT)];
  return { ...base, grave, spells };
}

const scenario = (id: string, format: Format, title: string, setup: Partial<Record<Seat, DuelistSetup>>, steps: Step[]): Scenario => {
  const full: Record<string, unknown> = { format, attackFirstTurn: true };
  for (const seat of seatsOf(format)) full[seat] = setup[seat] ?? {};
  return defineScenario({
    id: `summon-gate-${id}`,
    title: `${label(format)}: ${title}`,
    source: STATE,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "summon-gate", "seat-state", format, "card:29724053"],
    setup: full as Scenario["setup"],
    steps,
  });
};

export const SUMMON_GATE_SCENARIOS: Scenario[] = [
  scenario(
    "ffa3-turn-player-limit-and-two-opposing-seats-in-one-turn",
    "ffa3",
    "p1 makes 3 Extra Deck Special Summons in its turn, its 4th is not offered; in the same turn p2 and p0 (opposing seats of p1) make 2 each, 4 in all: each seat counts on its own",
    { p0: responder(2, [{ card: GATE, ...up }]), p1: turnPlayer(), p2: responder(2) },
    [
      endTurn("p0"),
      ...threeSummons("p1"),
      ...fourth("p1", false),
      changePhase("battle", "p1"),
      activate(URGENT, "p2"), pass("p2"), pass("p0"), select(K, FV),
      activate(URGENT, "p2"), pass("p0"), select(AA),
      activate(URGENT, "p0"), pass("p0"), select(K, FV),
      activate(URGENT, "p0"), select(AA),
      expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
      everySeat("ffa3", { p0: responderEnd(2, 2, true), p1: turnPlayerEnd, p2: responderEnd(2, 2) }),
    ],
  ),
  scenario(
    "ffa3-control-without-the-gate-the-4th-extra-deck-summon-is-offered",
    "ffa3",
    "control: with no Summon Gate on the field, the 4th Extra Deck Special Summon of p1 (the Xyz Summon) is offered",
    { p1: turnPlayer() },
    [
      endTurn("p0"),
      ...threeSummons("p1"),
      ...fourth("p1", true),
      everySeat("ffa3", { p1: { hand: [ELF], monsters: [SD, ELF, ELF], grave: [K, FV, HE, CI, AA, MW], extra: [UTOPIA] } }),
    ],
  ),
  scenario(
    "ffa4-turn-player-limit-and-three-opposing-seats-in-one-turn",
    "ffa4",
    "p1 makes 3 Extra Deck Special Summons in its turn, its 4th is not offered; in the same turn p2 (2), p3 (1) and p0 (2), the 3 opposing seats of p1, make 5 in all: each seat counts on its own",
    { p0: responder(2, [{ card: GATE, ...up }]), p1: turnPlayer(), p2: responder(2), p3: responder(1) },
    [
      endTurn("p0"),
      ...threeSummons("p1"),
      ...fourth("p1", false),
      changePhase("battle", "p1"),
      activate(URGENT, "p2"), pass("p2"), pass("p3"), pass("p0"), select(K, FV),
      activate(URGENT, "p2"), pass("p3"), pass("p0"), select(AA),
      activate(URGENT, "p3"), pass("p0"), select(K, FV),
      activate(URGENT, "p0"), pass("p0"), select(K, FV),
      activate(URGENT, "p0"), select(AA),
      expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
      everySeat("ffa4", { p0: responderEnd(2, 2, true), p1: turnPlayerEnd, p2: responderEnd(2, 2), p3: responderEnd(1, 1) }),
    ],
  ),
  scenario(
    "tag-the-count-is-per-team",
    "tag",
    "p1 makes 2 Extra Deck Special Summons in its turn and its partner p3 the 3rd of the team: the 2nd summon of p3 is not offered (the count is of the team); in the same turn p2 and p0, the other team, make 1 each and are not stopped",
    { p0: responder(1, [{ card: GATE, ...up }]), p1: responder(0), p2: responder(1), p3: responder(2) },
    [
      endTurn("p0"),
      specialSummon(AA, "p1"), select(K, FV),
      specialSummon(MW, "p1"), select(HE, AA),
      changePhase("battle", "p1"),
      activate(URGENT, "p2"), pass("p3"), pass("p0"), select(K, FV),
      pass("p0"), activate(URGENT, "p3"), pass("p0"), pass("p3"), select(K, FV),
      activate(URGENT, "p0"), select(K, FV),
      expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
      everySeat("tag", { p0: responderEnd(1, 1, true), p1: { ...responderEnd(0, 2), hand: [ELF] }, p2: responderEnd(1, 1), p3: responderEnd(2, 1) }),
    ],
  ),
  scenario(
    "tag-control-without-the-gate-the-partner-makes-2-summons",
    "tag",
    "control: with no Summon Gate on the field, p1 makes 2 Extra Deck Special Summons and its partner p3 makes 2 more in the same turn (the 2nd summon of p3 is offered)",
    { p1: responder(0), p3: responder(2) },
    [
      endTurn("p0"),
      specialSummon(AA, "p1"), select(K, FV),
      specialSummon(MW, "p1"), select(HE, AA),
      changePhase("battle", "p1"),
      activate(URGENT, "p3"), pass("p3"), select(K, FV),
      activate(URGENT, "p3"), select(AA),
      expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
      everySeat("tag", { p1: { ...responderEnd(0, 2), hand: [ELF] }, p3: responderEnd(2, 2) }),
    ],
  ),
];

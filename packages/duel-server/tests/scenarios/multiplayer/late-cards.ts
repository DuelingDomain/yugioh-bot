// Live scenarios of the late cards of the F7 design (part P5): Royal Tribute, Messenger of Peace, Dice Jar, coin and Ante cards, the Tag
// versions of Hero Counterattack and Foolish Revival, four more cards of rule R3 and the refused wrong-place answer.
// Plain data (no Vitest import): scripts/rule-coverage.ts reads it. late-cards.test.ts runs it on a live core (NSEAT_LIVE=1) with the real
// card scripts and the overlay, on the Standard multi core and again on the Domain multi core. Every scenario ends with the state of EVERY seat.

import {
  activate, defineScenario, endTurn, expectBoard, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const ELF = "Mystical Elf";
const RAT = "Giant Rat";
const OX = "Battle Ox";
const AXE = "Axe Raider";
const FANG = "Silver Fang";
const HOLE = "Dark Hole";
const RAIGEKI = "Raigeki";
const NECRO = "Necrovalley";
const ROYAL = "Royal Tribute";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);

/** The state of EVERY seat. LP, monsters, Spell and Trap zones, Graveyard and banished zone are exact; the hand only when the spec names it. */
function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>, lp = format === "tag" ? 16000 : 8000): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

// --- Royal Tribute -----------------------------------------------------------------------------------------------------------------
const EACH = `${SOURCE} [R-COMMON-EACH-PLAYER], card decisions 2026-10-01: Royal Tribute (every duelist discards the monsters in its hand, the partner included)`;
const HANDS: Record<Seat, string> = { p0: RAT, p1: OX, p2: AXE, p3: FANG };
const SPELLS: Record<Seat, string> = { p0: HOLE, p1: RAIGEKI, p2: HOLE, p3: RAIGEKI };

function royalTribute(format: Format): Scenario {
  const seats = seatsOf(format);
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) {
    (setup as Record<string, unknown>)[seat] = {
      hand: seat === "p0" ? [ROYAL, HANDS[seat], SPELLS[seat]] : [HANDS[seat], SPELLS[seat]],
      ...(seat === "p0" ? { field: NECRO } : {}),
    };
  }
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    spec[seat] = { hand: [SPELLS[seat]], grave: seat === "p0" ? [ROYAL, HANDS[seat]] : [HANDS[seat]], spells: seat === "p0" ? [NECRO] : [] };
  }
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  return defineScenario({
    id: `late-${format}-royal-tribute-every-duelist-discards-its-monsters`,
    title: `${label}: p0 activates Royal Tribute with Necrovalley: every duelist (p0 and the partner included) discards the monsters in its hand, the Spells stay`,
    source: EACH,
    rules: ["R-COMMON-EACH-PLAYER", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "each-player", "handes", format, "card:72405967", "card:47355498"],
    setup,
    steps: [activate(ROYAL, "p0"), zone("p0", "s0", "p0"), everySeat(format, spec)],
  });
}

export const LATE_CARD_SCENARIOS: Scenario[] = [
  royalTribute("ffa3"),
  royalTribute("ffa4"),
  royalTribute("tag"),
];

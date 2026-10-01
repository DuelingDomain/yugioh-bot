// Live scenarios of the late cards of the F7 design (part P5): Royal Tribute, Messenger of Peace, Dice Jar, coin and Ante cards, the Tag
// versions of Hero Counterattack and Foolish Revival, four more cards of rule R3 and the refused wrong-place answer.
// Plain data (no Vitest import): scripts/rule-coverage.ts reads it. late-cards.test.ts runs it on a live core (NSEAT_LIVE=1) with the real
// card scripts and the overlay, on the Standard multi core and again on the Domain multi core. Every scenario ends with the state of EVERY seat.

import {
  activate, changePhase, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, no, yes, zone,
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
const MESSENGER = "Messenger of Peace";

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

// --- Messenger of Peace ------------------------------------------------------------------------------------------------------------
// The card of p0 is face up on its field. Its ATK limit (1500 or more cannot attack) holds for the monsters of every duelist. The 100 LP
// are asked only in the Standby Phase of p0 (in Tag: of the duelist that owns the card, not of the partner). In Tag the 100 LP are paid
// from the one LP total of the team. Attacks are allowed in the 1st round (attackFirstTurn).
const PEACE = `${SOURCE} [R-COMMON-OPP-FIELD], card decisions 2026-10-01: Messenger of Peace (the ATK limit holds for all opponents, the 100 LP only in the own Standby Phase)`;
const BIG: Record<Seat, string> = { p0: OX, p1: AXE, p2: OX, p3: AXE };

function messengerSetup(format: Format): Scenario["setup"] {
  const setup: Scenario["setup"] = { format, attackFirstTurn: true };
  for (const seat of seatsOf(format)) {
    (setup as Record<string, unknown>)[seat] = {
      monsters: [BIG[seat], FANG],
      ...(seat === "p0" ? { spells: [{ card: MESSENGER, pos: "up" }] } : {}),
    };
  }
  return setup;
}

/** A battle phase in which the 1700 ATK monster of `seat` has no attack and the 1200 ATK Silver Fang has one. */
function limitOf(seat: Seat): Step[] {
  return [
    changePhase("battle", seat),
    expectNotOffered("attack", { card: BIG[seat], owner: seat }, seat),
    expectOffered("attack", { card: FANG, owner: seat }, seat),
  ];
}

function messengerOfPeace(format: Format, pay: boolean): Scenario {
  const seats = seatsOf(format);
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  const lp = format === "tag" ? 16000 : 8000;
  const own = (seat: Seat) => seat === "p0" || (format === "tag" && seat === "p2");
  // The duel starts in the Standby Phase of p0: the 1st payment is asked at once.
  const steps: Step[] = [];
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  if (pay) {
    // One round: every duelist meets the limit in its own battle phase and ends its turn. A payment prompt in the Standby Phase of any
    // other duelist would stop the next changePhase, so the round also shows that only p0 is asked. The 2nd payment is the 2nd turn of p0.
    steps.push(yes("p0"));
    for (const seat of seats) steps.push(...limitOf(seat), endTurn(seat));
    steps.push(yes("p0"));
    for (const seat of seats) spec[seat] = { hand: { count: 1 }, monsters: [BIG[seat], FANG], ...(own(seat) ? { lp: lp - 200 } : {}) };
    spec.p0 = { ...spec.p0, spells: [MESSENGER] };
  } else {
    // No payment: the card is destroyed at once and the 1700 ATK monster of p0 may attack again.
    steps.push(no("p0"), changePhase("battle", "p0"), expectOffered("attack", { card: BIG.p0, owner: "p0" }, "p0"));
    for (const seat of seats) spec[seat] = { hand: { count: 0 }, monsters: [BIG[seat], FANG] };
    spec.p0 = { ...spec.p0, grave: [MESSENGER] };
  }
  steps.push(everySeat(format, spec, lp));
  return defineScenario({
    id: `late-${format}-messenger-of-peace-${pay ? "limit-for-all-and-payment-only-in-own-standby" : "declined-payment-destroys-it"}`,
    title: `${label}: Messenger of Peace of p0: ${pay ? "no monster with 1500 ATK or more of any duelist attacks; only p0 is asked for the 100 LP, once in each of its own Standby Phases" : "p0 does not pay in its Standby Phase and the card is destroyed"}`,
    source: PEACE,
    rules: ["R-COMMON-OPP-FIELD", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "opp-field", "standby-cost", format, "card:44656491", "card:47355498"],
    setup: messengerSetup(format),
    steps,
  });
}

export const LATE_CARD_SCENARIOS: Scenario[] = [
  royalTribute("ffa3"),
  royalTribute("ffa4"),
  royalTribute("tag"),
  messengerOfPeace("ffa3", true),
  messengerOfPeace("ffa4", true),
  messengerOfPeace("tag", true),
  messengerOfPeace("ffa3", false),
];

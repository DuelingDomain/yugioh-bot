// Live scenarios of the late cards of the F7 design (part P5): Royal Tribute, Messenger of Peace, Dice Jar, coin and Ante cards, the Tag
// versions of Hero Counterattack and Foolish Revival, four more cards of rule R3 and the refused wrong-place answer.
// Plain data (no Vitest import): scripts/rule-coverage.ts reads it. late-cards.test.ts runs it on a live core (NSEAT_LIVE=1) with the real
// card scripts and the overlay, on the Standard multi core and again on the Domain multi core. Every scenario ends with the state of EVERY seat.

import {
  activate, attack, changePhase, changePosition, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPickSeats, faceDown, no, pickOpponent, select, yes, zone,
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
const DICE_JAR = "Dice Jar";
const CUP = "Cup of Ace";
const ANTE = "Ante";
const SKULL = "Summoned Skull";

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

// --- Dice Jar ----------------------------------------------------------------------------------------------------------------------
// A duel-style card (ADR-0002 Q4): the owner and ONE picked opponent roll, the other opponents do nothing. Tag uses the team LP. The dice
// come from the duel seed (the same stream on every format and on both cores), so the result is fixed: seed 2 gives the owner the higher die
// (4 against 2: the picked opponent takes 4 x 500), seed 4 gives the opponent the higher die (5 against 3: the owner takes 5 x 500).
const DICE = `${SOURCE} [R-COMMON-OPP-PICK], card decisions 2026-10-01 Q4: Dice Jar (a duel-style card: the owner and one picked opponent)`;
const PICKS: Record<Format, Seat[]> = { ffa3: ["p1", "p2"], ffa4: ["p1", "p2", "p3"], tag: ["p1", "p3"] };

function diceJar(format: Format, ownerWins: boolean): Scenario {
  const seats = seatsOf(format);
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  const lp = format === "tag" ? 16000 : 8000;
  // The last opponent is picked, never the first one clockwise (p1), so a die or a loss that goes to the first opponent would show.
  const picked = PICKS[format][PICKS[format].length - 1];
  const loss = ownerWins ? 2000 : 2500;
  const losers: Seat[] = ownerWins
    ? seats.filter((seat) => (format === "tag" ? seat === "p1" || seat === "p3" : seat === picked))
    : seats.filter((seat) => seat === "p0" || (format === "tag" && seat === "p2"));
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) spec[seat] = { hand: { count: 0 }, monsters: seat === "p0" ? [DICE_JAR] : [], ...(losers.includes(seat) ? { lp: lp - loss } : {}) };
  return defineScenario({
    id: `late-${format}-dice-jar-${ownerWins ? "owner-wins-picked-opponent-takes-the-damage" : "owner-loses-and-takes-the-damage"}`,
    title: `${label}: p0 flips Dice Jar and picks ${picked}: ${ownerWins ? `p0 rolls the higher die, only the picked side loses ${loss} LP` : `the picked opponent rolls the higher die, only p0 (its team) loses ${loss} LP`}; nobody else changes`,
    source: DICE,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "duel-style", "dice", "opp-pick", format, "card:3549275"],
    seed: [ownerWins ? "2" : "4", "2", "3", "4"],
    setup: { format, p0: { monsters: [faceDown(DICE_JAR)] } },
    steps: [
      changePosition(DICE_JAR, "p0"),
      expectPickSeats(PICKS[format], "p0"),
      pickOpponent(picked, "p0"),
      everySeat(format, spec, lp),
    ],
  });
}

// --- Cup of Ace (a coin toss with an effect on an opponent) ------------------------------------------------------------------------
// "Toss a coin: heads, you draw 2 cards; tails, your opponent draws 2 cards." The draw reaches ONE opponent: the activator picks it at
// activation (R-COMMON-OPP-PICK). Seed 5 gives tails (the coin stream does not change with the format or the core). The stock script is used.
const COIN = `${SOURCE} [R-COMMON-OPP-PICK], card decisions 2026-10-01 Q4: Cup of Ace (a coin toss; the draw goes to one picked opponent)`;
const DECK_OF: Record<Seat, [string, string]> = { p0: [RAT, OX], p1: [OX, AXE], p2: [AXE, FANG], p3: [FANG, ELF] };

function cupOfAce(format: Format): Scenario {
  const seats = seatsOf(format);
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  const picked = PICKS[format][PICKS[format].length - 1];
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) (setup as Record<string, unknown>)[seat] = { ...(seat === "p0" ? { hand: [CUP] } : {}), deck: [...DECK_OF[seat]] };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) spec[seat] = { hand: seat === picked ? [...DECK_OF[seat]] : [], grave: seat === "p0" ? [CUP] : [] };
  return defineScenario({
    id: `late-${format}-cup-of-ace-tails-the-picked-opponent-draws-2`,
    title: `${label}: p0 activates Cup of Ace and picks ${picked}: the coin is tails, so only ${picked} draws 2 cards; p0 and every other duelist draw nothing`,
    source: COIN,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "coin", "opp-pick", "draw", format, "card:37812118"],
    seed: ["5", "6", "7", "8"],
    setup,
    steps: [
      activate(CUP, "p0"),
      expectPickSeats(PICKS[format], "p0"),
      pickOpponent(picked, "p0"),
      everySeat(format, spec),
    ],
  });
}

// --- Ante (a duel-style card: you and ONE picked opponent) -------------------------------------------------------------------------
// Each side shows one hand card; the higher Level wins: the loser takes 1000 damage and its shown card goes to the Graveyard. The picked
// opponent is chosen at activation (Q4); in Tag the damage hits the team LP of the loser. The stock script is used. Every other seat keeps
// its hand card, so a show or a discard that reaches the wrong seat would change the final state.
const ANTE_RULE = `${SOURCE} [R-COMMON-OPP-PICK], card decisions 2026-10-01 Q4: Ante (you + one picked opponent; Tag uses the team LP)`;

function ante(format: Format, ownerWins: boolean): Scenario {
  const seats = seatsOf(format);
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  const lp = format === "tag" ? 16000 : 8000;
  const picked = PICKS[format][PICKS[format].length - 1];
  // Summoned Skull (Level 6) beats Mystical Elf (Level 4).
  const ownerCard = ownerWins ? SKULL : ELF;
  const pickedCard = ownerWins ? ELF : SKULL;
  const loserSeats: Seat[] = ownerWins
    ? seats.filter((seat) => (format === "tag" ? seat === "p1" || seat === "p3" : seat === picked))
    : seats.filter((seat) => seat === "p0" || (format === "tag" && seat === "p2"));
  const setup: Scenario["setup"] = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    const hand = seat === "p0" ? [ANTE, ownerCard] : seat === picked ? [pickedCard] : [HANDS[seat]];
    (setup as Record<string, unknown>)[seat] = { hand };
    const kept = seat === "p0" ? (ownerWins ? [ownerCard] : []) : seat === picked ? (ownerWins ? [] : [pickedCard]) : [HANDS[seat]];
    const grave = [...(seat === "p0" ? [ANTE] : []), ...(seat === "p0" && !ownerWins ? [ownerCard] : []), ...(seat === picked && ownerWins ? [pickedCard] : [])];
    spec[seat] = { hand: kept, grave, ...(loserSeats.includes(seat) ? { lp: lp - 1000 } : {}) };
  }
  return defineScenario({
    id: `late-${format}-ante-${ownerWins ? "owner-wins-the-picked-opponent-loses-1000-and-its-card" : "owner-loses-1000-and-its-card"}`,
    title: `${label}: p0 activates Ante and picks ${picked}: ${ownerWins ? `p0 shows the higher Level, only the picked side takes 1000 and ${picked} loses its shown card` : `${picked} shows the higher Level, only p0 (its team) takes 1000 and p0 loses its shown card`}; nobody else changes`,
    source: ANTE_RULE,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "duel-style", "opp-pick", "hand", format, "card:34236961"],
    setup,
    steps: [
      activate(ANTE, "p0"),
      expectPickSeats(PICKS[format], "p0"),
      pickOpponent(picked, "p0"),
      everySeat(format, spec, lp),
    ],
  });
}

// --- Hero Counterattack and Foolish Revival in Tag, Foolish Revival with a Graveyard that is not the picked one ----------------------
const HERO_RULE = `${SOURCE} [R-COMMON-OPP-PICK], the other cards use the defaults: Hero Counterattack (the opponent that attacked picks at random from your hand)`;
const REVIVAL_RULE = `${SOURCE} [R-COMMON-OPP-PICK], [R-COMMON-OPP-FIELD], a summon to the field of an opponent: the summoning player picks one opponent, the target may be in the Graveyard of any opponent`;
const AVIAN = "Elemental HERO Avian";
const SPARKMAN = "Elemental HERO Sparkman";
const HERO_COUNTERATTACK = "Hero Counterattack";
const FOOLISH_REVIVAL = "Foolish Revival";
const DARK_MAGICIAN = "Dark Magician";

// Tag: p1 (team 1) attacks the Hero of p0 (team 0) on its second turn (turn 6; no attack in the first turn of each seat). The attacker is the
// bound opponent: no pick prompt. Sparkman is Special Summoned to p0, p0 destroys a monster of an OPPOSING duelist (p1 or p3, never its partner p2).
const heroCounterattackTag = defineScenario({
  id: "late-tag-hero-counterattack-the-attacker-picks-from-your-hand-and-the-partner-is-unchanged",
  title: "Tag: p1 destroys the Hero of p0 in battle, p0 activates Hero Counterattack: the attacker picks at random from the hand of p0, the Hero is Special Summoned, p0 destroys the attacker; the partner p2 and p3 are unchanged",
  source: HERO_RULE,
  rules: ["R-COMMON-OPP-PICK", "R-TAG-PARTNER"],
  tags: ["multiplayer", "late-cards", "trap", "tag", "card:19024706"],
  setup: {
    format: "tag",
    // The Deck top is the same card as the hand card: the draw of turn 5 gives a second copy, so the random pick finds a Hero in any case.
    p0: { monsters: [AVIAN], hand: [SPARKMAN], deck: [SPARKMAN], spells: [{ card: HERO_COUNTERATTACK, pos: "set" }] },
    p1: { monsters: [SKULL] },
    p2: { monsters: [ELF], hand: [RAT] },
    p3: { monsters: [OX], hand: [AXE] },
  },
  steps: [
    ...(["p0", "p1", "p2", "p3", "p0"] as Seat[]).map((seat) => endTurn(seat)),
    changePhase("battle", "p1"),
    attack(SKULL, AVIAN, "p1"),
    activate(HERO_COUNTERATTACK, "p0"),
    select({ card: SKULL, owner: "p1" }),
    // The other seats drew the default Mystical Elf in their own turns (p1 twice, p2 and p3 once); no card of theirs moved because of the trap.
    expectBoard({
      p0: { lp: 14500, monsters: [SPARKMAN], hand: [SPARKMAN], spells: [], grave: [AVIAN, HERO_COUNTERATTACK], banished: [] },
      p1: { lp: 16000, monsters: [], hand: [ELF, ELF], spells: [], grave: [SKULL], banished: [] },
      p2: { lp: 14500, monsters: [ELF], hand: [RAT, ELF], spells: [], grave: [], banished: [] },
      p3: { lp: 16000, monsters: [OX], hand: [AXE, ELF], spells: [], grave: [], banished: [] },
    }),
  ],
});

// A Graveyard of an opponent that is NOT the picked one: the target may be there (R-COMMON-OPP-FIELD) and the card goes to the field of the
// picked opponent only. The Skull of p1 goes to the field of p2 and p1 keeps nothing, p2 keeps its own Graveyard card.
function foolishRevivalOtherGrave(format: "ffa3" | "tag"): Scenario {
  const label = format === "tag" ? "Tag" : "FFA3";
  const picked: Seat = format === "tag" ? "p3" : "p2";
  const source: Seat = "p1";
  const setup: Scenario["setup"] = { format, p0: { spells: [{ card: FOOLISH_REVIVAL, pos: "set" }] }, p1: { grave: [SKULL] } };
  (setup as Record<string, unknown>)[picked] = { grave: [DARK_MAGICIAN] };
  const lp = format === "tag" ? 16000 : 8000;
  const spec: Partial<Record<Seat, DuelistExpect>> = {
    p0: { grave: [FOOLISH_REVIVAL] },
    [source]: {},
    [picked]: { monsters: [SKULL], grave: [DARK_MAGICIAN] },
  };
  return defineScenario({
    id: `late-${format}-foolish-revival-target-in-the-grave-of-the-opponent-that-is-not-picked`,
    title: `${label}: p0 activates Foolish Revival and picks ${picked}, then targets the Summoned Skull in the Graveyard of ${source}: the Skull goes to the field of ${picked}; ${picked} keeps its own Graveyard card`,
    source: REVIVAL_RULE,
    rules: ["R-COMMON-OPP-PICK", "R-COMMON-OPP-FIELD", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "opponent-field-summon", format, "card:83778600"],
    setup,
    steps: [
      activate(FOOLISH_REVIVAL, "p0"),
      expectPickSeats(format === "tag" ? ["p1", "p3"] : ["p1", "p2"], "p0"),
      pickOpponent(picked, "p0"),
      select({ card: SKULL, owner: source }),
      everySeat(format, spec, lp),
    ],
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
  diceJar("ffa3", true),
  diceJar("ffa4", true),
  diceJar("tag", true),
  diceJar("ffa3", false),
  diceJar("ffa4", false),
  diceJar("tag", false),
  cupOfAce("ffa3"),
  cupOfAce("ffa4"),
  cupOfAce("tag"),
  ante("ffa3", true),
  ante("ffa4", false),
  ante("tag", true),
  ante("tag", false),
  heroCounterattackTag,
  foolishRevivalOtherGrave("ffa3"),
  foolishRevivalOtherGrave("tag"),
];

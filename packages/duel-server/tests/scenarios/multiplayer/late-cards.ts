// Live scenarios of the late cards of the F7 design (part P5): Royal Tribute, Messenger of Peace, Dice Jar, coin and Ante cards, the Tag
// versions of Hero Counterattack and Foolish Revival, four more cards of rule R3 and the refused wrong-place answer.
// Plain data (no Vitest import): scripts/rule-coverage.ts reads it. late-cards.test.ts runs it on a live core (NSEAT_LIVE=1) with the real
// card scripts and the overlay, on the Standard multi core and again on the Domain multi core. Every scenario ends with the state of EVERY seat.

import {
  activate, attack, changePhase, changePosition, endTurn, expectBoard, expectEliminated, expectTurn, expectNotOffered, expectOffered, expectPickOptions, expectPickSeats, expectPrompt, faceDown, no, pickOpponent, select, surrender, yes, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
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
  }, { destination: "grave" });
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
// The stock script gives 2 cards to the activator on Heads and to one opponent on Tails.
// In FFA, declare the opponent at activation for both results (R-COMMON-OPP-PICK).
// The owner accepts this C4 declaration because Tails can make an opponent draw.
// In Tag, the opponent choice occurs only on Tails. Heads changes only the hand and Deck of p0.
// The coin is the first draw of the duel generator (xoshiro256**, no shuffle runs before it): its result is the lowest bit of rotl(5 * seed[1], 7),
// that is bit 57 of 5 * seed[1]. A small seed word (5, 6, 7, 8) leaves that bit clear, so the first draw is even and the coin is tails; seed[1] = 2^57
// sets the bit and gives heads. Both results come from the seed alone, so they are the same on every format and on both cores.
const COIN = `${SOURCE} [R-COMMON-OPP-PICK], accepted C4 declaration: Cup of Ace (Heads draws for the activator; Tails draws for one declared opponent)`;
const DECK_OF: Record<Seat, [string, string]> = { p0: [RAT, OX], p1: [OX, AXE], p2: [AXE, FANG], p3: [FANG, ELF] };
const SEED_TAILS = ["5", "6", "7", "8"];
const SEED_HEADS = ["5", "144115188075855872", "7", "8"];

function cupOfAce(format: Format, heads = false): Scenario {
  const seats = seatsOf(format);
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  const picked = PICKS[format][PICKS[format].length - 1];
  const setup: Scenario["setup"] = { format };
  for (const seat of seats) (setup as Record<string, unknown>)[seat] = { ...(seat === "p0" ? { hand: [CUP] } : {}), deck: [...DECK_OF[seat]] };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  for (const seat of seats) {
    const draws = heads ? seat === "p0" : seat === picked;
    spec[seat] = {
      hand: draws ? [...DECK_OF[seat]] : [],
      grave: seat === "p0" ? [CUP] : [],
      // The board fixture fills each Deck to setup.deckSize, or 20 cards by default.
      deckCount: (setup.deckSize ?? 20) - (draws ? 2 : 0),
    };
  }
  const steps: Step[] = [
    activate(CUP, "p0"),
    ...(!heads || format !== "tag" ? [expectPickSeats(PICKS[format], "p0"), pickOpponent(picked, "p0")] : []),
    ...(heads ? [expectPrompt({ by: "p0", context: "action" })] : []),
    everySeat(format, spec),
  ];
  return defineScenario({
    id: heads ? `late-${format}-cup-of-ace-heads-the-activator-draws-2-and-other-seats-keep-their-resources` : `late-${format}-cup-of-ace-tails-the-picked-opponent-draws-2`,
    title: heads
      ? `${label}: p0 activates Cup of Ace: Heads makes p0 draw 2 cards; every other duelist keeps its resources`
      : `${label}: p0 activates Cup of Ace and picks ${picked}: the coin is tails, so only ${picked} draws 2 cards; p0 and every other duelist draw nothing`,
    source: COIN,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "coin", "opp-pick", "draw", format, "card:37812118"],
    seed: heads ? SEED_HEADS : SEED_TAILS,
    setup,
    steps,
  }, heads ? { card: ELF } : {});
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
    // Keep a real choice in Standard FFA after the turn-1 draw is removed.
    if (seat === "p0" && format !== "tag") hand.push(ELF);
    (setup as Record<string, unknown>)[seat] = { hand };
    const kept = seat === "p0" ? (ownerWins ? [ownerCard] : []) : seat === picked ? (ownerWins ? [] : [pickedCard]) : [HANDS[seat]];
    const grave = [...(seat === "p0" ? [ANTE] : []), ...(seat === "p0" && !ownerWins ? [ownerCard] : []), ...(seat === picked && ownerWins ? [pickedCard] : [])];
    if (seat === "p0" && format !== "tag") kept.push(ELF);
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
      ...(format === "tag" ? [] : [select(ownerCard)]),
      everySeat(format, spec, lp),
    ],
  });
}

// Ante: an opponent with no hand card cannot take part. The stock target needs a card in the hand of "your opponent" (chk == 0), the core runs
// it for each opponent in turn (the bound-opponent probe), so the pick offers only the opponents with a hand card; when only one opponent is left it
// is bound with no prompt. An opponent with an empty hand is never offered, never shows a card and never loses life points or a card.
// p1 has no hand card in every format. FFA3: only p2 has one (no pick prompt). FFA4: p2 and p3 have one (the pick lists exactly them, p3 is picked).
// Tag: p3 has one, p1 (the other opposing duelist) has none, and the partner p2 has one that must stay in its hand (no pick prompt).
function anteEmptyHand(format: Format): Scenario {
  const seats = seatsOf(format);
  const label = format === "tag" ? "Tag" : format.toUpperCase();
  const lp = format === "tag" ? 16000 : 8000;
  // FFA3 and Tag: the owner wins (Summoned Skull against Mystical Elf), the opponent loses. FFA4: the owner loses.
  const ownerWins = format !== "ffa4";
  const picked: Seat = format === "ffa3" ? "p2" : "p3";
  const ownerCard = ownerWins ? SKULL : ELF;
  const pickedCard = ownerWins ? ELF : SKULL;
  const others: Partial<Record<Seat, string>> = format === "ffa3" ? {} : format === "ffa4" ? { p2: AXE } : { p2: RAT };
  const setup: Scenario["setup"] = { format };
  const spec: Partial<Record<Seat, DuelistExpect>> = {};
  const loserSeats: Seat[] = ownerWins
    ? seats.filter((seat) => (format === "tag" ? seat === "p1" || seat === "p3" : seat === picked))
    : seats.filter((seat) => seat === "p0");
  for (const seat of seats) {
    const hand: string[] = seat === "p0" ? [ANTE, ownerCard] : seat === picked ? [pickedCard] : others[seat] ? [others[seat] as string] : [];
    // Keep a real choice in Standard FFA after the turn-1 draw is removed.
    if (seat === "p0" && format !== "tag") hand.push(ELF);
    (setup as Record<string, unknown>)[seat] = { hand };
    const kept = seat === "p0" ? (ownerWins ? [ownerCard] : []) : seat === picked ? (ownerWins ? [] : [pickedCard]) : others[seat] ? [others[seat] as string] : [];
    const grave = [...(seat === "p0" ? [ANTE] : []), ...(seat === "p0" && !ownerWins ? [ownerCard] : []), ...(seat === picked && ownerWins ? [pickedCard] : [])];
    if (seat === "p0" && format !== "tag") kept.push(ELF);
    spec[seat] = { hand: kept, grave, ...(loserSeats.includes(seat) ? { lp: lp - 1000 } : {}) };
  }
  // After the activation: a pick prompt that lists exactly the opponents with a hand card (FFA4), or the main phase of p0 (one legal opponent).
  const steps: Step[] = format === "ffa4"
    ? [activate(ANTE, "p0"), expectPickSeats(["p2", "p3"], "p0"), pickOpponent(picked, "p0"), select(ownerCard), everySeat(format, spec, lp)]
    : [activate(ANTE, "p0"), ...(format === "tag" ? [] : [select(ownerCard)]), expectPrompt({ by: "p0", context: "action" }), everySeat(format, spec, lp)];
  return defineScenario({
    id: `late-${format}-ante-an-opponent-with-no-hand-is-not-offered`,
    title: `${label}: p0 activates Ante while p1 has no hand card: ${format === "ffa4" ? "the pick lists only p2 and p3 (they have a hand card), p0 picks p3" : `p1 is not offered, ${picked} is the only opponent left and is bound with no pick prompt`}; ${ownerWins ? `p0 shows the higher Level, only ${format === "tag" ? "the team of p3" : picked} takes 1000 and ${picked} loses its shown card` : `p3 shows the higher Level, only p0 takes 1000 and loses its shown card`}; the opponent with no hand${format === "tag" ? " and the partner p2 are" : " is"} unchanged`,
    source: ANTE_RULE,
    rules: ["R-COMMON-OPP-PICK", ...(format === "tag" ? ["R-TAG-PARTNER"] : [])],
    tags: ["multiplayer", "late-cards", "duel-style", "opp-pick", "hand", "empty-hand", format, "card:34236961"],
    setup,
    steps,
  });
}

// --- Hero Counterattack and Foolish Revival ----------------------------------------------------------------------------------------
const HERO_RULE = `${SOURCE} [R-COMMON-OPP-PICK], the other cards use the defaults: Hero Counterattack (the opponent that attacked picks at random from your hand)`;
const REVIVAL_RULE = `${SOURCE} [R-FFA-OPP-ONE] [R-COMMON-OPP-PICK]: in FFA, select a target from the declared opponent's Graveyard and summon it to that opponent's field; in Tag, the target may be in either opposing Graveyard`;
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

// In FFA, the declaration limits the target and the summon to one opponent.
// In Tag, the two opposing Graveyards are shared; the summon goes to the picked duelist.
function foolishRevivalOtherGrave(format: "ffa3" | "tag"): Scenario {
  const label = format === "tag" ? "Tag" : "FFA3";
  const ffa = format === "ffa3";
  const picked: Seat = format === "tag" ? "p3" : "p2";
  const source: Seat = "p1";
  const target = ffa ? DARK_MAGICIAN : SKULL;
  const setup: Scenario["setup"] = { format, p0: { spells: [{ card: FOOLISH_REVIVAL, pos: "set" }] }, p1: { grave: [SKULL] } };
  // Two legal FFA targets keep the card prompt open so the test can check its options.
  (setup as Record<string, unknown>)[picked] = { grave: ffa ? [DARK_MAGICIAN, ELF] : [DARK_MAGICIAN] };
  const lp = format === "tag" ? 16000 : 8000;
  const spec: Partial<Record<Seat, DuelistExpect>> = {
    p0: { grave: [FOOLISH_REVIVAL] },
    [source]: { grave: ffa ? [SKULL] : [] },
    [picked]: { monsters: [target], grave: ffa ? [ELF] : [DARK_MAGICIAN], zones: { m0: { card: target, pos: "def" } } },
  };
  for (const seat of seatsOf(format)) spec[seat] = { hand: [], deckCount: 20, ...spec[seat] };
  return defineScenario({
    id: ffa
      ? "late-ffa3-foolish-revival-target-and-summon-use-the-declared-opponent"
      : `late-${format}-foolish-revival-target-in-the-grave-of-the-opponent-that-is-not-picked`,
    title: ffa
      ? "FFA3: p0 declares p2 for Foolish Revival: only p2's Graveyard cards are offered; Dark Magician goes to p2 in Defense Position; p1 keeps Summoned Skull"
      : `${label}: p0 activates Foolish Revival and picks ${picked}, then targets the Summoned Skull in the Graveyard of ${source}: the Skull goes to the field of ${picked}; ${picked} keeps its own Graveyard card`,
    source: REVIVAL_RULE,
    rules: ["R-COMMON-OPP-PICK", ...(ffa ? ["R-FFA-OPP-ONE"] : ["R-TAG-SHARED-CARDS", "R-TAG-PARTNER"])],
    tags: ["multiplayer", "late-cards", "opponent-field-summon", format, "card:83778600"],
    setup,
    steps: [
      activate(FOOLISH_REVIVAL, "p0"),
      expectPickSeats(format === "tag" ? ["p1", "p3"] : ["p1", "p2"], "p0"),
      pickOpponent(picked, "p0"),
      ...(ffa ? [expectPickOptions([{ card: DARK_MAGICIAN, seat: picked }, { card: ELF, seat: picked }], "p0")] : []),
      select({ card: target, owner: ffa ? picked : source }),
      everySeat(format, spec, lp),
    ],
  });
}

// --- R3 (Q1): cards that last "until the end of your opponent's next turn" or for N opponent turns ------------------------------------
// In FFA, RESET_OPPO_TURN without RESET_SELF_TURN counts only the declared opponent's turns when the effect binds one opponent.
// Effects with no declared opponent keep R3: every opponent turn counts. Tag keeps its opposing-duelist count; a partner turn does not count.
// A seat that lost takes no turn. The state of every living seat is checked after each step that matters.
const R3_RULE = `${SOURCE} [R-FFA-ORDER] Q1 R3: with no declared opponent, every opponent turn counts. [R-FFA-DECLARED-DURATION]: in FFA, RESET_OPPO_TURN without RESET_SELF_TURN counts only the declared opponent's turns. Tag keeps its opposing-duelist count; a seat that lost takes no turn`;
const TIME_SEAL = "Time Seal";

/** The table of the living `seats`: every seat has the hand size of `hands` (0 when it is missing), p0 has the Graveyard and Spell/Trap zones given. */
function table(seats: Seat[], hands: Partial<Record<Seat, number>>, p0: { grave?: string[]; spells?: string[] } = {}, lp = 8000): Step {
  const board: BoardExpect = {};
  for (const seat of seats) {
    board[seat] = {
      lp, hand: { count: hands[seat] ?? 0 }, monsters: [], banished: [],
      spells: seat === "p0" ? p0.spells ?? [] : [], grave: seat === "p0" ? p0.grave ?? [] : [],
    };
  }
  return expectBoard(board);
}

const timeSealSetup = { spells: [{ card: TIME_SEAL, pos: "set" as const }] };
const TIME_SEAL_RULE = `${SOURCE} [R-FFA-OPP-ONE] [R-FFA-ACTIVATED-LOCK] [R-FFA-DECLARED-DURATION] [R-FFA-FIRST-DRAW]: Time Seal skips the declared opponent's next Draw Phase; other opponents' turns do not end the lock; all first draws follow the duel mode and Master Rule`;
const timeSealFfa3 = defineScenario({
  id: "r3-ffa3-time-seal-skips-the-draw-of-the-declared-opponent",
  title: "FFA3: p0 declares p1 for Time Seal: p1 skips its next Draw Phase, p2 draws on its turn, and p1 draws on its second turn",
  source: TIME_SEAL_RULE,
  rules: ["R-FFA-ORDER", "R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK", "R-FFA-DECLARED-DURATION", "R-FFA-FIRST-DRAW"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "ffa3", "card:35316708"],
  setup: { format: "ffa3", p0: timeSealSetup },
  steps: [
    activate(TIME_SEAL, "p0"),
    expectPrompt({ by: "p0", context: "opponent" }),
    expectPickSeats(["p1", "p2"], "p0"),
    pickOpponent("p1", "p0"),
    table(["p0", "p1", "p2"], {}, { grave: [TIME_SEAL] }),
    endTurn("p0"), expectTurn("p1", 2),
    // The lock is bound to p1: p1 does not draw.
    table(["p0", "p1", "p2"], {}, { grave: [TIME_SEAL] }),
    expectBoard({ p1: { deckCount: 20 }, p2: { deckCount: 20 } }),
    endTurn("p1"), expectTurn("p2", 3),
    // The lock does not affect p2: p2 draws.
    table(["p0", "p1", "p2"], { p2: 1 }, { grave: [TIME_SEAL] }),
    expectBoard({ p1: { deckCount: 20 }, p2: { deckCount: 19 } }),
    endTurn("p2"), expectTurn("p0", 4),
    endTurn("p0"), expectTurn("p1", 5),
    table(["p0", "p1", "p2"], { p0: 1, p1: 1, p2: 1 }, { grave: [TIME_SEAL] }),
    expectBoard({ p0: { deckCount: 19 }, p1: { deckCount: 19 }, p2: { deckCount: 19 } }),
  ],
});

const timeSealFfa3P2 = defineScenario({
  id: "r3-ffa3-time-seal-declares-p2-and-skips-only-its-next-draw",
  title: "FFA3: p0 declares p2 for Time Seal: p1 draws on both turns, p2 skips its first draw and draws on its second turn",
  source: TIME_SEAL_RULE,
  rules: ["R-FFA-ORDER", "R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK", "R-FFA-DECLARED-DURATION", "R-FFA-FIRST-DRAW"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "ffa3", "card:35316708"],
  setup: { format: "ffa3", p0: timeSealSetup },
  steps: [
    activate(TIME_SEAL, "p0"),
    expectPrompt({ by: "p0", context: "opponent" }),
    expectPickSeats(["p1", "p2"], "p0"),
    pickOpponent("p2", "p0"),
    everySeat("ffa3", {
      p0: { hand: [], deckCount: 20, grave: [TIME_SEAL] },
      p1: { hand: [], deckCount: 20 },
      p2: { hand: [], deckCount: 20 },
    }),
    endTurn("p0"), expectTurn("p1", 2),
    // p1 is the next seat, but the lock applies only to the declared p2.
    everySeat("ffa3", {
      p0: { hand: [], deckCount: 20, grave: [TIME_SEAL] },
      p1: { hand: [ELF], deckCount: 19 },
      p2: { hand: [], deckCount: 20 },
    }),
    endTurn("p1"), expectTurn("p2", 3),
    // p2 skips one draw. Its hand and Deck do not change.
    everySeat("ffa3", {
      p0: { hand: [], deckCount: 20, grave: [TIME_SEAL] },
      p1: { hand: [ELF], deckCount: 19 },
      p2: { hand: [], deckCount: 20 },
    }),
    endTurn("p2"), expectTurn("p0", 4),
    endTurn("p0"), expectTurn("p1", 5),
    endTurn("p1"), expectTurn("p2", 6),
    everySeat("ffa3", {
      p0: { hand: [ELF], deckCount: 19, grave: [TIME_SEAL] },
      p1: { hand: [ELF, ELF], deckCount: 18 },
      p2: { hand: [ELF], deckCount: 19 },
    }),
  ],
});

// p1 leaves before its turn. The lock stays bound to p1, so p2 draws on both of its turns.
const timeSealCutShort = defineScenario({
  id: "r3-ffa3-time-seal-declared-opponent-leaves-the-lock-does-not-move",
  title: "FFA3: p0 declares p1 for Time Seal, then p1 gives up: p1 takes no turn; the lock stays bound to p1 and p2 draws on both of its turns",
  source: `${TIME_SEAL_RULE}. [R-FFA-ELIMINATION]: p1 leaves the duel. [R-FFA-OPP-ONE] [R-FFA-ACTIVATED-LOCK]: the lock applies only to p1 and does not move to p2`,
  rules: ["R-FFA-ORDER", "R-FFA-OPP-ONE", "R-FFA-ACTIVATED-LOCK", "R-FFA-DECLARED-DURATION", "R-FFA-ELIMINATION", "R-FFA-FIRST-DRAW"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "elimination", "ffa3", "card:35316708"],
  setup: { format: "ffa3", p0: timeSealSetup },
  steps: [
    activate(TIME_SEAL, "p0"),
    expectPrompt({ by: "p0", context: "opponent" }),
    expectPickSeats(["p1", "p2"], "p0"),
    pickOpponent("p1", "p0"),
    table(["p0", "p1", "p2"], {}, { grave: [TIME_SEAL] }),
    surrender("p1"),
    // The surrender keeps p0's action prompt open until p0 ends its turn.
    expectPrompt({ by: "p0", context: "action", offers: ["to_ep"] }),
    endTurn("p0"), expectEliminated("p1"), expectTurn("p2", 2),
    table(["p0", "p2"], { p2: 1 }, { grave: [TIME_SEAL] }),
    expectBoard({ p2: { deckCount: 19 } }),
    endTurn("p2"), expectTurn("p0", 3),
    table(["p0", "p2"], { p0: 1, p2: 1 }, { grave: [TIME_SEAL] }),
    endTurn("p0"), expectTurn("p2", 4),
    expectEliminated("p1"),
    table(["p0", "p2"], { p0: 1, p2: 2 }, { grave: [TIME_SEAL] }),
    expectBoard({ p0: { deckCount: 19 }, p2: { deckCount: 18 } }),
  ],
});

// Appointer of the Red Lotus: pay 2000 LP, show your hand, pick one opponent and banish one card from that hand.
// In FFA, the card returns during the declared opponent's next End Phase. In Tag, it returns during the next opposing End Phase.
const APPOINTER = "Appointer of the Red Lotus";
const appointerTag = defineScenario({
  id: "r3-tag-appointer-of-the-red-lotus-card-returns-to-the-picked-opponent-at-the-end-of-the-next-opposing-turn",
  title: "Tag: p0 pays 2000 (team LP) and banishes the Axe Raider from the hand of the picked p3: the card returns to the hand of p3 at the end of the turn of p1 (the next opposing turn); the partner p2 is unchanged",
  source: `${R3_RULE} [R-COMMON-OPP-PICK] [R-TAG-PARTNER]`,
  rules: ["R-TAG-ORDER", "R-COMMON-OPP-PICK", "R-TAG-PARTNER"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "opp-pick", "tag", "card:43262273"],
  setup: {
    format: "tag",
    p0: { hand: [ELF], spells: [{ card: APPOINTER, pos: "set" }] },
    p1: { hand: [RAT] },
    p2: { hand: [OX] },
    p3: { hand: [AXE, FANG] },
  },
  steps: [
    activate(APPOINTER, "p0"),
    expectPickSeats(["p1", "p3"], "p0"),
    pickOpponent("p3", "p0"),
    select({ card: AXE, owner: "p3" }),
    expectBoard({
      p0: { lp: 14000, hand: [ELF], monsters: [], spells: [], grave: [APPOINTER], banished: [] },
      p1: { lp: 16000, hand: [RAT], monsters: [], spells: [], grave: [], banished: [] },
      p2: { lp: 14000, hand: [OX], monsters: [], spells: [], grave: [], banished: [] },
      p3: { lp: 16000, hand: [FANG], monsters: [], spells: [], grave: [], banished: [AXE] },
    }),
    endTurn("p0"), expectTurn("p1", 2),
    endTurn("p1"), expectTurn("p2", 3),
    expectBoard({
      p0: { lp: 14000, hand: [ELF], monsters: [], spells: [], grave: [APPOINTER], banished: [] },
      p1: { lp: 16000, hand: [RAT, ELF], monsters: [], spells: [], grave: [], banished: [] },
      p2: { lp: 14000, hand: [OX, ELF], monsters: [], spells: [], grave: [], banished: [] },
      p3: { lp: 16000, hand: [AXE, FANG], monsters: [], spells: [], grave: [], banished: [] },
    }),
  ],
});
const appointerFfa3 = defineScenario({
  id: "r3-ffa3-appointer-of-the-red-lotus-card-returns-during-the-declared-opponents-next-end-phase",
  title: "FFA3: p0 pays 2000 and banishes Axe Raider from the hand of the declared p2: the card stays banished through p1's turn and returns to p2 during p2's next End Phase",
  source: `${R3_RULE} [R-COMMON-OPP-PICK] [R-FFA-OPP-ONE]: Appointer banishes the card until the declared opponent's next End Phase`,
  rules: ["R-FFA-ORDER", "R-COMMON-OPP-PICK", "R-FFA-OPP-ONE", "R-FFA-DECLARED-DURATION"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "opp-pick", "ffa3", "card:43262273"],
  setup: {
    format: "ffa3",
    p0: { hand: [ELF], spells: [{ card: APPOINTER, pos: "set" }] },
    p1: { hand: [RAT] },
    p2: { hand: [AXE, FANG] },
  },
  steps: [
    activate(APPOINTER, "p0"),
    expectPickSeats(["p1", "p2"], "p0"),
    pickOpponent("p2", "p0"),
    select({ card: AXE, owner: "p2" }),
    everySeat("ffa3", {
      p0: { lp: 6000, hand: [ELF], deckCount: 20, grave: [APPOINTER] },
      p1: { hand: [RAT], deckCount: 20 },
      p2: { hand: [FANG], deckCount: 20, banished: [AXE] },
    }),
    endTurn("p0"), expectTurn("p1", 2),
    // p1 draws. Axe Raider stays banished.
    everySeat("ffa3", {
      p0: { lp: 6000, hand: [ELF], deckCount: 20, grave: [APPOINTER] },
      p1: { hand: [RAT, ELF], deckCount: 19 },
      p2: { hand: [FANG], deckCount: 20, banished: [AXE] },
    }),
    endTurn("p1"), expectTurn("p2", 3),
    // p2 draws. Its next End Phase has not started, so Axe Raider stays banished.
    everySeat("ffa3", {
      p0: { lp: 6000, hand: [ELF], deckCount: 20, grave: [APPOINTER] },
      p1: { hand: [RAT, ELF], deckCount: 19 },
      p2: { hand: [FANG, ELF], deckCount: 19, banished: [AXE] },
    }),
    endTurn("p2"), expectTurn("p0", 4),
    // Axe Raider returns during p2's End Phase. Then p0 draws on turn 4.
    everySeat("ffa3", {
      p0: { lp: 6000, hand: [ELF, ELF], deckCount: 19, grave: [APPOINTER] },
      p1: { hand: [RAT, ELF], deckCount: 19 },
      p2: { hand: [AXE, FANG, ELF], deckCount: 19 },
    }),
  ],
});

// Continuous Traps that destroy themselves after 3 of the opponent turns of the owner (RESET_OPPO_TURN, count 3): the end of the 3rd counted turn
// is visible on the board. The same R3 count as the Steelcage, with 3 instead of 2.
const SEA_LORD = "Sea Lord's Amulet";
const DEPTH = "Depth Amulet";
function onField(card: string, on: boolean): Step {
  return expectBoard({ p0: { spells: on ? [card] : [], grave: on ? [] : [card], monsters: [] } });
}
const seaLordFfa3 = defineScenario({
  id: "r3-ffa3-sea-lords-amulet-is-destroyed-after-the-third-opponent-turn",
  title: "FFA3: Sea Lord's Amulet (RESET_OPPO_TURN, count 3) stays through the turns of p1, p2 and the next turn of p0, and is destroyed at the end of the 2nd turn of p1 (the 3rd opponent turn)",
  source: R3_RULE,
  rules: ["R-FFA-ORDER"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "ffa3", "card:61258740"],
  setup: { format: "ffa3", p0: { spells: [{ card: SEA_LORD, pos: "set" }] } },
  steps: [
    activate(SEA_LORD, "p0"),
    onField(SEA_LORD, true),
    endTurn("p0"), expectTurn("p1", 2),
    endTurn("p1"), expectTurn("p2", 3),
    endTurn("p2"), expectTurn("p0", 4),
    // Two opponent turns are over (p1, p2).
    table(["p0", "p1", "p2"], { p0: 1, p1: 1, p2: 1 }, { spells: [SEA_LORD] }),
    endTurn("p0"), expectTurn("p1", 5),
    onField(SEA_LORD, true),
    endTurn("p1"), expectTurn("p2", 6),
    // The 3rd opponent turn (the 2nd turn of p1) is over: the card is in the Graveyard of p0.
    table(["p0", "p1", "p2"], { p0: 1, p1: 2, p2: 2 }, { grave: [SEA_LORD] }),
  ],
});
const depthTag = defineScenario({
  id: "r3-tag-depth-amulet-partner-turn-does-not-count",
  title: "Tag: Depth Amulet (RESET_OPPO_TURN, count 3) ignores the turn of the partner p2 and is destroyed at the end of the 2nd turn of p1 (p1, p3, p1 are the 3 opposing turns)",
  source: `${R3_RULE} [R-TAG-ORDER] [R-TAG-PARTNER]`,
  rules: ["R-TAG-ORDER", "R-TAG-PARTNER"],
  tags: ["multiplayer", "late-cards", "turn-count", "r3", "tag", "card:8279188"],
  setup: { format: "tag", p0: { spells: [{ card: DEPTH, pos: "set" }] } },
  steps: [
    activate(DEPTH, "p0"),
    onField(DEPTH, true),
    endTurn("p0"), expectTurn("p1", 2),
    endTurn("p1"), expectTurn("p2", 3),
    // 1 opposing turn (p1) is over. The turn of the partner p2 does not count.
    endTurn("p2"), expectTurn("p3", 4),
    endTurn("p3"), expectTurn("p0", 5),
    // 2 opposing turns (p1, p3) are over.
    onField(DEPTH, true),
    endTurn("p0"), expectTurn("p1", 6),
    endTurn("p1"), expectTurn("p2", 7),
    // The 3rd opposing turn (the 2nd turn of p1) is over: the card is in the Graveyard of p0.
    table(["p0", "p1", "p2", "p3"], { p0: 1, p1: 2, p2: 2, p3: 1 }, { grave: [DEPTH] }, 16000),
  ],
});

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
  cupOfAce("ffa3", true),
  cupOfAce("ffa4", true),
  cupOfAce("tag", true),
  ante("ffa3", true),
  ante("ffa4", false),
  ante("tag", true),
  ante("tag", false),
  anteEmptyHand("ffa3"),
  anteEmptyHand("ffa4"),
  anteEmptyHand("tag"),
  heroCounterattackTag,
  foolishRevivalOtherGrave("ffa3"),
  foolishRevivalOtherGrave("tag"),
  timeSealFfa3,
  timeSealFfa3P2,
  timeSealCutShort,
  appointerFfa3,
  appointerTag,
  seaLordFfa3,
  depthTag,
];

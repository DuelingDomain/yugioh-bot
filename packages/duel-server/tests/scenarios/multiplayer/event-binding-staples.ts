// Dark Bribe (77538567), Don Zaloog (76922029), Soul Taker (81510157), Maxx "C" (23434538), Effect Veiler (97268402) and Infinite Impermanence (10045474): cards that name "the opponent" as 1-tp inside their
// own effect. In a duel with more than 2 duelists the opponent is the duelist of the event (the one who activated, took the damage or summoned) or the
// controller of the target. Each scenario asserts the final state of every seat: the duelist of the event is the only one that is affected.

import { activate, attack, auto, pass, choose, select, endTurn, expectPrompt, expectTurn, expectOffered, faceDown, yes, pickOpponent, type Scenario, type Step } from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";
import { baseLp, baseSetup, everySeat, label, SEATS, turnsBefore, type Format, type Seat } from "./seat-kit.js";

const POT = "Pot of Greed";
const BRIBE = "Dark Bribe";
const team = (seat: Seat): number => Number(seat[1]) % 2;
/** Cards a seat drew until the turn of `turn` (the first player does not draw). */
const drawn = (seat: Seat, turn: Seat): number => (seat !== "p0" && Number(seat[1]) <= Number(turn[1]) ? 1 : 0);

/** The turn player `activator` activates Pot of Greed; `holder` (a Set Dark Bribe) negates it: only the activator draws (1 card from the Bribe, 0 from the Pot). */
function bribe(format: Format, activator: Seat, holder: Seat): Scenario {
  const spec: Record<string, object> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: { count: drawn(seat, activator) } };
  spec[activator] = { ...spec[activator], hand: { count: drawn(activator, activator) + 1 }, grave: [POT] };
  spec[holder] = { ...spec[holder], grave: [BRIBE] };
  const steps: Step[] = [
    ...turnsBefore(format, activator),
    activate(POT, activator),
    expectOffered("activate", BRIBE, holder),
    activate(BRIBE, holder),
  ];
  return defineScenario({
    id: `dark-bribe-${format}-${activator}-pot-negated-by-${holder}-only-${activator}-draws`,
    title: `${label(format)}: ${activator} activates Pot of Greed and ${holder} negates it with Dark Bribe: the Pot is destroyed and ${activator} (not another seat) draws 1 card`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the opponent named by 1-tp is the duelist of the event`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "event-opponent", format, "card:77538567"],
    setup: baseSetup(format, { [activator]: { hand: [POT] }, [holder]: { spells: [faceDown(BRIBE)] } }),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

const ZALOOG = "Don Zaloog";
const ELF = "Mystical Elf";

/**
 * `attacker` attacks `target` directly with Don Zaloog (the target holds 1 known card in hand) and chooses an effect: the discard takes the random card of
 * the hand of the target, the Deck effect sends the top 2 cards of the Deck of the target to the Graveyard. No other seat loses a card.
 */
function zaloog(format: Format, attacker: Seat, target: Seat, effect: "hand" | "deck"): Scenario {
  const base = baseLp(format);
  const foes = SEATS[format].filter((seat) => (format === "tag" ? team(seat) !== team(attacker) : seat !== attacker));
  const spec: Record<string, object> = {};
  for (const seat of SEATS[format]) {
    const own = drawn(seat, attacker) + (seat === target ? 1 : 0);
    const hit = seat === target;
    spec[seat] = {
      hand: { count: hit && effect === "hand" ? own - 1 : own },
      grave: { count: hit ? (effect === "hand" ? 1 : 2) : 0 },
    };
  }
  for (const seat of foes) if (seat === target || (format === "tag" && team(seat) === team(target))) spec[seat] = { ...spec[seat], lp: base - 1400 };
  spec[attacker] = { ...spec[attacker], monsters: [ZALOOG] };
  const steps: Step[] = [
    ...turnsBefore(format, attacker),
    attack(ZALOOG, "direct", attacker),
    ...(foes.length > 1 ? [pickOpponent(target, attacker)] : []),
    yes(attacker),
    choose(effect === "hand" ? "Discard 1 random card" : "Send the top 2 cards", attacker),
  ];
  const setup: Record<string, object> = { [target]: { hand: [ELF], deck: [ELF, ELF, ELF, ELF, ELF, ELF] } };
  for (const seat of SEATS[format]) if (seat !== target) setup[seat] = { ...(seat === attacker ? { monsters: [ZALOOG] } : {}), deck: [ELF, ELF, ELF, ELF, ELF, ELF] };
  return defineScenario({
    id: `don-zaloog-${format}-${attacker}-damages-${target}-${effect}-effect-hits-only-${target}`,
    title: `${label(format)}: ${attacker} attacks ${target} directly with Don Zaloog and the ${effect === "hand" ? "random discard" : "Deck effect"} hits ${target} only (no other seat loses a card)`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the opponent named by 1-tp is the duelist of the event`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "event-opponent", format, "card:76922029"],
    setup: baseSetup(format, setup as never),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

/**
 * Maxx "C" is a Quick Effect that opens a chain window for its holder in every phase, so the holder passes each window until the activator has the
 * turn: each turn transition has 5 windows (Main Phase 1 and End Phase of the seat that ends its turn, then Draw, Standby and Main Phase 1 of the next seat).
 * When the holder ends its own turn, it has 4 windows: its own Main Phase 1 has no response window.
 */
function windows(format: Format, activator: Seat, holder: Seat): Step[] {
  const n = 5;
  const own = 4;
  return turnsBefore(format, activator).flatMap((step) => [step, ...Array.from({ length: (step as { by: Seat }).by === holder ? own : n }, () => pass(holder))]);
}

const TAKER = "Soul Taker";
const MAXX = "Maxx \"C\"";
const REBORN = "Monster Reborn";
const sameSide = (format: Format, a: Seat, b: Seat): boolean => (format === "tag" ? team(a) === team(b) : a === b);

/** `user` activates Soul Taker on the monster of `target`: the monster of `target` is destroyed and the controller of that monster (only that duelist side) gains 1000 LP. */
function taker(format: Format, user: Seat, target: Seat): Scenario {
  const base = baseLp(format);
  const spec: Record<string, object> = {};
  for (const seat of SEATS[format]) {
    spec[seat] = { monsters: seat === target ? [] : [ELF], grave: seat === target ? [ELF] : [], spells: [] };
    // A Tag team shares one LP pool: the whole team of the controller gains 1000.
    if (sameSide(format, seat, target)) spec[seat] = { ...spec[seat], lp: base + 1000 };
  }
  spec[user] = { ...spec[user], grave: [TAKER] };
  const setup: Record<string, object> = {};
  for (const seat of SEATS[format]) setup[seat] = { monsters: [ELF] };
  setup[user] = { monsters: [ELF], hand: [TAKER] };
  return defineScenario({
    id: `soul-taker-${format}-${user}-destroys-monster-of-${target}-${target}-gains-1000`,
    title: `${label(format)}: ${user} activates Soul Taker on the monster of ${target}: ${target} (the controller, not another seat) gains 1000 LP`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the opponent named by 1-tp is the controller of the target`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "event-opponent", format, "card:81510157"],
    setup: baseSetup(format, setup as never),
    // R-COMMON-OPP-ONE: declare the target controller before selecting its monster.
    steps: [...turnsBefore(format, user), activate(TAKER, user), ...(format !== "tag" ? [pickOpponent(target, user)] : [select({ card: ELF, owner: target })]), everySeat(format, spec as never)],
  });
}

/** `activator` Special Summons with Monster Reborn; `holder` answers with Maxx "C" from the hand and draws 1 card (a duelist of another side) or none (the same side as the summoner). */
function maxx(format: Format, activator: Seat, holder: Seat): Scenario {
  const spec: Record<string, object> = {};
  for (const seat of SEATS[format]) spec[seat] = { hand: { count: drawn(seat, activator) }, monsters: [], grave: [] };
  const draws = sameSide(format, holder, activator) ? 0 : 1;
  spec[holder] = { ...spec[holder], hand: { count: drawn(holder, activator) + draws }, grave: [MAXX] };
  spec[activator] = { ...spec[activator], monsters: [ELF], grave: [REBORN] };
  if (holder === activator) spec[activator] = { ...spec[activator], grave: [REBORN, MAXX] };
  return defineScenario({
    id: `maxx-c-${format}-${activator}-special-summons-${holder}-${draws ? "draws" : "no-draw"}`,
    title: `${label(format)}: ${activator} Special Summons a monster and ${holder} activates Maxx "C": ${draws ? `${holder} draws 1 card` : `${holder} is on the side of the summoner and draws nothing`}, no other seat draws`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the opponent named by 1-tp is the duelist of the event`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "event-opponent", format, "card:23434538"],
    setup: baseSetup(format, { [activator]: { hand: [REBORN], grave: [ELF] }, [holder]: { hand: [MAXX] } } as never),
    steps: [
      ...windows(format, activator, holder),
      activate(REBORN, activator),
      auto(activator),
      expectOffered("activate", { card: MAXX, from: "hand" }, holder),
      activate({ card: MAXX, from: "hand" }, holder),
      choose("Monster Zone 5", activator),
      everySeat(format, spec as never),
    ],
  });
}

const VEILER = "Effect Veiler";
const IMPERMANENCE = "Infinite Impermanence";
const HOMUNCULUS = "Homunculus the Alchemic Being";
const CALCULATOR = "The Calculator";

/**
 * The holder is offered its Quick Effect in the Main Phase 1 of a turn of another side: at the click that ends the Main Phase of the turn player
 * (the holder passes the window of each earlier turn). Tag: the partner of the turn player is never offered.
 */
function mainWindows(format: Format, turnSeat: Seat, holder: Seat): Step[] {
  const order = SEATS[format];
  const offered = (seat: Seat): boolean => (format === "tag" ? team(seat) !== team(holder) : seat !== holder);
  const steps: Step[] = [];
  for (let i = 0; i < order.indexOf(turnSeat); i++) {
    const seat = order[i] as Seat;
    steps.push({ op: "phase", to: "end", by: seat } as Step);
    if (offered(seat)) steps.push(pass(holder));
  }
  return steps;
}

/**
 * The target Calculator loses its continuous ATK effect, including at a non-turn seat.
 * Every other Calculator keeps its ATK. The turn player's Homunculus keeps its ignition effect.
 */
function negate(format: Format, card: "veiler" | "impermanence", turnSeat: Seat, holder: Seat, target: Seat): Scenario {
  const name = card === "veiler" ? VEILER : IMPERMANENCE;
  const spec: Record<string, object> = {};
  const setup: Record<string, object> = {};
  for (const seat of SEATS[format]) {
    // Each pair is level 4 + level 2. Tag counts all face-up monsters on the own team.
    const pairs = SEATS[format].filter((s) => s !== holder && (format !== "tag" ? s === seat : team(s) === team(seat))).length;
    spec[seat] = {
      hand: { count: drawn(seat, turnSeat) }, monsters: seat === holder ? [] : [HOMUNCULUS, CALCULATOR], grave: [],
      ...(seat !== holder ? { zones: { m1: { card: CALCULATOR, attack: seat === target ? 0 : pairs * 1800 } } } : {}),
    };
    setup[seat] = seat === holder ? {} : { monsters: [HOMUNCULUS, CALCULATOR] };
  }
  spec[holder] = { ...spec[holder], grave: [name] };
  setup[holder] = card === "veiler" ? { hand: [VEILER] } : { spells: [faceDown(IMPERMANENCE)] };
  const steps: Step[] = [
    // A Set Trap (like Maxx "C") opens a chain window in every phase of every turn.
    ...(card === "veiler" ? mainWindows(format, turnSeat, holder) : windows(format, turnSeat, holder)),
    endTurn(turnSeat),
    expectOffered("activate", name, holder),
    activate(name, holder),
    // R-COMMON-OPP-ONE: declare the target controller before selecting its monster.
    ...(format !== "tag" ? [pickOpponent(target, holder)] : []),
    select({ card: CALCULATOR, owner: target }),
  ];
  for (const seat of SEATS[format]) {
    if (seat === holder || seat !== turnSeat) continue;
    // A different monster at the turn seat still resolves its ignition effect.
    steps.push(activate(HOMUNCULUS, seat));
    steps.push(expectPrompt({ by: seat, title: "Declare an Attribute" }), choose("attr:1", seat));
  }
  return defineScenario({
    id: `${card === "veiler" ? "effect-veiler" : "infinite-impermanence"}-${format}-${turnSeat}-turn-${holder}-negates-calculator-of-${target}`,
    title: `${label(format)}: ${holder} uses ${name} in the Main Phase of ${turnSeat} on The Calculator of ${target}: its ATK becomes 0, other Calculators keep their ATK and the turn player can use Homunculus`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the opponent named by 1-tp is any duelist of the other side`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "event-opponent", format, `card:${card === "veiler" ? 97268402 : 10045474}`],
    setup: baseSetup(format, setup as never),
    steps: [...steps, everySeat(format, spec as never)],
  });
}

/** Tag: the partner of the turn player holds Effect Veiler (and an opposing monster is a legal target): it is never offered during the turn of its own team. */
function veilerPartner(turnSeat: Seat, holder: Seat): Scenario {
  const spec: Record<string, object> = {};
  for (const seat of SEATS.tag) spec[seat] = { hand: { count: drawn(seat, "p1") + (seat === holder ? 1 : 0) }, monsters: [HOMUNCULUS] };
  return defineScenario({
    id: `effect-veiler-tag-${turnSeat}-turn-partner-${holder}-is-never-offered`,
    title: `Tag: ${holder} holds Effect Veiler in the turn of its partner ${turnSeat}: it is not offered, the turn of the opposing team starts and ${holder} keeps the card in hand`,
    source: `${SOURCE} [R-COMMON-SEAT-STATE] the opponent named by 1-tp is any duelist of the other side`,
    rules: ["R-COMMON-SEAT-STATE"],
    tags: ["multiplayer", "event-opponent", "tag", "card:97268402"],
    setup: baseSetup("tag", { p0: { monsters: [HOMUNCULUS] }, p1: { monsters: [HOMUNCULUS] }, p2: { monsters: [HOMUNCULUS], hand: [VEILER] }, p3: { monsters: [HOMUNCULUS] } }),
    steps: [endTurn(turnSeat), expectTurn("p1", 2), everySeat("tag", spec as never)],
  });
}

export const EVENT_BINDING_SCENARIOS: Scenario[] = [
  bribe("ffa3", "p1", "p2"), bribe("ffa3", "p1", "p0"), bribe("ffa4", "p2", "p0"), bribe("ffa4", "p2", "p3"),
  bribe("tag", "p1", "p0"), bribe("tag", "p1", "p2"), bribe("tag", "p0", "p3"), bribe("tag", "p0", "p1"),
  zaloog("ffa3", "p1", "p2", "deck"), zaloog("ffa3", "p1", "p0", "hand"), zaloog("ffa4", "p3", "p1", "deck"), zaloog("ffa4", "p2", "p0", "hand"),
  taker("ffa3", "p1", "p2"), taker("ffa3", "p1", "p0"), taker("ffa4", "p2", "p3"), taker("ffa4", "p3", "p1"),
  taker("tag", "p1", "p0"), taker("tag", "p1", "p2"), taker("tag", "p0", "p3"),
  maxx("ffa3", "p1", "p2"), maxx("ffa3", "p1", "p0"), maxx("ffa4", "p2", "p0"), maxx("ffa4", "p2", "p3"),
  maxx("tag", "p1", "p0"), maxx("tag", "p1", "p2"), maxx("tag", "p1", "p3"), maxx("tag", "p0", "p2"),
  negate("ffa3", "veiler", "p1", "p2", "p0"), negate("ffa3", "veiler", "p1", "p2", "p1"), negate("ffa3", "veiler", "p1", "p0", "p1"), negate("ffa4", "veiler", "p2", "p3", "p2"), negate("ffa4", "veiler", "p1", "p0", "p1"),
  negate("tag", "veiler", "p0", "p1", "p0"), negate("tag", "veiler", "p0", "p1", "p2"), negate("tag", "veiler", "p1", "p0", "p1"), negate("tag", "veiler", "p1", "p2", "p3"),
  negate("ffa3", "impermanence", "p1", "p2", "p0"), negate("ffa3", "impermanence", "p1", "p2", "p1"), negate("ffa4", "impermanence", "p2", "p0", "p2"),
  negate("tag", "impermanence", "p0", "p1", "p0"), negate("tag", "impermanence", "p0", "p3", "p2"), negate("tag", "impermanence", "p1", "p2", "p3"),
  veilerPartner("p0", "p2"),
  zaloog("tag", "p1", "p2", "deck"), zaloog("tag", "p0", "p3", "hand"), zaloog("tag", "p2", "p1", "hand"), zaloog("tag", "p3", "p0", "deck"),
];

// Live proofs of the R2 "no change" cards (scripts/generate-multi-scripts.ts, R2_NO_CHANGE) that no other file plays. The stock script of each card
// keeps a flag or a counter for a player in a global check (GlobalCheck, Duel.RegisterEffect(e,0)): the global effect sees REAL seats, and in Tag the
// flag is keyed by team. Every scenario shows that the card reads the flag of the right seat (or team) in FFA3 and in Tag (a holder of team 1 at
// least once), and ends with the state of EVERY seat. Plain data (scripts/rule-coverage.ts reads it); r2-nochange.test.ts runs it live.

import {
  activate, attack, auto, changePhase, choose, endTurn, expectBoard, expectNotOffered, expectOffered, expectPickSeats, expectPrompt, expectSeatNotOffered, expectTurn, faceDown, no,
  expectNoPrompt, changePosition, xyz, normalSummon, pass, pickOpponent, setCard, select, finish, specialSummon, yes, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
type Format = "ffa3" | "ffa4" | "tag";

const seatsOf = (format: Format): Seat[] => (format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"]);

function everySeat(format: Format, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const board: BoardExpect = {};
  for (const seat of seatsOf(format)) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const EACH = `${SOURCE} [R-COMMON-SEAT-STATE]`;

const probe = (format: Format, slug: string, card: number | number[], title: string, setup: Record<string, unknown>, steps: Step[], spec: Partial<Record<Seat, DuelistExpect>>, extraRules: string[] = []): Scenario =>
  defineScenario({
    id: `r2-nochange-${format}-${slug}`,
    title,
    source: EACH,
    rules: ["R-COMMON-SEAT-STATE", ...extraRules],
    tags: ["multiplayer", "r2-nochange", "no-change", format, ...(Array.isArray(card) ? card : [card]).map((c) => `card:${c}`)],
    setup: { format, ...setup } as unknown as Scenario["setup"],
    steps: [...steps, everySeat(format, spec)],
  });

const turns = (upTo: Seat[]): Step[] => upTo.map((seat) => endTurn(seat));

/** `count` direct attacks of `by`, each on the picked opponent `target`; the attackers are the first monsters of `by` (each attack uses up one). */
const attacks = (count: number, by: Seat, target: Seat): Step[] =>
  Array.from({ length: count }, () => [attack({ card: ELF, nth: 0 }, "direct", by), pickOpponent(target, by)]).flat();

/** 4 Special Summons of Quillbolt Hedgehog from the Graveyard by `by` (the 4th has one free zone left, so no zone prompt). */
const quills = (by: Seat): Step[] =>
  [0, 1, 2, 3].flatMap((n) => [activate({ card: QUILL, from: "grave", nth: 0 }, by), ...(n < 3 ? [auto(by)] : []), choose("Face-up Attack", by)]);

const ELF = "Mystical Elf";
const DM = "Dark Magician";
const SCAPEGOAT = "Scapegoat";
const BUMPKIN = "Undaunted Bumpkin Beast";
const TRIFORT = "Trifortressops";
const MONO = "Meteor Rush - Monochroid";
const RAIGEKI = "Raigeki";
const VOLCANO = "Jurrac Volcano";
const METEOR = "Jurrac Meteor";
const WATER = "Water Spirit"; // a vanilla Tuner: Quillbolt Hedgehog needs a Tuner on its field
const FLAME = "Flame Swordsman"; // a vanilla Fusion Monster
const BRIGHTEST = "Brightest, Blazing, Branded King";
const HIGH_SPIRITS = "Branded in High Spirits";
const LEON = "Gold Pride - Leon";
const PEDAL = "Gold Pride - Pedal to the Metal!";
const ADVANCE = "Ancient Gear Advance";
const CASTLE = "Ancient Gear Castle";
const LIBRARY = "Spellbook Library of the Heliosphere";
const BOOK = "Spellbook of Secrets";
const POT = "Pot of Greed";
const FLAVIAN = "Flavian - Colosseum of the Gladiator Beasts";
const RETIARI = "Gladiator Beast Retiari";
const CHARGE = "Gladiator Beast Charge";
const SKYBLASTER = "Phantom Skyblaster";
const TRIAL = "Trial and Tribulation";
const SKULL = "Summoned Skull";
const GAIA = "Gaia The Fierce Knight";
const PINNY = "Melffy Pinny";
const SAMNITE = "Gladiator Beast Samnite";
const CED = "Compulsory Evacuation Device";
const DOOMED = "Tribute to The Doomed";
const CROSS = "Final Cross";
const SCRAP = "Scrap Archfiend";
const RITUAL = "Numeron Chaos Ritual";
const BUG = "Man-Eater Bug";
const SUNYA = "Number C1: Numeron Chaos Gate Sunya";
const NETWORK = "Numeron Network";
const UTOPIA = "Number 39: Utopia";
const NUMERONIUS = "Number C1000: Numerounius";
const UNIFIED = "Unified Front";
const CARTESIA = "Blazing Cartesia, the Virtuous";
const SCREAMS = "Screams of the Branded";
const BURST = "Evolution Burst";
const CYBER = "Cyber Dragon";
const SACRIFICE = "Card of Sacrifice";
const BEACON = "Cyberse Beacon";
const GADGET = "Cyberse Gadget";
const SOUL = "Successor Soul";
const LEONIDAS = "D/D/D Rebel King Leonidas";
const OOKAZI = "Ookazi";
const EVOLUTION = "Pendulum Evolution";
const VENEMY = "Starving Venemy Dragon";
const RAINBOW = "Rainbow Dragon";
const OVERDRIVE = "Ultimate Crystal Rainbow Dragon Overdrive";
const BEASTS = ["Crystal Beast Sapphire Pegasus", "Crystal Beast Cobalt Eagle", "Crystal Beast Ruby Carbuncle", "Crystal Beast Amethyst Cat", "Crystal Beast Emerald Tortoise", "Crystal Beast Amber Mammoth", "Crystal Beast Topaz Tiger"];
const LV5 = "Armed Dragon LV5";
const LV7 = "Armed Dragon LV7";
const VW_TIGER = "VW-Tiger Catapult";
const XYZ_CANNON = "XYZ-Dragon Cannon";
const VWXYZ = "VWXYZ-Dragon Catapult Cannon";
const CATAPULT = "Armed Dragon Catapult Cannon";
const TYPHON = "Super Starslayer TY-PHON - Sky Crisis";
const DRAGONAR = "Number 99: Utopia Dragonar";
const UTOPIA39 = "Number 39: Utopia";
const HEART = "Heart of the Blue-Eyes";
const ANKH = "Millennium Ankh";
const INCARNATE = "The Unstoppable Exodia Incarnate";
const BEWD = "Blue-Eyes White Dragon";
const FORBIDDEN = ["Exodia the Forbidden One", "Left Arm of the Forbidden One", "Right Arm of the Forbidden One", "Left Leg of the Forbidden One", "Right Leg of the Forbidden One"];
const LEGACY = "Legacy of the Duelist";
const WHISKER = "Whisker Blitzclique";
const SURGE = "Surge Blitzclique";
const GRAIN = "Grain Blitzclique"; // a Thunder monster
const TELL = "D/D/D Marksman King Tell";
const POLY = "Polymerization";
const MANIPULATOR = "Flame Manipulator";
const MASAKI = "Masaki the Legendary Swordsman";
const CARNOT = "Carnot the Eternal Machine";
const SPIDER = "Link Spider";
const YOWIE = "Yowie";
const QUILL = "Quillbolt Hedgehog";
const BIDENT = "Sangenpai Bident Dragion";
const TRANSCENDENT = "Sangenpai Transcendent Dragion";

const SHEEP = { include: [73915052], count: 4 }; // the 4 Sheep Tokens of Scapegoat

/**
 * Sangenpai Bident Dragion 82570174 and Sangenpai Transcendent Dragion 18969888: the Quick Effect from the Graveyard needs "3 or more attacks declared this
 * turn" and adds the flags of the two folded players (Duel.GetFlagEffect(0,id)+Duel.GetFlagEffect(1,id)). The holder starts with the monster on the field
 * (a monster that starts in the Graveyard was never properly summoned and cannot return); Raigeki of the attacker destroys it, then the attacker declares
 * 3 direct attacks. The flags are those of the attacking seat (FFA3) or team (Tag), not of the holder.
 */
const dragion = (format: "ffa3" | "tag", card: number, name: string, answers: Step[], hits = 3): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p0";
  const attacker: Seat = tag ? "p0" : "p1";
  const target: Seat = tag ? "p1" : "p2";
  const before = tag ? turns(["p0", "p1", "p2", "p3"]) : turns(["p0", "p1", "p2", "p0"]);
  const setup: Record<string, unknown> = tag
    ? { p0: { hand: [RAIGEKI], monsters: [ELF, ELF, ELF], deck: [ELF, ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] }, p3: { monsters: [name], deck: [ELF, ELF] } }
    : { p0: { monsters: [name], deck: [ELF, ELF] }, p1: { hand: [RAIGEKI], monsters: [ELF, ELF, ELF], deck: [ELF, ELF] }, p2: { deck: [ELF, ELF] } };
  const lp = (tag ? 16000 : 8000) - hits * 800;
  const spec: Partial<Record<Seat, DuelistExpect>> = tag
    ? { p0: { monsters: [ELF, ELF, ELF], grave: [RAIGEKI] }, p1: { lp }, p3: { lp, monsters: [name] } }
    : { p0: { monsters: [name] }, p1: { monsters: [ELF, ELF, ELF], grave: [RAIGEKI] }, p2: { lp } };
  if (tag && name === TRANSCENDENT) {
    // MUST_ATTACK forces the replay into the newly revived 3000 ATK blocker.
    // The third attack is no longer direct: Elf is destroyed for 2200 damage.
    spec.p0 = { lp: 13800, monsters: [ELF, ELF], grave: [RAIGEKI, ELF] };
    spec.p2 = { lp: 13800 };
  }
  return probe(format, `${name.toLowerCase().replace(/ /g, "-")}-flag-of-${tag ? "team-0-serves-p3-of-team-1" : "p1-serves-p0"}`, card,
    `${tag ? "Tag" : "FFA3"}: ${attacker} destroys the ${name} of ${holder} with Raigeki and declares 3 direct attacks on ${target} (the attack flag is kept for the ${tag ? "team" : "seat"} of ${attacker}): the ${name} in the Graveyard of ${holder} is offered after the 3rd declaration and Special Summoned${tag ? name === TRANSCENDENT ? "; its forced replay destroys the attacking Elf" : "; the attacker cancels the replay into the revived blocker" : ""}`,
    setup,
    [...before, activate(RAIGEKI, attacker), changePhase("battle", attacker), ...attacks(3, attacker, target), expectOffered("activate", name, holder), activate(name, holder), ...answers],
    spec);
};

const dragions = (): Scenario[] => [
  dragion("ffa3", 82570174, BIDENT, [auto("p0"), yes("p1"), pickOpponent("p2", "p1")]),
  dragion("tag", 82570174, BIDENT, [pickOpponent("p0", "p3"), auto("p3"), no("p0")], 2),
  dragion("ffa3", 18969888, TRANSCENDENT, [auto("p0"), no("p0")], 2),
  dragion("tag", 18969888, TRANSCENDENT, [pickOpponent("p0", "p3"), auto("p3"), no("p3")], 2),
];

/**
 * Yowie 33393090: a global check keeps one flag per Special Summon EVENT for the event player `ep` (the real summoning seat; the team in Tag). The core raises
 * the event with ep = PLAYER_NONE for a Special Summon by an effect (the 2-player core too), so only summons by a procedure (here Link Summons of Link
 * Spider) are counted. The cost of the trigger needs Duel.GetFlagEffect(owner,id)<=1 and the lock "cannot Special Summon this turn" reads the same flag.
 * The holder (p0 in FFA3, p3 of team 1 in Tag) Link Summons `before` times, then Normal Summons Yowie: with 1 earlier summon Yowie is offered and then
 * locks the 2nd Link Summon, with 2 it is not offered.
 */
const yowie = (format: "ffa3" | "tag", before: 1 | 2): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p0";
  const lead = tag ? turns(["p0", "p1", "p2"]) : [];
  const link: Step[] = [specialSummon(SPIDER, holder), select({ card: ELF, nth: 0 })];
  const others: Partial<Record<Seat, unknown>> = { p0: { deck: [ELF, ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] } };
  delete others[holder];
  const setup = { ...others, [holder]: { monsters: [ELF, ELF], extra: [SPIDER, SPIDER], hand: [YOWIE], deck: [ELF, ELF] } };
  const common = `${tag ? "Tag" : "FFA3"}: ${holder} Link Summons Link Spider ${before} time${before > 1 ? "s" : ""} (one flag per summon for the ${tag ? "team" : "seat"} of ${holder}), then Normal Summons Yowie`;
  const field = [...Array(before).fill(SPIDER), ...Array(2 - before).fill(ELF)];
  if (before === 1) {
    return probe(format, `yowie-offered-after-1-link-summon-of-${holder}`, 33393090,
      `${common}: the Trigger Effect is offered and used; the lock of the flag then stops the 2nd Link Summon`,
      setup,
      [...lead, ...link, normalSummon(YOWIE, holder), auto(holder), yes(holder), expectNotOffered("specialSummon", SPIDER, holder)],
      { [holder]: { monsters: [...field, YOWIE], hand: tag ? [ELF] : [], grave: Array(before).fill(ELF) } });
  }
  return probe(format, `yowie-not-offered-after-2-link-summons-of-${holder}`, 33393090,
    `${common}: the flag is 2 and the cost fails, so Yowie is not offered (the next prompt is the action prompt of ${holder})`,
    setup,
    [...lead, ...link, ...link, normalSummon(YOWIE, holder), auto(holder), expectPrompt({ by: holder, context: "action" })],
    { [holder]: { monsters: [...field, YOWIE], hand: tag ? [ELF] : [], grave: Array(before).fill(ELF) } });
};

/**
 * Carnot the Eternal Machine 13567610: a global check keeps ONE permanent flag for the seat (the team in Tag) that activated a monster effect from the hand or
 * the Graveyard; the Special Summon procedure from the hand needs the flag of the opponent (Duel.HasFlagEffect(1-tp,id)). The flag is made by the Graveyard
 * effect of Quillbolt Hedgehog. In every format the activator itself and (Tag) its partner do not get the procedure, the opposing duelists do, in their own turn.
 */
const carnot = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const wake: Step[] = [activate({ card: QUILL, from: "grave", nth: 0 }, "p0"), auto("p0"), choose("Face-up Attack", "p0")];
  const deck = { deck: [ELF, ELF] };
  const setup = tag
    ? { p0: { hand: [CARNOT], monsters: [WATER], grave: [QUILL], ...deck }, p1: { hand: [CARNOT], ...deck }, p2: { hand: [CARNOT], ...deck }, p3: { hand: [CARNOT], ...deck } }
    : { p0: { hand: [CARNOT], monsters: [WATER], grave: [QUILL], ...deck }, p1: { hand: [CARNOT], ...deck }, p2: { hand: [CARNOT], ...deck } };
  const steps: Step[] = tag
    ? [
        expectNotOffered("specialSummon", CARNOT, "p0"), ...wake, expectNotOffered("specialSummon", CARNOT, "p0"), endTurn("p0"),
        expectOffered("specialSummon", CARNOT, "p1"), specialSummon(CARNOT, "p1"), endTurn("p1"),
        expectNotOffered("specialSummon", CARNOT, "p2"), endTurn("p2"),
        expectOffered("specialSummon", CARNOT, "p3"), specialSummon(CARNOT, "p3"),
      ]
    : [
        expectNotOffered("specialSummon", CARNOT, "p0"), ...wake, expectNotOffered("specialSummon", CARNOT, "p0"), endTurn("p0"),
        expectOffered("specialSummon", CARNOT, "p1"), specialSummon(CARNOT, "p1"), endTurn("p1"),
        expectOffered("specialSummon", CARNOT, "p2"), specialSummon(CARNOT, "p2"),
      ];
  const spec: Partial<Record<Seat, DuelistExpect>> = tag
    ? { p0: { monsters: [WATER, QUILL], hand: [CARNOT] }, p1: { monsters: [CARNOT], hand: [ELF] }, p2: { hand: [CARNOT, ELF] }, p3: { monsters: [CARNOT], hand: [ELF] } }
    : { p0: { monsters: [WATER, QUILL], hand: [CARNOT] }, p1: { monsters: [CARNOT], hand: [ELF] }, p2: { monsters: [CARNOT], hand: [ELF] } };
  return probe(format, `carnot-flag-of-the-activator-serves-the-opposing-${tag ? "team" : "seats"}`, 13567610,
    tag
      ? "Tag: p0 activates a monster effect from the Graveyard (Quillbolt Hedgehog): the flag is kept for team 0, so Carnot is not offered to p0 or to the partner p2 but is offered to p1 and p3 of team 1 in their own turns and Special Summoned from the hand"
      : "FFA3: p0 activates a monster effect from the Graveyard (Quillbolt Hedgehog): Carnot is not offered to p0 itself, is offered to p1 and to p2 in their own turns and Special Summoned from the hand",
    setup, steps, spec);
};

/**
 * The 3 cards of a "fusion monster goes to the Graveyard" flag (Brightest, Blazing, Branded King 19271881, Branded in High Spirits 29948294) and of a
 * "Gold Pride monster is destroyed" flag (Gold Pride - Pedal to the Metal! 27275398) share one shape: a global check keeps a flag for the controller (or the
 * previous controller) of the monster, and the card in the Graveyard reads Duel.HasFlagEffect(tp,id) in the End Phase. Raigeki of p0 destroys the monster
 * of the holder; a second duelist keeps the same card in the Graveyard with no monster of its own and must not be offered it.
 */
const graveFlag = (format: "ffa3" | "tag", card: number, name: string, monster: string, action: Step[], spec: (holder: Seat, other: Seat) => Partial<Record<Seat, DuelistExpect>>): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p2";
  const other: Seat = tag ? "p2" : "p1";
  const setup: Record<string, unknown> = { p0: { hand: [RAIGEKI], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] } };
  if (tag) setup.p3 = { deck: [ELF] };
  setup[holder] = { monsters: [monster], grave: [name], deck: [ELF] };
  setup[other] = { ...(setup[other] as object), grave: [name] };
  return probe(format, `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/-$/, "")}-flag-of-${holder}-only`, card,
    `${tag ? "Tag" : "FFA3"}: Raigeki of p0 destroys the ${monster} of ${holder}, so the flag is kept for ${tag ? "team 1" : holder}; in the End Phase ${name} in the Graveyard of ${holder} is offered, the same card in the Graveyard of ${other} (no flag) is not`,
    setup,
    [activate(RAIGEKI, "p0"), changePhase("end", "p0"), ...action],
    spec(holder, other));
};

const graveFlags = (): Scenario[] => [
  ...(["ffa3", "tag"] as const).flatMap((format) => [
    graveFlag(format, 19271881, BRIGHTEST, FLAME, [expectOffered("activate", BRIGHTEST, format === "tag" ? "p3" : "p2"), activate(BRIGHTEST, format === "tag" ? "p3" : "p2")],
      (holder, other) => ({ p0: { grave: [RAIGEKI] }, [other]: { grave: [BRIGHTEST] }, [holder]: { grave: [FLAME], hand: [BRIGHTEST] } })),
    graveFlag(format, 29948294, HIGH_SPIRITS, FLAME, [yes(format === "tag" ? "p3" : "p2")],
      (holder, other) => ({ p0: { grave: [RAIGEKI] }, [other]: { grave: [HIGH_SPIRITS] }, [holder]: { grave: [FLAME], hand: [HIGH_SPIRITS] } })),
    graveFlag(format, 95515789, CARTESIA, FLAME, [yes(format === "tag" ? "p3" : "p2")],
      (holder, other) => ({ p0: { grave: [RAIGEKI] }, [other]: { grave: [CARTESIA] }, [holder]: { grave: [FLAME], hand: [CARTESIA] } })),
    graveFlag(format, 27275398, PEDAL, LEON, [yes(format === "tag" ? "p3" : "p2")],
      (holder, other) => ({ p0: { grave: [RAIGEKI] }, [other]: { grave: [PEDAL] }, [holder]: { grave: [LEON], spells: [PEDAL] } })),
  ]),
];

/** The holder of a "first turn of the holder" scenario: p2 in FFA3 (turn 3, then turn 6), p3 of team 1 in Tag (turn 4, then turn 8) and the turns before. */
const twoTurns = (format: "ffa3" | "tag") => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p2";
  const first: Step[] = tag ? turns(["p0", "p1", "p2"]) : turns(["p0", "p1"]);
  const between: Step[] = tag ? turns(["p3", "p0", "p1", "p2"]) : turns(["p2", "p0", "p1"]);
  return { tag, holder, first, between };
};

/**
 * Ancient Gear Advance 4064925: a global check keeps one flag for the seat (the team in Tag) that Set a monster, a Spell or a Trap, turned a monster face-down or
 * Special Summoned a face-down monster this turn; the Spell cannot be activated while Duel.HasFlagEffect(tp,id). The holder Sets a monster in its first turn
 * (Advance is not offered), the flag ends with the turn, and in its next turn Advance is offered and searches an Ancient Gear Spell.
 */
const advance = (format: "ffa3" | "tag"): Scenario => {
  const { tag, holder, first, between } = twoTurns(format);
  const filler = { deck: [ELF, ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  setup[holder] = { hand: [ADVANCE, ELF], deck: [ELF, ELF, CASTLE] };
  return probe(format, `ancient-gear-advance-not-offered-after-a-set-of-${holder}`, 4064925,
    `${tag ? "Tag" : "FFA3"}: ${holder} Sets a monster (the flag is kept for the ${tag ? "team" : "seat"} of ${holder}), so Ancient Gear Advance is not offered; in the next turn of ${holder} the flag is gone and Advance is offered and searches Ancient Gear Castle`,
    setup,
    [...first, setCard({ card: ELF, nth: 0 }, holder), expectNotOffered("activate", ADVANCE, holder), ...between, expectOffered("activate", ADVANCE, holder), activate(ADVANCE, holder), auto(holder)],
    { [holder]: { monsters: [ELF], hand: [ELF, ELF, CASTLE], spells: [ADVANCE] } });
};

/**
 * Spellbook Library of the Heliosphere 20822520: a global check keeps a flag for the seat (the team in Tag) that activated a Spell that is not a Spellbook; the
 * cost needs Duel.GetFlagEffect(tp,id+1)==0. The holder (5 Spellbook Spells in the Graveyard) activates Pot of Greed in its first turn (the Library is not
 * offered), and in its next turn the Library is offered and adds the Spellbook of the top 2 cards of the Deck.
 */
const library = (format: "ffa3" | "tag"): Scenario => {
  const { tag, holder, first, between } = twoTurns(format);
  const filler = { deck: [ELF, ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  setup[holder] = { hand: [POT, LIBRARY], grave: [BOOK, BOOK, BOOK, BOOK, BOOK], deck: [ELF, ELF, ELF, ELF, BOOK, ELF, ELF] };
  return probe(format, `spellbook-library-heliosphere-not-offered-after-a-spell-of-${holder}`, 20822520,
    `${tag ? "Tag" : "FFA3"}: ${holder} activates Pot of Greed (a Spell that is not a Spellbook: the flag is kept for the ${tag ? "team" : "seat"} of ${holder}), so Spellbook Library of the Heliosphere is not offered; in the next turn of ${holder} it is offered and adds the Spellbook from the top of the Deck`,
    setup,
    [...first, activate(POT, holder), expectNotOffered("activate", LIBRARY, holder), ...between, expectOffered("activate", LIBRARY, holder), activate(LIBRARY, holder), auto(holder)],
    { [holder]: { hand: [ELF, ELF, ELF, ELF, BOOK], grave: [POT, LIBRARY, BOOK, BOOK, BOOK, BOOK, BOOK] } });
};

/**
 * Flavian, Colosseum of the Gladiator Beasts 5063379: a global check keeps a flag for the PREVIOUS controller of a Gladiator Beast Special Summoned from the Deck;
 * the End Phase effect needs Duel.HasFlagEffect(tp,id). p0 attacks the holder directly, the holder Special Summons Retiari from the Deck with the attack trigger
 * (the flag is kept for the holder), the attack is cancelled, and in the End Phase the holder is offered Flavian and Sets Gladiator Beast Charge. The attacker
 * has no flag and no Flavian, and the other seats are untouched.
 */
const flavian = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p1";
  const before: Step[] = tag ? turns(["p0", "p1", "p2", "p3"]) : turns(["p0", "p1", "p2"]);
  const filler = { deck: [ELF, ELF] };
  const setup: Record<string, unknown> = { p0: { monsters: [ELF], deck: [ELF, ELF] }, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  setup[holder] = { field: FLAVIAN, deck: [ELF, RETIARI, CHARGE, ELF] };
  return probe(format, `flavian-set-of-${holder}-after-a-deck-summon`, 5063379,
    `${tag ? "Tag" : "FFA3"}: p0 attacks ${holder} directly, ${holder} Special Summons Gladiator Beast Retiari from the Deck with Flavian (flag kept for ${holder}), the attack is cancelled, and in the End Phase ${holder} is offered Flavian and Sets Gladiator Beast Charge`,
    setup,
    [...before, changePhase("battle", "p0"), attack({ card: ELF, nth: 0 }, "direct", "p0"), pickOpponent(holder, "p0"), yes(holder), auto(holder), no("p0"),
      changePhase("end", "p0"), yes(holder)],
    { [holder]: { monsters: [RETIARI], spells: [FLAVIAN, CHARGE], hand: tag ? [ELF] : [ELF, ELF] }, p0: { monsters: [ELF] } });
};

/**
 * Phantom Skyblaster 12958919: its Standby Phase damage effect has the cost Duel.GetFlagEffect(tp,id)==0 (the flag is kept for the controller of a Skyblaster
 * that declared an attack, and lasts to the End Phase). The holder starts its own turn with a Skyblaster, so the flag is 0, the effect is offered in its Standby
 * Phase and the picked opponent takes 300 damage (in Tag the opposing team takes it: both members show the shared pool); the other seats keep their Life Points.
 */
const skyblaster = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const holder: Seat = "p1";
  const before: Step[] = turns(["p0"]);
  const filler = { deck: [ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  setup[holder] = { monsters: [SKYBLASTER], deck: [ELF, ELF] };
  return probe(format, `phantom-skyblaster-standby-damage-of-${holder}`, 12958919,
    `${tag ? "Tag" : "FFA3"}: ${holder} controls Phantom Skyblaster, no Skyblaster attacked yet, so in its Standby Phase the damage effect is offered and resolves`,
    setup,
    [...before, yes(holder), ...(tag ? [] : [pickOpponent("p0", holder)])],
    tag ? { [holder]: { monsters: [SKYBLASTER], hand: [ELF] }, p0: { lp: 15700 }, p2: { lp: 15700 } } : { [holder]: { monsters: [SKYBLASTER], hand: [ELF] }, p0: { lp: 7700 } });
};

/**
 * Trial and Tribulation 26285788: a global check keeps a flag for the reason player of each Tributed monster; the End Phase effect (registered by the holder) reads
 * Duel.GetFlagEffect(tp,id): 1 Tribute draws 1 card, 2 Tributes return 2 monsters from the Graveyard to the hand. The holder activates the Spell, then Tribute Summons
 * (1 Tribute of Summoned Skull, or 2 Tributes of Gaia the Fierce Knight); the other seats Tribute nothing and are untouched.
 */
const trial = (format: "ffa3" | "tag", tributes: 1 | 2): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p2";
  const first: Step[] = tag ? turns(["p0", "p1", "p2"]) : turns(["p0", "p1"]);
  const filler = { deck: [ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  const big = tributes === 1 ? SKULL : GAIA;
  setup[holder] = { hand: [TRIAL, big], monsters: Array(tributes).fill(ELF), deck: [ELF, ELF, ELF] };
  return probe(format, `trial-and-tribulation-${tributes}-tribute-of-${holder}`, 26285788,
    `${tag ? "Tag" : "FFA3"}: ${holder} activates Trial and Tribulation, then Tribute Summons ${big} with ${tributes} Tribute${tributes === 2 ? "s" : ""}; in the End Phase the flag counts ${tributes}, so ${holder} ${tributes === 1 ? "draws 1 card" : "returns the 2 Tributed monsters to the hand"}`,
    setup,
    [...first, activate(TRIAL, holder), normalSummon(big, holder), select(...Array.from({ length: tributes }, () => ({ card: ELF, nth: 0 }))), changePhase("end", holder)],
    { [holder]: { monsters: [big], grave: tributes === 1 ? [TRIAL, ELF] : [TRIAL], hand: tributes === 1 ? [ELF, ELF] : [ELF, ELF, ELF] } });
};

/**
 * "Own action first" probes: the holder starts with the card NOT offered (its flag is 0), makes the action that the global check counts for the holder, and
 * then the card is offered and resolves. Melffy Pinny 34800281 (a face-up Beast of the holder returned to the hand: flag for the previous controller; Compulsory
 * Evacuation Device on the own Gladiator Beast Samnite) and Final Cross 35756798 (a Synchro Monster of the holder sent to the Graveyard: flag for its controller;
 * Tribute to the Doomed on one Scrap Archfiend; the second Scrap Archfiend gets the extra attack).
 */
const ownAction = (format: "ffa3" | "tag", kind: "pinny" | "cross"): Scenario => {
  const tag = format === "tag";
  // Pinny: p0 in its first turn (the Set Trap of the holder would open a chain window in the turns before). Final Cross needs the Battle Phase, which a seat has only after its first turn: p1 in turn 5 (FFA3) or p3 of team 1 in turn 4 (Tag).
  const holder: Seat = kind === "pinny" ? "p0" : tag ? "p3" : "p1";
  const first: Step[] = kind === "pinny" ? [] : tag ? turns(["p0", "p1", "p2"]) : turns(["p0", "p1", "p2", "p0"]);
  const filler = { deck: [ELF, ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  if (kind === "pinny") {
    setup[holder] = { hand: [PINNY], monsters: [SAMNITE], spells: [{ card: CED, pos: "set" }], deck: [ELF, ELF, ELF] };
    return probe(format, `melffy-pinny-after-a-beast-bounce-of-${holder}`, 34800281,
      `${tag ? "Tag" : "FFA3"}: ${holder} controls a Beast and holds Melffy Pinny (not offered: flag 0); Compulsory Evacuation Device returns the Beast (flag kept for ${tag ? "team 1" : holder}), then Pinny is offered to ${holder} and is Special Summoned`,
      setup,
      [...first, expectNotOffered("activate", PINNY, holder), activate(CED, holder), expectOffered("activate", PINNY, holder), activate(PINNY, holder), auto(holder)],
      { [holder]: { monsters: [PINNY], hand: [SAMNITE], grave: [CED] } });
  }
  setup[holder] = { hand: [CROSS, DOOMED, ELF], monsters: [SCRAP, SCRAP], deck: [ELF, ELF, ELF] };
  return probe(format, `final-cross-after-a-synchro-to-grave-of-${holder}`, 35756798,
    `${tag ? "Tag" : "FFA3"}: ${holder} controls 2 Synchro Monsters and holds Final Cross (not offered: flag 0); Tribute to the Doomed destroys a Synchro of the holder (flag kept for ${tag ? "team 1" : holder}), then Final Cross is offered to ${holder} and gives the other Synchro a second attack`,
    setup,
    [...first, expectNotOffered("activate", CROSS, holder), activate(DOOMED, holder), select(ELF), select({ card: SCRAP, nth: 0 }), expectOffered("activate", CROSS, holder), activate(CROSS, holder), auto(holder)],
    { [holder]: { monsters: [SCRAP], hand: tag ? [ELF] : [ELF, ELF], grave: [SCRAP, DOOMED, ELF, CROSS] } });
};

/**
 * Numeron Chaos Ritual 41850466: a global check keeps a flag for the previous controller of a face-up Number C1: Numeron Chaos Gate Sunya that a MONSTER effect
 * destroyed; the Spell needs Duel.GetFlagEffect(tp,id)>0. The holder (Network and 4 Numbers in the Graveyard, Numeron C1000 in the Extra Deck) flips Man-Eater Bug,
 * which destroys the own Sunya: the Spell is not offered before, is offered after, and Special Summons Number C1000 with the 5 targets as Xyz Material.
 */
const numeron = (format: "ffa3" | "tag"): Scenario => {
  const { tag, holder, first } = twoTurns(format);
  const filler = { deck: [ELF, ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  setup[holder] = { hand: [RITUAL], monsters: [{ card: BUG, pos: "set" }, SUNYA], grave: [NETWORK, UTOPIA, UTOPIA, UTOPIA, UTOPIA], extra: [NUMERONIUS], deck: [ELF, ELF, ELF] };
  return probe(format, `numeron-chaos-ritual-after-sunya-destroyed-by-a-monster-of-${holder}`, 41850466,
    `${tag ? "Tag" : "FFA3"}: ${holder} holds Numeron Chaos Ritual (not offered: flag 0); Man-Eater Bug flips and destroys the own Number C1: Numeron Chaos Gate Sunya (flag kept for ${tag ? "team 1" : holder}), then the Spell is offered to ${holder} and Special Summons Number C1000: Numerounius`,
    setup,
    [...first, expectNotOffered("activate", RITUAL, holder), changePosition({ card: BUG }, holder), select(SUNYA), expectOffered("activate", RITUAL, holder), activate(RITUAL, holder), auto(holder), auto(holder), auto(holder), ...(tag ? [pickOpponent("p0", holder)] : [])],
    { [holder]: { monsters: [BUG, NUMERONIUS], hand: [ELF], grave: [UTOPIA, RITUAL] } });
};

const unified = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const attacker = tag ? "Jinzo #7" : ELF;
  const UFSET = { card: UNIFIED, pos: "set" };
  const setup: Record<string, unknown> = { p0: { monsters: [attacker, ELF], spells: [UFSET], hand: [DM], deck: [ELF, ELF, ELF] }, p1: { monsters: [DM], spells: [UFSET], hand: [ELF], deck: [ELF, ELF, ELF] }, p2: { deck: [ELF, ELF] } };
  if (tag) setup.p3 = { deck: [ELF, ELF] };
  // Set traps open a chain window for their owner at every phase change, in the turn of every seat, so the passes are part of the line.
  const ffa3Steps: Step[] = [
    endTurn("p0"), pass("p1"), pass("p0"), pass("p1"), pass("p1"), pass("p0"), pass("p1"), pass("p0"), pass("p1"), pass("p0"), endTurn("p1"),
    pass("p0"), pass("p1"), pass("p0"), pass("p0"), pass("p1"), pass("p0"), pass("p1"), pass("p0"), pass("p1"), endTurn("p2"), pass("p0"), pass("p1"),
    pass("p0"), pass("p1"), pass("p0"), pass("p1"), pass("p0"), pass("p1"), pass("p0"), pass("p1"), changePhase("battle", "p0"), pass("p1"),
    expectOffered("activate", UNIFIED, "p0"), pass("p0"), pass("p1"), attack({ card: ELF, nth: 0 }, "direct", "p0"), pickOpponent("p2", "p0"),
    expectOffered("activate", UNIFIED, "p1"), pass("p1"), pass("p1"), pass("p1"), pass("p1"), expectNotOffered("activate", UNIFIED, "p0"),
  ];
  const tagSteps: Step[] = [
    endTurn("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    endTurn("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    endTurn("p2"),
    pass("p1"),
    pass("p0"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    endTurn("p3"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    pass("p0"),
    pass("p1"),
    changePhase("battle", "p0"),
    pass("p1"),
    expectOffered("activate", UNIFIED, "p0"),
    pass("p0"),
    pass("p1"),
    attack(attacker, "direct", "p0"),
    yes("p0"),
    pickOpponent("p1", "p0"),
    expectOffered("activate", UNIFIED, "p1"),
    pass("p1"),
    pass("p1"),
    pass("p1"),
    pass("p1"),
    expectNotOffered("activate", UNIFIED, "p0"),
  ];
  const steps = tag ? tagSteps : ffa3Steps;
  const hit: Seat = tag ? "p1" : "p2";
  const spec: Partial<Record<Seat, DuelistExpect>> = { p0: { monsters: [attacker, ELF], spells: [UNIFIED] }, p1: { monsters: [DM], spells: [UNIFIED] } };
  spec[hit] = { ...spec[hit], lp: tag ? 15500 : 7200 };
  if (tag) spec.p3 = { lp: 15500 };
  return probe(format, "unified-front-direct-attack-flag-p0", 31472884,
    `${tag ? "Tag" : "FFA3"}: p0 and p1 each control a Set Unified Front; p0 attacks directly${tag ? " with Jinzo #7's card-granted effect" : ""} (the flag is kept for ${tag ? "team 0" : "p0"}): the Set Unified Front of p0 is offered before the attack and not after it, the Set Unified Front of p1 is offered in the Damage Step`,
    setup, steps, spec);
};

const yowies = (): Scenario[] => [yowie("ffa3", 1), yowie("ffa3", 2), yowie("tag", 1), yowie("tag", 2)];

/** Batch of "own turn" probes: the holder is p1 (team 1 in Tag). `late` holders have a Battle Phase (p1 in turn 5 in FFA3, p3 in turn 4 in Tag). */
const holderOf = (format: "ffa3" | "tag", late: boolean) => {
  const tag = format === "tag";
  const holder: Seat = late && tag ? "p3" : "p1";
  const first: Step[] = !late ? turns(["p0"]) : tag ? turns(["p0", "p1", "p2"]) : turns(["p0", "p1", "p2", "p0"]);
  const filler = { deck: [ELF, ELF, ELF, ELF] };
  const setup: Record<string, unknown> = { p0: filler, p1: filler, p2: filler };
  if (tag) setup.p3 = filler;
  return { tag, holder, first, setup, label: tag ? "Tag" : "FFA3" };
};

/**
 * Screams of the Branded 67100549 is a Trap: it needs Duel.GetFlagEffect(tp,id)>0 (a Fusion Monster of the holder went to the Graveyard this turn: flag for
 * its controller). Raigeki of p0 destroys the Flame Swordsman of the holder; the Set trap of the holder is then offered and Special Summons it from the
 * Graveyard. A second duelist has the same Set trap and a Fusion Monster in its Graveyard but no flag: it is not offered.
 */
const screams = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p3" : "p2";
  const other: Seat = tag ? "p2" : "p1";
  const setup: Record<string, unknown> = { p0: { hand: [RAIGEKI], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] } };
  if (tag) setup.p3 = { deck: [ELF] };
  setup[holder] = { monsters: [FLAME], spells: [{ card: SCREAMS, pos: "set" }], deck: [ELF] };
  setup[other] = { ...(setup[other] as object), spells: [{ card: SCREAMS, pos: "set" }], grave: [FLAME] };
  return probe(format, `screams-of-the-branded-flag-of-${holder}-only`, 67100549,
    `${tag ? "Tag" : "FFA3"}: Raigeki of p0 destroys the Flame Swordsman of ${holder} (flag kept for ${tag ? "team 1" : holder}); the Set Screams of the Branded of ${holder} is offered and Special Summons it from the Graveyard`,
    setup,
    [activate(RAIGEKI, "p0"), expectOffered("activate", SCREAMS, holder), activate(SCREAMS, holder)],
    { p0: { grave: [RAIGEKI] }, [other]: { spells: [SCREAMS], grave: [FLAME] }, [holder]: { monsters: [FLAME], grave: [SCREAMS] } });
};

/**
 * Card of Sacrifice 88513608 is a Trap: a global check keeps a flag for rp (the duelist that changes a battle position by hand); the cost needs
 * not Duel.HasFlagEffect(tp,id). The holder keeps it Set with 3 Attack Position Mystical Elf (2400 ATK in all) against the Dark Magician of p0 (2500 ATK).
 * Without a position change the Set trap is offered at the End Phase window of the holder and draws 2 cards; after the holder changed the position of one Elf by hand
 * (flag of the holder, in Tag of team 1) no window opens for it at the same phase change.
 */
/** Windows that the Set trap of the holder opens in the turn of p0 and in the Draw, Standby and Main steps before the holder can act. */
const PASSES = 5;
const sacrifice = (format: "ffa3" | "tag", changed: boolean): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, false);
  setup[holder] = { spells: [{ card: SACRIFICE, pos: "set" }], monsters: [ELF, ELF, ELF], deck: [ELF, ELF, ELF, ELF] };
  setup.p0 = { monsters: [DM], deck: [ELF, ELF, ELF, ELF] };
  const steps: Step[] = changed
    ? [...first, ...Array.from({ length: PASSES }, () => pass(holder)), changePosition({ card: ELF, nth: 0 }, holder), changePhase("end", holder)]
    : [...first, ...Array.from({ length: PASSES }, () => pass(holder)), changePhase("end", holder), expectOffered("activate", SACRIFICE, holder), activate(SACRIFICE, holder)];
  const spec: Partial<Record<Seat, DuelistExpect>> = changed
    ? { p0: { monsters: [DM] }, [holder]: { spells: [SACRIFICE], monsters: [ELF, ELF, ELF], hand: [ELF] } }
    : { p0: { monsters: [DM] }, [holder]: { grave: [SACRIFICE], monsters: [ELF, ELF, ELF], hand: [ELF, ELF, ELF] } };
  return probe(format, `card-of-sacrifice-${changed ? "not-offered-after-a-position-change" : "offered-without-a-position-change"}-of-${holder}`, 88513608,
    changed
      ? `${label}: ${holder} changes the position of one Elf by hand (flag of ${tag ? "team 1" : holder}); its Set Card of Sacrifice gets no window at the End Phase change`
      : `${label}: ${holder} keeps a Set Card of Sacrifice with 3 Attack Position Elf (2400 ATK) against the Dark Magician of p0 (2500 ATK): it is offered at the End Phase window and draws 2 cards`,
    setup, steps, spec);
};

/**
 * Cyberse Beacon 91269402 is a Trap: a global check keeps a flag for ep (the duelist that took battle damage or damage from an opponent's card effect); the
 * condition reads Duel.GetFlagEffect(tp,id)~=0. Ookazi of p0 burns one duelist: the Set Cyberse Beacon of that duelist is offered and adds Cyberse Gadget from the
 * Deck; a second duelist with the same Set trap that did not take the damage is not offered it (in Tag the flag is the one of the team of the damaged duelist).
 */
const beacon = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p1" : "p2";
  const other: Seat = tag ? "p2" : "p1";
  const set = { spells: [{ card: BEACON, pos: "set" }], deck: [GADGET, ELF] };
  const setup: Record<string, unknown> = { p0: { hand: [OOKAZI], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] } };
  if (tag) setup.p3 = { deck: [ELF] };
  setup[holder] = set;
  setup[other] = set;
  const lp = tag ? 15200 : 7200;
  const spec: Partial<Record<Seat, DuelistExpect>> = {
    p0: { grave: [OOKAZI] }, [other]: { spells: [BEACON] },
    [holder]: { lp, grave: [BEACON], hand: [GADGET] },
  };
  if (tag) spec.p3 = { lp };
  return probe(format, `cyberse-beacon-damage-flag-of-${holder}-only`, 91269402,
    `${tag ? "Tag" : "FFA3"}: Ookazi of p0 burns ${holder} (flag kept for ${tag ? "team 1" : holder}); the Set Cyberse Beacon of ${holder} is offered and adds Cyberse Gadget, the same Set trap of ${other} (no damage taken${tag ? ", team 0" : ""}) is not offered`,
    setup,
    [activate(OOKAZI, "p0"), ...(tag ? [] : [pickOpponent(holder, "p0")]), expectOffered("activate", BEACON, holder), activate(BEACON, holder)],
    spec);
};

/**
 * Successor Soul 69145169: a global check keeps a flag for the controller of an attacker (label = field id of the first attacker, 0 once a second monster
 * attacked); the cost needs no flag or label ~= 0. The holder (an Elf and a second Elf, Man-Eater Bug to Tribute, Dark Magician in the hand) attacks the Man-Eater Bug
 * of p0 with ONE monster and is offered the Quick-Play Spell; after a SECOND monster attacked it is not offered.
 */
const soul = (format: "ffa3" | "tag", attackers: 1 | 2): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, true);
  setup[holder] = { hand: [SOUL, DM, BUG], monsters: [ELF, ELF], deck: [ELF, ELF, ELF, ELF] };
  setup.p0 = { monsters: attackers === 1 ? [BUG] : [BUG, BUG], deck: [ELF, ELF, ELF, ELF] };
  const ready: Step[] = [...first, normalSummon(BUG, holder), pass(holder), changePhase("battle", holder), pass(holder)];
  const hit = attack({ card: ELF, nth: 0 }, { card: BUG, owner: "p0" }, holder);
  const steps: Step[] = attackers === 1
    ? [...ready, hit, expectOffered("activate", SOUL, holder), activate(SOUL, holder)]
    : [...ready, hit, expectOffered("activate", SOUL, holder), pass(holder), pass(holder), hit, changePhase("main2", holder)];
  const spec: Partial<Record<Seat, DuelistExpect>> = attackers === 1
    ? { p0: { grave: [BUG] }, [holder]: { monsters: [ELF, ELF, DM], grave: [BUG, SOUL], hand: tag ? [ELF] : [ELF, ELF] } }
    : { p0: { lp: tag ? 15300 : 7300, grave: [BUG, BUG] }, [holder]: { monsters: [ELF, ELF, BUG], hand: tag ? [SOUL, DM, ELF] : [SOUL, DM, ELF, ELF] } };
  if (attackers === 2 && tag) spec.p2 = { lp: 15300 };
  return probe(format, `successor-soul-${attackers === 1 ? "offered-after-one-attacker" : "not-offered-after-two-attackers"}-of-${holder}`, 69145169,
    `${label}: ${holder} attacks with ${attackers} monster${attackers === 1 ? "" : "s"} (flag of ${tag ? "team 1" : holder}); Successor Soul is ${attackers === 1 ? "offered, Tributes the Man-Eater Bug, sends the Bug of p0 to the Graveyard and Special Summons Dark Magician" : "offered at the first attack and not at the second"}`,
    setup, steps, spec);
};

/**
 * D/D/D Rebel King Leonidas 92536468: a global check keeps a flag for ep (RESET_CHAIN) and the hand effect reads ep==tp and r&REASON_EFFECT. Ookazi of p0 burns
 * one duelist (800): its Leonidas in the hand triggers (optional, `yes`), is Special Summoned and the 800 LP come back, so the LP is unchanged. A second duelist
 * with Leonidas in the hand that took no damage (in Tag the duelist of team 0) gets no trigger.
 */
const leonidas = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p1" : "p2";
  const other: Seat = tag ? "p2" : "p1";
  const setup: Record<string, unknown> = { p0: { hand: [OOKAZI], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] } };
  if (tag) setup.p3 = { deck: [ELF] };
  setup[holder] = { hand: [LEONIDAS], deck: [ELF] };
  setup[other] = { hand: [LEONIDAS], deck: [ELF] };
  return probe(format, `d-d-d-rebel-king-leonidas-hand-effect-of-${holder}-only`, 92536468,
    `${tag ? "Tag" : "FFA3"}: Ookazi of p0 burns ${holder}: Leonidas in the hand of ${holder} triggers and is Special Summoned (800 LP back), the Leonidas in the hand of ${other} (no damage taken) does not trigger`,
    setup,
    [activate(OOKAZI, "p0"), ...(tag ? [] : [pickOpponent(holder, "p0")]), expectOffered("activate", LEONIDAS, holder), activate(LEONIDAS, holder), auto(holder)],
    { p0: { grave: [OOKAZI] }, [other]: { hand: [LEONIDAS] }, [holder]: { monsters: [LEONIDAS] } });
};

/**
 * D/D/D Marksman King Tell 71612253: a global check keeps a flag for ep (the duelist that took effect damage); the Quick Effect needs
 * Duel.GetFlagEffect(tp,id)~=0. Ookazi of p0 burns one duelist: the Tell of that duelist is offered, detaches a material, shrinks a monster and burns an opponent;
 * the same Tell of a second duelist that took no damage (in Tag a duelist of team 0) is not offered it.
 */
const tell = (format: "ffa3" | "tag"): Scenario => {
  const tag = format === "tag";
  const holder: Seat = tag ? "p1" : "p2";
  const other: Seat = tag ? "p2" : "p1";
  const DIVINE_WRATH = "Divine Wrath";
  const setup: Record<string, unknown> = { p0: { hand: [OOKAZI], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] } };
  if (tag) setup.p3 = { deck: [ELF] };
  setup[holder] = { monsters: [xyz(TELL, [ELF, ELF])], deck: [ELF] };
  // Divine Wrath can respond to Tell, but not to Ookazi. Its discard stays in hand because this seat passes.
  setup[other] = { hand: [ELF], monsters: [xyz(TELL, [ELF, ELF])], spells: [faceDown(DIVINE_WRATH)], deck: [ELF] };
  return probe(format, `d-d-d-marksman-king-tell-damage-flag-of-${holder}-only`, 71612253,
    `${tag ? "Tag" : "FFA3"}: Ookazi of p0 burns ${holder} (flag kept for ${tag ? "team 1" : holder}); the Tell of ${other} (no damage taken) is not offered in response before the Tell of ${holder} resolves, shrinks the Tell of ${other}, and burns ${tag ? "team 0" : other} for 1000`,
    setup,
    [activate(OOKAZI, "p0"), ...(tag ? [] : [pickOpponent(holder, "p0")]), expectOffered("activate", TELL, holder), activate(TELL, holder),
      // R-COMMON-OPP-PICK (ADR:18): declare before the detach cost. The target can be on either field; only damage goes to the declared opponent.
      ...(tag ? [] : [expectPickSeats(["p0", "p1"], holder), pickOpponent(other, holder)]), select(ELF), select({ card: TELL, owner: other }),
      expectPrompt({ by: other, context: "chain" }), expectOffered("activate", DIVINE_WRATH, other),
      expectBoard({ [other]: { lp: tag ? 16000 : 8000 } }),
      expectSeatNotOffered("activate", { card: TELL, owner: other }, other), pass(other)],
    tag
      ? { p0: { lp: 15000, grave: [OOKAZI] }, p1: { lp: 15200, grave: [ELF], monsters: [TELL] }, p2: { lp: 15000, hand: [ELF], monsters: [TELL], spells: [DIVINE_WRATH] }, p3: { lp: 15200 } }
      : { p0: { lp: 8000, grave: [OOKAZI] }, p1: { lp: 7000, hand: [ELF], monsters: [TELL], spells: [DIVINE_WRATH], zones: { m0: { card: TELL, attack: 1300, materials: 2 } } }, p2: { lp: 7200, grave: [ELF], monsters: [TELL], zones: { m0: { card: TELL, attack: 2300, materials: 1 } } } },
    ["R-COMMON-OPP-PICK"]);
};

/**
 * Whisker Blitzclique 85523502: a global check keeps a flag for rp (the duelist whose "Blitzclique" card destroyed a card by effect); the Quick Effect from the hand
 * needs Duel.HasFlagEffect(tp,id). The holder reveals Surge Blitzclique to destroy the Dark Magician of p0 (flag of the holder, in Tag of team 1), then its Whisker
 * Blitzclique is offered and Special Summons a Thunder monster from the hand. A second duelist with the same Whisker and a Thunder monster in the hand is not offered it.
 */
const whisker = (format: "ffa3" | "tag"): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, false);
  const other: Seat = holder === "p1" ? "p2" : "p1";
  setup[holder] = { hand: [SURGE, WHISKER, GRAIN, GRAIN], deck: [ELF, ELF, ELF] };
  setup[other] = { ...(setup[other] as object), hand: [WHISKER, GRAIN] };
  setup.p0 = { monsters: [DM], deck: [ELF, ELF, ELF, ELF] };
  return probe(format, `whisker-blitzclique-destroy-flag-of-${holder}-only`, 85523502,
    `${label}: ${holder} reveals Surge Blitzclique to destroy the Dark Magician of p0 (flag of ${tag ? "team 1" : holder}); the Whisker Blitzclique in the hand of ${holder} is offered and Special Summons a Thunder monster, the Whisker in the hand of ${other} (no flag) is not offered`,
    setup,
    [...first, activate(SURGE, holder), select(GRAIN), expectOffered("activate", WHISKER, holder), activate(WHISKER, holder), select(GRAIN), no(holder)],
    { p0: { grave: [DM] }, [other]: { hand: [WHISKER, GRAIN] }, [holder]: { monsters: [GRAIN, GRAIN], hand: [SURGE, WHISKER, ELF] } });
};

/**
 * Legacy of the Duelist 88851326 (accepted deviation, see R2_ACCEPTED_DEVIATIONS: in FFA the Set flag of one opponent locks every opponent for the rest of the turn,
 * which cannot be seen because a duelist Sets in its own turn): a global check keeps a flag for rp on a Set from the hand; the Set lock of the controller reads the own
 * flag, the Set lock of the opponents reads the flag of 1-controller. Legacy is on the field of p0. A duelist (p0 itself, or the opponent) Sets one card from the
 * hand and is then not offered a second Set; the first Set is allowed (so the lock is the flag of the one that Set).
 */
const legacy = (format: "ffa3" | "tag", own: boolean): Scenario => {
  const { holder: opp, first, setup, label, tag } = holderOf(format, true);
  const holder: Seat = own ? "p0" : opp;
  setup.p0 = { spells: [LEGACY], deck: [ELF, ELF, ELF, ELF], ...(own ? { hand: [POT, POT] } : {}) };
  if (!own) setup[opp] = { hand: [POT, POT], deck: [ELF, ELF, ELF, ELF] };
  const steps: Step[] = [...(own ? [] : first), setCard(POT, holder), expectNotOffered("set", POT, holder)];
  return probe(format, `legacy-of-the-duelist-second-set-of-${own ? "the-controller" : "an-opponent"}-${holder}-is-locked`, 88851326,
    `${label}: Legacy of the Duelist on the field of p0; ${own ? "p0 (the controller)" : `${holder} (an opponent${tag ? ", team 1" : ""})`} Sets one card from the hand (flag of ${tag && holder !== "p0" ? "team 1" : holder}) and is not offered a second Set`,
    setup, steps, { p0: { spells: own ? [LEGACY, POT] : [LEGACY] }, ...(own ? {} : { [holder]: { spells: [POT], hand: tag ? [ELF, POT] : [ELF, ELF, POT] } }) });
};

/**
 * Heart of the Blue-Eyes 54475145: a global check keeps a flag for rp (the duelist that activated Millennium Ankh, once per Duel, reset 0); the Graveyard effect needs
 * Duel.HasFlagEffect(tp,id) and a Level 8 or higher monster that the opponent summons. The holder activates Millennium Ankh in its turn; later the next seat
 * Tribute Summons Blue-Eyes White Dragon: the Dragon goes to the Graveyard and the Heart of the holder is Special Summoned. In FFA3 a second Heart in the
 * Graveyard of p0 (no Ankh, so no flag) is not offered; in Tag the flag is the one of team 1.
 */
const heart = (format: "ffa3" | "tag"): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, false);
  const summoner: Seat = "p2";
  setup[holder] = { hand: [ANKH, FORBIDDEN[0]], monsters: FORBIDDEN.slice(1), extra: [INCARNATE], grave: [HEART], deck: [ELF, ELF, ELF] };
  setup[summoner] = { hand: [BEWD], monsters: [ELF, ELF], deck: [ELF, ELF, ELF] };
  if (!tag) setup.p0 = { ...(setup.p0 as object), grave: [HEART] };
  return probe(format, `heart-of-the-blue-eyes-ankh-flag-of-${holder}${tag ? "" : "-only"}`, 54475145,
    `${label}: ${holder} activates Millennium Ankh (flag of ${tag ? "team 1" : holder}); ${summoner} Tribute Summons Blue-Eyes White Dragon: the Heart in the Graveyard of ${holder} sends the Dragon to the Graveyard and is Special Summoned${tag ? "" : "; the Heart in the Graveyard of p0 (no Ankh) is not offered"}`,
    setup,
    [...first, activate(ANKH, holder), endTurn(holder), normalSummon(BEWD, summoner), select({ card: ELF, nth: 0 }, { card: ELF, nth: 0 }),
      yes(holder)],
    { [holder]: { monsters: [HEART, INCARNATE] }, [summoner]: { grave: [ELF, ELF, BEWD] }, ...(tag ? {} : { p0: { grave: [HEART] } }) });
};

const dragonar = (format: "ffa3" | "tag", self: boolean): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, true);
  setup[holder] = { monsters: [xyz(DRAGONAR, [ELF, ELF, ELF]), ELF], extra: [UTOPIA39], deck: [ELF, ELF, ELF, ELF] };
  // the quick effect of Dragonar opens a chain window for the holder at every phase of the turns before: pass them (counted per turn)
  const windows = tag ? [5, 5, 5] : [5, 4, 5, 5];
  const toTurn = first.flatMap((st, k) => [st, ...Array.from({ length: windows[k] }, () => pass(holder))]);
  const dmg = self ? 3000 : 800;
  const victim: Step[] = [pickOpponent("p0", holder)];
  const steps: Step[] = self
    ? [...toTurn, changePhase("battle", holder), pass(holder), attack({ card: DRAGONAR }, "direct", holder), ...victim,
      expectOffered("activate", DRAGONAR, holder), activate(DRAGONAR, holder), select({ card: ELF, nth: 0 }, { card: ELF, nth: 1 })]
    : [...toTurn, expectOffered("activate", DRAGONAR, holder), changePhase("battle", holder), pass(holder), attack({ card: ELF }, "direct", holder), ...victim,
      changePhase("main2", holder), expectNotOffered("activate", DRAGONAR, holder)];
  const lp = (tag ? 16000 : 8000) - dmg;
  return probe(format, `number-99-utopia-dragonar-${self ? "own" : "other-monster"}-direct-attack-of-${holder}`, 95134948,
    `${label}: ${holder} attacks directly with ${self ? "Dragonar itself (the flag of the duelist is the own flag of Dragonar): its effect is offered at the attack, detaches 2 and Special Summons Number 39: Utopia" : "another monster (a flag of the duelist that is not the own flag of Dragonar): Dragonar is offered in the Main Phase 1 before and not in the Main Phase 2 after"}`,
    setup, steps,
    { p0: { lp: tag ? lp : lp }, ...(tag ? { p2: { lp } } : {}), [holder]: self ? { monsters: [DRAGONAR, ELF, UTOPIA39], grave: [ELF, ELF] } : { monsters: [DRAGONAR, ELF] } });
};

const typhon = (format: "ffa3" | "tag", twice: boolean): Scenario => {
  const { holder, setup, label, tag } = holderOf(format, false);
  setup.p0 = {
    hand: twice ? [POLY, POLY] : [POLY], monsters: twice ? [MANIPULATOR, MASAKI, MANIPULATOR, MASAKI] : [MANIPULATOR, MASAKI],
    extra: twice ? [FLAME, FLAME] : [FLAME], deck: [ELF, ELF, ELF, ELF],
  };
  setup[holder] = { monsters: [ELF], extra: [TYPHON], deck: [ELF, ELF, ELF, ELF] };
  const fuse = (pick: boolean): Step[] => [activate(POLY, "p0"), ...(pick ? [select(FLAME)] : []), select(MANIPULATOR, MASAKI)];
  const steps: Step[] = [...fuse(twice), ...(twice ? fuse(false) : []), endTurn("p0"), twice ? expectOffered("specialSummon", TYPHON, holder) : expectNotOffered("specialSummon", TYPHON, holder)];
  return probe(format, `ty-phon-flag-of-${twice ? "two" : "one"}-extra-deck-summon-of-p0-for-${holder}`, 93039339,
    `${label}: p0 Fusion Summons ${twice ? "twice" : "once"} from the Extra Deck in its turn; in the next turn ${holder} is ${twice ? "" : "not "}offered the alternative Xyz Summon of TY-PHON`,
    setup, twice ? [...steps, specialSummon(TYPHON, holder)] : steps,
    {
      p0: { monsters: twice ? [FLAME, FLAME] : [FLAME], grave: twice ? [POLY, MANIPULATOR, MASAKI, POLY, MANIPULATOR, MASAKI] : [POLY, MANIPULATOR, MASAKI] },
      [holder]: twice ? { monsters: [TYPHON] } : { monsters: [ELF] },
    });
};

const catapult = (format: "ffa3" | "tag"): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, true);
  const negative: Seat = "p0";
  setup[negative] = { monsters: [ELF, VWXYZ, LV7], extra: [CATAPULT], deck: [ELF, ELF, ELF, ELF] };
  setup[holder] = { monsters: [LV5, VW_TIGER, XYZ_CANNON], extra: [VWXYZ, CATAPULT], deck: [LV7, ELF, ELF, ELF] };
  const steps: Step[] = [
    ...first, changePhase("battle", holder), attack({ card: LV5 }, { card: ELF, owner: "p0" }, holder), endTurn(holder), yes(holder),
    ...(tag ? [] : [endTurn("p2")]),
    expectNotOffered("specialSummon", CATAPULT, negative), endTurn(negative),
    ...(tag ? [endTurn("p1"), endTurn("p2")] : []),
    specialSummon(VWXYZ, holder), select(VW_TIGER, XYZ_CANNON), expectOffered("specialSummon", CATAPULT, holder), specialSummon(CATAPULT, holder), select(VWXYZ, LV7),
  ];
  return probe(format, `armed-dragon-catapult-cannon-flags-of-${holder}-not-of-${negative}`, 75906310,
    `${label}: ${holder} destroys a monster with Armed Dragon LV5, Special Summons LV7 at the End Phase and Special Summons VWXYZ-Dragon Catapult Cannon (both flags of ${tag ? "team 1" : holder}); in the next turn Armed Dragon Catapult Cannon is offered to ${holder} and is not offered to ${negative} (VWXYZ and LV7 on its field by setup: no flag)`,
    setup, steps,
    {
      // the Elf of p0 is destroyed by the battle (1600 damage: the team LP in Tag)
      p0: { lp: tag ? 14400 : 6400, monsters: [VWXYZ, LV7], grave: [ELF] }, ...(tag ? { p2: { lp: 14400 } } : {}),
      [holder]: { monsters: [CATAPULT], grave: [LV5], banished: [VW_TIGER, XYZ_CANNON, LV7, VWXYZ] },
    });
};

const overdrive = (format: "ffa3" | "tag"): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, false);
  const negative: Seat = "p0";
  setup[negative] = { monsters: [RAINBOW], grave: BEASTS, extra: [OVERDRIVE], deck: [ELF, ELF, ELF, ELF] };
  setup[holder] = { hand: [RAINBOW], grave: BEASTS, extra: [OVERDRIVE], deck: [ELF, ELF, ELF, ELF] };
  const steps: Step[] = [
    expectNotOffered("specialSummon", OVERDRIVE, negative), ...first,
    specialSummon(RAINBOW, holder), expectOffered("specialSummon", OVERDRIVE, holder), specialSummon(OVERDRIVE, holder), select(RAINBOW, ...BEASTS),
  ];
  return probe(format, `ultimate-crystal-rainbow-dragon-overdrive-flag-of-${holder}-not-of-${negative}`, 84544192,
    `${label}: ${holder} Special Summons Rainbow Dragon from the hand (flag of ${tag ? "team 1" : holder}) and is offered the contact Fusion Summon of Overdrive; ${negative} has Rainbow Dragon on the field by setup and 7 Crystal Beasts in the Graveyard (no Special Summon, no flag) and is not offered it`,
    setup, steps, { [holder]: { monsters: [OVERDRIVE], banished: [RAINBOW, ...BEASTS] }, p0: { monsters: [RAINBOW], grave: BEASTS } });
};

const evolution = (format: "ffa3" | "tag"): Scenario => {
  const { holder, first, setup, label, tag } = holderOf(format, false);
  const negative: Seat = "p0";
  setup[negative] = { hand: [EVOLUTION, DM], pendulum: ["Stargazer Magician", "Timegazer Magician"], deck: [ELF, ELF, ELF, ELF] };
  setup[holder] = { hand: [EVOLUTION, POLY, LEONIDAS, DM, ELF], pendulum: ["Stargazer Magician", "Timegazer Magician"], extra: [VENEMY], deck: [ELF, ELF, ELF, ELF] };
  const steps: Step[] = [
    activate(EVOLUTION, negative), expectNotOffered("activate", { card: EVOLUTION, effect: "Pendulum Summon" }, negative), ...first,
    activate(EVOLUTION, holder), expectNotOffered("activate", { card: EVOLUTION, effect: "Pendulum Summon" }, holder), activate(POLY, holder), select(LEONIDAS, DM), expectOffered("activate", { card: EVOLUTION, effect: "Pendulum Summon" }, holder), activate({ card: EVOLUTION, effect: "Pendulum Summon" }, holder), select(ELF),
  ];
  return probe(format, `pendulum-evolution-flag-of-${holder}-not-of-${negative}`, 55795155,
    `${label}: ${holder} Fusion Summons the Pendulum Monster Starving Venemy Dragon from the Extra Deck (flag of ${tag ? "team 1" : holder}): its Pendulum Summon effect of Pendulum Evolution is offered after the summon and not before; ${negative} has the same face-up Spell and no flag: not offered`,
    setup, steps, {
      [holder]: { monsters: [VENEMY, ELF], spells: [EVOLUTION, "Stargazer Magician", "Timegazer Magician"], grave: [LEONIDAS, DM, POLY] },
      p0: { hand: [DM], spells: [EVOLUTION, "Stargazer Magician", "Timegazer Magician"] },
    });
};

/**
 * Evolution Burst 52875873: a global check keeps a flag for the controller of an attacking Cyber Dragon; the cost needs Duel.GetFlagEffect(tp,id)==0. The holder is
 * offered the Spell before its Cyber Dragon attacks and is not offered it in the Main Phase 2 after the attack.
 */
const burst = (format: "ffa3" | "tag"): Scenario => {
  const { holder, first, setup, label } = holderOf(format, true);
  setup[holder] = { hand: [BURST], monsters: [CYBER], deck: [ELF, ELF, ELF] };
  setup.p0 = { spells: [{ card: POT, pos: "set" }], deck: [ELF, ELF, ELF, ELF] };
  const tag = format === "tag";
  return probe(format, `evolution-burst-not-offered-after-a-cyber-dragon-attack-of-${holder}`, 52875873,
    `${label}: ${holder} is offered Evolution Burst before its Cyber Dragon attacks; the attack (direct, on p0) keeps the flag for ${tag ? "team 1" : holder}, so the Spell is not offered in the Main Phase 2`,
    setup,
    [...first, expectOffered("activate", BURST, holder), attack({ card: CYBER }, "direct", holder), pickOpponent("p0", holder), changePhase("main2", holder), expectNotOffered("activate", BURST, holder)],
    { p0: { lp: tag ? 13900 : 5900, spells: [POT] }, ...(tag ? { p2: { lp: 13900 } } : {}), [holder]: { monsters: [CYBER], hand: tag ? [BURST, ELF] : [BURST, ELF, ELF] } });
};

export const R2_NOCHANGE_SCENARIOS: Scenario[] = [
  probe("ffa3", "bumpkin-offered-after-3-special-summons-of-an-opponent", 8700633,
    "FFA3: p2 Special Summons 4 Sheep Tokens with Scapegoat (the flag is kept for the seat of p2); in the Main Phase of p2 the Undaunted Bumpkin Beast of p0 is offered and Special Summoned, the Bumpkin of p2 itself stays in the hand",
    { p0: { hand: [BUMPKIN], deck: [ELF, ELF] }, p1: { deck: [ELF, ELF] }, p2: { hand: [SCAPEGOAT, BUMPKIN], deck: [ELF] } },
    [endTurn("p0"), endTurn("p1"), activate(SCAPEGOAT, "p2"), changePhase("end", "p2"), expectOffered("activate", BUMPKIN, "p0"), activate(BUMPKIN, "p0"), auto("p0")],
    { p0: { monsters: [BUMPKIN] }, p2: { hand: [BUMPKIN, ELF], grave: [SCAPEGOAT], monsters: SHEEP } }),
  probe("tag", "bumpkin-flag-of-the-opposing-team-serves-the-partner-p3", 8700633,
    "Tag: p0 Special Summons 4 Sheep Tokens with Scapegoat (the flag is kept for team 0); the Undaunted Bumpkin Beast of p3 (team 1) is offered and Special Summoned, the Bumpkin of the partner p2 of the summoner stays in the hand",
    { p0: { hand: [SCAPEGOAT], deck: [ELF] }, p1: { deck: [ELF] }, p2: { hand: [BUMPKIN], deck: [ELF] }, p3: { hand: [BUMPKIN], deck: [ELF, ELF] } },
    [activate(SCAPEGOAT, "p0"), expectOffered("activate", BUMPKIN, "p3"), activate(BUMPKIN, "p3"), pickOpponent("p0", "p3"), auto("p3")],
    { p0: { monsters: SHEEP, grave: [SCAPEGOAT] }, p2: { hand: [BUMPKIN] }, p3: { monsters: [BUMPKIN] } }),
  probe("ffa3", "trifortressops-offered-to-p2-after-3-summons-of-p0", 12275533,
    "FFA3: p0 Special Summons 4 Sheep Tokens with Scapegoat (flag of the seat of p0); Trifortressops of p2 is offered and Special Summoned",
    { p0: { hand: [SCAPEGOAT], deck: [ELF] }, p1: { deck: [ELF] }, p2: { hand: [TRIFORT], deck: [ELF, ELF] } },
    [activate(SCAPEGOAT, "p0"), expectOffered("activate", TRIFORT, "p2"), activate(TRIFORT, "p2"), auto("p2")],
    { p0: { monsters: SHEEP, grave: [SCAPEGOAT] }, p2: { monsters: [TRIFORT] } }),
  probe("tag", "trifortressops-flag-of-team-1-serves-the-opposing-team-0", 12275533,
    "Tag: p1 Special Summons 4 Sheep Tokens with Scapegoat in its turn (flag of team 1); Trifortressops of p2 (team 0) is offered and Special Summoned, the Trifortressops of the partner p3 of the summoner stays in the hand",
    { p0: { deck: [ELF] }, p1: { hand: [SCAPEGOAT], deck: [ELF] }, p2: { hand: [TRIFORT], deck: [ELF, ELF] }, p3: { hand: [TRIFORT], deck: [ELF] } },
    [endTurn("p0"), activate(SCAPEGOAT, "p1"), expectOffered("activate", TRIFORT, "p2"), activate(TRIFORT, "p2"), auto("p2")],
    { p1: { monsters: SHEEP, grave: [SCAPEGOAT] }, p2: { monsters: [TRIFORT] }, p3: { hand: [TRIFORT] } }),
  // Meteor Rush - Monochroid: the Battle Phase condition adds the attack flags of both folded players (Duel.GetFlagEffect(0,id)+Duel.GetFlagEffect(1,id))
  probe("ffa3", "monochroid-offered-to-p2-after-5-attacks-of-p0-on-p1", 99748883,
    "FFA3: p0 declares 5 direct attacks (all on p1): the flag of the attacker seat counts all 5 and the Meteor Rush - Monochroid of p2 is offered only after the 5th; p2 Special Summons it",
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF], deck: [ELF] }, p1: { deck: [ELF] }, p2: { hand: [MONO], deck: [ELF, ELF] } },
    [...turns(["p0", "p1", "p2"]), changePhase("battle", "p0"), ...attacks(5, "p0", "p1"), expectOffered("activate", MONO, "p2"), activate(MONO, "p2"), auto("p2"), yes("p0"), pickOpponent("p1", "p0")],
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p1: { lp: 4000 }, p2: { monsters: [MONO] } }),
  probe("tag", "monochroid-flag-of-team-0-serves-p3-of-team-1", 99748883,
    "Tag: p0 declares 5 direct attacks on team 1 (the attack flag is kept for team 0): the Meteor Rush - Monochroid of p3 (team 1) is offered after the 5th and Special Summoned; p0 cancels the replay into the revived blocker",
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] }, p3: { hand: [MONO], deck: [ELF, ELF] } },
    [...turns(["p0", "p1", "p2", "p3"]), changePhase("battle", "p0"), ...attacks(5, "p0", "p1"), expectOffered("activate", MONO, "p3"), activate(MONO, "p3"), pickOpponent("p0", "p3"), auto("p3"), no("p0")],
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p1: { lp: 12800 }, p3: { lp: 12800, monsters: [MONO] } }),
  ...dragions(),
  // Jurrac Volcano: the Trigger Effect needs "4 or more monster effects activated by the opponent this turn" (Duel.GetFlagEffect(1-tp,id)>=4)
  probe("ffa3", "volcano-flag-of-p1-serves-p0-and-p2", 89948817,
    "FFA3: p1 activates 4 monster effects (Quillbolt Hedgehog from its Graveyard, flag of the seat of p1): the 4th Special Summon makes the Jurrac Volcano of p2 and then the one of p0 offer their Trigger Effects, each Synchro Summons a Jurrac Meteor (its effect then destroys the other cards of the field, so each Meteor and each Volcano ends in the Graveyard, the Tuner in the Graveyard and the 4 Quillbolt Hedgehogs banished); the first 3 summons offer nothing",
    { p0: { field: VOLCANO, extra: [METEOR], deck: [ELF, ELF] }, p1: { monsters: [WATER], grave: [QUILL, QUILL, QUILL, QUILL], deck: [ELF, ELF] }, p2: { field: VOLCANO, extra: [METEOR], deck: [ELF, ELF] } },
    [endTurn("p0"), ...quills("p1"), yes("p2"), activate(VOLCANO, "p0")],
    { p0: { grave: [METEOR, VOLCANO] }, p1: { grave: [WATER], banished: [QUILL, QUILL, QUILL, QUILL] }, p2: { grave: [METEOR, VOLCANO] } }),
  probe("tag", "volcano-flag-of-team-0-serves-p3-of-team-1", 89948817,
    "Tag: p0 activates 4 monster effects (the flag is kept for team 0): the Jurrac Volcano of p3 (team 1) offers its Trigger Effect after the 4th Special Summon and Synchro Summons a Jurrac Meteor (the Meteor then destroys the other cards, so the Volcano of p2 ends in the Graveyard too, with no offer to p2)",
    { p0: { monsters: [WATER], grave: [QUILL, QUILL, QUILL, QUILL], deck: [ELF, ELF] }, p1: { deck: [ELF] }, p2: { field: VOLCANO, extra: [METEOR], deck: [ELF] }, p3: { field: VOLCANO, extra: [METEOR], deck: [ELF, ELF] } },
    [...quills("p0"), yes("p3"), auto("p3")],
    { p0: { grave: [WATER], banished: [QUILL, QUILL, QUILL, QUILL] }, p2: { grave: [VOLCANO] }, p3: { grave: [METEOR, VOLCANO] } }),
  ...yowies(),
  unified("ffa3"),
  unified("tag"),
  numeron("ffa3"),
  numeron("tag"),
  ownAction("ffa3", "pinny"),
  ownAction("tag", "pinny"),
  ownAction("ffa3", "cross"),
  ownAction("tag", "cross"),
  flavian("ffa3"),
  flavian("tag"),
  skyblaster("ffa3"),
  skyblaster("tag"),
  trial("ffa3", 1),
  trial("tag", 1),
  trial("ffa3", 2),
  trial("tag", 2),
  advance("ffa3"),
  advance("tag"),
  library("ffa3"),
  library("tag"),
  ...graveFlags(),
  carnot("ffa3"),
  carnot("tag"),
  screams("ffa3"),
  screams("tag"),
  burst("ffa3"),
  burst("tag"), sacrifice("ffa3", false), sacrifice("ffa3", true), sacrifice("tag", false), sacrifice("tag", true), beacon("ffa3"), beacon("tag"), soul("ffa3", 1), soul("ffa3", 2), soul("tag", 1), soul("tag", 2), leonidas("ffa3"), leonidas("tag"), tell("ffa3"), tell("tag"), whisker("ffa3"), whisker("tag"), legacy("ffa3", true), legacy("ffa3", false), legacy("tag", true), legacy("tag", false), heart("ffa3"), heart("tag"), dragonar("ffa3", true), dragonar("ffa3", false), dragonar("tag", true), dragonar("tag", false), typhon("ffa3", true), typhon("ffa3", false), typhon("tag", true), typhon("tag", false), catapult("ffa3"), catapult("tag"), overdrive("ffa3"), overdrive("tag"), evolution("ffa3"), evolution("tag"),
];

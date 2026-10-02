// Live proofs of the R2 "no change" cards (scripts/generate-multi-scripts.ts, R2_NO_CHANGE) that no other file plays. The stock script of each card
// keeps a flag or a counter for a player in a global check (GlobalCheck, Duel.RegisterEffect(e,0)): the global effect sees REAL seats, and in Tag the
// flag is keyed by team. Every scenario shows that the card reads the flag of the right seat (or team) in FFA3 and in Tag (a holder of team 1 at
// least once), and ends with the state of EVERY seat. Plain data (scripts/rule-coverage.ts reads it); r2-nochange.test.ts runs it live.

import {
  activate, attack, auto, changePhase, choose, defineScenario, endTurn, expectBoard, expectNotOffered, expectOffered, expectPrompt, expectTurn, faceDown, no,
  expectNoPrompt, normalSummon, pickOpponent, setCard, select, finish, specialSummon, yes, zone,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
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

const probe = (format: Format, slug: string, card: number | number[], title: string, setup: Record<string, unknown>, steps: Step[], spec: Partial<Record<Seat, DuelistExpect>>): Scenario =>
  defineScenario({
    id: `r2-nochange-${format}-${slug}`,
    title,
    source: EACH,
    rules: ["R-COMMON-SEAT-STATE"],
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
  return probe(format, `${name.toLowerCase().replace(/ /g, "-")}-flag-of-${tag ? "team-0-serves-p3-of-team-1" : "p1-serves-p0"}`, card,
    `${tag ? "Tag" : "FFA3"}: ${attacker} destroys the ${name} of ${holder} with Raigeki and declares 3 direct attacks on ${target} (the attack flag is kept for the ${tag ? "team" : "seat"} of ${attacker}): the ${name} in the Graveyard of ${holder} is offered after the 3rd attack and Special Summoned`,
    setup,
    [...before, activate(RAIGEKI, attacker), changePhase("battle", attacker), ...attacks(3, attacker, target), expectOffered("activate", name, holder), activate(name, holder), ...answers],
    spec);
};

const dragions = (): Scenario[] => [
  dragion("ffa3", 82570174, BIDENT, [auto("p0"), yes("p1"), yes("p1")]),
  dragion("tag", 82570174, BIDENT, [pickOpponent("p0", "p3"), auto("p3"), yes("p0"), yes("p0")]),
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

const yowies = (): Scenario[] => [yowie("ffa3", 1), yowie("ffa3", 2), yowie("tag", 1), yowie("tag", 2)];

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
    [...turns(["p0", "p1", "p2"]), changePhase("battle", "p0"), ...attacks(5, "p0", "p1"), expectOffered("activate", MONO, "p2"), activate(MONO, "p2"), auto("p2"), yes("p0"), yes("p0")],
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p1: { lp: 4000 }, p2: { monsters: [MONO] } }),
  probe("tag", "monochroid-flag-of-team-0-serves-p3-of-team-1", 99748883,
    "Tag: p0 declares 5 direct attacks on team 1 (the attack flag is kept for team 0): the Meteor Rush - Monochroid of p3 (team 1) is offered after the 5th and Special Summoned",
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF], deck: [ELF] }, p1: { deck: [ELF] }, p2: { deck: [ELF] }, p3: { hand: [MONO], deck: [ELF, ELF] } },
    [...turns(["p0", "p1", "p2", "p3"]), changePhase("battle", "p0"), ...attacks(5, "p0", "p1"), expectOffered("activate", MONO, "p3"), activate(MONO, "p3"), pickOpponent("p0", "p3"), auto("p3"), yes("p0"), yes("p0")],
    { p0: { monsters: [ELF, ELF, ELF, ELF, ELF] }, p1: { lp: 12000 }, p3: { lp: 12000, monsters: [MONO] } }),
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
];

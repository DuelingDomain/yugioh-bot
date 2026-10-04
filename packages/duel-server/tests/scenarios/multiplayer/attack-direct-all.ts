// Table of the ATTACK cards (manifest class ATTACK, "when an opponent's monster declares a direct attack") that attack-direct.ts and
// attack-count.ts do not run with their own scenario. Every card gets two live scenarios at FFA3 and at FFA4, built from one row:
//   - the direct attack goes to the holder p0: the effect is offered to p0 (p0 declines, so the state of every seat is the plain result of the attack);
//   - the direct attack goes to ANOTHER opponent (p2 in FFA3, p3 in FFA4): p0 is not asked, and that opponent takes the damage.
// Plain data (scripts/rule-coverage.ts reads it); attack-direct-all.test.ts runs it on a live core (NSEAT_LIVE=1) with the real card scripts and
// the overlay. A card whose effect is not a choice (a continuous trigger) has a `forced` result instead of the offer. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, attack, changePhase, endTurn, expectBoard, expectOffered, expectPrompt, faceDown, no, normalSummon, pass, pickOpponent, select, specialSummon, yes,
  type BoardExpect, type CardRef, type DuelistExpect, type DuelistSetup, type Scenario, type Step,
} from "../../support/dsl.js";
import { defineScenarioWithFfaFirstDraw as defineScenario } from "./ffa-first-draw.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
export type AttackAllFormat = "ffa3" | "ffa4";
const FORMATS: AttackAllFormat[] = ["ffa3", "ffa4"];
/** The opponent (never the holder p0) that receives the attack in the "not offered" scenarios; p2 is a bystander in FFA4. */
const OTHER_SEAT: Record<AttackAllFormat, Seat> = { ffa3: "p2", ffa4: "p3" };

const RAT = "Giant Rat"; // 1400 ATK, Level 4 Beast
const DARK_HOLE = "Dark Hole"; // decoy: the first card of the Deck of p0 is drawn in its second turn
const REBORN = "Monster Reborn";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;
const up = (card: CardRef) => ({ card, pos: "up" as const });

export interface AttackCardRow {
  code: number;
  name: string;
  /** Cards of p0, the holder. */
  p0: DuelistSetup;
  /** Cards of p1, the attacker. Default: the Giant Rat on the field. */
  p1?: DuelistSetup;
  /** The monster of p1 that declares the direct attack and its ATK. Default: the Giant Rat, 1400. */
  attacker?: string;
  atk?: number;
  /** Steps of p0 in its first turn, before it ends the turn (for example a Synchro Summon that must be properly summoned). */
  turn1?: Step[];
  /** Steps of p1 before the battle (p0 ends its turn first). */
  before?: Step[];
  /** The card asks p0 to pay at the Standby Phase of p0 (Firewall: 500 LP, p0 answers yes in each of its 2 turns before the attack). */
  upkeep?: number;
  /** The effect is a trigger effect: p0 gets the "Activate the Trigger Effect of ..." question (yes/no) and answers no. Default: the effect is offered as an action. */
  trigger?: boolean;
  /** The card of p0 stops the damage that p1 and the other opponents take (Ghostrick Parade). */
  noDamageToOthers?: boolean;
  /** What p0 has at the end when it differs from its setup (the cards that its own turn 1 steps moved). */
  p0End?: DuelistExpect;
  /** What p1 has at the end (monsters, Graveyard). Default: the monsters of its setup. */
  p1End?: DuelistExpect;
  /** Substring of the option text, to choose between effects of one card. */
  effect?: string;
  /**
   * The effect of the card is not a choice (a continuous trigger): there is no offer. `hit` is what p1 sees and the state of p0 when the
   * attack goes to p0; the card stays as it was when the attack goes to another opponent.
   */
  forced?: { after: Step[]; p0: DuelistExpect };
}

const names = (list: Array<CardRef | { card: CardRef } | null> | undefined): string[] =>
  (list ?? []).filter((entry): entry is CardRef | { card: CardRef } => entry !== null).map((entry) => String(typeof entry === "object" ? entry.card : entry));

/** The zones of a setup as an exact expectation (the hand is checked only for the card of the row, by the caller). */
function zonesOf(setup: DuelistSetup): DuelistExpect {
  return {
    monsters: names(setup.monsters),
    spells: [...names(setup.spells), ...names(setup.pendulum), ...(setup.field ? names([setup.field]) : [])],
    grave: names(setup.grave),
    banished: names(setup.banished),
  };
}

/** The state of EVERY seat: monsters, Spell and Trap zones, Graveyard, banished zone and LP are exact (a seat that the spec leaves out is empty, 8000 LP). */
function everySeat(format: AttackAllFormat, spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

const slugOf = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

function scenario(row: AttackCardRow, format: AttackAllFormat, to: "holder" | "other"): Scenario {
  const other = OTHER_SEAT[format];
  const attacker = row.attacker ?? RAT;
  const atk = row.atk ?? 1400;
  const p1Setup = row.p1 ?? { monsters: [RAT] };
  const p1Zones = { ...zonesOf(p1Setup), ...row.p1End };
  const p0Zones = { ...zonesOf(row.p0), ...row.p0End };
  const holds = names(row.p0.hand);
  const label = format.toUpperCase();
  const setup: Record<string, unknown> = { format, p0: row.p0, p1: p1Setup, p2: {} };
  if (format === "ffa4") setup.p3 = {};

  const pay: Step[] = row.upkeep ? [yes("p0")] : [];
  const paid = (row.upkeep ?? 0) * 2;
  const common: Step[] = [
    // A duelist cannot attack in its first turn, so every seat ends one turn first: p1 attacks in the second turn of its round.
    ...pay,
    ...(row.turn1 ?? []),
    endTurn("p0"),
    endTurn("p1"),
    endTurn("p2"),
    ...(format === "ffa4" ? [endTurn("p3")] : []),
    ...pay,
    endTurn("p0"),
    ...(row.before ?? []),
    changePhase("battle", "p1"),
    attack(attacker, "direct", "p1"),
    pickOpponent(to === "holder" ? "p0" : other, "p1"),
  ];
  const prompt = expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] });
  let steps: Step[];
  if (to === "other") {
    steps = [
      ...common,
      prompt,
      everySeat(format, { p0: { lp: 8000 - paid, ...p0Zones }, p1: p1Zones, [other]: { lp: row.noDamageToOthers ? 8000 : 8000 - atk } }),
    ];
  } else if (row.forced) {
    steps = [...common, ...row.forced.after, everySeat(format, { p0: { lp: 8000 - paid - atk, ...row.forced.p0 }, p1: p1Zones })];
  } else {
    steps = [
      ...common,
      ...(row.trigger
        ? [expectPrompt({ by: "p0", title: row.name, offers: ["yes", "no"] }), no("p0")]
        : [expectOffered("activate", row.effect ? { card: row.name, effect: row.effect } : row.name, "p0"), pass("p0")]),
      // p0 declines: the attack goes on and p0 takes the damage, so the state is the plain result of the attack.
      prompt,
      everySeat(format, { p0: { lp: 8000 - paid - atk, ...p0Zones, ...(holds.includes(row.name) ? { hand: { include: [row.name] } } : {}) }, p1: p1Zones }),
    ];
  }
  return defineScenario({
    id: `attack-direct-all-${format}-${slugOf(row.name)}-${to === "holder" ? (row.forced ? "acts-when-the-attack-goes-to-p0" : "offered-when-the-attack-goes-to-p0") : `not-offered-when-the-attack-goes-to-${other}`}`,
    title:
      to === "holder"
        ? row.forced
          ? `${label}: ${row.name} of p0 acts when p1 declares a direct attack and picks p0 (the attacked seat)`
          : `${label}: ${row.name} is offered to p0 when p1 declares a direct attack and picks p0 (the attacked seat), and p0 declines`
        : `${label}: ${row.name} of p0 does not act when p1 declares a direct attack and picks ${other}: p0 is not asked, ${other} takes the damage`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", format, `card:${row.code}`],
    setup: setup as Scenario["setup"],
    steps,
  });
}

/** The cards of the table, by code. */
export const ATTACK_ALL_ROWS: AttackCardRow[] = [
  // Traps, set face-down.
  { code: 2625939, name: "Spool Code", p0: { spells: [faceDown("Spool Code")], grave: ["Protron", "Digitron", "Bitron"] } },
  { code: 9201964, name: "D - Fortune", p0: { spells: [faceDown("D - Fortune")], grave: ["Destiny HERO - Diamond Dude"] } },
  { code: 22765132, name: "Performapal Call", p0: { spells: [faceDown("Performapal Call")], deck: [DARK_HOLE, "Performapal Sky Pupil"] } },
  { code: 24590232, name: "King's Consonance", p0: { spells: [faceDown("King's Consonance")], grave: ["Debris Dragon", "Mystical Elf"] } },
  {
    code: 33298291, name: "Dances with Beasts", attacker: "Blue-Eyes White Dragon", atk: 3000,
    p0: { spells: [faceDown("Dances with Beasts")], hand: ["Sangan"], grave: ["Battle Ox"] },
    p1: { monsters: ["Blue-Eyes White Dragon", "Dark Magician", "Summoned Skull"] },
  },
  {
    code: 56051648, name: "Spider Egg",
    p0: { spells: [faceDown("Spider Egg")], grave: ["Flying Kamakiri #2", "Gokibore", "Neo Bug"] },
  },
  {
    // The target must be a Synchro Monster that was Synchro Summoned (STATUS_PROC_COMPLETE): p0 Synchro Summons Armory Arm (Level 4, as the Giant
    // Rat) in its turn 1 and Dark Hole sends it to the Graveyard. p1 Normal Summons the Giant Rat in its turn, so Dark Hole does not hit it.
    code: 60312997, name: "Reanimation Wave",
    p0: { spells: [faceDown("Reanimation Wave")], hand: [DARK_HOLE], monsters: ["Neo Flamvell Hedgehog", "Kuriboh"], extra: ["Armory Arm"] },
    turn1: [specialSummon("Armory Arm"), select("Neo Flamvell Hedgehog", "Kuriboh"), activate(DARK_HOLE, "p0")],
    p0End: { monsters: [], spells: ["Reanimation Wave"], grave: [DARK_HOLE, "Armory Arm", "Neo Flamvell Hedgehog", "Kuriboh"], extra: [] },
    p1: { hand: [RAT] },
    before: [normalSummon(RAT, "p1")],
    p1End: { monsters: [RAT], grave: [] },
  },
  { code: 78161960, name: "Reject Reborn", p0: { spells: [faceDown("Reject Reborn")], grave: ["Quillbolt Hedgehog", "Turbo Cannon"] } },
  {
    code: 89040386, name: "Blackwing - Backlash",
    p0: {
      spells: [faceDown("Blackwing - Backlash")],
      grave: ["Blackwing - Gale the Whirlwind", "Blackwing - Hillen the Tengu-wind", "Blackwing - Zonda the Dusk", "Blackwing - Shamal the Sandstorm", "Blackwing - Fane the Steel Chain"],
    },
  },
  { code: 27062594, name: "The Door of Destiny", p0: { spells: [faceDown("The Door of Destiny")] } },
  // Continuous Spells and Traps, face-up.
  { code: 5641251, name: "F.A. Dead Heat", trigger: true, p0: { spells: [up("F.A. Dead Heat")], deck: [DARK_HOLE, "F.A. Whip Crosser"] } },
  { code: 36415522, name: "Performapal Pinch Helper", trigger: true, p0: { spells: [up("Performapal Pinch Helper")], deck: [DARK_HOLE, "Performapal Sky Pupil"] } },
  { code: 44046281, name: "Dimension Gate", trigger: true, p0: { spells: [up("Dimension Gate")] } },
  { code: 49838105, name: "Sylvan Waterslide", trigger: true, p0: { spells: [up("Sylvan Waterslide")] } },
  { code: 49966595, name: "Graydle Parasite", trigger: true, p0: { spells: [up("Graydle Parasite")], deck: [DARK_HOLE, "Graydle Cobra"] } },
  { code: 94804055, name: "Firewall", upkeep: 500, p0: { spells: [up("Firewall")], grave: ["Flame Viper"] } },
  { code: 29400787, name: "Ghostrick Parade", trigger: true, noDamageToOthers: true, p0: { field: up("Ghostrick Parade"), deck: [DARK_HOLE, "Ghostrick Witch"] } },
  // Monsters in the hand.
  { code: 8836329, name: "Raging Storm Dragon - Beaufort IX", p0: { hand: ["Raging Storm Dragon - Beaufort IX"] } },
  { code: 12423762, name: "Gagaga Gardna", p0: { hand: ["Gagaga Gardna"] } },
  { code: 16947147, name: "Speedroid Menko", p0: { hand: ["Speedroid Menko"] } },
  { code: 18964575, name: "Swift Scarecrow", p0: { hand: ["Swift Scarecrow"] } },
  { code: 19665973, name: "Battle Fader", p0: { hand: ["Battle Fader"] } },
  { code: 24731453, name: "Snow Plow Hustle Rustle", p0: { hand: ["Snow Plow Hustle Rustle"], spells: [faceDown(DARK_HOLE)] } },
  { code: 26775203, name: "Blackwing - Ghibli the Searing Wind", p0: { hand: ["Blackwing - Ghibli the Searing Wind"] } },
  { code: 53819028, name: "Predaplant Sarraceniant", p0: { hand: ["Predaplant Sarraceniant"] } },
  { code: 54512827, name: "Ghostrick Lantern", p0: { hand: ["Ghostrick Lantern"] } },
  { code: 61318483, name: "Ghostrick Jackfrost", p0: { hand: ["Ghostrick Jackfrost"] } },
  { code: 64605089, name: "Swordsman of Revealing Light", p0: { hand: ["Swordsman of Revealing Light"] } },
  { code: 68120130, name: "Junk Defender", p0: { hand: ["Junk Defender"] } },
  { code: 69304426, name: "Artifact Vajra", p0: { hand: ["Artifact Vajra"] } },
  { code: 69838592, name: "Yosenju Oyam", p0: { hand: ["Yosenju Oyam", "Yosenju Kama 1"] } },
  // Monsters in the Graveyard.
  { code: 2830693, name: "Rainbow Kuriboh", trigger: true, p0: { grave: ["Rainbow Kuriboh"] } },
  { code: 24212820, name: "The Phantom Knights of Dark Gauntlets", p0: { grave: ["The Phantom Knights of Dark Gauntlets"] } },
  { code: 25669282, name: "Burnout", trigger: true, p0: { grave: ["Burnout"], banished: ["Chemicritter Hydron Hawk"] } },
  { code: 44891812, name: "Superheavy Samurai Helper", trigger: true, p0: { grave: ["Superheavy Samurai Helper", "Superheavy Samurai Soulbang Cannon"] } },
  { code: 46613515, name: "Clear Kuriboh", trigger: true, p0: { grave: ["Clear Kuriboh"] } },
  { code: 62017867, name: "Superheavy Samurai Gigagloves", trigger: true, p0: { grave: ["Superheavy Samurai Gigagloves"] } },
  { code: 71985676, name: "Performapal Inflater Tapir", trigger: true, p0: { grave: ["Performapal Inflater Tapir"], hand: ["Performapal Sky Pupil"] } },
  { code: 77462146, name: "The Phantom Knights of Shadow Veil", p0: { grave: ["The Phantom Knights of Shadow Veil"] } },
  { code: 80208158, name: "D.D. Esper Star Sparrow", trigger: true, p0: { grave: ["D.D. Esper Star Sparrow"] } },
  { code: 96427353, name: "Aqua Armor Ninja", trigger: true, p0: { grave: ["Aqua Armor Ninja", "Ninja Grandmaster Sasuke"] } },
  {
    code: 92530005, name: "Performage Ball Balancer",
    // The effect needs a Special Summoned attacker: p1 Special Summons the Giant Rat with Monster Reborn first.
    p0: { grave: ["Performage Ball Balancer"], deck: [DARK_HOLE, "Performage Cup Tricker"] },
    p1: { hand: [REBORN], grave: [RAT] },
    before: [activate(REBORN, "p1"), select(RAT)],
    trigger: true,
    p1End: { monsters: [RAT], grave: [REBORN] },
  },
  // Pendulum Monsters in the Pendulum Zone.
  { code: 9106362, name: "Performapal Gongato", trigger: true, p0: { pendulum: ["Performapal Gongato", null] } },
  { code: 59762399, name: "Performapal Odd-Eyes Light Phoenix", trigger: true, p0: { pendulum: ["Performapal Odd-Eyes Light Phoenix", "Performapal Smile Sorcerer"] } },
  {
    // A continuous effect: the card destroys itself at a direct attack (no offer) and its forced trigger ends the Battle Phase: p0 takes no damage.
    code: 55554175, name: "Performapal Classikuriboh", p0: { pendulum: ["Performapal Classikuriboh", null] },
    forced: { after: [pickOpponent("p1", "p0"), expectPrompt({ by: "p1", offers: ["to_ep"] })], p0: { lp: 8000, monsters: [], spells: [], grave: [], banished: [], extra: ["Performapal Classikuriboh"] } },
  },
];

export const ATTACK_ALL_SCENARIOS: Scenario[] = ATTACK_ALL_ROWS.flatMap((row) =>
  FORMATS.flatMap((format) => [scenario(row, format, "holder"), scenario(row, format, "other")]),
);

// An older core has no Duel.MPAttackedSeat: aux.MPAttackedAtMe then takes its fallback (mp-utility.lua). The scenarios hide the function at the start
// of the duel (`withoutCoreFunctions`) and run Counter Gate (FFA3: p0 holds it, p1 attacks, p2 is the third seat):
//   - p2 has a monster, so the direct attack can go to p0 only: offered;
//   - p2 has no monster and the attack goes to p2: not offered;
//   - p2 has no monster and the attack goes to p0: the fallback cannot tell it from an attack at p2, so it is not offered (the known limit of the fallback;
//     the core function is exact, see the table scenarios above, where the same setup is offered).
function fallback(slug: string, title: string, p2: DuelistSetup, to: "p0" | "p2" | "auto", offered: boolean): Scenario {
  const gate = "Counter Gate";
  const spec = { p0: { spells: [faceDown(gate)], deck: [DARK_HOLE, DARK_HOLE] }, p1: { monsters: [RAT] }, p2 };
  const lpP2 = to === "p2" ? 8000 - 1400 : 8000;
  const lpP0 = to === "p2" ? 8000 : 8000 - 1400;
  return defineScenario({
    id: `attack-direct-all-fallback-ffa3-counter-gate-${slug}`,
    title: `FFA3 on a core without Duel.MPAttackedSeat: ${title}`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", "ffa3", "card:94561645", "fallback"],
    setup: { format: "ffa3", withoutCoreFunctions: ["MPAttackedSeat"], ...spec } as unknown as Scenario["setup"],
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent(to === "auto" ? "p0" : to, "p1"),
      ...(offered
        ? [activate(gate, "p0"), everySeat("ffa3", { p0: { grave: [gate], hand: [DARK_HOLE, DARK_HOLE] }, p1: { monsters: [RAT] }, p2: zonesOf(p2) })]
        : [
            expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] }),
            everySeat("ffa3", { p0: { lp: lpP0, spells: [gate], hand: [DARK_HOLE] }, p1: { monsters: [RAT] }, p2: { lp: lpP2, ...zonesOf(p2) } }),
          ]),
    ],
  });
}

export const ATTACK_FALLBACK_SCENARIOS: Scenario[] = [
  fallback("offered-when-p2-has-a-monster", "p1 attacks p0 directly while p2 has a monster: p0 is offered Counter Gate (the only seat the attack can go to)", { monsters: ["Silver Fang"] }, "auto", true),
  fallback("not-offered-when-the-attack-goes-to-p2", "p1 attacks p2, which has no monster, p0 has none either: Counter Gate of p0 is not offered", {}, "p2", false),
  fallback("not-offered-when-both-seats-are-empty", "p1 attacks p0 while p2 has no monster either: the fallback cannot tell the target, Counter Gate is not offered (the core function can)", {}, "p0", false),
];

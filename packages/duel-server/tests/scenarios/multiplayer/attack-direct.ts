// Live scenarios of the cards whose trigger is "when an opponent's monster declares a direct attack" (manifest class ATTACK).
// FFA folds every opponent into the Lua value 1, so the stock condition `GetAttackTarget()==nil` alone offers the card to a seat
// that the attack does not go to. The overlay (aux.MPAttackedAtMe) offers it only to the seat that the direct attack goes to
// (Duel.MPAttackedSeat). Each card has two FFA3 scenarios: the attack goes to the holder (offered, resolves) and the attack goes to
// the other opponent (not offered, that opponent takes the damage). Tag keeps the team value: the holder or the partner is asked.
// Plain data; tests/scenarios/multiplayer/attack-direct.test.ts runs them on a live core (NSEAT_LIVE=1). Every scenario ends with the
// state of every seat. Decisions: docs/adr/0002-multiplayer-duel-rules.md.

import {
  activate, attack, changePhase, defineScenario, endTurn, expectBoard, expectPrompt, faceDown, pickOpponent, yes,
  type BoardExpect, type DuelistExpect, type Scenario, type Step,
} from "../../support/dsl.js";
import { SOURCE } from "./nseat-scenarios.js";

type Seat = "p0" | "p1" | "p2" | "p3";
const RAT = "Giant Rat"; // 1400 ATK Beast, Level 4
const OX = "Battle Ox"; // 1700 ATK
const NUMBER_62 = "Number 62: Galaxy-Eyes Prime Photon Dragon"; // 4000 ATK Xyz, LIGHT Dragon
const NUMBER_90 = "Number 90: Galaxy-Eyes Photon Lord"; // 2500 ATK Xyz
const DARK_HOLE = "Dark Hole";
const REBORN = "Monster Reborn";
const OPP_PICK = `${SOURCE} [R-COMMON-OPP-PICK]`;

/**
 * The state of EVERY seat of a format, exact for the monster zones, the Spell and Trap zones, the Graveyard, the banished zone and
 * the Life Points (8000 for a seat, 16000 for the team of a Tag duel, unless given). A seat that the spec leaves out must be empty. The hand is checked only when the spec names it.
 */
function everySeat(format: "ffa3" | "ffa4" | "tag", spec: Partial<Record<Seat, DuelistExpect>>): Step {
  const seats: Seat[] = format === "ffa3" ? ["p0", "p1", "p2"] : ["p0", "p1", "p2", "p3"];
  const board: BoardExpect = {};
  for (const seat of seats) board[seat] = { lp: format === "tag" ? 16000 : 8000, monsters: [], spells: [], grave: [], banished: [], ...spec[seat] };
  return expectBoard(board);
}

interface DirectCase {
  /** Slug of the card in the scenario id. */
  slug: string;
  /** Name of the card, for the titles. */
  name: string;
  code: number;
  /** Cards of p0 (the holder) and of p1 (the attacker), and p2 (the other opponent, empty by default). */
  p0: DuelistExpectSetup;
  p1: DuelistExpectSetup;
  p2?: DuelistExpectSetup;
  /** Steps of p1 before the battle, after p0 ended its turn. */
  before?: Step[];
  /** The attacker (name) that declares the direct attack. */
  attacker: string;
  /** What p0 does when the card is offered, as the card is named in the answer. */
  answer: Step[];
  /** The state at the end when the attack goes to p0 and when it goes to p2 (p1 and p2 as the spec of the cards). */
  atP0: Partial<Record<Seat, DuelistExpect>>;
  atP2: Partial<Record<Seat, DuelistExpect>>;
  /** Why the setup is what it is. */
  note?: string;
}
type DuelistExpectSetup = Record<string, unknown>;

const direct = (c: DirectCase, to: "p0" | "p2"): Scenario =>
  defineScenario({
    id: `attack-direct-ffa3-${c.slug}-${to === "p0" ? "offered-when-the-attack-goes-to-p0" : "not-offered-when-the-attack-goes-to-p2"}`,
    title:
      to === "p0"
        ? `FFA3: ${c.name} is offered to p0 when p1 declares a direct attack and picks p0 (the attacked seat), and it resolves`
        : `FFA3: ${c.name} is NOT offered to p0 when p1 declares a direct attack and picks p2: the attack goes to p2, and p2 takes the damage`,
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", "ffa3", `card:${c.code}`],
    setup: { format: "ffa3", p0: c.p0, p1: c.p1, p2: c.p2 ?? {} } as Scenario["setup"],
    // A duelist cannot attack in its first turn, so every seat ends one turn first: p1 attacks in turn 5.
    // p0 draws the first card of its Deck in turn 4.
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      endTurn("p0"),
      ...(c.before ?? []),
      changePhase("battle", "p1"),
      attack(c.attacker, "direct", "p1"),
      pickOpponent(to, "p1"),
      ...(to === "p0" ? c.answer : [expectPrompt({ by: "p1", offers: ["to_m2", "to_ep"] })]),
      everySeat("ffa3", to === "p0" ? c.atP0 : c.atP2),
    ],
  });

const pair = (c: DirectCase): Scenario[] => [direct(c, "p0"), direct(c, "p2")];

export const ATTACK_DIRECT_SCENARIOS: Scenario[] = [
  // A Trap that is set (shape: a Trap that activates on the attack).
  ...pair({
    slug: "counter-gate", name: "Counter Gate", code: 94561645,
    p0: { spells: [faceDown("Counter Gate")], deck: [DARK_HOLE, DARK_HOLE] },
    p1: { monsters: [RAT] },
    attacker: RAT,
    answer: [activate("Counter Gate", "p0")],
    atP0: { p0: { grave: ["Counter Gate"], hand: [DARK_HOLE, DARK_HOLE] }, p1: { monsters: [RAT] } },
    atP2: { p0: { spells: ["Counter Gate"], hand: [DARK_HOLE] }, p1: { monsters: [RAT] }, p2: { lp: 6600 } },
  }),
  // A Trap whose target needs a Special Summoned attacker with ATK at or above the LP of the holder.
  ...pair({
    slug: "stardust-re-spark", name: "Stardust Re-Spark", code: 20590784,
    p0: { lp: 1000, spells: [faceDown("Stardust Re-Spark")], deck: [DARK_HOLE, DARK_HOLE] },
    p1: { hand: [REBORN], grave: [RAT] },
    before: [activate(REBORN, "p1")],
    attacker: RAT,
    answer: [activate("Stardust Re-Spark", "p0")],
    atP0: { p0: { lp: 1000, grave: ["Stardust Re-Spark"], hand: [DARK_HOLE, DARK_HOLE] }, p1: { monsters: [RAT], grave: [REBORN] } },
    atP2: { p0: { lp: 1000, spells: ["Stardust Re-Spark"], hand: [DARK_HOLE] }, p1: { monsters: [RAT], grave: [REBORN] }, p2: { lp: 6600 } },
  }),
  // A Trap that Special Summons itself as a monster (ATK equal to the LP of the holder).
  ...pair({
    slug: "krystal-avatar", name: "Krystal Avatar", code: 20960340,
    p0: { lp: 1000, spells: [faceDown("Krystal Avatar")] },
    p1: { monsters: [RAT] },
    attacker: RAT,
    answer: [activate("Krystal Avatar", "p0")],
    // Krystal Avatar has 1000 ATK (the LP of p0) and the attack changes to it: it loses to the 1400 ATK of the Rat, p0 takes 400 and the effect of Krystal Avatar deals 1000 to p1.
    atP0: { p0: { lp: 600, grave: ["Krystal Avatar"] }, p1: { lp: 7000, monsters: [RAT] } },
    atP2: { p0: { lp: 1000, spells: ["Krystal Avatar"] }, p1: { monsters: [RAT] }, p2: { lp: 6600 } },
  }),
  // A monster in the hand with a trigger effect (shape: a hand monster that Special Summons itself).
  ...pair({
    slug: "gladiator-beast-noxious", name: "Gladiator Beast Noxious", code: 67385964,
    p0: { hand: ["Gladiator Beast Noxious"], deck: [DARK_HOLE] },
    p1: { monsters: [RAT] },
    attacker: RAT,
    answer: [activate("Gladiator Beast Noxious", "p0")],
    // Noxious has 0 ATK, it is not destroyed by that battle: p0 takes the 1400 ATK of the Rat.
    atP0: { p0: { lp: 6600, monsters: ["Gladiator Beast Noxious"] }, p1: { monsters: [RAT] } },
    atP2: { p0: { hand: ["Gladiator Beast Noxious", DARK_HOLE] }, p1: { monsters: [RAT] }, p2: { lp: 6600 } },
  }),
  ...pair({
    slug: "performapal-kuribohble", name: "Performapal Kuribohble", code: 69181753,
    p0: { hand: ["Performapal Kuribohble"], deck: [DARK_HOLE] },
    p1: { monsters: [RAT] },
    attacker: RAT,
    answer: [activate("Performapal Kuribohble", "p0")],
    // Kuribohble has 300 ATK and loses to the Rat, and the 1100 battle damage is gained as LP.
    atP0: { p0: { lp: 9100, grave: ["Performapal Kuribohble"] }, p1: { monsters: [RAT] } },
    atP2: { p0: { hand: ["Performapal Kuribohble", DARK_HOLE] }, p1: { monsters: [RAT] }, p2: { lp: 6600 } },
  }),
  // Group of the conditions with `Duel.IsTurnPlayer(1-tp)`: a Trap that needs the holder to have no monster, and a Trap that needs low LP.
  ...pair({
    slug: "battle-instinct", name: "Battle Instinct", code: 60534585,
    p0: { spells: [faceDown("Battle Instinct")], hand: [RAT], deck: [DARK_HOLE] },
    p1: { monsters: [OX] },
    attacker: OX,
    answer: [activate("Battle Instinct", "p0")],
    atP0: { p0: { monsters: [RAT], grave: ["Battle Instinct"], hand: [DARK_HOLE] }, p1: { monsters: [OX] } },
    atP2: { p0: { spells: ["Battle Instinct"], hand: [RAT, DARK_HOLE] }, p1: { monsters: [OX] }, p2: { lp: 6300 } },
  }),
  ...pair({
    slug: "offering-to-the-immortals", name: "Offering to the Immortals", code: 82340056,
    p0: { lp: 3000, spells: [faceDown("Offering to the Immortals")], deck: [DARK_HOLE, "Earthbound Immortal Uru"] },
    p1: { monsters: [OX] },
    attacker: OX,
    answer: [activate("Offering to the Immortals", "p0")],
    atP0: { p0: { lp: 3000, monsters: { count: 2 }, grave: ["Offering to the Immortals"], hand: [DARK_HOLE, "Earthbound Immortal Uru"] }, p1: { monsters: [OX] } },
    atP2: { p0: { lp: 3000, spells: ["Offering to the Immortals"], hand: [DARK_HOLE] }, p1: { monsters: [OX] }, p2: { lp: 6300 } },
  }),
  // Group of the conditions that read the controller of the attacker (`eg:GetFirst():IsControler(1-tp)`): a Trap that Special Summons
  // from the Extra Deck, and a Trap that acts on the monsters of the attacker side.
  ...pair({
    slug: "double-dragon-descent", name: "Double Dragon Descent", code: 13166648,
    p0: { spells: [faceDown("Double Dragon Descent")], extra: [NUMBER_62], deck: [DARK_HOLE] },
    p1: { monsters: [NUMBER_90] },
    attacker: NUMBER_90,
    answer: [activate("Double Dragon Descent", "p0")],
    // Number 62 is summoned, its ATK becomes the 2500 of the attacker, and the attack goes to it: both are destroyed.
    atP0: { p0: { grave: ["Double Dragon Descent", NUMBER_62], hand: [DARK_HOLE] }, p1: { grave: [NUMBER_90] } },
    atP2: { p0: { spells: ["Double Dragon Descent"], hand: [DARK_HOLE] }, p1: { monsters: [NUMBER_90] }, p2: { lp: 5500 } },
  }),
  ...pair({
    slug: "drowning-mirror-force", name: "Drowning Mirror Force", code: 47475363,
    p0: { spells: [faceDown("Drowning Mirror Force")] },
    p1: { monsters: [RAT, OX] },
    attacker: RAT,
    answer: [activate("Drowning Mirror Force", "p0")],
    atP0: { p0: { grave: ["Drowning Mirror Force"] } },
    atP2: { p0: { spells: ["Drowning Mirror Force"] }, p1: { monsters: [RAT, OX] }, p2: { lp: 6600 } },
  }),
  // Tag keeps the team value: a direct attack at a seat of the team asks the partner of the target as well (p2 holds the Trap, p0 holds nothing).
  defineScenario({
    id: "attack-direct-tag-counter-gate-offered-to-the-partner",
    title: "Tag: Counter Gate of p2 is offered when p1 declares a direct attack at p0 (the partner of p2 is attacked), and it resolves",
    source: OPP_PICK,
    rules: ["R-COMMON-OPP-PICK", "R-FFA-ATTACK"],
    tags: ["multiplayer", "attack", "trigger", "tag", "card:94561645"],
    setup: { format: "tag", p1: { monsters: [RAT] }, p2: { spells: [faceDown("Counter Gate")], deck: [DARK_HOLE, DARK_HOLE] }, p3: {} } as Scenario["setup"],
    // Turn order p0, p1, p2, p3: p1 attacks in turn 6. p2 draws a Dark Hole in turn 3, and Counter Gate draws the second one.
    steps: [
      endTurn("p0"),
      endTurn("p1"),
      endTurn("p2"),
      endTurn("p3"),
      endTurn("p0"),
      changePhase("battle", "p1"),
      attack(RAT, "direct", "p1"),
      pickOpponent("p0", "p1"),
      activate("Counter Gate", "p2"),
      everySeat("tag", { p1: { monsters: [RAT] }, p2: { grave: ["Counter Gate"], hand: [DARK_HOLE, DARK_HOLE] } }),
    ],
  }),
];

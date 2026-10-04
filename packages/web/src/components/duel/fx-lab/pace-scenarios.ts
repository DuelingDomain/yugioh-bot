import type { DuelCardInfo } from "@yugidraft/shared/duels";
import { GY, HAND, MZ, SZ, edit, ev, link, newBoard, type Edit, type EventSpec, type LabScenario, type LabScript, type LabStep } from "./board";
import { CARDS } from "./cards";

/**
 * Pace checks: the plays a duel is made of, in the order and batches the server sends them (a destroy marker
 * is deferred until after the resolving link, and a chain resolves inside one batch). They exist to watch
 * and measure whether each step of a chain can be followed: what was activated, by whom, and what it did.
 * Seat 0 is you, seat 1 is the opponent.
 */

const ME = 0;
const OPP = 1;
const C = CARDS;

const myHand = { hand: [C.celtic, C.sangan, C.potOfGreed, C.monsterReborn], deck: 28, extra: [] };
const oppHand = { hand: [null, null, null, null, null], deck: 29, extra: [null, null] };

type Why = { cause: "effect"; sourceCode: number; sourceKind: "spell" | "trap" | "monster"; sourceSeat: number };
const effectOf = (card: DuelCardInfo, kind: Why["sourceKind"], seat: number): Why => ({ cause: "effect", sourceCode: card.code, sourceKind: kind, sourceSeat: seat });

/** The opponent answers your Normal Summon with a Set Trap Hole: it flips, resolves and destroys the monster. */
function trapHole(gapMs: number): LabScript {
  const initial = newBoard(myHand, oppHand);
  edit.hiddenSpell(OPP, 2)(initial);
  const why = effectOf(C.trapHole, "trap", OPP);
  const summon: LabStep = {
    at: 0,
    events: [ev.move(ME, C.celtic, HAND(ME, 0), MZ(ME, 2), "summon"), ev.summon(ME, C.celtic, MZ(ME, 2), "normal")],
    edits: [edit.monster(ME, 2, C.celtic), edit.removeHand(ME, 0)],
  };
  const answer: LabStep = {
    at: gapMs,
    events: [
      ev.activate(OPP, C.trapHole, SZ(OPP, 2), 1),
      ev.chain("chain-resolving", OPP, C.trapHole, 1),
      ev.toGrave(ME, C.celtic, MZ(ME, 2), 0, why),
      ev.chain("chain-resolved", OPP, C.trapHole, 1),
      ev.destroy(ME, C.celtic, MZ(ME, 2), why),
      ev.move(OPP, C.trapHole, SZ(OPP, 2), GY(OPP, 0), "send"),
      ev.chainEnd(),
    ],
    edits: [edit.monster(ME, 2, null), edit.grave(ME, C.celtic), edit.spell(OPP, 2, null), edit.grave(OPP, C.trapHole)],
    chain: [],
  };
  return { initial, steps: [summon, answer], tailMs: 7000 };
}

/** The opponent plays Mystical Space Typhoon from the hand on your Set Mirror Force. */
function quickPlay(): LabScript {
  const initial = newBoard(myHand, oppHand);
  edit.setSpell(ME, 2, C.mirrorForce)(initial);
  const why = effectOf(C.mst, "spell", OPP);
  const play: LabStep = {
    at: 0,
    events: [
      ev.move(OPP, C.mst, HAND(OPP, 0), SZ(OPP, 1), "activate"),
      ev.activate(OPP, C.mst, SZ(OPP, 1), 1),
      ev.chain("chain-resolving", OPP, C.mst, 1),
      ev.toGrave(ME, C.mirrorForce, SZ(ME, 2), 0, why),
      ev.chain("chain-resolved", OPP, C.mst, 1),
      ev.destroy(ME, C.mirrorForce, SZ(ME, 2), why),
      ev.move(OPP, C.mst, SZ(OPP, 1), GY(OPP, 0), "send"),
      ev.chainEnd(),
    ],
    edits: [edit.removeHand(OPP, 0), edit.spell(ME, 2, null), edit.grave(ME, C.mirrorForce), edit.grave(OPP, C.mst)],
    chain: [],
  };
  return { initial, steps: [play], tailMs: 7000 };
}

/** You play Pot of Greed: the card goes to the Spell and Trap Zone, you draw two, it goes to the Graveyard. */
function normalSpell(): LabScript {
  const initial = newBoard(myHand, oppHand);
  const edits: Edit[] = [edit.removeHand(ME, 2), edit.drawFromDeck(ME, 2), edit.addHand(ME, C.kuriboh), edit.addHand(ME, C.blueEyes), edit.grave(ME, C.potOfGreed)];
  const events: EventSpec[] = [
    ev.move(ME, C.potOfGreed, HAND(ME, 2), SZ(ME, 2), "activate"),
    ev.activate(ME, C.potOfGreed, SZ(ME, 2), 1),
    ev.chain("chain-resolving", ME, C.potOfGreed, 1),
    ev.draw(ME, C.kuriboh, 3),
    ev.draw(ME, C.blueEyes, 4),
    ev.chain("chain-resolved", ME, C.potOfGreed, 1),
    ev.move(ME, C.potOfGreed, SZ(ME, 2), GY(ME, 0), "send"),
    ev.chainEnd(),
  ];
  return { initial, steps: [{ at: 0, events, edits, chain: [] }], tailMs: 7000 };
}

/**
 * Chain of two: the opponent's Set Trap Hole answers your summon (link 1, its own batch), you answer with Solemn
 * Judgment (link 2) paying half your LP, and the chain resolves in the batch of your answer, link 2 first.
 */
function chainOfTwo(): LabScript {
  const initial = newBoard(myHand, oppHand);
  edit.hiddenSpell(OPP, 2)(initial);
  edit.setSpell(ME, 3, C.solemn)(initial);
  const why = effectOf(C.solemn, "trap", ME);
  const first: LabStep = {
    at: 0,
    events: [
      ev.move(ME, C.celtic, HAND(ME, 0), MZ(ME, 2), "summon"),
      ev.summon(ME, C.celtic, MZ(ME, 2), "normal"),
      ev.activate(OPP, C.trapHole, SZ(OPP, 2), 1),
    ],
    edits: [edit.monster(ME, 2, C.celtic), edit.removeHand(ME, 0), edit.spell(OPP, 2, C.trapHole)],
    chain: [link(1, OPP, C.trapHole)],
  };
  const answer: LabStep = {
    at: 4200,
    events: [
      ev.activate(ME, C.solemn, SZ(ME, 3), 2),
      ev.damage(ME, 4000, "cost"),
      ev.chain("chain-resolving", ME, C.solemn, 2),
      ev.chain("chain-resolved", ME, C.solemn, 2),
      ev.chain("chain-resolving", OPP, C.trapHole, 1),
      ev.chain("chain-negated", OPP, C.trapHole, 1),
      ev.toGrave(OPP, C.trapHole, SZ(OPP, 2), 0, why),
      ev.destroy(OPP, C.trapHole, SZ(OPP, 2), why),
      ev.move(ME, C.solemn, SZ(ME, 3), GY(ME, 0), "send"),
      ev.chainEnd(),
    ],
    edits: [edit.lp(ME, 4000), edit.spell(OPP, 2, null), edit.grave(OPP, C.trapHole), edit.spell(ME, 3, null), edit.grave(ME, C.solemn)],
    chain: [],
  };
  return { initial, steps: [first, answer], tailMs: 7000 };
}

export const PACE_SCENARIOS: LabScenario[] = [
  {
    id: "pace-trap-hole", category: "Chain", name: "Pace: your summon, the opponent's Trap Hole",
    description: "You Normal Summon; the opponent's Set Trap Hole flips, shows its face, is announced as Chain Link 1, resolves and destroys the monster. Each step must be readable.",
    build: () => trapHole(1500),
  },
  {
    id: "pace-trap-hole-bot", category: "Chain", name: "Pace: Trap Hole answered at once",
    description: "The same play with the opponent answering the instant the summon lands (a practice bot), so the summon and the trap pile up.",
    build: () => trapHole(60),
  },
  {
    id: "pace-quick-play", category: "Chain", name: "Pace: the opponent's Quick-Play Spell",
    description: "The opponent plays Mystical Space Typhoon from the hand on your Set Mirror Force: the card is shown, announced, and the trap breaks.",
    build: quickPlay,
  },
  {
    id: "pace-normal-spell", category: "Chain", name: "Pace: your Normal Spell",
    description: "You play Pot of Greed: it activates, you draw two, it goes to the Graveyard. Your own play stays brisk.",
    build: normalSpell,
  },
  {
    id: "pace-chain-two", category: "Chain", name: "Pace: chain of two with a negate",
    description: "The opponent's Trap Hole is Chain Link 1; your Solemn Judgment (paying half your LP) is Chain Link 2 and negates it. Every link and the LP change get their own beat.",
    build: chainOfTwo,
  },
];

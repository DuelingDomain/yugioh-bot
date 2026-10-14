import { GY, HAND, MZ, SZ, edit, ev, link, newBoard, type EventSpec, type LabScenario, type LabScript, type LabStep } from "./board";
import { CARDS } from "./cards";
import { POS_FACEUP_ATTACK } from "../constants";

/**
 * Activation checks: a Spell or Trap that is activated on the field and stays there. The card must keep the full size of
 * its zone, with the zone outline drawn, for the whole placement, activation and resolve, and a card that is already face-up
 * must not turn again. Seat 0 is you, seat 1 is the opponent.
 */

const ME = 0;
const OPP = 1;
const C = CARDS;

const myHand = { hand: [C.sangan, C.kuriboh, C.swords, C.mst], deck: 28, extra: [] };
const trapHand = { ...myHand, hand: [C.sangan, C.kuriboh, C.imperialOrder, C.mst] };
const oppHand = { hand: [null, null, null, null, null], deck: 29, extra: [null, null] };

/** The resolve of a link that leaves its card on the field. The engine sends it in a batch after the activation. */
const resolves = (seat: number, card: typeof C.swords, index = 1): EventSpec[] => [
  ev.chain("chain-resolving", seat, card, index),
  ev.chain("chain-resolved", seat, card, index),
  ev.chainEnd(),
];

/** You play a Continuous Spell from the hand: it lands in its zone, activates, resolves and stays. */
function handContinuous(): LabScript {
  const initial = newBoard(myHand, oppHand);
  const activation: LabStep = {
    at: 0,
    events: [ev.move(ME, C.swords, HAND(ME, 2), SZ(ME, 2), "activate"), ev.activate(ME, C.swords, SZ(ME, 2), 1)],
    edits: [edit.removeHand(ME, 2), edit.spell(ME, 2, C.swords)],
    chain: [link(1, ME, C.swords)],
  };
  const resolve: LabStep = { at: 1800, events: resolves(ME, C.swords), chain: [] };
  return { initial, steps: [activation, resolve], tailMs: 4000 };
}

/**
 * A Continuous Trap is Set, then activated in a later turn's batch: it flips once and stays. `flip` adds the engine's
 * position event: in the batch of the activation ("with"), or in a batch of its own before it ("before").
 */
function setContinuous(flip: "none" | "with" | "before", owner = ME): LabScript {
  const initial = newBoard(trapHand, oppHand);
  const setStep: LabStep = owner === ME
    ? {
        at: 0,
        events: [ev.move(ME, C.imperialOrder, HAND(ME, 2), SZ(ME, 1), "set", { faceDown: true }), ev.set(ME, C.imperialOrder, SZ(ME, 1))],
        edits: [edit.removeHand(ME, 2), edit.setSpell(ME, 1, C.imperialOrder)],
      }
    : {
        at: 0,
        events: [{ ...ev.set(OPP, C.imperialOrder, SZ(OPP, 1)) }],
        edits: [edit.hiddenSpell(OPP, 1)],
      };
  const flipEvent = ev.position(owner, C.imperialOrder, SZ(owner, 1), 0x0a, POS_FACEUP_ATTACK, true);
  const before = flip === "before";
  const flipStep: LabStep = { at: 2200, events: [flipEvent], edits: [edit.spell(owner, 1, C.imperialOrder)] };
  const activation: LabStep = {
    at: before ? 4400 : 2200,
    events: [...(flip === "with" ? [flipEvent] : []), ev.activate(owner, C.imperialOrder, SZ(owner, 1), 1)],
    edits: before ? [] : [edit.spell(owner, 1, C.imperialOrder)],
    chain: [link(1, owner, C.imperialOrder)],
  };
  const resolve: LabStep = { at: before ? 6200 : 4000, events: resolves(owner, C.imperialOrder), chain: [] };
  return { initial, steps: [setStep, ...(before ? [flipStep] : []), activation, resolve], tailMs: 4000 };
}

/** A face-up card on the field uses its effect (a Continuous Spell or a monster): it was never Set, so it must not turn. */
function faceUpEffect(monster: boolean): LabScript {
  const initial = newBoard(myHand, oppHand);
  if (monster) edit.monster(ME, 1, C.sangan)(initial);
  else edit.spell(ME, 1, C.swords)(initial);
  const card = monster ? C.sangan : C.swords;
  const zone = monster ? MZ(ME, 1) : SZ(ME, 1);
  const activation: LabStep = { at: 300, events: [ev.activate(ME, card, zone, 1)], chain: [link(1, ME, card)] };
  const resolve: LabStep = { at: 2200, events: resolves(ME, card), chain: [] };
  return { initial, steps: [activation, resolve], tailMs: 4000 };
}

/** The opponent activates a Set Continuous Trap (link 1); you answer with Mystical Space Typhoon from the hand (link 2), which resolves first. */
function quickPlayInChain(): LabScript {
  const initial = newBoard(myHand, oppHand);
  edit.hiddenSpell(OPP, 1)(initial);
  const step: LabStep = {
    at: 0,
    events: [
      ev.activate(OPP, C.imperialOrder, SZ(OPP, 1), 1),
      ev.move(ME, C.mst, HAND(ME, 3), SZ(ME, 3), "activate"),
      ev.activate(ME, C.mst, SZ(ME, 3), 2),
      ev.chain("chain-resolving", ME, C.mst, 2),
      ev.chain("chain-resolved", ME, C.mst, 2),
      ev.move(ME, C.mst, SZ(ME, 3), GY(ME, 0), "send"),
      ev.chain("chain-resolving", OPP, C.imperialOrder, 1),
      ev.chain("chain-resolved", OPP, C.imperialOrder, 1),
      ev.chainEnd(),
    ],
    edits: [edit.removeHand(ME, 3), edit.spell(OPP, 1, C.imperialOrder), edit.grave(ME, C.mst)],
    chain: [link(1, OPP, C.imperialOrder), link(2, ME, C.mst)],
  };
  return { initial, steps: [step], tailMs: 5000 };
}

export const ACTIVATION_SCENARIOS: LabScenario[] = [
  {
    id: "activation-hand-continuous", category: "Chain", name: "Activation: Continuous Spell from the hand",
    description: "The card flies in, activates and stays. It keeps the full size of its zone and the zone outline the whole time.",
    build: handContinuous,
  },
  {
    id: "activation-set-continuous", category: "Chain", name: "Activation: Set Continuous Trap",
    description: "A Set Continuous Trap activates once and stays. It turns over exactly once and never shrinks.",
    build: () => setContinuous("none"),
  },
  {
    id: "activation-set-continuous-flip", category: "Chain", name: "Activation: Set Continuous Trap with a flip event",
    description: "The engine sends a flip event with the activation. The card still turns exactly once.",
    build: () => setContinuous("with"),
  },
  {
    id: "activation-set-continuous-flip-first", category: "Chain", name: "Activation: flip event in an earlier batch",
    description: "The flip event comes in a batch before the activation. The card turns once, at the flip, and the activation does not turn it again.",
    build: () => setContinuous("before"),
  },
  {
    id: "activation-opp-set-continuous", category: "Chain", name: "Activation: the opponent's Set Continuous Trap",
    description: "The opponent's Set Continuous Trap activates and stays. It turns exactly once.",
    build: () => setContinuous("none", OPP),
  },
  {
    id: "activation-faceup-spell", category: "Chain", name: "Activation: face-up Continuous Spell",
    description: "A Continuous Spell that is already face-up uses its effect. It never turns and keeps its zone size.",
    build: () => faceUpEffect(false),
  },
  {
    id: "activation-faceup-monster", category: "Chain", name: "Activation: face-up monster effect",
    description: "A face-up monster uses its effect. It never turns and keeps its zone size.",
    build: () => faceUpEffect(true),
  },
  {
    id: "activation-quick-play-chain", category: "Chain", name: "Activation: Quick-Play Spell in a chain",
    description: "The opponent's Set Continuous Trap is link 1; your Quick-Play Spell from the hand is link 2. Both keep their zone size.",
    build: quickPlayInChain,
  },
];

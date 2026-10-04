import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

/**
 * A flip effect that answers an attack, found in one engine batch.
 *
 * A face-down monster that is attacked and flips up with an effect ("FLIP: target 1 monster on the
 * field; destroy it") sends all of this at once: the attack, the flip, the activation, the target,
 * the destruction of the attacker, the end of the chain and, last, the battle result. Played with no
 * order the board shows the flip, the chain and the destroy together, and the attack not at all.
 *
 * The beats of this case, one after the other (virtual ms, so the FX speed setting scales them):
 *
 *   attack      the attacker strikes at its target              FLIP_SEQUENCE_TIMING.attackMs
 *   flip        the face-down card turns face-up                .flipMs
 *   activation  the card glows with the chain display           CHAIN_TIMING.activateMs (chain-state.ts)
 *   target      the chosen card is marked, even when it is the only legal one   .targetMs
 *   effect      the destroy of the chain link (its normal chain lead after the resolving badge)
 *   aftermath   the battle result of the flipped card, after the chain has ended
 *
 * Only the case where the effect removes the attacker is a sequence: the attack then has no battle
 * to play (battle-trigger.ts fizzles it), so the lunge here is its only beat. Pure: events in, one
 * description out. chain-beats.ts lays the times; BattleFx, PositionFx and ChainFx read them.
 */

export const FLIP_SEQUENCE_TIMING = {
  /** The attacker's lunge and the aim marker on its target. */
  attackMs: 400,
  /** The face-down card is face-up this long after it starts to turn (the face-up pose then holds). */
  flipMs: 300,
  /** The chosen target stays marked this long before the link resolves. */
  targetMs: 500,
  /** Reduced motion: no lunge and no 3D turn, only short marks. */
  reducedAttackMs: 250,
  reducedFlipMs: 150,
  reducedTargetMs: 320,
} as const;

export type FlipSequence = {
  attack: DuelEvent;
  /** The position event that turns the attacked card face-up. */
  flip: DuelEvent;
  /** The flipped card's chain activation. */
  activate: DuelEvent;
  /** The first target event of that link, when the engine sent one. */
  target: DuelEvent | null;
  /** The chain-resolving event of that link. */
  resolving: DuelEvent | null;
  /** The chain-end that closes the chain, when it is in the batch. */
  chainEnd: DuelEvent | null;
  /** The effect removing the attacker (a move or a destroy with a non-battle cause). */
  attackerLeft: DuelEvent;
  /** Moves and destroys of the link's effect: the engine sends some of them after the link has resolved. */
  effects: DuelEvent[];
  /** Moves and destroys after the chain end that the fight itself caused (the flipped card's death). */
  aftermath: DuelEvent[];
};

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean =>
  a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

const byId = (events: readonly DuelEvent[]): DuelEvent[] => [...events].filter((event) => typeof event.id === "number").sort((a, b) => a.id - b.id);

/** True for a cause that did not come from the fight. An event with no cause is not an effect. */
const isEffectCause = (cause: string | undefined): boolean => cause != null && cause !== "battle";

/**
 * Every flip-effect sequence in `events` (a batch or a window). An attack counts when the card it
 * targets flips, activates from the same zone, and the attacker then leaves by an effect, all before
 * the next attack or phase.
 */
export function findFlipSequences(events: readonly DuelEvent[]): FlipSequence[] {
  const ordered = byId(events);
  const found: FlipSequence[] = [];
  ordered.forEach((attack, at) => {
    if (attack.kind !== "attack" || !attack.zone || !attack.target) return;
    const window: DuelEvent[] = [];
    for (const event of ordered.slice(at + 1)) {
      if (event.kind === "attack" || event.kind === "phase") break;
      window.push(event);
    }
    const flip = window.find((event) => event.kind === "position" && event.flip === true && sameZone(event.zone, attack.target));
    if (!flip) return;
    const activate = window.find((event) => event.kind === "activate" && event.id > flip.id && typeof event.chainIndex === "number" && sameZone(event.zone, attack.target));
    if (!activate) return;
    const index = activate.chainIndex;
    const attackerLeft = window.find((event) => event.id > activate.id && (
      (event.kind === "destroy" && sameZone(event.zone, attack.zone) && isEffectCause(event.cause)) ||
      (event.kind === "move" && sameZone(event.from, attack.zone) && event.cause !== "battle")
    ));
    if (!attackerLeft) return;
    const link = (kind: string) => window.find((event) => event.kind === kind && event.chainIndex === index && event.id > activate.id) ?? null;
    const chainEnd = window.find((event) => event.kind === "chain-end" && event.id > activate.id) ?? null;
    const effects = window.filter((event) => event.id > activate.id && (!chainEnd || event.id < chainEnd.id) &&
      (event.kind === "move" || event.kind === "destroy") && isEffectCause(event.cause));
    const aftermath = chainEnd
      ? window.filter((event) => event.id > chainEnd.id && (event.kind === "move" || event.kind === "destroy") && !isEffectCause(event.cause))
      : [];
    found.push({
      attack,
      flip,
      activate,
      target: link("target"),
      resolving: link("chain-resolving"),
      chainEnd,
      attackerLeft,
      effects,
      aftermath,
    });
  });
  return found;
}

/** The flip sequence that begins with this attack, or null. */
export function flipSequenceOf(events: readonly DuelEvent[], attackId: number): FlipSequence | null {
  return findFlipSequences(events).find((sequence) => sequence.attack.id === attackId) ?? null;
}

/** Step lengths of the sequence beats before the chain, in virtual ms. */
export function flipSequenceSteps(reduced: boolean): { attackMs: number; flipMs: number; targetMs: number } {
  const t = FLIP_SEQUENCE_TIMING;
  return reduced
    ? { attackMs: t.reducedAttackMs, flipMs: t.reducedFlipMs, targetMs: t.reducedTargetMs }
    : { attackMs: t.attackMs, flipMs: t.flipMs, targetMs: t.targetMs };
}

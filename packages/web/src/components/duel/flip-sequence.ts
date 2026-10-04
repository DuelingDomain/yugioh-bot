import type { DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

/**
 * A flip effect that answers an attack.
 *
 * A face-down monster that is attacked and flips up with an effect ("FLIP: target 1 monster on the
 * field; destroy it") sends the attack, the flip, the activation, the target, the effect, the end of
 * the chain and, last, the battle result. With one legal target they come in one engine batch; with
 * a real choice the engine stops after the activation, so they come in two or more. Played with no
 * order the board shows the flip, the chain and the effect together, and the attack not at all.
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
 * The sequence starts when the flip is followed by its activation, whether or not the attacker
 * survives. The lunge here is then the attack's only beat: BattleFx plays no battle for it, and the
 * result of the fight (a battle destroy, battle damage) waits for the chain end. The sequence is a
 * small state machine over the event stream, so it works across batches: `advanceFlipTracks` takes
 * the new events and returns what each one is for. chain-beats.ts lays the times; BattleFx,
 * PositionFx and ChainFx read them.
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

/** One attack that may become a flip sequence, with what the stream has shown of it so far. */
export type FlipTrack = {
  attack: DuelEvent;
  flip: DuelEvent | null;
  /** The damage calculation event, when the engine sent it before the activation. */
  battle: DuelEvent | null;
  /** Battle damage the engine sent after the flip and before the activation (its real order). */
  damage: DuelEvent[];
  activate: DuelEvent | null;
  target: DuelEvent | null;
  resolving: DuelEvent | null;
  chainEnd: DuelEvent | null;
};

/** What a new event is for in a flip sequence. `open` is the activation that makes the sequence. */
export type FlipStep =
  | {
      role: "open"; track: FlipTrack; event: DuelEvent; flipFresh: boolean;
      /** The damage calculation came in an earlier call: the normal battle has played, so the sequence has no attack beat. */
      attackPlayed: boolean;
      /** Early battle damage that is new in this call. */
      damage: DuelEvent[];
    }
  | { role: "target" | "resolving" | "effect" | "chain-end" | "aftermath"; track: FlipTrack; event: DuelEvent };

const sameZone = (a: DuelZoneRef | undefined, b: DuelZoneRef | undefined): boolean =>
  a != null && b != null && a.controller === b.controller && a.location === b.location && a.sequence === b.sequence;

const byId = (events: readonly DuelEvent[]): DuelEvent[] => [...events].filter((event) => typeof event.id === "number").sort((a, b) => a.id - b.id);

/** True for a cause that did not come from the fight. An event with no cause is not an effect. */
const isEffectCause = (cause: string | undefined): boolean => cause != null && cause !== "battle";

/** True for the fight's own result: a battle destroy or move, or battle damage. */
function isFightResult(event: DuelEvent): boolean {
  if (event.kind === "damage") return event.cause == null || event.cause === "battle";
  return (event.kind === "move" || event.kind === "destroy") && !isEffectCause(event.cause);
}

/**
 * Feeds new events (any batch, in any number of calls) to the open tracks. A track opens at an
 * attack on a monster, learns the flip of that monster, and becomes a sequence when the flipped card
 * activates. A new attack, a phase or the Damage Step end closes the open tracks. Mutates `tracks`
 * and returns the role of each event that belongs to a sequence, in id order.
 */
export function advanceFlipTracks(tracks: FlipTrack[], events: readonly DuelEvent[]): FlipStep[] {
  const ordered = byId(events);
  const freshIds = new Set(ordered.map((event) => event.id));
  const steps: FlipStep[] = [];
  for (const event of ordered) {
    if (event.kind === "phase" || event.kind === "attack" || event.kind === "battle-end") {
      tracks.length = 0;
      if (event.kind === "attack" && event.zone && event.target) {
        tracks.push({ attack: event, flip: null, battle: null, damage: [], activate: null, target: null, resolving: null, chainEnd: null });
      }
      continue;
    }
    const track = tracks[tracks.length - 1];
    if (!track) continue;
    const { attack } = track;
    if (!track.activate) {
      if (event.kind === "position" && event.flip === true && !track.flip && sameZone(event.zone, attack.target)) track.flip = event;
      else if (event.kind === "battle" && track.flip && !track.battle) track.battle = event;
      // The engine calculates the damage before the activation; the damage waits for the strike (chain-beats.ts).
      else if (event.kind === "damage" && track.flip && isFightResult(event)) track.damage.push(event);
      else if (event.kind === "activate" && track.flip && typeof event.chainIndex === "number" && sameZone(event.zone, attack.target)) {
        track.activate = event;
        steps.push({
          role: "open", track, event, flipFresh: freshIds.has(track.flip.id),
          attackPlayed: track.battle != null && !freshIds.has(track.battle.id),
          damage: track.damage.filter((damage) => freshIds.has(damage.id)),
        });
      }
      continue;
    }
    const index = track.activate.chainIndex;
    if (!track.chainEnd) {
      if (event.kind === "target" && event.chainIndex === index && !track.target && !track.resolving) {
        track.target = event;
        steps.push({ role: "target", track, event });
      } else if (event.kind === "chain-resolving" && event.chainIndex === index && !track.resolving) {
        track.resolving = event;
        steps.push({ role: "resolving", track, event });
      } else if (event.kind === "chain-end") {
        track.chainEnd = event;
        steps.push({ role: "chain-end", track, event });
      } else if ((event.kind === "move" || event.kind === "destroy") && isEffectCause(event.cause)) {
        steps.push({ role: "effect", track, event });
      }
    } else if (isFightResult(event)) {
      steps.push({ role: "aftermath", track, event });
    }
  }
  return steps;
}

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
  /** The chain-end that closes the chain, when it is in the window. */
  chainEnd: DuelEvent | null;
  /** Moves and destroys of the link's effect: the engine sends some of them after the link has resolved. */
  effects: DuelEvent[];
  /** The fight's own result after the chain end: a battle destroy or move, battle damage. */
  aftermath: DuelEvent[];
  /** Battle damage the engine sent before the activation. */
  damage: DuelEvent[];
};

/** Every flip sequence in `events` (a whole log or a window). Stateless: runs the tracker over it. */
export function findFlipSequences(events: readonly DuelEvent[]): FlipSequence[] {
  const tracks: FlipTrack[] = [];
  const found = new Map<FlipTrack, FlipSequence>();
  for (const step of advanceFlipTracks(tracks, events)) {
    const { track, event } = step;
    if (step.role === "open") {
      found.set(track, {
        attack: track.attack, flip: track.flip as DuelEvent, activate: event,
        target: null, resolving: null, chainEnd: null, effects: [], aftermath: [], damage: track.damage,
      });
      continue;
    }
    const sequence = found.get(track);
    if (!sequence) continue;
    if (step.role === "target") sequence.target = event;
    else if (step.role === "resolving") sequence.resolving = event;
    else if (step.role === "chain-end") sequence.chainEnd = event;
    else if (step.role === "effect") sequence.effects.push(event);
    else sequence.aftermath.push(event);
  }
  return [...found.values()];
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

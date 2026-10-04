import type { DuelEvent } from "@yugidraft/shared/duels";
import { chainEffectLead, chainStepDelay, isChainEvent } from "./chain-state";

/**
 * The beats of a chain on the board: when each chain event plays, and when the effect of a
 * resolving link plays.
 *
 * A chain resolves inside one engine batch, so every layer gets all of it at once. ChainFx plays
 * the chain events one beat at a time (a pulse on the resolving badge, a tick as it clears, an "up
 * next" mark on the link below) and this plan is the clock for it. The plan is made once, when the
 * batch arrives, and read by everything else, like the battle hold:
 *
 *  - `chainBeatAt(id)`: when ChainFx plays this chain event. The banners and sounds of the same
 *    events wait for it, so a "Negated" banner appears with the slash on its badge.
 *  - `chainEffectAt(id)`: the earliest moment the effect of a link may start (a card flight, a
 *    destroy, a summon or a flip while that link resolves). It is a short lead after the badge
 *    starts to pulse, so the effect plays while the badge is still the thing to look at, never
 *    before it. The move planner, SummonFx, PositionFx and DestroyFx start no earlier than this.
 *
 * Times are performance.now() stamps. 0 means "no plan: play now".
 */

type PlanOptions = {
  now: number;
  reduced: boolean;
  duelKey: string;
};

/** Event kinds that are the visible effect of a resolving link. */
const EFFECT_KINDS = new Set<string>(["move", "destroy", "summon", "set", "position", "equip"]);
const MAX_KEPT = 400;

const beats = new Map<number, number>();
const effects = new Map<number, number>();
/** Presentation of a paired event can precede its deferred engine marker. */
const presentations = new Map<number, number>();
const handled = new Set<number>();
/** The link a chain event belongs to: the last activation of each chain index, and the beat event that first resolves it. */
const activations = new Map<number, number>();
const closers = new Map<number, number>();
const state = { key: "", freeAt: 0, resolvingAt: null as number | null, resolvingId: 0 };

export function resetChainBeats(key = ""): void {
  beats.clear();
  effects.clear();
  presentations.clear();
  handled.clear();
  activations.clear();
  closers.clear();
  state.key = key;
  state.freeAt = 0;
  state.resolvingAt = null;
  state.resolvingId = 0;
}

/** When ChainFx plays this chain event; 0 when it was never planned. */
export function chainBeatAt(eventId: number): number {
  return beats.get(eventId) ?? 0;
}

/** The earliest start of the effect carried by this event; 0 when nothing holds it. */
export function chainEffectAt(eventId: number): number {
  return presentations.get(eventId) ?? effects.get(eventId) ?? 0;
}

/**
 * When the link activated by this event stops being announced: the beat on which it starts to
 * resolve (or is negated). 0 while that is not known (an open response window) or never planned.
 */
export function activationEndAt(activateId: number): number {
  const closer = closers.get(activateId);
  return closer == null ? 0 : chainBeatAt(closer);
}

export function presentEffectAt(eventId: number, at: number): void {
  presentations.set(eventId, at);
  trim(presentations);
}

/** Extend an existing chain gate to an actual animation handoff, preserving every later beat. */
export function holdChainFrom(eventId: number, until: number): void {
  const following = [...beats].filter(([id]) => id >= eventId);
  const first = following.reduce((min, [, at]) => Math.min(min, at), Infinity);
  const delta = Math.max(0, until - first);
  if (!Number.isFinite(delta) || delta <= 0) return;
  for (const [id, at] of following) beats.set(id, at + delta);
  for (const [id, at] of effects) if (id >= eventId) effects.set(id, at + delta);
  if (state.resolvingAt != null && state.resolvingId >= eventId) state.resolvingAt += delta;
  state.freeAt += delta;
}

export function holdChainAfter(eventId: number, until: number): void {
  holdChainFrom(eventId + 1, until);
  // A response window can split activation from resolution: keep the handoff for the next batch.
  state.freeAt = Math.max(state.freeAt, until);
}

/** When the last planned beat has had its hold; 0 when nothing is planned. */
export function chainBeatsEndAt(): number {
  return state.freeAt;
}

function trim(map: Map<number, number>): void {
  while (map.size > MAX_KEPT) map.delete(map.keys().next().value as number);
}

/**
 * Plans every chain event in `fresh` (and the effects inside a resolving link) that has no plan
 * yet. Safe to call again with the same batch, from any layer: planned events are skipped.
 */
export function planChainBeats(fresh: readonly DuelEvent[], options: PlanOptions): void {
  const { now, reduced, duelKey } = options;
  if (state.key !== duelKey) resetChainBeats(duelKey);
  const ordered = fresh.filter((event) => typeof event.id === "number" && !handled.has(event.id)).sort((a, b) => a.id - b.id);
  const total = ordered.filter(isChainEvent).length;
  let cursor = Math.max(now, state.freeAt);
  let played = 0;
  for (const event of ordered) {
    handled.add(event.id);
    if (isChainEvent(event)) {
      beats.set(event.id, cursor);
      if (event.chainIndex != null) {
        if (event.kind === "activate") activations.set(event.chainIndex, event.id);
        else if (event.kind === "chain-resolving" || event.kind === "chain-negated") {
          const opened = activations.get(event.chainIndex);
          if (opened != null && !closers.has(opened)) closers.set(opened, event.id);
        }
      }
      if (event.kind === "chain-resolving") { state.resolvingAt = cursor; state.resolvingId = event.id; }
      else if (event.kind === "chain-resolved" || event.kind === "chain-end" || event.kind === "activate") state.resolvingAt = null;
      played += 1;
      cursor += chainStepDelay(event.kind, total - played, reduced);
      continue;
    }
    if (state.resolvingAt != null && EFFECT_KINDS.has(event.kind)) {
      const at = state.resolvingAt + chainEffectLead(reduced);
      if (at > now + 30) effects.set(event.id, at);
    }
  }
  if (played > 0) state.freeAt = cursor;
  trim(beats);
  trim(effects);
  trim(closers);
  trim(activations);
  while (handled.size > MAX_KEPT * 2) handled.delete(handled.values().next().value as number);
}

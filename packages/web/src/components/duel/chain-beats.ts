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
const handled = new Set<number>();
const state = { key: "", freeAt: 0, resolvingAt: null as number | null };

export function resetChainBeats(key = ""): void {
  beats.clear();
  effects.clear();
  handled.clear();
  state.key = key;
  state.freeAt = 0;
  state.resolvingAt = null;
}

/** When ChainFx plays this chain event; 0 when it was never planned. */
export function chainBeatAt(eventId: number): number {
  return beats.get(eventId) ?? 0;
}

/** The earliest start of the effect carried by this event; 0 when nothing holds it. */
export function chainEffectAt(eventId: number): number {
  return effects.get(eventId) ?? 0;
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
      if (event.kind === "chain-resolving") state.resolvingAt = cursor;
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
  while (handled.size > MAX_KEPT * 2) handled.delete(handled.values().next().value as number);
}

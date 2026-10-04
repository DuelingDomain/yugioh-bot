import type { DuelEvent } from "@yugidraft/shared/duels";
import { chainBeatAt, chainEffectAt, holdChainAfter, holdChainFrom, presentEffectAt } from "./chain-beats";
import { battleDestroyAt, battleTakeover, BREAK_SETTLE_MS } from "./battle-hold";
import { CARD_FX, MOVE_PACE } from "./duel-timing";
import { holdDestroySceneUntil } from "./destroy-scene-hold";
import { LOCATION_SZONE, TYPE_SPELL, TYPE_TRAP } from "./constants";
import type { MovePlan } from "./move-plan";

const state = { readyAt: 0, placedAt: 0 };
const handled = new Set<number>();
const sources = new Map<string, number>();
const zoneKey = (zone: NonNullable<DuelEvent["zone"]>) => `${zone.controller}:${zone.location}:${zone.sequence}`;

export function resetEffectSequence(): void {
  state.readyAt = 0;
  state.placedAt = 0;
  handled.clear();
  sources.clear();
}

const isSpellTrap = (event: DuelEvent) => event.zone?.location === LOCATION_SZONE &&
  !!(event.card && event.card.type & (TYPE_SPELL | TYPE_TRAP));

/** Reconcile measured flights and render-captured scenes with the chain's existing beats. */
export function sequenceEffects(fresh: readonly DuelEvent[], moves: readonly MovePlan[], now: number, reduced: boolean): void {
  const ordered = [...fresh].sort((a, b) => a.id - b.id);
  const byId = new Map(moves.map((move) => [move.id, move]));
  const destroys = new Map(ordered.filter((event) => event.kind === "destroy").map((event) => [event.id, event]));
  const groups = new Map<string, Array<{ move: MovePlan; destroy: DuelEvent }>>();
  const groupOf = new Map<number, string>();
  let segment = 0;
  for (const event of ordered) {
    if (event.kind === "chain-resolving") segment += 1;
    const move = byId.get(event.id);
    const destroy = move?.pairedIds.map((id) => destroys.get(id)).find((item) => item != null);
    if (!move || !destroy || destroy.cause !== "effect" ||
      (destroy.sourceKind !== "spell" && destroy.sourceKind !== "trap")) continue;
    const key = `${segment}:${destroy.sourceSeat}:${destroy.sourceCode}`;
    const group = groups.get(key) ?? [];
    group.push({ move, destroy });
    groups.set(key, group);
    groupOf.set(event.id, key);
  }
  const playedGroups = new Set<string>();
  const isCleanup = (move: MovePlan) => move.event.from != null && sources.has(zoneKey(move.event.from)) &&
    sources.get(zoneKey(move.event.from)) === move.event.card?.code;
  for (const event of ordered) {
    if (handled.has(event.id)) continue;
    handled.add(event.id);
    if (event.kind === "chain-end") sources.clear();
    const move = byId.get(event.id);
    const groupKey = groupOf.get(event.id);
    if (groupKey) {
      if (playedGroups.has(groupKey)) continue;
      playedGroups.add(groupKey);
      const group = groups.get(groupKey)!;
      const startAt = Math.max(now, state.readyAt, ...group.map(({ move }) => Math.max(move.startAt, chainEffectAt(move.id))));
      let settleAt = startAt;
      for (const { move: target, destroy } of group) {
        const scene = holdDestroySceneUntil(destroy.id, startAt);
        const destroyAt = scene?.startAt ?? startAt;
        const handoffAt = destroyAt + (scene?.handoffMs ?? (reduced ? CARD_FX.reducedEffectMs : MOVE_PACE.destroyBreakMs + CARD_FX.destroyFlashMs));
        const takeover = battleTakeover(target.event.from, now);
        const heldAt = battleDestroyAt(target.event.from, now);
        // One resolution is one break phase. Its targets can travel together; obsolete serial
        // crack leads must not introduce empty gaps between flights after the shared break.
        target.startAt = Math.max(target.startAt, handoffAt, takeover?.moveAt ?? (heldAt > 0 ? heldAt + BREAK_SETTLE_MS : 0));
        target.landAt = target.startAt + target.durationMs;
        // The deferred marker is presented with its paired MOVE, even after CHAIN_SOLVED.
        if (!target.takeover && heldAt === 0) target.leadMs = target.startAt - destroyAt;
        presentEffectAt(destroy.id, destroyAt);
        settleAt = Math.max(settleAt, target.landAt + target.holdMs, scene ? scene.startAt + scene.totalMs : 0);
      }
      state.readyAt = settleAt;
      holdChainAfter(event.id, settleAt);
      continue;
    }
    // Paired destroy markers are already pinned to the preceding target's phase.
    if (event.kind === "destroy" && moves.some((item) => item.pairedIds.includes(event.id))) continue;
    if (event.kind === "activate" && isSpellTrap(event)) {
      sources.set(zoneKey(event.zone!), event.card!.code);
      const incoming = moves.find((item) => item.pairedIds.includes(event.id));
      // A trap that answers a summon or a Set waits for that card to land: the answer follows what it answers.
      for (const earlier of ordered) {
        if (earlier.id >= event.id) break;
        const placed = byId.get(earlier.id);
        if (placed && (earlier.reason === "summon" || earlier.reason === "set")) state.placedAt = Math.max(state.placedAt, placed.landAt);
      }
      const startAt = Math.max(now, state.readyAt, chainBeatAt(event.id), incoming?.landAt ?? 0, state.placedAt);
      holdChainFrom(event.id, startAt);
      presentEffectAt(event.id, startAt);
      state.readyAt = startAt + (reduced ? CARD_FX.reducedEffectMs : CARD_FX.activationMs);
      holdChainAfter(event.id, state.readyAt);
      continue;
    }
    if (state.readyAt > now) {
      if (move) {
        // Keep source cleanup as a phase boundary. Other flights retain the queue's
        // overlap and compression: translate their entire layout by one nonnegative delta.
        const cleanup = isCleanup(move);
        const run = [move];
        if (!cleanup) {
          for (const following of ordered.slice(ordered.indexOf(event) + 1)) {
            const next = byId.get(following.id);
            if (following.kind === "activate" || following.kind === "chain-resolving" || following.kind === "chain-end" ||
              groupOf.has(following.id) || (next && isCleanup(next))) break;
            if (next && !handled.has(following.id)) run.push(next);
          }
        }
        const delta = Math.max(0, ...run.map(item => {
          const predecessor = moves.find(previous => previous.handoff === item.id);
          return Math.max(now, state.readyAt + item.leadMs, item.notBeforeAt ?? 0, chainEffectAt(item.id),
            predecessor && !run.includes(predecessor) ? predecessor.landAt : 0) - item.startAt;
        }));
        for (const item of run) {
          handled.add(item.id);
          item.startAt += delta;
          item.landAt = item.startAt + item.durationMs;
        }
        state.readyAt = Math.max(state.readyAt, ...run.map(item => item.landAt + item.holdMs));
        holdChainAfter(run.at(-1)!.id, state.readyAt);
        if (cleanup) sources.delete(zoneKey(move.event.from!));
      } else if (event.kind === "activate") {
        holdChainFrom(event.id, state.readyAt);
        presentEffectAt(event.id, Math.max(state.readyAt, chainBeatAt(event.id), chainEffectAt(event.id)));
      } else if (!["chain-resolving", "chain-resolved", "chain-negated", "chain-end"].includes(event.kind)) {
        presentEffectAt(event.id, Math.max(state.readyAt, chainEffectAt(event.id)));
      }
    }
  }
  // A later batch answers what this one placed.
  for (const event of ordered) {
    const placed = byId.get(event.id);
    if (placed && (event.reason === "summon" || event.reason === "set")) state.placedAt = Math.max(state.placedAt, placed.landAt);
  }
  while (handled.size > 800) handled.delete(handled.values().next().value!);
}

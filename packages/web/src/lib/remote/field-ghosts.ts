"use client";

import { useSyncExternalStore } from "react";
import { fieldZoneLocation, type FieldTrack } from "@yugidraft/vision";
import type { RemoteState } from "@yugidraft/shared/remote";

type TwinCard = RemoteState["seats"][number]["twin"][number];

/**
 * The first look at a card on the virtual board. The watcher has a still outline in a zone, so the board shows a
 * placeholder card there at once. It is local to this browser and is the same card as the "Reading…" placeholder the
 * watcher saves a moment later (same ref, same look): when that twin arrives, the ghost is simply replaced by it.
 */
export interface FieldGhost { id: string; zone: string; slot?: number; faceDown: boolean; defense: boolean }

/** A pile has no outline to show; the watcher does not place a card there either. */
const PILES = new Set(["DECK", "EXTRA", "GY", "BANISHED"]);
/** Moved less than this (fraction of the frame) between two samples: the card lies still. */
const STILL = 0.012;
/** A card still for this long counts as still even when no second sample has arrived. */
export const GHOST_STILL_MS = 100;

export interface GhostMemo { x: number; y: number; since: number; samples: number }

/**
 * Ghosts for one watcher snapshot. A track qualifies when it is visible, in a zone with a slot, a clear (not covered or
 * partial) outline, and it did not move since the last sample (or has been in place for `GHOST_STILL_MS`).
 */
export function nextFieldGhosts(tracks: readonly FieldTrack[], memo: Map<string, GhostMemo>, now: number): { ghosts: FieldGhost[]; pending: boolean } {
  const seen = new Set<string>(); const ghosts: FieldGhost[] = []; let pending = false;
  for (const track of tracks) {
    const quad = track.card.quad;
    if (track.removed || track.visible === false || track.state === "dismissed" || PILES.has(track.zone) || quad.length < 3) continue;
    seen.add(track.id);
    const x = quad.reduce((sum, p) => sum + p.x, 0) / quad.length, y = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
    const before = memo.get(track.id);
    const same = before && Math.hypot(before.x - x, before.y - y) < STILL;
    const entry: GhostMemo = same ? { ...before, samples: before.samples + 1 } : { x, y, since: now, samples: 0 };
    memo.set(track.id, same ? { ...entry, x: before.x, y: before.y } : entry);
    if (track.card.confidence < 0.6 || track.card.partial || track.card.covered) continue;
    if (entry.samples >= 1 || track.lastSeen - track.firstSeen >= GHOST_STILL_MS || now - entry.since >= GHOST_STILL_MS) {
      const location = fieldZoneLocation(track.zone);
      ghosts.push({ id: track.id, zone: location.zone, slot: location.slot, faceDown: track.faceDown, defense: track.position === "defense" || (track.faceDown && /^M|^EMZ/.test(track.zone)) });
    } else pending = true;
  }
  for (const id of memo.keys()) if (!seen.has(id)) memo.delete(id);
  return { ghosts, pending };
}

/** The ghosts as twin cards, so the board draws them in the same cell as the card that follows. Skips occupied cells. */
export function ghostTwins(ghosts: readonly FieldGhost[], twin: readonly TwinCard[]): TwinCard[] {
  return ghosts.flatMap(ghost => {
    if (twin.some(card => card.ref === ghost.id || (card.zone === ghost.zone && (card.slot ?? 0) === (ghost.slot ?? 0)))) return [];
    return [{ ref: ghost.id, faceUp: false, position: ghost.defense ? "defense" : "attack", zone: ghost.zone, ...(ghost.slot ? { slot: ghost.slot } : {}) } as TwinCard];
  });
}

const EMPTY: readonly FieldGhost[] = [];
const store = new Map<string, readonly FieldGhost[]>();
const listeners = new Set<() => void>();

/** Sets the ghosts of one table seat. Equal lists change nothing, so a steady watcher causes no render. */
export function setFieldGhosts(key: string, ghosts: readonly FieldGhost[]): void {
  const before = store.get(key) ?? EMPTY;
  if (before.length === ghosts.length && before.every((g, i) => g.id === ghosts[i].id && g.zone === ghosts[i].zone && g.slot === ghosts[i].slot && g.faceDown === ghosts[i].faceDown && g.defense === ghosts[i].defense)) return;
  if (ghosts.length) store.set(key, ghosts); else store.delete(key);
  for (const listener of listeners) listener();
}

export const ghostKey = (slug: string, seat: number) => `${slug}:${seat}`;

export function useFieldGhosts(key: string): readonly FieldGhost[] {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => store.get(key) ?? EMPTY,
    () => EMPTY,
  );
}

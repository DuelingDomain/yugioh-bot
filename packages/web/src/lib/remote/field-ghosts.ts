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
/** A track the placer has not turned into a card by now is not a new card (a die, a counter): the ghost goes. */
export const GHOST_MAX_MS = 2500;
/** After a card leaves a cell (removal, Undo) the cell shows no ghost for this long. */
const BLOCK_MS = 1000;

export interface GhostMemo { x: number; y: number; born: number; since: number; samples: number }
export interface GhostState { memo: Map<string, GhostMemo>; last?: readonly FieldTrack[]; out: FieldGhost[] }
export const newGhostState = (): GhostState => ({ memo: new Map(), out: [] });

const blocked = new Map<string, number>();
/** A card left this cell of the seat: no ghost there for a moment, so the track that is still on the mat does not flash. */
export function blockGhostCell(key: string, zone: string, slot?: number, now = Date.now()): void {
  blocked.set(`${key}:${zone}:${slot ?? 0}`, now + BLOCK_MS);
}
const isBlocked = (key: string, zone: string, slot: number | undefined, now: number) => (blocked.get(`${key}:${zone}:${slot ?? 0}`) ?? 0) > now;

/**
 * Ghosts for one watcher snapshot. A track qualifies when it is a new, unread outline (a candidate the placer has not
 * bound to a card), clear (not covered or partial), in a zone with a slot, young (see `GHOST_MAX_MS`), and still.
 * The same snapshot gives the same answer (a repeated effect run does not count as a new sample).
 */
export function nextFieldGhosts(tracks: readonly FieldTrack[], state: GhostState, now: number, key: string, bound: (id: string) => boolean): FieldGhost[] {
  if (state.last === tracks) return state.out;
  const { memo } = state; const seen = new Set<string>(); const ghosts: FieldGhost[] = [];
  for (const track of tracks) {
    const quad = track.card.quad;
    if (track.removed || track.visible === false || PILES.has(track.zone) || quad.length < 3) continue;
    seen.add(track.id);
    const x = quad.reduce((sum, p) => sum + p.x, 0) / quad.length, y = quad.reduce((sum, p) => sum + p.y, 0) / quad.length;
    const before = memo.get(track.id);
    const same = !!before && Math.hypot(before.x - x, before.y - y) < STILL;
    const entry: GhostMemo = before ? same ? { ...before, samples: before.samples + 1 } : { x, y, born: before.born, since: now, samples: 0 } : { x, y, born: now, since: now, samples: 0 };
    memo.set(track.id, entry);
    if (track.state !== "candidate" || bound(track.id) || now - entry.born > GHOST_MAX_MS) continue;
    if (track.card.confidence < 0.6 || track.card.partial || track.card.covered) continue;
    if (entry.samples >= 1 || now - entry.since >= GHOST_STILL_MS) {
      const location = fieldZoneLocation(track.zone);
      if (isBlocked(key, location.zone, location.slot, now)) continue;
      ghosts.push({ id: track.id, zone: location.zone, slot: location.slot, faceDown: track.faceDown, defense: track.position === "defense" || (track.faceDown && /^M|^EMZ/.test(track.zone)) });
    }
  }
  for (const id of memo.keys()) if (!seen.has(id)) memo.delete(id);
  state.last = tracks; state.out = ghosts;
  return ghosts;
}

/** The ghosts as twin cards, so the board draws them in the same cell as the card that follows. Skips occupied cells. */
export function ghostTwins(ghosts: readonly FieldGhost[], twin: readonly TwinCard[]): TwinCard[] {
  return ghosts.flatMap(ghost => {
    if (twin.some(card => card.ref === ghost.id || (card.zone === ghost.zone && (card.slot ?? 0) === (ghost.slot ?? 0)))) return [];
    return [{ ref: ghost.id, faceUp: !ghost.faceDown, position: ghost.defense ? "defense" : "attack", zone: ghost.zone, ...(ghost.slot ? { slot: ghost.slot } : {}) } as TwinCard];
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

export function useFieldGhosts(key: string): readonly FieldGhost[] {
  return useSyncExternalStore(
    listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    () => store.get(key) ?? EMPTY,
    () => EMPTY,
  );
}

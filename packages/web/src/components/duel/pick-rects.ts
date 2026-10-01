import { ADD_TO_HAND } from "./duel-timing";

/**
 * Where the cards of a card strip were on screen, so a card that is picked there and then goes to a
 * hand (an "Added to hand" showcase) can start its flight from where the player saw it.
 *
 * The strip writes the rects while it is open and says when it closes. A card is found by its passcode
 * and the location it was picked from. A rect is used once (two copies of a card are two strip cards),
 * and only while the strip is open or closed less than `pickRectTtlMs` ago. `stripSeenWithin` tells that
 * a strip was on screen not long ago, so a card that left a pile after a pick whose rect has expired
 * still starts at the middle of the board, as if the strip had just closed.
 *
 * Plain module state, like the other board plans; `resetPickRects` clears it (room change, tests).
 */

export type PickRect = { left: number; top: number; width: number; height: number };
export type PickEntry = { code: number; location: number; rect: PickRect };

type State = { rects: Map<string, PickRect[]>; locations: Set<number>; closedAt: number | null; seenAt: number | null };

const state: State = { rects: new Map(), locations: new Set(), closedAt: null, seenAt: null };

const keyOf = (code: number, location: number): string => `${code}:${location}`;

export function resetPickRects(): void {
  state.rects.clear();
  state.locations.clear();
  state.closedAt = null;
  state.seenAt = null;
}

/** The strip is open and its cards are at these rects (called again whenever they move). */
export function rememberPickRects(entries: readonly PickEntry[], now: number): void {
  state.rects.clear();
  state.locations.clear();
  for (const entry of entries) {
    if (entry.code <= 0 || entry.rect.width < 4 || entry.rect.height < 4) continue;
    const key = keyOf(entry.code, entry.location);
    const list = state.rects.get(key) ?? [];
    list.push({ ...entry.rect });
    state.locations.add(entry.location);
    state.rects.set(key, list);
  }
  state.closedAt = null;
  state.seenAt = now;
}

/** The strip closed: its rects stay for the TTL. */
export function closePickRects(now: number): void {
  if (state.rects.size === 0 && state.seenAt == null) return;
  state.closedAt = now;
  state.seenAt = now;
}

function live(now: number, ttlMs: number): boolean {
  return state.closedAt == null || now - state.closedAt <= ttlMs;
}

/**
 * The rect the strip showed this card at, and forgets it (a second card with the same passcode finds the
 * next copy). Falls back to any location when the strip did not know where the card came from.
 */
export function takePickRect(code: number, location: number, now: number, ttlMs: number = ADD_TO_HAND.pickRectTtlMs): PickRect | null {
  if (code <= 0 || !live(now, ttlMs)) return null;
  for (const key of [keyOf(code, location), keyOf(code, 0)]) {
    const list = state.rects.get(key);
    const rect = list?.shift();
    if (list && list.length === 0) state.rects.delete(key);
    if (rect) return rect;
  }
  return null;
}

/**
 * A strip that showed cards from `location` (any place when 0 or omitted) is open, or closed less than
 * `windowMs` ago. The strip's rects may be gone by then, but the card was picked there.
 */
export function stripSeenWithin(now: number, location = 0, windowMs: number = ADD_TO_HAND.pickWindowMs): boolean {
  if (state.seenAt == null) return false;
  if (state.closedAt != null && now - state.closedAt > windowMs) return false;
  return location === 0 || state.locations.has(location) || state.locations.has(0);
}

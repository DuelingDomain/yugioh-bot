"use client";

// One shared state for the coin toss, for every duel screen (1v1 room, 3D, table, Tag):
//   1. the input lock: while a toss plays nothing on the duel screen may take a click, a tap or a key;
//   2. the log hold: a toss line of the duel log stays hidden until its result has landed.
// The picture is coin-toss-fx.tsx; it takes and gives back both. Handlers that can send an answer also
// ask `isCoinTossActive()`, so a queued key or a fast click cannot get past the block.
import { useSyncExternalStore } from "react";

/* ---------- the input lock ---------- */

const locks = new Set<symbol>();
const lockListeners = new Set<() => void>();
const emitLock = () => { for (const listener of [...lockListeners]) listener(); };

/** Take the lock. The returned function gives it back (safe to call twice). */
export function acquireCoinLock(): () => void {
  const token = Symbol("coin-toss");
  locks.add(token);
  emitLock();
  return () => {
    if (locks.delete(token)) emitLock();
  };
}

/** True while a coin toss plays on this duel screen. */
export function isCoinTossActive(): boolean {
  return locks.size > 0;
}

function subscribeLock(listener: () => void): () => void {
  lockListeners.add(listener);
  return () => { lockListeners.delete(listener); };
}

/** Resolves when no toss plays (at once when none does), or when the signal aborts. */
export function waitForCoinIdle(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (!isCoinTossActive() || signal?.aborted) {
      resolve();
      return;
    }
    const done = () => {
      lockListeners.delete(check);
      signal?.removeEventListener("abort", done);
      resolve();
    };
    const check = () => { if (!isCoinTossActive()) done(); };
    lockListeners.add(check);
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Re-renders when the toss starts or ends. */
export function useCoinTossLocked(): boolean {
  return useSyncExternalStore(subscribeLock, isCoinTossActive, () => false);
}

/* ---------- the log hold ---------- */

const EMPTY: ReadonlySet<number> = new Set();
const holds = new Map<number, number>();
let heldSnapshot: ReadonlySet<number> = EMPTY;
const holdListeners = new Set<() => void>();

function publishHolds(): void {
  heldSnapshot = holds.size === 0 ? EMPTY : new Set(holds.keys());
  for (const listener of [...holdListeners]) listener();
}

/** Hide the log line that belongs to this toss event. The returned function shows it again. */
export function holdTossLog(eventId: number): () => void {
  holds.set(eventId, (holds.get(eventId) ?? 0) + 1);
  publishHolds();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    const left = (holds.get(eventId) ?? 1) - 1;
    if (left > 0) holds.set(eventId, left);
    else holds.delete(eventId);
    publishHolds();
  };
}

export function heldTossLogIds(): ReadonlySet<number> {
  return heldSnapshot;
}

function subscribeHolds(listener: () => void): () => void {
  holdListeners.add(listener);
  return () => { holdListeners.delete(listener); };
}

/** The toss events whose log line must stay hidden now. */
export function useHeldTossLogIds(): ReadonlySet<number> {
  return useSyncExternalStore(subscribeHolds, heldTossLogIds, () => EMPTY);
}

/** The log without the held toss lines. The same array when nothing is held, so memos stay stable. */
export function withoutHeldTossLines<T extends { eventId?: number }>(entries: readonly T[], held: ReadonlySet<number>): readonly T[] {
  if (held.size === 0) return entries;
  const shown = entries.filter((entry) => entry.eventId == null || !held.has(entry.eventId));
  return shown.length === entries.length ? entries : shown;
}

/** Test helper: forget every lock and hold. */
export function resetCoinTossState(): void {
  locks.clear();
  holds.clear();
  publishHolds();
  emitLock();
}

/* ---------- the input block ---------- */

// Pointer and key events that reach the page during a toss. The blocker sits on `window` in the capture
// phase and is installed when this module loads, so it runs before any listener that a component adds
// later (the prompt keys, the aim arrow, the chain mode, the menus that close on an outside click).
// It stops the event there, so no handler sees it. The browser keeps its own keys (copy, reload, tab
// change, dev tools) and the wheel, so the page can still scroll and the user can leave.
const BLOCKED_POINTER = [
  "pointerdown", "pointerup", "mousedown", "mouseup", "click", "dblclick", "auxclick", "contextmenu",
  "touchstart", "touchend", "dragstart", "submit",
] as const;
const BLOCKED_KEYS = ["keydown", "keyup", "keypress"] as const;

/** Keys the browser needs: shortcuts with Ctrl, Cmd or Alt, the function keys, Tab (focus) and the modifier keys. */
function isBrowserKey(event: KeyboardEvent): boolean {
  if (event.ctrlKey || event.metaKey || event.altKey) return true;
  return /^(F\d{1,2}|Tab|Shift|Control|Alt|Meta|OS|CapsLock|PrintScreen)$/.test(event.key);
}

function blockPointer(event: Event): void {
  if (!isCoinTossActive()) return;
  event.stopImmediatePropagation();
  if (event.cancelable) event.preventDefault();
}

function blockKey(event: Event): void {
  if (!isCoinTossActive()) return;
  if (isBrowserKey(event as KeyboardEvent)) return;
  event.stopImmediatePropagation();
  if (event.cancelable) event.preventDefault();
}

const INSTALLED = Symbol.for("duel.coinToss.blocker");

function installBlocker(): void {
  if (typeof window === "undefined") return;
  const host = window as unknown as Record<symbol, (() => void) | undefined>;
  // A hot reload loads this module again: the old blocker reads the old lock state, so it goes first.
  host[INSTALLED]?.();
  for (const type of BLOCKED_POINTER) window.addEventListener(type, blockPointer, { capture: true, passive: false });
  for (const type of BLOCKED_KEYS) window.addEventListener(type, blockKey, { capture: true });
  host[INSTALLED] = () => {
    for (const type of BLOCKED_POINTER) window.removeEventListener(type, blockPointer, { capture: true });
    for (const type of BLOCKED_KEYS) window.removeEventListener(type, blockKey, { capture: true });
  };
}

installBlocker();

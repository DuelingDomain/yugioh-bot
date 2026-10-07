"use client";

/**
 * State of the inline card inspector: which card is shown, which card is pinned, and where it is shown.
 *
 * - Hover or keyboard focus on a card in the pool PREVIEWS it. Leaving the pool ends the preview after a short delay
 *   (so the pointer can cross to the inspector); entering the inspector holds it.
 * - Click, Enter or Space on a card PINS it. A pin stays while hover and focus move on. Click it again, press Esc or
 *   use the Unpin button to release it. Using the inspector's own controls pins the card it shows.
 * - Esc is read in the capture phase and calls preventDefault when it unpins, so a drawer or dialog around the pool can
 *   skip its own Esc when `event.defaultPrevented` is set. The first Esc unpins; the second closes the drawer.
 * - A card that leaves the pool (its copies went to 0) is unpinned. It does not come back if the card is added again.
 * - On a phone ("sheet" mode) hover does not exist: only a pinned card shows, in a bottom sheet.
 *
 * Wire it once, then give the result to `PoolBrowser` (`inspector` prop) and `CardInspector` (`controller` prop).
 *
 *   const inspector = useCardInspector({ main, extra, getCard, actions });
 *   <CardInspector controller={inspector} />
 *   <PoolBrowser main={main} extra={extra} getCard={getCard} inspector={inspector} />
 *
 * Options:
 *   main, extra   the pools (Map of passcode to copies); `extra` may be left out.
 *   getCard       card details by passcode; may return undefined while they load.
 *   actions       onStep / onSetCopies / onRemove. Leave them out for a read-only inspector and browser.
 *   mode          "auto" (default: sheet at 720px wide or less), "pane" or "sheet".
 *   leaveDelayMs  how long a preview waits after the pointer leaves a card (default 180).
 */

import * as React from "react";
import type { PoolCard, PoolCopies, PoolEditActions, PoolLane } from "./pool-browser-model";

export type InspectorMode = "auto" | "pane" | "sheet";

export interface UseCardInspectorOptions {
  main: PoolCopies;
  extra?: PoolCopies;
  getCard: (id: number) => PoolCard | undefined;
  actions?: PoolEditActions;
  mode?: InspectorMode;
  leaveDelayMs?: number;
}

export interface CardInspectorController {
  /** The pinned card, or null. */
  pinnedId: number | null;
  /** The card under the pointer or keyboard focus, or null. Always null in sheet mode. */
  previewId: number | null;
  /** What the inspector shows: the preview, else the pin. */
  shownId: number | null;
  /** True when the inspector is a bottom sheet (phone). */
  sheet: boolean;
  /** True when no edit callbacks were given. */
  readOnly: boolean;
  actions: PoolEditActions;
  getCard: (id: number) => PoolCard | undefined;
  /** The lane and copies of a card, or null when it is not in the pool. */
  locate: (id: number) => { lane: PoolLane; copies: number } | null;
  preview: (id: number) => void;
  endPreview: (delayMs?: number) => void;
  /** Keeps the current preview (the pointer is over the inspector). */
  holdPreview: () => void;
  pin: (id: number) => void;
  /** Pins a card, or releases it when it is already pinned. */
  togglePin: (id: number) => void;
  unpin: () => void;
  /** Moves focus back to what opened the sheet, when that is still on the page. */
  restoreFocus: () => void;
}

const PHONE_QUERY = "(max-width: 720px)";

function subscribePhone(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const mq = window.matchMedia(PHONE_QUERY);
  mq.addEventListener?.("change", onChange);
  return () => mq.removeEventListener?.("change", onChange);
}
const phoneNow = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(PHONE_QUERY).matches;

function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.matches !== "function") return false;
  return el.matches("input, textarea, select, [contenteditable='true'], [contenteditable='']");
}

export function useCardInspector(opts: UseCardInspectorOptions): CardInspectorController {
  const { main, extra, getCard, mode = "auto", leaveDelayMs = 180 } = opts;
  const actions = React.useMemo<PoolEditActions>(
    () => ({ onStep: opts.actions?.onStep, onSetCopies: opts.actions?.onSetCopies, onRemove: opts.actions?.onRemove }),
    [opts.actions?.onStep, opts.actions?.onSetCopies, opts.actions?.onRemove],
  );
  const phone = React.useSyncExternalStore(subscribePhone, phoneNow, () => false);
  const sheet = mode === "sheet" || (mode === "auto" && phone);

  const [pinned, setPinned] = React.useState<number | null>(null);
  const [previewed, setPreviewed] = React.useState<number | null>(null);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const trigger = React.useRef<HTMLElement | null>(null);

  const locate = React.useCallback(
    (id: number) => {
      const m = main.get(id);
      if (m !== undefined && m >= 1) return { lane: "main" as const, copies: m };
      const x = extra?.get(id);
      if (x !== undefined && x >= 1) return { lane: "extra" as const, copies: x };
      return null;
    },
    [main, extra],
  );
  const present = React.useCallback((id: number | null) => id !== null && locate(id) !== null, [locate]);

  // A card that left the pool is unpinned for good.
  React.useEffect(() => {
    if (pinned !== null && !present(pinned)) setPinned(null);
    if (previewed !== null && !present(previewed)) setPreviewed(null);
  }, [pinned, previewed, present]);

  const clearTimer = React.useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
  }, []);
  React.useEffect(() => clearTimer, [clearTimer]);

  const preview = React.useCallback(
    (id: number) => {
      clearTimer();
      if (!sheet) setPreviewed(id);
    },
    [clearTimer, sheet],
  );
  const endPreview = React.useCallback(
    (delayMs?: number) => {
      clearTimer();
      const wait = delayMs ?? leaveDelayMs;
      if (wait <= 0) {
        setPreviewed(null);
        return;
      }
      timer.current = setTimeout(() => {
        timer.current = null;
        setPreviewed(null);
      }, wait);
    },
    [clearTimer, leaveDelayMs],
  );
  const pin = React.useCallback(
    (id: number) => {
      clearTimer();
      if (typeof document !== "undefined" && document.activeElement instanceof HTMLElement && document.activeElement !== document.body) {
        trigger.current = document.activeElement;
      }
      setPinned(id);
      setPreviewed(null);
    },
    [clearTimer],
  );
  const unpin = React.useCallback(() => {
    clearTimer();
    setPinned(null);
    setPreviewed(null);
  }, [clearTimer]);
  const togglePin = React.useCallback(
    (id: number) => {
      if (pinned === id) unpin();
      else pin(id);
    },
    [pinned, pin, unpin],
  );
  const restoreFocus = React.useCallback(() => {
    const el = trigger.current;
    trigger.current = null;
    if (el && el.isConnected && typeof el.focus === "function") el.focus();
  }, []);

  const hasSomething = pinned !== null || previewed !== null;
  React.useEffect(() => {
    if (!hasSomething) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || isTypingTarget(e.target)) return;
      e.preventDefault();
      unpin();
    };
    document.addEventListener("keydown", onKey, true);
    return () => document.removeEventListener("keydown", onKey, true);
  }, [hasSomething, unpin]);

  const pinnedId = present(pinned) ? pinned : null;
  const previewId = !sheet && present(previewed) ? previewed : null;

  return {
    pinnedId,
    previewId,
    shownId: previewId ?? pinnedId,
    sheet,
    readOnly: !actions.onStep,
    actions,
    getCard,
    locate,
    preview,
    endPreview,
    holdPreview: clearTimer,
    pin,
    togglePin,
    unpin,
    restoreFocus,
  };
}

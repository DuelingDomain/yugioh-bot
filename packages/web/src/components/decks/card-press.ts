"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

/** A finger must rest this long on a card before it counts as a long press. */
const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling or dragging, not pressing. */
const LONG_PRESS_SLOP = 10;

/** What a press on a deck card does. The deck grid and the Deck Master slot each give their own. */
export type PressActions = {
  /** Plain mouse click. */
  remove: () => void;
  /** Ctrl+click or Cmd+click, and Ctrl+Enter from the keyboard. */
  moveSide: () => void;
  /** A tap on a touch screen and Enter or Space: the card opens for inspection and nothing is removed. */
  select: () => void;
  /** Right-click, long press, the ContextMenu key and Shift+F10. */
  menu: (anchor: HTMLElement) => void;
};

/**
 * Click rules for the cards of a deck, shared by all the tiles of one grid:
 * left-click removes, Ctrl or Cmd+click moves to or from the Side Deck, right-click or long press opens
 * the art menu. A tap on a touch screen and Enter or Space never remove a card; they select it.
 * A keyboard click is the one with `detail === 0`: browsers send a real click with at least 1.
 */
export function useCardPress() {
  const pointer = useRef("mouse");
  const timer = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // The long press already opened the menu, so the click that ends it must do nothing.
  const longPressed = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  }, []);
  useEffect(() => cancel, [cancel]);

  return useCallback((actions: PressActions) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      pointer.current = event.pointerType || "mouse";
      longPressed.current = false;
      cancel();
      if (event.pointerType !== "touch") return;
      const anchor = event.currentTarget;
      origin.current = { x: event.clientX, y: event.clientY };
      timer.current = window.setTimeout(() => {
        timer.current = undefined;
        longPressed.current = true;
        actions.menu(anchor);
      }, LONG_PRESS_MS);
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onDragStart: cancel,
    onClick(event: MouseEvent<HTMLElement>) {
      event.currentTarget.focus();
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      const keyboard = event.detail === 0;
      if (event.ctrlKey || event.metaKey) actions.moveSide();
      else if (keyboard || pointer.current === "touch") actions.select();
      else actions.remove();
    },
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      actions.menu(event.currentTarget);
    },
    /** ContextMenu and Shift+F10 open the menu from the keyboard. */
    onKeyDown(event: KeyboardEvent<HTMLElement>) {
      if (event.key !== "ContextMenu" && !(event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      actions.menu(event.currentTarget);
    },
  }), [cancel]);
}

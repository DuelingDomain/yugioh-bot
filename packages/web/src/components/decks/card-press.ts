"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";

/** A finger must rest this long on a card before it counts as a long press. */
const LONG_PRESS_MS = 450;
/** A finger that moves further than this is scrolling or dragging, not pressing. */
const LONG_PRESS_SLOP = 10;
/** How long a finished long press waits for its click before it forgets itself. */
const LONG_PRESS_SETTLE_MS = 400;

/** What a press on a deck card does. The deck grid and the Deck Master slot each give their own. */
export type PressActions = {
  /** A mouse click that began with a primary-button press on the same card. */
  remove: () => void;
  /** Ctrl+click or Cmd+click, and Ctrl+Enter from the keyboard. */
  moveSide: () => void;
  /** A tap on a touch screen or pen, Enter and Space, and any click without a mouse press: the card opens for inspection and nothing is removed. */
  select: () => void;
  /** Right-click, long press, the ContextMenu key and Shift+F10. */
  menu: (anchor: HTMLElement) => void;
};

/**
 * Click rules for the cards of a deck, shared by all the tiles of one grid:
 * left-click removes, Ctrl or Cmd+click moves to or from the Side Deck, right-click or long press opens
 * the art menu. A tap on a touch screen or pen, Enter and Space never remove a card; they select it.
 *
 * Removal needs proof of a real mouse press: a primary-button pointerdown on the same tile arms it, and the
 * click that follows removes. A click with no such pointerdown (a screen reader, a script, the keyboard)
 * only selects. A second click of a double-click does nothing, so one double-click removes one card.
 */
export function useCardPress() {
  const armed = useRef<HTMLElement | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const settle = useRef<number | undefined>(undefined);
  const origin = useRef<{ x: number; y: number } | null>(null);
  // The long press already opened the menu, so the click that ends it must do nothing.
  const longPressed = useRef(false);

  const cancel = useCallback(() => {
    window.clearTimeout(timer.current);
    timer.current = undefined;
    origin.current = null;
  }, []);
  useEffect(() => () => { cancel(); window.clearTimeout(settle.current); }, [cancel]);

  return useCallback((actions: PressActions) => ({
    onPointerDown(event: PointerEvent<HTMLElement>) {
      window.clearTimeout(settle.current);
      longPressed.current = false;
      armed.current = null;
      cancel();
      if (event.pointerType === "touch" || event.pointerType === "pen") {
        const anchor = event.currentTarget;
        origin.current = { x: event.clientX, y: event.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = undefined;
          longPressed.current = true;
          actions.menu(anchor);
        }, LONG_PRESS_MS);
      } else if (event.button === 0) {
        armed.current = event.currentTarget;
      }
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const start = origin.current;
      if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > LONG_PRESS_SLOP) cancel();
    },
    onPointerUp() {
      cancel();
      // The click of a long press comes right after pointerup; a long press that sends none must not leave the flag set.
      if (longPressed.current) settle.current = window.setTimeout(() => { longPressed.current = false; }, LONG_PRESS_SETTLE_MS);
    },
    onPointerCancel() {
      cancel();
      armed.current = null;
    },
    onDragStart() {
      cancel();
      armed.current = null;
    },
    onClick(event: MouseEvent<HTMLElement>) {
      const wasArmed = armed.current === event.currentTarget;
      armed.current = null;
      event.currentTarget.focus();
      if (longPressed.current) {
        longPressed.current = false;
        return;
      }
      // The second click of a double-click: the first one already acted.
      if (event.detail > 1) return;
      if (event.ctrlKey || event.metaKey) actions.moveSide();
      // A keyboard click (detail 0) never removes, whatever press came before it.
      else if (wasArmed && event.detail >= 1) actions.remove();
      else actions.select();
    },
    onContextMenu(event: MouseEvent<HTMLElement>) {
      event.preventDefault();
      // Ctrl+click on a Mac is a right-click with no click after it: the press must not stay armed.
      armed.current = null;
      // Android sends contextmenu after the long press that already opened the menu.
      if (longPressed.current) return;
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

"use client";

import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

const LONG_PRESS_MS = 520; const MOVE_LIMIT = 10;
/** Text fields keep the browser menu (copy and paste). */
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true']");

/**
 * The table has its own menu: the browser menu never shows here, except in text fields.
 * `open` gets the element under a right click or a long press (touch). It opens the card actions when that element is a card.
 * A long press fires the same `contextmenu` event on the target, so one path serves the mouse and the finger.
 */
export function useCardMenu(open: (target: Element) => void) {
  const press = useRef<{ x: number; y: number; target: Element; timer: ReturnType<typeof setTimeout> } | null>(null);
  const fired = useRef(0);
  const clear = useCallback(() => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } }, []);
  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (editable(event.target)) return;
    event.preventDefault();
    if (event.target instanceof Element) open(event.target);
  }, [open]);
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    clear();
    if (event.pointerType === "mouse" || !event.isPrimary || editable(event.target) || !(event.target instanceof Element)) return;
    const { clientX, clientY, target } = event;
    const timer = setTimeout(() => {
      press.current = null; fired.current = Date.now();
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
    }, LONG_PRESS_MS);
    press.current = { x: clientX, y: clientY, target, timer };
  }, [clear]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const now = press.current; if (now && Math.hypot(event.clientX - now.x, event.clientY - now.y) > MOVE_LIMIT) clear();
  }, [clear]);
  // The lift that ends a long press must not also count as a tap.
  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (Date.now() - fired.current < 700) { event.preventDefault(); event.stopPropagation(); fired.current = 0; }
  }, []);
  return { onContextMenu, onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onClickCapture };
}

"use client";

import { useCallback, useRef, type MouseEvent, type PointerEvent } from "react";

const LONG_PRESS_MS = 520; const MOVE_LIMIT = 10; const AFTER_MS = 700;
/** Only a card cell or a camera feed can start a long press. A slow tap on any button stays a tap. */
const CARDS = "[data-zone][data-seat], [data-remote-seat]";
/** Text fields keep the browser menu (copy and paste). */
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest("input, textarea, select, [contenteditable=''], [contenteditable='true'], [contenteditable='plaintext-only']");
/** Escape routes to the browser menu: Shift, a link, or selected text under the pointer. */
const escapes = (event: MouseEvent<HTMLElement>) => {
  const target = event.target; if (!(target instanceof Element)) return false;
  if (event.shiftKey || target.closest("a[href]")) return true;
  const selection = getSelection(); return !!selection && !selection.isCollapsed && selection.containsNode(target, true);
};

/**
 * The table has its own menu: the browser menu never shows here, except in text fields.
 * `open` gets the element under a right click or a long press (touch) and says if it opened something (a card menu).
 * A long press fires the same `contextmenu` event on the target, so one path serves the mouse and the finger.
 * The click that ends a long press is swallowed only when a menu really opened.
 */
export function useCardMenu(open: (target: Element) => boolean) {
  const press = useRef<{ x: number; y: number; target: Element; timer: ReturnType<typeof setTimeout> } | null>(null);
  const fired = useRef(0); const synthetic = useRef(false); const touch = useRef(false);
  const clear = useCallback(() => { if (press.current) { clearTimeout(press.current.timer); press.current = null; } }, []);
  const onContextMenu = useCallback((event: MouseEvent<HTMLElement>) => {
    if (editable(event.target) || escapes(event)) return;
    clear(); event.preventDefault();
    if (!(event.target instanceof Element)) return;
    const native = event.nativeEvent.isTrusted;
    // Android sends its own contextmenu for a long press. One press opens one menu.
    if (native && Date.now() - fired.current < AFTER_MS) return;
    const opened = open(event.target);
    if (opened && (synthetic.current || (native && touch.current))) fired.current = Date.now();
    synthetic.current = false;
  }, [open, clear]);
  const onPointerDown = useCallback((event: PointerEvent<HTMLElement>) => {
    clear(); touch.current = event.pointerType !== "mouse";
    if (event.pointerType === "mouse" || !event.isPrimary || editable(event.target) || !(event.target instanceof Element) || !event.target.closest(CARDS)) return;
    const { clientX, clientY, target } = event;
    const timer = setTimeout(() => {
      press.current = null; synthetic.current = true;
      target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX, clientY, button: 2 }));
      synthetic.current = false;
    }, LONG_PRESS_MS);
    press.current = { x: clientX, y: clientY, target, timer };
  }, [clear]);
  const onPointerMove = useCallback((event: PointerEvent<HTMLElement>) => {
    const now = press.current; if (now && Math.hypot(event.clientX - now.x, event.clientY - now.y) > MOVE_LIMIT) clear();
  }, [clear]);
  // The lift that ends a long press must not also count as a tap.
  const onClickCapture = useCallback((event: MouseEvent<HTMLElement>) => {
    if (Date.now() - fired.current < AFTER_MS) { event.preventDefault(); event.stopPropagation(); fired.current = 0; }
  }, []);
  return { onContextMenu, onPointerDown, onPointerMove, onPointerUp: clear, onPointerCancel: clear, onClickCapture };
}

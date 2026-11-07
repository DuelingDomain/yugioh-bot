"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { flushSync } from "react-dom";
import { Icon } from "./icons";
import s from "./remote-ui.module.css";

type Offset = { dx: number; dy: number };
/** The status chip asks the dock of a seat to open: `detail.seat`. */
export const NOTIFY_OPEN_EVENT = "dd-remote-notify-open";
/** With less room than this, a card choice shrinks and its text scrolls. */
const TIGHT_ROOM = 250;
// One saved offset per anchor: an offset from the top of the seat means nothing from its bottom. The CSS names the anchor in --dock-anchor.
const KEY = (seat: number, anchor: string) => `dd-remote-notify-pos2:${seat}:${anchor}`;
const anchorOf = (node: HTMLElement) => getComputedStyle(node).getPropertyValue("--dock-anchor").trim() || "top";
const readOffset = (seat: number, anchor: string): Offset => {
  try { const value = JSON.parse(localStorage.getItem(KEY(seat, anchor)) ?? "null"); if (value && Number.isFinite(value.dx) && Number.isFinite(value.dy)) return { dx: value.dx, dy: value.dy }; } catch { /* no storage */ }
  return { dx: 0, dy: 0 };
};

/**
 * The notification stack of one seat: recognition prompts, notices and toasts for that player sit here, floating above the seat layout.
 * It is out of flow on every path (appear, update, hide, reset), so it cannot move the camera or the field.
 * A header (shown only while something is waiting) holds the drag handle, a minimize button that leaves a small chip with a count, and a reset.
 * Content is portaled into `data-notify-slot`; the position is kept per device.
 */
export function NotifyDock({ seat, onSlot, view }: { seat: number; onSlot: (seat: number, node: HTMLElement | null) => void; /** Changes when the seat layout changes, so the stack is placed again. */ view: string }) {
  const root = useRef<HTMLDivElement>(null); const slot = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0); const [open, setOpen] = useState(true); const [offset, setOffset] = useState<Offset>({ dx: 0, dy: 0 });
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null);
  const setSlot = useCallback((node: HTMLDivElement | null) => { slot.current = node; onSlot(seat, node); }, [onSlot, seat]);
  // The position the person chose, and the position shown. The second is the first kept inside the seat.
  const wanted = useRef<Offset>({ dx: 0, dy: 0 }); const shown = useRef(offset); shown.current = offset; const anchor = useRef<string | null>(null); const shownCount = useRef(0);
  useEffect(() => {
    const node = slot.current; if (!node) return;
    const read = () => Array.from(node.children).reduce((sum, child) => sum + (child.getAttribute("data-testid") === "toasts" ? child.childElementCount : child.textContent ? 1 : 0), 0);
    shownCount.current = read(); setCount(shownCount.current);
    // Applied before the next paint: the header never shows for a frame with an empty stack.
    // A new notice opens a minimized stack: nothing that waits for the player stays hidden.
    const observer = new MutationObserver(() => { const next = read(); if (next === shownCount.current) return; const more = next > shownCount.current; shownCount.current = next; flushSync(() => { setCount(next); if (more) setOpen(true); }); }); observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    const onOpen = (event: Event) => { if ((event as CustomEvent<{ seat?: number }>).detail?.seat === seat) setOpen(true); };
    window.addEventListener(NOTIFY_OPEN_EVENT, onOpen); return () => window.removeEventListener(NOTIFY_OPEN_EVENT, onOpen);
  }, [seat]);
  const save = (next: Offset) => { wanted.current = next; setOffset(next); const node = root.current; try { localStorage.setItem(KEY(seat, node ? anchorOf(node) : "top"), JSON.stringify(next)); } catch { /* no storage */ } };
  // Keep the whole stack inside the seat panel.
  const clamp = (next: Offset, base: Offset): Offset => {
    const node = root.current; const area = node?.parentElement; if (!node || !area) return next;
    const box = node.getBoundingClientRect(); const bounds = area.getBoundingClientRect();
    const mx = next.dx - base.dx; const my = next.dy - base.dy;
    const dx = Math.min(Math.max(mx, bounds.left + 4 - box.left), bounds.right - 4 - box.right) + base.dx;
    const dy = Math.min(Math.max(my, bounds.top + 4 - box.top), bounds.bottom - 4 - box.bottom) + base.dy;
    return { dx, dy };
  };
  const headBottom = (area: HTMLElement) => area.querySelector("header")?.getBoundingClientRect().bottom ?? area.getBoundingClientRect().top;
  // The tallest the stack can be with the seat header and the LP buttons clear. It depends only on the seat and the stack width, so a resize cannot make it flip.
  const fitRoom = (node: HTMLElement, area: HTMLElement) => {
    const lp = area.querySelector(`[data-testid="lp-${seat}"]`)?.getBoundingClientRect();
    if (!lp?.width) { node.style.removeProperty("--dock-room"); node.removeAttribute("data-tight"); return; }
    const bounds = area.getBoundingClientRect(); const head = headBottom(area);
    const beside = lp.left - bounds.left - 8 >= node.getBoundingClientRect().width;
    const room = Math.floor(beside ? bounds.bottom - 8 - head - 4 : lp.top - head - 8);
    node.style.setProperty("--dock-room", `${Math.max(120, room)}px`); node.toggleAttribute("data-tight", room < TIGHT_ROOM);
  };
  // The stack must not cover the LP buttons or the seat header. It moves above the buttons, or else beside them. The position the person chose stays saved.
  const clearLp = (next: Offset, base: Offset): Offset => {
    const node = root.current; const area = node?.parentElement; if (!node || !area) return next;
    const lp = area.querySelector(`[data-testid="lp-${seat}"]`)?.getBoundingClientRect(); if (!lp?.width) return next;
    const box = node.getBoundingClientRect(); const bounds = area.getBoundingClientRect();
    const left = box.left + next.dx - base.dx, right = box.right + next.dx - base.dx, top = box.top + next.dy - base.dy, bottom = box.bottom + next.dy - base.dy;
    if (left >= lp.right || right <= lp.left || top >= lp.bottom || bottom <= lp.top) return next;
    const up = bottom - lp.top + 4; if (top - up >= headBottom(area) + 2) return { dx: next.dx, dy: next.dy - up };
    const aside = right - lp.left + 4; if (left - aside >= bounds.left + 4) return { dx: next.dx - aside, dy: next.dy };
    return next;
  };
  // Runs before paint when the content, the view or the seat size changes: a new anchor loads its own offset, and the header never leaves the seat.
  const place = useRef(() => {}); place.current = () => {
    const node = root.current; if (!node || drag.current) return;
    const now = anchorOf(node); if (anchor.current !== now) { anchor.current = now; wanted.current = readOffset(seat, now); }
    if (getComputedStyle(node).display === "none") { setOffset(old => old.dx === wanted.current.dx && old.dy === wanted.current.dy ? old : wanted.current); return; }
    if (node.parentElement) fitRoom(node, node.parentElement);
    const next = clearLp(clamp(wanted.current, shown.current), shown.current);
    setOffset(old => Math.abs(old.dx - next.dx) < .5 && Math.abs(old.dy - next.dy) < .5 ? old : next);
  };
  useLayoutEffect(() => { place.current(); }, [count, open, view, seat]);
  useLayoutEffect(() => {
    const node = root.current; const area = node?.parentElement; if (!node || !area || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => place.current()); observer.observe(node); observer.observe(area);
    return () => observer.disconnect();
  }, []);
  const down = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY, from: offset };
  };
  const move = (event: PointerEvent<HTMLButtonElement>) => {
    const d = drag.current; if (!d) return;
    setOffset(clamp({ dx: d.from.dx + event.clientX - d.x, dy: d.from.dy + event.clientY - d.y }, offset));
  };
  const up = (event: PointerEvent<HTMLButtonElement>) => { if (!drag.current) return; drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); save(offset); };
  const key = (event: KeyboardEvent<HTMLButtonElement>) => {
    const step = event.shiftKey ? 48 : 16; const move = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
    if (!move) return; event.preventDefault(); event.stopPropagation(); save(clamp({ dx: offset.dx + move[0], dy: offset.dy + move[1] }, offset));
  };
  const reset = () => save({ dx: 0, dy: 0 });
  return <div ref={root} className={s.seatDock} data-seat-dock={seat} data-count={count} data-open={open ? "1" : "0"} role="region" aria-label="Card detection notifications" data-testid={`notify-dock-${seat}`}
    style={{ transform: `translate(${offset.dx}px, ${offset.dy}px)` }}>
    {count > 0 ? <div className={s.ndHead} onDoubleClick={reset}>
      <button type="button" className={s.ndGrip} aria-label="Move notifications. Drag, or use the arrow keys. Double click to reset." title="Drag to move. Double click to reset." onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
        <Icon name="grip" /></button>
      <b className={s.ndTitle}>Card notices</b>
      <span className={s.ndCount} data-testid={`notify-count-${seat}`}>{count}</span>
      <button type="button" className={s.ndBtn} onClick={reset} aria-label="Reset notification position" title="Reset position">Reset</button>
      <button type="button" className={s.ndBtn} aria-expanded={open} onClick={() => setOpen(value => !value)} data-testid={`notify-toggle-${seat}`}>{open ? "Hide" : `Show ${count}`}</button>
    </div> : null}
    <div ref={setSlot} className={s.ndSlot} hidden={!open} data-notify-slot={seat} />
  </div>;
}

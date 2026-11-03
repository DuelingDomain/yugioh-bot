"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Icon } from "./icons";
import s from "./remote-ui.module.css";

type Offset = { dx: number; dy: number };
const KEY = (seat: number) => `dd-remote-notify-pos:${seat}`;
const readOffset = (seat: number): Offset => {
  try { const value = JSON.parse(localStorage.getItem(KEY(seat)) ?? "null"); if (value && Number.isFinite(value.dx) && Number.isFinite(value.dy)) return { dx: value.dx, dy: value.dy }; } catch { /* no storage */ }
  return { dx: 0, dy: 0 };
};

/**
 * The notification stack of one seat: recognition prompts, notices and toasts for that player sit here, beside their own virtual field.
 * A header (shown only while something is waiting) holds the drag handle, a minimize button that leaves a small chip with a count, and a reset.
 * Content is portaled into `data-notify-slot`; the position is kept per device.
 */
export function NotifyDock({ seat, onSlot, stage }: { stage?: boolean; seat: number; onSlot: (seat: number, node: HTMLElement | null) => void }) {
  const root = useRef<HTMLDivElement>(null); const slot = useRef<HTMLDivElement | null>(null);
  const [count, setCount] = useState(0); const [open, setOpen] = useState(true); const [offset, setOffset] = useState<Offset>({ dx: 0, dy: 0 });
  const drag = useRef<{ x: number; y: number; from: Offset } | null>(null);
  const setSlot = useCallback((node: HTMLDivElement | null) => { slot.current = node; onSlot(seat, node); }, [onSlot, seat]);
  useEffect(() => { setOffset(readOffset(seat)); }, [seat]);
  useEffect(() => {
    const node = slot.current; if (!node) return;
    const update = () => setCount(Array.from(node.children).reduce((sum, child) => sum + (child.getAttribute("data-testid") === "toasts" ? child.childElementCount : child.textContent ? 1 : 0), 0));
    update(); const observer = new MutationObserver(update); observer.observe(node, { childList: true, subtree: true, characterData: true });
    return () => observer.disconnect();
  }, []);
  const save = (next: Offset) => { setOffset(next); try { localStorage.setItem(KEY(seat), JSON.stringify(next)); } catch { /* no storage */ } };
  // Keep the whole stack inside the seat panel.
  const clamp = (next: Offset, base: Offset): Offset => {
    const node = root.current; const area = node?.parentElement; if (!node || !area) return next;
    const box = node.getBoundingClientRect(); const bounds = area.getBoundingClientRect();
    const mx = next.dx - base.dx; const my = next.dy - base.dy;
    const dx = Math.min(Math.max(mx, bounds.left + 4 - box.left), bounds.right - 4 - box.right) + base.dx;
    const dy = Math.min(Math.max(my, bounds.top + 4 - box.top), bounds.bottom - 4 - box.bottom) + base.dy;
    return { dx, dy };
  };
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
  return <div ref={root} className={`${s.seatDock} ${stage ? s.stageDock : ""}`} data-seat-dock={seat} data-count={count} data-open={open ? "1" : "0"} role="region" aria-label="Card detection notifications" data-testid={`notify-dock-${seat}`}
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

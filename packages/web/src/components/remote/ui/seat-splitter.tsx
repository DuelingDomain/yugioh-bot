"use client";

import { useCallback, useEffect, useRef, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import s from "./remote-ui.module.css";

/** The webcam may take 30 % to 85 % of the seat body. The 3 rows of the board and the ledge need the rest, so the real top limit is often lower. */
export const SPLIT_MIN = 0.3;
export const SPLIT_MAX = 0.85;
/** Room kept for the phases and LP under the webcam, in px. */
const LEDGE_MIN = 150;
const KEY_STEP = 0.02;

export type SplitBox = { now: number; min: number; max: number };

export const clampSplit = (value: number, box?: { min: number; max: number }) => Math.min(box?.max ?? SPLIT_MAX, Math.max(box?.min ?? SPLIT_MIN, value));

/** Reads a stored ratio: a number from 0.3 to 0.85, else nothing. */
export function readSplit(key: string): number | null {
  try { const value = parseFloat(localStorage.getItem(key) ?? ""); return Number.isFinite(value) ? Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, value)) : null; } catch { return null; }
}
export function writeSplit(key: string, value: number | null) {
  try { if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value.toFixed(3)); } catch { /* storage blocked: not remembered */ }
}

/** Where the seam is, in the seat body that holds the webcam and the board. Null while the seat has no webcam column (webcam only, a phone). */
export function measureSplit(handle: HTMLElement): (SplitBox & { body: HTMLElement; col: HTMLElement; height: number }) | null {
  const body = handle.closest<HTMLElement>(`.${s.sbody}`); const col = body?.querySelector<HTMLElement>(`:scope > .${s.feedcol}`); const cams = col?.querySelector<HTMLElement>(`:scope > .${s.cams}`);
  if (!body || !col || !cams) return null;
  const bodyStyle = getComputedStyle(body); const height = body.clientHeight - parseFloat(bodyStyle.paddingTop || "0") - parseFloat(bodyStyle.paddingBottom || "0");
  if (!(height > 0) || !(col.offsetHeight > 0)) return null;
  // The picture cannot grow past its natural height (the width of the column at the camera's shape), so a bigger share would only leave an empty band.
  const naturalCam = parseFloat(getComputedStyle(cams).maxHeight); const colStyle = getComputedStyle(col);
  const gap = parseFloat(colStyle.rowGap || "0") || 0;
  const rows = Array.from(col.children).filter(child => child !== cams && getComputedStyle(child).position !== "absolute").reduce((sum, child) => sum + (child as HTMLElement).offsetHeight + gap, 0);
  const natural = Number.isFinite(naturalCam) ? (naturalCam + rows + parseFloat(colStyle.paddingBottom || "0") + parseFloat(colStyle.paddingTop || "0") + gap) / height : SPLIT_MAX;
  const max = Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, natural, (height - LEDGE_MIN) / height));
  return { body, col, height, now: col.offsetHeight / height, min: Math.min(SPLIT_MIN, max), max };
}

/**
 * The seam between the webcam and the board of one seat (1v1, board shown). Drag it, or focus it and press Up and Down, to change how much of the seat
 * the webcam takes. A double click (or Enter) brings back the default. The ratio is the webcam's share of the seat body. `onGrab` runs when a drag begins
 * (the Enlarge field preset leaves its view and the drag continues from there).
 */
export function SeatSplitter({ seat, name, seatRef, box, split, onMeasure, onSplit, onGrab }: {
  seat: number; name: string; seatRef: { current: HTMLElement | null }; box: SplitBox | null; split: number | null;
  onMeasure: (box: SplitBox | null) => void; onSplit: (ratio: number | null) => void; onGrab: () => void;
}) {
  const handle = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: number; y: number; base: number; height: number; box: SplitBox; ratio: number } | null>(null);

  const measure = useCallback(() => {
    const node = handle.current; const next = node ? measureSplit(node) : null;
    onMeasure(next ? { now: next.now, min: next.min, max: next.max } : null);
  }, [onMeasure]);
  // The limits follow the seat: its size changes with the window and the drawer.
  useEffect(() => {
    const node = handle.current; const body = node?.closest<HTMLElement>(`.${s.sbody}`); if (!node || !body) return;
    measure(); if (typeof ResizeObserver === "undefined") return;
    const watcher = new ResizeObserver(() => { if (!drag.current) measure(); }); watcher.observe(body);
    return () => watcher.disconnect();
  }, [measure, split]);

  const show = (ratio: number) => { const seatEl = seatRef.current; if (!seatEl) return; seatEl.style.setProperty("--split", ratio.toFixed(4)); seatEl.setAttribute("data-split", ""); };
  const onDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 && event.pointerType === "mouse") return;
    const start = measureSplit(event.currentTarget); if (!start) return;
    event.preventDefault(); event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, y: event.clientY, base: start.now, height: start.height, box: { now: start.now, min: start.min, max: start.max }, ratio: start.now };
    event.currentTarget.setAttribute("data-dragging", "");
  };
  const onMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const state = drag.current; if (!state || state.id !== event.pointerId) return;
    event.preventDefault();
    const ratio = clampSplit(state.base + (event.clientY - state.y) / state.height, state.box);
    if (Math.abs(ratio - state.ratio) < 0.0005 && state.ratio !== state.base) return;
    // The first move of a drag out of the Enlarge field preset puts the seat back in the camera view, with the same share.
    if (state.ratio === state.base && Math.abs(event.clientY - state.y) > 2) onGrab();
    state.ratio = ratio; show(ratio);
    event.currentTarget.setAttribute("aria-valuenow", String(Math.round(ratio * 100)));
  };
  const end = (event: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) => {
    const state = drag.current; if (!state || state.id !== event.pointerId) return;
    drag.current = null; event.currentTarget.removeAttribute("data-dragging");
    try { event.currentTarget.releasePointerCapture(event.pointerId); } catch { /* already released */ }
    if (cancelled || Math.abs(state.ratio - state.base) < 0.0005 && Math.abs(event.clientY - state.y) <= 2) {
      // A click without a move changes nothing. A cancelled drag puts the share back.
      const seatEl = seatRef.current; if (seatEl && split === null && cancelled) { seatEl.style.removeProperty("--split"); seatEl.removeAttribute("data-split"); }
      else if (seatEl && split !== null) seatEl.style.setProperty("--split", clampSplit(split, state.box).toFixed(4));
      return;
    }
    onSplit(state.ratio);
  };
  const onKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const now = box?.now ?? SPLIT_MIN; const step = event.shiftKey ? KEY_STEP * 5 : KEY_STEP;
    let next: number | null | undefined;
    if (event.key === "ArrowUp") next = clampSplit(now - step, box ?? undefined);
    else if (event.key === "ArrowDown") next = clampSplit(now + step, box ?? undefined);
    else if (event.key === "Home") next = box?.min ?? SPLIT_MIN;
    else if (event.key === "End") next = box?.max ?? SPLIT_MAX;
    else if (event.key === "Enter") next = null;
    if (next === undefined) return;
    event.preventDefault(); event.stopPropagation(); if (next !== null) onGrab(); onSplit(next);
  };
  const now = Math.round((box?.now ?? 0) * 100);
  return <div ref={handle} className={s.splitter} role="separator" aria-orientation="horizontal" tabIndex={0} data-testid={`split-${seat}`} data-set={split !== null || undefined}
    aria-label={`Webcam and board of ${name}. Drag, or press Up and Down, to change the webcam height. Double click or Enter brings back the default.`}
    aria-valuemin={Math.round((box?.min ?? SPLIT_MIN) * 100)} aria-valuemax={Math.round((box?.max ?? SPLIT_MAX) * 100)} aria-valuenow={now || undefined} aria-valuetext={now ? `Webcam ${now} percent` : undefined}
    title="Drag to change the webcam height. Double click to reset."
    style={{ touchAction: "none" } as CSSProperties}
    onPointerDown={onDown} onPointerMove={onMove} onPointerUp={event => end(event, false)} onPointerCancel={event => end(event, true)} onLostPointerCapture={event => { if (drag.current) end(event, true); }}
    onClick={event => event.stopPropagation()} onDoubleClick={event => { event.stopPropagation(); onSplit(null); }} onKeyDown={onKey}><i /></div>;
}

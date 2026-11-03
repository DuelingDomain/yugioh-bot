"use client";

import { useEffect, useId, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { fieldMatPoint, MIN_ZONE_SIZE, onMat, unscaleZoneRect, zoneCellAt, type FieldCalibration, type FieldFormat, type ZoneOverrides, type ZoneRect } from "@yugidraft/vision";
import { byAreaDesc, fieldGridCells, projectCell } from "@/lib/remote/zone-grid";
import s from "./zone-editor.module.css";

type Point = { x: number; y: number };
const HANDLES: [string, number, number][] = [["nw", 0, 0], ["n", .5, 0], ["ne", 1, 0], ["e", 1, .5], ["se", 1, 1], ["s", .5, 1], ["sw", 0, 1], ["w", 0, .5]];
/** Rows and piles by zone id. A row never takes the piles of its own height, and a column takes the M/S pair (and the EMZ above it). */
const GROUPS = [["M1", "M2", "M3", "M4", "M5"], ["S1", "S2", "S3", "S4", "S5"], ["EMZ1", "EMZ2"], ["FIELD", "EXTRA"], ["BANISHED", "GY", "DECK"]];
const ORDER = ["EMZ1", "EMZ2", "M1", "M2", "M3", "M4", "M5", "S1", "S2", "S3", "S4", "S5", "FIELD", "EXTRA", "BANISHED", "GY", "DECK"];
const columnOf = (id: string): string[] => {
  const n = /^[MS]([1-5])$/.exec(id)?.[1];
  if (n) return [`M${n}`, `S${n}`, ...(n === "2" ? ["EMZ1"] : n === "4" ? ["EMZ2"] : [])];
  if (id === "EMZ1") return ["EMZ1", "M2", "S2"];
  if (id === "EMZ2") return ["EMZ2", "M4", "S4"];
  return GROUPS.find(g => g.includes(id)) ?? [id];
};
const MOVE_THRESHOLD = 4;
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));
function useMedia(query: string) {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const q = window.matchMedia?.(query); if (!q) return;
    const update = () => setOn(q.matches); update();
    q.addEventListener?.("change", update); return () => q.removeEventListener?.("change", update);
  }, [query]);
  return on;
}

/**
 * Draft state of the zone editor. The player edits `zones` (per-zone rectangles at spacing 1) on top of the default
 * layout; nothing is saved until the host takes `zones` on Done. `calibration` supplies the 4-corner homography.
 * `cells` are what is drawn (spacing applied). Every change keeps one undo step.
 */
export function useZoneEditor(calibration: FieldCalibration | undefined, format: FieldFormat) {
  const spacing = calibration?.zoneSpacing ?? 1;
  const [zones, setZonesState] = useState<ZoneOverrides>({});
  const zonesRef = useRef(zones), history = useRef<ZoneOverrides[]>([]);
  const [depth, setDepth] = useState(0);
  const [selected, setSelected] = useState<string[]>([]);
  const [addMode, setAddMode] = useState(false);
  const coarse = useMedia("(pointer: coarse)"), narrow = useMedia("(max-width: 600px)");
  const cells = useMemo(() => fieldGridCells(format, spacing, zones), [format, spacing, zones]);
  const exists = (ids: string[]) => ids.filter(id => cells.some(c => c.zone === id));
  const select = (ids: string[]) => setSelected([...new Set(ids)]);
  const put = (next: ZoneOverrides) => { zonesRef.current = next; setZonesState(next); };
  const checkpoint = () => { history.current = [...history.current.slice(-49), zonesRef.current]; setDepth(history.current.length); };
  const pick = (of: (id: string) => string[]) => select([...selected, ...exists(selected.flatMap(of))]);
  return {
    calibration, format, zones, cells, selected, spacing, coarse, narrow, addMode, canUndo: depth > 0,
    /** Starts an edit from the saved overrides. */
    begin(saved?: ZoneOverrides) { put({ ...(saved ?? {}) }); history.current = []; setDepth(0); setSelected([]); setAddMode(false); },
    select, checkpoint, setAddMode,
    /** Writes rectangles given as drawn (spacing applied); they are kept at spacing 1. */
    apply(rects: ZoneOverrides) { put({ ...zonesRef.current, ...Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, unscaleZoneRect(r, spacing)])) }); },
    undo() { const before = history.current.pop(); if (before) { put(before); setDepth(history.current.length); } },
    selectAll: () => select(cells.map(c => c.zone)),
    selectRow: () => pick(id => GROUPS.find(g => g.includes(id)) ?? [id]), selectColumn: () => pick(columnOf),
    /** Moves the selection to the previous or next zone in reading order; `add` keeps the old picks too. */
    step(direction: 1 | -1, add: boolean) {
      const order = exists(ORDER), at = order.indexOf(selected.at(-1) ?? ""), next = order[at < 0 ? (direction > 0 ? 0 : order.length - 1) : (at + direction + order.length) % order.length];
      if (next) select(add ? [...selected, next] : [next]);
    },
    resetSelected() { checkpoint(); const next = { ...zonesRef.current }; for (const id of selected) delete next[id]; put(next); },
    resetAll() { checkpoint(); put({}); },
    dirty: Object.keys(zones).length > 0,
  };
}
export type ZoneEditor = ReturnType<typeof useZoneEditor>;

type Drag =
  | { kind: "move"; startMat: Point; rects: ZoneOverrides; origin: Point; started: boolean }
  | { kind: "resize"; startMat: Point; rects: ZoneOverrides; box: ZoneRect; hx: number; hy: number; origin: Point; started: boolean }
  | { kind: "box"; start: Point; base: string[] };

/** The editable zone grid over a camera picture: select, move and resize zones. `ratio` is the picture's width / height. */
export function ZoneEditorOverlay({ editor, ratio }: { editor: ZoneEditor; ratio: number }) {
  const { calibration, cells, selected, spacing } = editor;
  const root = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const help = useId();
  const height = 1000 / ratio;
  const low = { x: .5 - spacing, y: -.5 }, high = { x: .5 + spacing, y: 1.5 };

  useEffect(() => { root.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const el = root.current; if (!el || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight })); watch.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => watch.disconnect();
  }, []);

  const point = (event: { clientX: number; clientY: number }): Point => {
    const rect = root.current!.getBoundingClientRect();
    return { x: (event.clientX - rect.left) / rect.width, y: (event.clientY - rect.top) / rect.height };
  };
  const mat = (p: Point) => onMat(p, calibration);
  const rectsOf = (ids: string[]): ZoneOverrides => Object.fromEntries(ids.flatMap(id => { const c = cells.find(cell => cell.zone === id); return c ? [[id, { x: c.x, y: c.y, w: c.w, h: c.h }]] : []; }));
  const boxOf = (ids: string[]): ZoneRect | null => {
    const picked = cells.filter(c => ids.includes(c.zone)); if (!picked.length) return null;
    const x0 = Math.min(...picked.map(c => c.x)), y0 = Math.min(...picked.map(c => c.y));
    return { x: x0, y: y0, w: Math.max(...picked.map(c => c.x + c.w)) - x0, h: Math.max(...picked.map(c => c.y + c.h)) - y0 };
  };
  const shift = (rects: ZoneOverrides, dx: number, dy: number) => {
    const all = Object.values(rects);
    const mx = clamp(dx, low.x - Math.min(...all.map(r => r.x)), high.x - Math.max(...all.map(r => r.x))), my = clamp(dy, low.y - Math.min(...all.map(r => r.y)), high.y - Math.max(...all.map(r => r.y)));
    editor.apply(Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, { ...r, x: r.x + mx, y: r.y + my }])));
  };
  /** Scales the picked rectangles inside a new box; the edge opposite the handle stays, and no member gets smaller than the minimum. */
  const scale = (rects: ZoneOverrides, b: ZoneRect, edges: { x0: number; y0: number; x1: number; y1: number }, hx: number, hy: number) => {
    let { x0, y0, x1, y1 } = edges;
    x0 = Math.max(x0, low.x); y0 = Math.max(y0, low.y); x1 = Math.min(x1, high.x); y1 = Math.min(y1, high.y);
    const all = Object.values(rects), minW = Math.min(...all.map(r => r.w)), minH = Math.min(...all.map(r => r.h));
    const sx = Math.max((x1 - x0) / b.w, MIN_ZONE_SIZE * spacing / minW), sy = Math.max((y1 - y0) / b.h, MIN_ZONE_SIZE / minH);
    if (hx === 0) x0 = x1 - b.w * sx; else x1 = x0 + b.w * sx;
    if (hy === 0) y0 = y1 - b.h * sy; else y1 = y0 + b.h * sy;
    editor.apply(Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, { x: x0 + (r.x - b.x) * sx, y: y0 + (r.y - b.y) * sy, w: r.w * sx, h: r.h * sy }])));
  };
  /** The zone under a mat point; the same smallest-cell rule as the card assignment, but a gap selects nothing. */
  const hit = (m: Point) => zoneCellAt(m, cells);

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); event.currentTarget.focus({ preventScroll: true });
    const p = point(event), m = mat(p), cell = hit(m), add = event.shiftKey || event.ctrlKey || event.metaKey || editor.addMode;
    if (!cell) { if (!add) editor.select([]); drag.current = { kind: "box", start: p, base: add ? selected : [] }; setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
    let ids = selected;
    if (add) { ids = selected.includes(cell.zone) ? selected.filter(id => id !== cell.zone) : [...selected, cell.zone]; editor.select(ids); if (!ids.includes(cell.zone)) return; }
    else if (!selected.includes(cell.zone)) { ids = [cell.zone]; editor.select(ids); }
    drag.current = { kind: "move", startMat: m, rects: rectsOf(ids), origin: { x: event.clientX, y: event.clientY }, started: false };
  };
  const startResize = (event: PointerEvent<HTMLDivElement>, hx: number, hy: number) => {
    event.preventDefault(); event.stopPropagation(); root.current?.setPointerCapture?.(event.pointerId);
    const bounds = boxOf(selected); if (!bounds) return;
    drag.current = { kind: "resize", startMat: mat(point(event)), rects: rectsOf(selected), box: bounds, hx, hy, origin: { x: event.clientX, y: event.clientY }, started: false };
  };
  const moveTo = (event: PointerEvent<HTMLDivElement>) => {
    const active = drag.current; if (!active) return;
    const p = point(event);
    if (active.kind === "box") {
      const x0 = Math.min(active.start.x, p.x), x1 = Math.max(active.start.x, p.x), y0 = Math.min(active.start.y, p.y), y1 = Math.max(active.start.y, p.y);
      setBox({ x0, y0, x1, y1 });
      const inBox = cells.filter(c => { const q = projectCell(c, calibration!).center; return q.x >= x0 && q.x <= x1 && q.y >= y0 && q.y <= y1; }).map(c => c.zone);
      editor.select([...active.base, ...inBox]); return;
    }
    // A tap or a click with a little hand movement selects only; it never makes a zone custom.
    if (!active.started) { if (Math.hypot(event.clientX - active.origin.x, event.clientY - active.origin.y) < MOVE_THRESHOLD) return; active.started = true; editor.checkpoint(); }
    const now = mat(p), dx = now.x - active.startMat.x, dy = now.y - active.startMat.y;
    if (active.kind === "move") { shift(active.rects, dx, dy); return; }
    const { box: b, hx, hy } = active;
    let x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    if (hx === 0) x0 = Math.min(x0 + dx, x1 - MIN_ZONE_SIZE); else if (hx === 1) x1 = Math.max(x1 + dx, x0 + MIN_ZONE_SIZE);
    if (hy === 0) y0 = Math.min(y0 + dy, y1 - MIN_ZONE_SIZE); else if (hy === 1) y1 = Math.max(y1 + dy, y0 + MIN_ZONE_SIZE);
    scale(active.rects, b, { x0, y0, x1, y1 }, hx, hy);
  };
  const up = () => { drag.current = null; setBox(null); };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    const mod = event.ctrlKey || event.metaKey, name = event.key.toLowerCase();
    if (mod && name === "a") { event.preventDefault(); editor.selectAll(); return; }
    if (mod && name === "z") { event.preventDefault(); editor.undo(); return; }
    if (event.key === "[" || event.key === "]") { event.preventDefault(); editor.step(event.key === "]" ? 1 : -1, event.shiftKey); return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); if (selected.some(id => editor.zones[id])) editor.resetSelected(); return; }
    const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
    const bounds = boxOf(selected);
    if (!arrow || !bounds || !calibration) return;
    event.preventDefault(); editor.checkpoint();
    if (event.altKey) {
      // Alt+Arrow resizes in mat units: Right and Down grow the box, Left and Up shrink it.
      const step = event.shiftKey ? .02 : .004;
      scale(rectsOf(selected), bounds, { x0: bounds.x, y0: bounds.y, x1: bounds.x + bounds.w + arrow[0] * step, y1: bounds.y + bounds.h + arrow[1] * step }, 1, 1);
      return;
    }
    // The step is on screen, so Left is always left on the picture; it is turned into mat units here.
    const step = event.shiftKey ? .02 : .004, c = fieldMatPoint({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, calibration);
    const a = mat(c), b = mat({ x: c.x + arrow[0] * step, y: c.y + arrow[1] * step * ratio });
    shift(rectsOf(selected), b.x - a.x, b.y - a.y);
  };

  const bounds = calibration ? boxOf(selected) : null;
  const pct = (p: Point): CSSProperties => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });
  if (!calibration) return null;
  // Handles sit on the projected box. Edge handles are dropped when the box is too small on screen for three of them in a row.
  const at = (hx: number, hy: number) => fieldMatPoint({ x: bounds!.x + bounds!.w * hx, y: bounds!.y + bounds!.h * hy }, calibration);
  const length = (a: Point, b: Point) => Math.hypot((a.x - b.x) * size.w, (a.y - b.y) * size.h);
  const handleSize = editor.narrow ? 22 : 16;
  const wide = bounds ? length(at(0, 0), at(1, 0)) >= 3 * handleSize && length(at(0, 1), at(1, 1)) >= 3 * handleSize : true;
  const tall = bounds ? length(at(0, 0), at(0, 1)) >= 3 * handleSize && length(at(1, 0), at(1, 1)) >= 3 * handleSize : true;
  const cursorOf = (hx: number, hy: number) => {
    const centre = at(.5, .5), p = at(hx, hy), angle = Math.atan2((p.y - centre.y) * size.h, (p.x - centre.x) * size.w) * 180 / Math.PI;
    return (["ew-resize", "nwse-resize", "ns-resize", "nesw-resize"] as const)[((Math.round(angle / 45) % 4) + 4) % 4];
  };
  return <div ref={root} className={s.overlay} tabIndex={0} role="application" data-testid="zone-editor" aria-label="Zone editor" aria-describedby={help}
    onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
    <span id={help} className={s.sr}>Click a zone to select it. Square bracket keys pick the previous or next zone, Shift adds. Arrow keys move the selection, Shift for larger steps. Alt with an arrow key resizes it. Delete resets it. Control Z undoes.</span>
    <svg className={s.grid} viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden>
      {byAreaDesc(cells).map(cell => {
        const { corners, center } = projectCell(cell, calibration), on = selected.includes(cell.zone);
        return <g key={cell.zone} data-selected={on || undefined} data-custom={editor.zones[cell.zone] ? true : undefined}>
          <polygon data-zone={cell.zone} points={corners.map(p => `${p.x * 1000},${p.y * height}`).join(" ")} />
          <text x={center.x * 1000} y={center.y * height}>{cell.label}</text>
        </g>;
      })}
    </svg>
    {box ? <div className={s.box} style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }} /> : null}
    {bounds ? HANDLES.filter(([name]) => (name === "n" || name === "s" ? wide : name === "e" || name === "w" ? tall : true)).map(([name, hx, hy]) => <div key={name} className={s.handle} data-handle={name} data-testid={`zone-handle-${name}`} aria-hidden
      style={{ ...pct(at(hx, hy)), cursor: cursorOf(hx, hy) }} onPointerDown={event => startResize(event, hx, hy)} />) : null}
  </div>;
}

/** Selection tools and Done / Cancel for the editor. */
export function ZoneEditorToolbar({ editor, onDone, onCancel }: { editor: ZoneEditor; onDone(zones: ZoneOverrides): void; onCancel(): void }) {
  const { selected } = editor, none = !selected.length;
  const customSelected = selected.some(id => editor.zones[id]);
  const idle = editor.coarse
    ? "Tap a zone. Turn on Add to selection to pick more. Drag a handle to resize, drag a zone to move."
    : "Click a zone. Shift-click or drag a box to pick more. Drag a handle to resize, drag a zone to move. Arrow keys move, Alt+arrows resize, [ and ] pick the next zone, Ctrl+Z undoes.";
  return <div className={s.toolbar} data-testid="zone-editor-toolbar">
    <p className={s.hint} role="status" data-testid="zone-editor-status">
      {none ? idle : `${selected.length} selected: ${selected.slice(0, 6).join(", ")}${selected.length > 6 ? "…" : ""}`}
    </p>
    {editor.coarse && editor.narrow ? <p className={s.hint} data-testid="zone-editor-turn">Turn your phone sideways for a larger view.</p> : null}
    <div className={s.row}>
      <button type="button" disabled={none} onClick={editor.selectRow} data-testid="zone-editor-row">Select row</button>
      <button type="button" disabled={none} onClick={editor.selectColumn} data-testid="zone-editor-column">Select column</button>
      <button type="button" onClick={editor.selectAll} data-testid="zone-editor-all">Select all</button>
      <button type="button" aria-pressed={editor.addMode} onClick={() => editor.setAddMode(!editor.addMode)} data-testid="zone-editor-add">Add to selection</button>
      <button type="button" disabled={!editor.canUndo} onClick={editor.undo} data-testid="zone-editor-undo">Undo</button>
      <button type="button" disabled={!customSelected} onClick={editor.resetSelected} data-testid="zone-editor-reset">Reset zone</button>
      <button type="button" disabled={!editor.dirty} onClick={editor.resetAll} data-testid="zone-editor-reset-all">Reset all</button>
    </div>
    <div className={s.confirm}>
      <button type="button" onClick={onCancel} data-testid="zone-editor-cancel">Cancel</button>
      <button type="button" className={s.primary} onClick={() => onDone(editor.zones)} data-testid="zone-editor-done">Done</button>
    </div>
  </div>;
}

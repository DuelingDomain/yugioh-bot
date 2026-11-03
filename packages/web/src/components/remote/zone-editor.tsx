"use client";

import { useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import { fieldMatPoint, MIN_ZONE_SIZE, onMat, type FieldCalibration, type FieldFormat, type ZoneOverrides, type ZoneRect } from "@yugidraft/vision";
import { fieldGridCells, projectCell } from "@/lib/remote/zone-grid";
import s from "./zone-editor.module.css";

type Point = { x: number; y: number };
const HANDLES: [string, number, number][] = [["nw", 0, 0], ["n", .5, 0], ["ne", 1, 0], ["e", 1, .5], ["se", 1, 1], ["s", .5, 1], ["sw", 0, 1], ["w", 0, .5]];
const inside = (r: ZoneRect, p: Point) => p.x >= r.x && p.x < r.x + r.w && p.y >= r.y && p.y < r.y + r.h;

/**
 * Draft state of the zone editor. The player edits `zones` (per-zone rectangles in mat units) on top of the default
 * layout; nothing is saved until the host takes `zones` on Done. `calibration` supplies the 4-corner homography.
 */
export function useZoneEditor(calibration: FieldCalibration | undefined, format: FieldFormat) {
  const [zones, setZones] = useState<ZoneOverrides>({});
  const [selected, setSelected] = useState<string[]>([]);
  const cells = useMemo(() => fieldGridCells(format, calibration?.zoneSpacing ?? 1, zones), [format, calibration?.zoneSpacing, zones]);
  const byId = (id: string) => cells.find(c => c.zone === id);
  const select = (ids: string[]) => setSelected([...new Set(ids)]);
  const rowOrColumn = (axis: "row" | "column") => {
    const picked = new Set(selected);
    for (const id of selected) {
      const anchor = byId(id); if (!anchor) continue;
      const cx = anchor.x + anchor.w / 2, cy = anchor.y + anchor.h / 2;
      for (const c of cells) if (axis === "row" ? cy >= c.y && cy < c.y + c.h : cx >= c.x && cx < c.x + c.w) picked.add(c.zone);
    }
    setSelected([...picked]);
  };
  const withoutSelected = () => { const next = { ...zones }; for (const id of selected) delete next[id]; return next; };
  return {
    calibration, format, zones, cells, selected,
    /** Starts an edit from the saved overrides. */
    begin(saved?: ZoneOverrides) { setZones({ ...(saved ?? {}) }); setSelected([]); },
    setZones, select,
    selectAll: () => setSelected(cells.map(c => c.zone)),
    selectRow: () => rowOrColumn("row"), selectColumn: () => rowOrColumn("column"),
    resetSelected: () => setZones(withoutSelected()),
    resetAll: () => setZones({}),
    dirty: Object.keys(zones).length > 0,
  };
}
export type ZoneEditor = ReturnType<typeof useZoneEditor>;

type Drag =
  | { kind: "move"; startMat: Point; rects: ZoneOverrides }
  | { kind: "resize"; startMat: Point; rects: ZoneOverrides; box: ZoneRect; hx: number; hy: number }
  | { kind: "box"; start: Point; base: string[] };

/** The editable zone grid over a camera picture: select, move and resize zones. `ratio` is the picture's width / height. */
export function ZoneEditorOverlay({ editor, ratio }: { editor: ZoneEditor; ratio: number }) {
  const { calibration, cells, selected } = editor;
  const root = useRef<HTMLDivElement>(null), drag = useRef<Drag | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const height = 1000 / ratio;
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
  const shift = (rects: ZoneOverrides, dx: number, dy: number) => editor.setZones({ ...editor.zones, ...Object.fromEntries(Object.entries(rects).map(([id, r]) => [id, { ...r, x: r.x + dx, y: r.y + dy }])) });
  const hit = (m: Point) => cells.filter(c => inside(c, m)).sort((a, b) => a.w * a.h - b.w * b.h)[0];

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.currentTarget.setPointerCapture?.(event.pointerId); event.currentTarget.focus({ preventScroll: true });
    const p = point(event), m = mat(p), cell = hit(m), add = event.shiftKey || event.ctrlKey || event.metaKey;
    if (!cell) { if (!add) editor.select([]); drag.current = { kind: "box", start: p, base: add ? selected : [] }; setBox({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); return; }
    let ids = selected;
    if (add) { ids = selected.includes(cell.zone) ? selected.filter(id => id !== cell.zone) : [...selected, cell.zone]; editor.select(ids); if (!ids.includes(cell.zone)) return; }
    else if (!selected.includes(cell.zone)) { ids = [cell.zone]; editor.select(ids); }
    drag.current = { kind: "move", startMat: m, rects: rectsOf(ids) };
  };
  const startResize = (event: PointerEvent<HTMLDivElement>, hx: number, hy: number) => {
    event.preventDefault(); event.stopPropagation(); root.current?.setPointerCapture?.(event.pointerId);
    const bounds = boxOf(selected); if (!bounds) return;
    drag.current = { kind: "resize", startMat: mat(point(event)), rects: rectsOf(selected), box: bounds, hx, hy };
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
    const now = mat(p), dx = now.x - active.startMat.x, dy = now.y - active.startMat.y;
    if (active.kind === "move") { shift(active.rects, dx, dy); return; }
    const { box: b, hx, hy } = active;
    let x0 = b.x, x1 = b.x + b.w, y0 = b.y, y1 = b.y + b.h;
    if (hx === 0) x0 = Math.min(x0 + dx, x1 - MIN_ZONE_SIZE); else if (hx === 1) x1 = Math.max(x1 + dx, x0 + MIN_ZONE_SIZE);
    if (hy === 0) y0 = Math.min(y0 + dy, y1 - MIN_ZONE_SIZE); else if (hy === 1) y1 = Math.max(y1 + dy, y0 + MIN_ZONE_SIZE);
    const sx = (x1 - x0) / b.w, sy = (y1 - y0) / b.h;
    editor.setZones({ ...editor.zones, ...Object.fromEntries(Object.entries(active.rects).map(([id, r]) => [id, { x: x0 + (r.x - b.x) * sx, y: y0 + (r.y - b.y) * sy, w: r.w * sx, h: r.h * sy }])) });
  };
  const up = () => { drag.current = null; setBox(null); };
  const key = (event: KeyboardEvent<HTMLDivElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") { event.preventDefault(); editor.selectAll(); return; }
    if (event.key === "Delete" || event.key === "Backspace") { event.preventDefault(); editor.resetSelected(); return; }
    const arrow = ({ ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] } as Record<string, number[]>)[event.key];
    const bounds = boxOf(selected);
    if (!arrow || !bounds || !calibration) return;
    event.preventDefault();
    // The step is on screen, so Left is always left on the picture; it is turned into mat units here.
    const step = event.shiftKey ? .02 : .004, c = fieldMatPoint({ x: bounds.x + bounds.w / 2, y: bounds.y + bounds.h / 2 }, calibration);
    const a = mat(c), b = mat({ x: c.x + arrow[0] * step, y: c.y + arrow[1] * step * ratio });
    shift(rectsOf(selected), b.x - a.x, b.y - a.y);
  };

  const bounds = calibration ? boxOf(selected) : null;
  const pct = (p: Point): CSSProperties => ({ left: `${p.x * 100}%`, top: `${p.y * 100}%` });
  if (!calibration) return null;
  return <div ref={root} className={s.overlay} tabIndex={0} role="application" data-testid="zone-editor" aria-label="Zone editor. Click a zone to select it. Arrow keys move the selection, Shift for larger steps. Delete resets it."
    onPointerDown={down} onPointerMove={moveTo} onPointerUp={up} onPointerCancel={up} onKeyDown={key}>
    <svg className={s.grid} viewBox={`0 0 1000 ${height}`} preserveAspectRatio="none" aria-hidden>
      {cells.map(cell => {
        const { corners, center } = projectCell(cell, calibration), on = selected.includes(cell.zone);
        return <g key={cell.zone} data-selected={on || undefined} data-custom={editor.zones[cell.zone] ? true : undefined}>
          <polygon data-zone={cell.zone} points={corners.map(p => `${p.x * 1000},${p.y * height}`).join(" ")} />
          <text x={center.x * 1000} y={center.y * height}>{cell.label}</text>
        </g>;
      })}
    </svg>
    {box ? <div className={s.box} style={{ left: `${box.x0 * 100}%`, top: `${box.y0 * 100}%`, width: `${(box.x1 - box.x0) * 100}%`, height: `${(box.y1 - box.y0) * 100}%` }} /> : null}
    {bounds ? HANDLES.map(([name, hx, hy]) => <div key={name} className={s.handle} data-handle={name} data-testid={`zone-handle-${name}`} aria-hidden
      style={pct(fieldMatPoint({ x: bounds.x + bounds.w * hx, y: bounds.y + bounds.h * hy }, calibration))} onPointerDown={event => startResize(event, hx, hy)} />) : null}
  </div>;
}

/** Selection tools and Done / Cancel for the editor. */
export function ZoneEditorToolbar({ editor, onDone, onCancel }: { editor: ZoneEditor; onDone(zones: ZoneOverrides): void; onCancel(): void }) {
  const { selected } = editor, none = !selected.length;
  const customSelected = selected.some(id => editor.zones[id]);
  return <div className={s.toolbar} data-testid="zone-editor-toolbar">
    <p className={s.hint} role="status" data-testid="zone-editor-status">
      {none ? "Click a zone. Shift-click or drag a box to pick more. Drag a handle to resize, drag a zone to move, arrow keys nudge (Shift = bigger)."
        : `${selected.length} selected: ${selected.slice(0, 6).join(", ")}${selected.length > 6 ? "…" : ""}`}
    </p>
    <div className={s.row}>
      <button type="button" disabled={none} onClick={editor.selectRow} data-testid="zone-editor-row">Select row</button>
      <button type="button" disabled={none} onClick={editor.selectColumn} data-testid="zone-editor-column">Select column</button>
      <button type="button" onClick={editor.selectAll} data-testid="zone-editor-all">Select all</button>
      <button type="button" disabled={!customSelected} onClick={editor.resetSelected} data-testid="zone-editor-reset">Reset zone</button>
      <button type="button" disabled={!editor.dirty} onClick={editor.resetAll} data-testid="zone-editor-reset-all">Reset all</button>
      <span className={s.spacer} />
      <button type="button" onClick={onCancel} data-testid="zone-editor-cancel">Cancel</button>
      <button type="button" className={s.primary} onClick={() => onDone(editor.zones)} data-testid="zone-editor-done">Done</button>
    </div>
  </div>;
}

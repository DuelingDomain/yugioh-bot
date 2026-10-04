"use client";

import { useLayoutEffect, useRef, useState } from "react";
import type { BattleAim } from "../battle-fx";
import table from "./table.module.css";

/** A box in plane coordinates (px, before the tilt). */
type PlaneBox = { x: number; y: number; w: number; h: number };
type Pt = { x: number; y: number };

/** One drawn path and the rings of its two ends. */
type PlanePath = { d: string; from: Pt };
type PlaneGeom = { mode: BattleAim["mode"]; width: number; height: number; paths: PlanePath[]; rings: PlaneBox[]; fromRing: PlaneBox };

/** The card box inside a zone cell: the concept card is 0.875 of the cell height (`--ch` = `--s` * 0.875). */
const CARD_RATIO = 0.875;
/** Gap (px) between the arrow and the card edges (concept `layoutPlaneSvg`). */
const START_GAP = 2;
const END_GAP = 6;

/**
 * The attack path between two points: a quadratic curve that bows to the right of the travel direction
 * (concept `layoutPlaneSvg`: control point at the middle, pushed sideways by 0.34 of the length).
 */
export function attackCurve(a: Pt, b: Pt): string {
  const length = Math.hypot(b.x - a.x, b.y - a.y);
  const cx = (a.x + b.x) / 2 + length * 0.34;
  const cy = (a.y + b.y) / 2;
  const r = (n: number) => Math.round(n * 10) / 10;
  return `M${r(a.x)} ${r(a.y)} Q${r(cx)} ${r(cy)} ${r(b.x)} ${r(b.y)}`;
}

/**
 * Position of an element in plane coordinates. This is the one place inside the plane where offsetLeft / offsetTop are
 * right: the SVG is laid out in plane pixels and tilts with the table (spec 2.2 rule 7). Every positioned ancestor
 * (cell, zone) adds its offset until the plane itself.
 */
function boxInPlane(el: HTMLElement, plane: HTMLElement): PlaneBox | null {
  let x = 0;
  let y = 0;
  let node: HTMLElement | null = el;
  while (node && node !== plane) {
    x += node.offsetLeft;
    y += node.offsetTop;
    node = node.offsetParent as HTMLElement | null;
  }
  if (node !== plane || el.offsetWidth === 0 || el.offsetHeight === 0) return null;
  return { x, y, w: el.offsetWidth, h: el.offsetHeight };
}

function zoneInPlane(plane: HTMLElement, key: string): PlaneBox | null {
  const el = plane.querySelector<HTMLElement>(`[data-zones~="${key}"]`);
  return el ? boxInPlane(el, plane) : null;
}

function measure(plane: HTMLElement, aim: BattleAim | null): PlaneGeom | null {
  if (!aim?.from) return null;
  const from = zoneInPlane(plane, aim.from);
  if (!from) return null;
  const cardH = from.h * CARD_RATIO;
  const centre = (box: PlaneBox): Pt => ({ x: box.x + box.w / 2, y: box.y + box.h / 2 });
  const start = centre(from);
  const targets: PlaneBox[] = [];
  for (const key of aim.to.zones ?? []) {
    const box = zoneInPlane(plane, key);
    if (box) targets.push(box);
  }
  const paths: PlanePath[] = targets.map((box) => {
    const end = centre(box);
    const up = end.y < start.y;
    // Leave the near edge of the attacker, land on the near edge of the target.
    const a = { x: start.x, y: start.y + (up ? -cardH / 2 - START_GAP : cardH / 2 + START_GAP) };
    const b = { x: end.x, y: end.y + (up ? cardH / 2 + END_GAP : -cardH / 2 - END_GAP) };
    return { d: attackCurve(a, b), from: a };
  });
  // A direct attack aims at the opponent's life points, which sit outside the plane: point past its far edge.
  if (aim.to.lpSeat != null && !(aim.to.zones?.length)) {
    const a = { x: start.x, y: start.y - cardH / 2 - START_GAP };
    const b = { x: start.x, y: -END_GAP };
    paths.push({ d: attackCurve(a, b), from: a });
  }
  if (paths.length === 0) return null;
  return { mode: aim.mode, width: plane.offsetWidth, height: plane.offsetHeight, paths, rings: targets, fromRing: from };
}

function signatureOf(aim: BattleAim | null): string {
  if (!aim?.from) return "";
  return `${aim.mode}|${aim.from}|${(aim.to.zones ?? []).join(",")}|${aim.to.lpSeat ?? ""}`;
}

/**
 * The attack path drawn on the plane, in plane coordinates, so it tilts with the table (concept `layoutPlaneSvg`:
 * gold, 2px, dash 6 6, a curve with an arrow head). It draws the room's aim (`battleAim`): a dim preview from the
 * action menu, the arrow of the hovered target, and the locked one. It renders as a child of the plane and measures
 * its parent in one animation frame (reads, then one state write).
 *
 * The room must hand the same `battleAim` to this component or to `BattleFx`, not to both: `BattleFx` draws its own
 * flat arrow from it. `hidden` hides the path while another layer owns the arrow.
 */
export function PlaneSvg({ aim, hidden = false }: { aim: BattleAim | null; hidden?: boolean }) {
  const ref = useRef<SVGSVGElement | null>(null);
  const aimRef = useRef(aim);
  aimRef.current = aim;
  const [geom, setGeom] = useState<PlaneGeom | null>(null);
  const signature = hidden ? "" : signatureOf(aim);

  useLayoutEffect(() => {
    const plane = ref.current?.parentElement;
    if (!plane || signature === "") {
      setGeom(null);
      return;
    }
    let frame: number | null = null;
    const run = () => {
      frame = null;
      setGeom(measure(plane, aimRef.current));
    };
    const schedule = () => {
      if (frame == null) frame = requestAnimationFrame(run);
    };
    setGeom(measure(plane, aimRef.current));
    schedule();
    window.addEventListener("resize", schedule);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(schedule) : null;
    observer?.observe(plane);
    return () => {
      if (frame != null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer?.disconnect();
    };
  }, [signature]);

  const live = geom != null && signature !== "";
  return (
    <svg ref={ref} className={table.planeSvg} aria-hidden="true" data-sv-plane-svg="" data-aim={live ? geom.mode : undefined}
      viewBox={live ? `0 0 ${geom.width} ${geom.height}` : undefined}>
      {live ? (
        <>
          <defs>
            <marker id="sv-aim-head" viewBox="0 0 10 10" refX="7" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M1 1L9 5L1 9z" fill="#e8cf94" />
            </marker>
          </defs>
          {geom.mode !== "preview" ? (
            <rect className={`${table.aimRing} ${table.aimRingFrom}`} x={geom.fromRing.x - 2} y={geom.fromRing.y - 2}
              width={geom.fromRing.w + 4} height={geom.fromRing.h + 4} rx={8} />
          ) : null}
          {geom.mode !== "preview" ? geom.rings.map((box, index) => (
            <rect key={index} className={table.aimRing} x={box.x - 2} y={box.y - 2} width={box.w + 4} height={box.h + 4} rx={8} />
          )) : null}
          {geom.paths.map((path, index) => (
            <path key={index} className={`${table.aimPath} ${geom.mode === "preview" ? table.aimPathDim : ""}`} d={path.d} markerEnd="url(#sv-aim-head)" />
          ))}
        </>
      ) : null}
    </svg>
  );
}

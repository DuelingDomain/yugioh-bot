"use client";

import { useEffect, useRef } from "react";
import { ARENA_CENTER } from "./geometry";
import { findShown } from "./zone-find";
import styles from "./pair-link.module.css";

export interface PairLinkProps {
  /** The two seats of a facing pair (`sharedExtraWith`). Zone 5 of one is zone 6 of the other. */
  a: number;
  b: number;
  /** Text on the link, e.g. "Linked columns". */
  label: string;
  /** Changes when the view moves (camera mode, seats and fly pose, board size, seats out): the link measures again for a short while. */
  stamp: string;
}

/** The two physical shared zones: a's zone 5 with b's zone 6, and a's zone 6 with b's zone 5. */
const ZONES: ReadonlyArray<readonly [number, number]> = [
  [5, 6],
  [6, 5],
];

/** How long the link keeps measuring after a change: a camera move or a zoom runs shorter than this. */
const SETTLE_MS = 1400;
/** The turn ring is a disc this size when the DOM has none to measure (stage px), and the room the lines keep from it. */
const RING_R = 72;
const RING_GAP = 14;
const LABEL = { w: 92, h: 18 };

interface Pt {
  x: number;
  y: number;
}

const quad = (p0: Pt, c: Pt, p1: Pt, t: number): Pt => ({
  x: (1 - t) * (1 - t) * p0.x + 2 * (1 - t) * t * c.x + t * t * p1.x,
  y: (1 - t) * (1 - t) * p0.y + 2 * (1 - t) * t * c.y + t * t * p1.y,
});

/**
 * The curve between two zones that keeps off the turn ring: the straightest bow whose samples stay clear of the disc. It
 * bows to whichever side clears it first (the other line of the pair takes its own side, so they never cross there).
 */
export function routeAround(p0: Pt, p1: Pt, ring: { x: number; y: number; r: number }): { c: Pt; d: string } {
  const dx = p1.x - p0.x;
  const dy = p1.y - p0.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const mid = { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 };
  const clear = (c: Pt) => {
    for (let i = 0; i <= 24; i += 1) {
      const p = quad(p0, c, p1, i / 24);
      if (Math.hypot(p.x - ring.x, p.y - ring.y) < ring.r + RING_GAP) return false;
    }
    return true;
  };
  const control = (bow: number): Pt => ({ x: mid.x + nx * bow, y: mid.y + ny * bow });
  let pick = control(0);
  if (!clear(pick)) {
    for (const bow of [30, 60, 90, 130, 180, 240, 320]) {
      const options = [bow, -bow].map(control).filter(clear);
      if (options.length > 0) {
        // The side that bows away from the ring.
        pick = options.sort((u, v) => Math.hypot(v.x - ring.x, v.y - ring.y) - Math.hypot(u.x - ring.x, u.y - ring.y))[0];
        break;
      }
    }
  }
  return { c: pick, d: `M${p0.x} ${p0.y} Q${pick.x} ${pick.y} ${p1.x} ${p1.y}` };
}

/**
 * The plaza link of a facing pair: a thin gold and violet line from each Extra Monster Zone of one seat to the same
 * zone on the facing seat's field, with a small label on one line. The lines route round the turn ring. It measures the
 * live zone elements, but only for a moment after something moved the view (a new `stamp`, which includes the fly pose, a resize, a transition, a pointer
 * or wheel gesture on the stage, a key), not on every frame. No pointer events; the motion stops under reduced motion.
 */
export function PairLink({ a, b, label, stamp }: PairLinkProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefs = useRef<Array<SVGPathElement | null>>([]);
  const nodeRefs = useRef<Array<SVGCircleElement | null>>([]);
  const labelRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const root = svg.closest("[data-table-stage]") ?? document;
    let frame = 0;
    let until = 0;
    const centre = (node: Element, origin: DOMRect, k: number): Pt => {
      const r = node.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - origin.left) / k, y: (r.top + r.height / 2 - origin.top) / k };
    };
    const hide = () => svg.setAttribute("data-found", "false");
    const measure = () => {
      const origin = svg.getBoundingClientRect();
      const k = origin.width / 1100;
      if (!(k > 0)) return hide();
      const ringEl = findShown(root, "[data-turn-ring]");
      const ringBox = ringEl?.getBoundingClientRect();
      const ring = ringBox && ringBox.width > 0
        ? { x: (ringBox.left + ringBox.width / 2 - origin.left) / k, y: (ringBox.top + ringBox.height / 2 - origin.top) / k, r: Math.max(RING_R, ringBox.width / k / 2) }
        : { x: ARENA_CENTER.x, y: ARENA_CENTER.y, r: RING_R };
      const ends: Pt[] = [];
      const routes: Array<{ p0: Pt; c: Pt; p1: Pt }> = [];
      ZONES.forEach(([zoneA, zoneB], index) => {
        const fromEl = findShown(root, `[data-testid="seat-field-${a}"] [data-link-seq="${zoneA}"]`);
        const toEl = findShown(root, `[data-testid="seat-field-${b}"] [data-link-seq="${zoneB}"]`);
        const paths = [pathRefs.current[index * 2], pathRefs.current[index * 2 + 1]];
        if (!fromEl || !toEl) return paths.forEach((path) => path?.setAttribute("d", ""));
        const p0 = centre(fromEl, origin, k);
        const p1 = centre(toEl, origin, k);
        const { c, d } = routeAround(p0, p1, ring);
        paths.forEach((path) => path?.setAttribute("d", d));
        nodeRefs.current[index * 2]?.setAttribute("transform", `translate(${p0.x} ${p0.y})`);
        nodeRefs.current[index * 2 + 1]?.setAttribute("transform", `translate(${p1.x} ${p1.y})`);
        ends.push(p0, p1);
        routes.push({ p0, c, p1 });
      });
      if (routes.length === 0) return hide();
      // The label sits on the first line where it is clear of the ring and of the zones at both ends (a zone card is about 70 px
      // tall on the stage), so it never covers a card.
      const first = routes[0];
      const clearOf = (p: Pt) =>
        Math.hypot(p.x - ring.x, p.y - ring.y) > ring.r + RING_GAP + LABEL.w / 2 * 0.4 &&
        ends.every((end) => Math.hypot(p.x - end.x, p.y - end.y) > 75);
      const spots = [0.5, 0.42, 0.58, 0.34, 0.66, 0.26, 0.74].map((t) => quad(first.p0, first.c, first.p1, t));
      const spot = spots.find(clearOf) ?? spots[0];
      labelRef.current?.setAttribute("transform", `translate(${spot.x} ${spot.y})`);
      svg.setAttribute("data-found", "true");
    };
    const loop = () => {
      frame = 0;
      measure();
      if (performance.now() < until) frame = requestAnimationFrame(loop);
    };
    // A change starts (or extends) a short measuring burst; a quiet view costs nothing.
    const wake = () => {
      until = performance.now() + SETTLE_MS;
      if (!frame) frame = requestAnimationFrame(loop);
    };
    wake();
    const resize = typeof ResizeObserver !== "undefined" ? new ResizeObserver(wake) : null;
    resize?.observe(root instanceof Element ? root : document.documentElement);
    resize?.observe(svg);
    window.addEventListener("resize", wake);
    const events = ["transitionend", "animationend", "pointerup", "wheel", "keyup"] as const;
    events.forEach((name) => root.addEventListener(name, wake, true));
    // Camera keys (1-3, F, arrows) may be pressed with the focus on the page body, outside the stage.
    window.addEventListener("keyup", wake);
    // A free fly drag moves the world between the camera states: measure while a button is down.
    const drag = (event: PointerEvent) => {
      if (event.buttons !== 0) wake();
    };
    window.addEventListener("pointermove", drag);
    return () => {
      window.removeEventListener("keyup", wake);
      window.removeEventListener("pointermove", drag);
      if (frame) cancelAnimationFrame(frame);
      resize?.disconnect();
      window.removeEventListener("resize", wake);
      events.forEach((name) => root.removeEventListener(name, wake, true));
    };
  }, [a, b, stamp]);

  return (
    <svg ref={svgRef} className={styles.link} viewBox="0 0 1100 860" data-pair-link={`${a}-${b}`} data-found="false" aria-hidden="true">
      {ZONES.map(([zoneA], index) => (
        <g key={zoneA}>
          <path ref={(node) => void (pathRefs.current[index * 2] = node)} className={styles.glow} fill="none" />
          <path ref={(node) => void (pathRefs.current[index * 2 + 1] = node)} className={styles.line} fill="none" />
        </g>
      ))}
      {[0, 1, 2, 3].map((index) => (
        <circle key={index} ref={(node) => void (nodeRefs.current[index] = node)} className={styles.node} r="5" />
      ))}
      <g ref={labelRef}>
        <rect className={styles.tag} x={-LABEL.w / 2} y={-LABEL.h / 2} width={LABEL.w} height={LABEL.h} rx="9" />
        <text className={styles.text} textAnchor="middle" y="4">{label}</text>
      </g>
    </svg>
  );
}

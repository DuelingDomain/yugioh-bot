"use client";

import { useEffect, useRef } from "react";
import { ARENA_CENTER } from "./geometry";
import { hexToRgbTriplet } from "./seat-angle";
import { findShown } from "./zone-find";
import { SEAT_TONE_HEX, type BattleAim, type SeatTone } from "./types";
import styles from "./attack-line.module.css";

export interface AttackLineProps {
  aim: BattleAim | null;
  /** Tone of the attacking seat: the line starts in its colour. */
  tone: SeatTone;
  /** Height of the stage canvas in stage px (the width is always 1100). A table whose canvas is not 860 high says so. */
  stageHeight?: number;
}

interface Pt {
  x: number;
  y: number;
  w: number;
}

const escape = (value: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"'));

/** The curve of the line: a quadratic that bows toward the arena centre, so it crosses the arena. */
export function aimCurve(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const mx = (from.x + to.x) / 2;
  const my = (from.y + to.y) / 2;
  const nx = -dy / length;
  const ny = dx / length;
  const side = (ARENA_CENTER.x - mx) * nx + (ARENA_CENTER.y - my) * ny > 0 ? 1 : -1;
  const bow = Math.min(90, length * 0.18) * side;
  return `M${from.x} ${from.y} Q${mx + nx * bow} ${my + ny * bow - 20} ${to.x} ${to.y}`;
}

/**
 * The attack line of a battle aim, drawn on the stage canvas (stage px). It measures the attacker, and the target
 * card or LP panel, from the live DOM on every frame while an aim exists, so it follows a camera that moves under
 * it (a fly-in orbit, a swing). Preview is a faint dashed hint, aim is dashed and marching, locked is solid.
 * It takes no pointer events. BattleFx gets no aim of its own: this line is the aim layer of a table.
 */
export function AttackLine({ aim, tone, stageHeight = 860 }: AttackLineProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const gradRef = useRef<SVGLinearGradientElement>(null);
  const startRef = useRef<SVGGElement>(null);
  const endRef = useRef<SVGGElement>(null);
  const endRingRef = useRef<SVGCircleElement>(null);
  const active = aim?.from != null;
  const mode = aim?.mode ?? "aim";
  const fromKey = aim?.from ?? null;
  const zones = (aim?.to.zones ?? []).join(" ");
  const lpSeat = aim?.to.lpSeat ?? null;

  useEffect(() => {
    const svg = svgRef.current;
    if (!active || !svg || !fromKey) return;
    const root = svg.closest("[data-table-stage]") ?? document;
    let frame = 0;
    const find = (selector: string): Element | null => findShown(root, selector);
    const point = (node: Element, origin: DOMRect, k: number): Pt => {
      const r = node.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - origin.left) / k, y: (r.top + r.height / 2 - origin.top) / k, w: r.width / k };
    };
    const hide = () => svg.setAttribute("data-found", "false");
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const origin = svg.getBoundingClientRect();
      const k = origin.width / 1100;
      if (!(k > 0)) return hide();
      const fromEl = find(`[data-zones~="${escape(fromKey)}"]`);
      const toEl =
        lpSeat != null
          ? find(`[data-lp-seat="${lpSeat}"]`)
          : zones
              .split(" ")
              .filter(Boolean)
              .map((key) => find(`[data-zones~="${escape(key)}"]`))
              .find((node): node is Element => node != null) ?? null;
      if (!fromEl || !toEl) return hide();
      const p0 = point(fromEl, origin, k);
      const p1 = point(toEl, origin, k);
      const d = aimCurve(p0, p1);
      glowRef.current?.setAttribute("d", d);
      pathRef.current?.setAttribute("d", d);
      const grad = gradRef.current;
      if (grad) {
        grad.setAttribute("x1", String(p0.x));
        grad.setAttribute("y1", String(p0.y));
        grad.setAttribute("x2", String(p1.x));
        grad.setAttribute("y2", String(p1.y));
      }
      startRef.current?.setAttribute("transform", `translate(${p0.x} ${p0.y})`);
      endRef.current?.setAttribute("transform", `translate(${p1.x} ${p1.y})`);
      endRingRef.current?.setAttribute("r", String(Math.max(24, Math.min(46, p1.w * 0.42))));
      svg.setAttribute("data-found", "true");
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [active, fromKey, zones, lpSeat]);

  const rgb = hexToRgbTriplet(SEAT_TONE_HEX[tone].main);
  const preview = mode === "preview";
  return (
    <svg
      ref={svgRef}
      className={styles.line}
      viewBox={`0 0 1100 ${stageHeight}`}
      data-attack-line={active ? mode : "off"}
      data-found="false"
      aria-hidden="true"
      style={active ? (stageHeight === 860 ? undefined : { height: stageHeight }) : { display: "none" }}
    >
      <defs>
        <filter id="attack-line-glow" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="5" />
        </filter>
        <linearGradient ref={gradRef} id="attack-line-grad" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor={`rgb(${rgb})`} />
          <stop offset="0.25" stopColor="#f0a46a" />
          <stop offset="1" stopColor="#ffd2ad" />
        </linearGradient>
        <marker id="attack-line-head" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
          <path d="M0 0L10 5L0 10z" fill="#ffd2ad" />
        </marker>
      </defs>
      <path ref={glowRef} className={styles.glow} stroke={`rgb(217 141 82 / ${preview ? 0.25 : 0.5})`} strokeWidth={preview ? 8 : 14} fill="none" filter="url(#attack-line-glow)" />
      <path
        ref={pathRef}
        className={mode === "locked" ? styles.solid : preview ? styles.preview : styles.march}
        stroke="url(#attack-line-grad)"
        strokeWidth={preview ? 2 : 3.2}
        strokeLinecap="round"
        fill="none"
        markerEnd="url(#attack-line-head)"
      />
      <g ref={startRef}>
        <circle r="7" fill={`rgb(${rgb})`} stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" />
        <circle r="13" fill="none" stroke={`rgb(${rgb} / 0.5)`} />
      </g>
      <g ref={endRef}>
        <circle ref={endRingRef} r="30" className={styles.ring} fill="none" stroke="#ffd2ad" strokeOpacity="0.8" strokeWidth="1.4" strokeDasharray="6 5" />
        {mode === "locked" ? <circle r="4" fill="#ffd2ad" /> : null}
      </g>
    </svg>
  );
}

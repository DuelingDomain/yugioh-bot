"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { hexToRgbTriplet } from "./seat-angle";
import { findShown } from "./zone-find";
import { SEAT_TONE_HEX, type BattleAim, type SeatTone } from "./types";
import styles from "./aim-arrow.module.css";

/** Where the mouse or pen was last seen, in client px. Null on a touch screen: it has no cursor. */
export interface AimPointerSpot {
  x: number;
  y: number;
}

export interface AimArrowProps {
  /** Zone key of the attacker: the arrow starts at its card. */
  fromKey: string;
  /** Tone of the attacking seat: the arrow starts in its colour. */
  tone: SeatTone;
  /** Tone of the seat that the snapped target belongs to (its dot on the label). */
  targetTone: SeatTone | null;
  /** The live pointer. It is read on every frame, so a move costs no render. */
  pointer: { current: AimPointerSpot | null };
  /** The legal target under the tip. The arrow snaps to it. Null: the arrow follows the pointer. */
  snap: BattleAim["to"] | null;
  /** Short words for the snapped target ("Attack: Dark Magician", "Direct attack: Ren"). */
  label: string | null;
}

interface Pt {
  x: number;
  y: number;
  w: number;
}

const escape = (value: string) => (typeof CSS !== "undefined" && CSS.escape ? CSS.escape(value) : value.replace(/"/g, '\\"'));

/** A shallow curve from the attacker to the tip that bows up the screen, so it clears the cards it starts from. */
export function aimArrowPath(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const side = ny <= 0 ? 1 : -1;
  const bow = Math.min(80, length * 0.16) * side;
  return `M${from.x} ${from.y} Q${(from.x + to.x) / 2 + nx * bow} ${(from.y + to.y) / 2 + ny * bow} ${to.x} ${to.y}`;
}

/** The nodes that light up for a target: a card, or a whole board (field mat and LP panel) of a seat. */
function hotNodes(snap: BattleAim["to"]): Element[] {
  if (snap.lpSeat != null) {
    const seat = snap.lpSeat;
    const chips = [...document.querySelectorAll(`[data-lp-seat="${seat}"]`)].filter((node) => !node.closest("[data-holo]"));
    return [...document.querySelectorAll(`[data-seat-field="${seat}"], [data-holo="${seat}"]`), ...chips];
  }
  return (snap.zones ?? []).map((key) => findShown(document, `[data-zones~="${escape(key)}"]`)).filter((node): node is Element => node != null);
}

/**
 * The aim arrow of a pointer-driven attack. After an attacker is chosen it runs from that card to the mouse cursor and
 * follows it live. When the tip is over a legal target it snaps to it, lights the target up and shows a short label.
 * It is drawn in client px on a fixed layer over the page (a portal on the body), and it measures the attacker and the
 * target from the live DOM on every frame, so it follows a camera that moves under it. It takes no pointer events.
 */
export function AimArrow({ fromKey, tone, targetTone, pointer, snap, label }: AimArrowProps) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const glowRef = useRef<SVGPathElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const gradRef = useRef<SVGLinearGradientElement>(null);
  const startRef = useRef<SVGGElement>(null);
  const endRef = useRef<SVGGElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const labelRef = useRef<HTMLDivElement>(null);
  const zones = (snap?.zones ?? []).join(" ");
  const lpSeat = snap?.lpSeat ?? null;
  const snapped = zones !== "" || lpSeat != null;

  useEffect(() => setHost(document.body), []);

  useEffect(() => {
    const layer = layerRef.current;
    if (!host || !layer) return;
    let frame = 0;
    const point = (node: Element): Pt => {
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width };
    };
    const root = document.documentElement;
    // The table root holds the attacker, the targets and the LP panels: a frame searches that, not the whole page.
    let scope: ParentNode = document;
    const hide = () => {
      layer.setAttribute("data-found", "false");
    };
    const draw = () => {
      frame = requestAnimationFrame(draw);
      if (!(scope instanceof Element) || !scope.isConnected) scope = document.querySelector("[data-table-stage]") ?? document;
      const fromEl = findShown(scope, `[data-zones~="${escape(fromKey)}"]`);
      const toEl =
        lpSeat != null
          ? findShown(scope, `[data-holo="${lpSeat}"], [data-lp-seat="${lpSeat}"]`)
          : zones
              .split(" ")
              .filter(Boolean)
              .map((key) => findShown(scope, `[data-zones~="${escape(key)}"]`))
              .find((node): node is Element => node != null) ?? null;
      const tip: Pt | null = toEl ? point(toEl) : pointer.current ? { ...pointer.current, w: 0 } : null;
      if (!fromEl || !tip) return hide();
      const p0 = point(fromEl);
      const d = aimArrowPath(p0, tip);
      glowRef.current?.setAttribute("d", d);
      pathRef.current?.setAttribute("d", d);
      const grad = gradRef.current;
      if (grad) {
        grad.setAttribute("x1", String(p0.x));
        grad.setAttribute("y1", String(p0.y));
        grad.setAttribute("x2", String(tip.x));
        grad.setAttribute("y2", String(tip.y));
      }
      startRef.current?.setAttribute("transform", `translate(${p0.x} ${p0.y})`);
      endRef.current?.setAttribute("transform", `translate(${tip.x} ${tip.y})`);
      ringRef.current?.setAttribute("r", String(Math.max(26, Math.min(64, tip.w * 0.55))));
      const chip = labelRef.current;
      if (chip) {
        const x = Math.min(window.innerWidth - 110, Math.max(110, tip.x));
        // Below the target: the card hover info opens above it. Above only when there is no room below.
        const gap = Math.max(30, tip.w * 0.55 + 10);
        const below = tip.y + gap < window.innerHeight - 70;
        chip.style.transform = `translate(${x}px, ${below ? tip.y + gap : Math.max(40, tip.y - gap)}px) translate(-50%, ${below ? "0" : "-100%"})`;
      }
      layer.setAttribute("data-found", "true");
    };
    // The table's own attack line steps aside while this arrow is mounted.
    root.setAttribute("data-aim-arrow-on", "true");
    draw();
    return () => {
      cancelAnimationFrame(frame);
      root.removeAttribute("data-aim-arrow-on");
    };
  }, [host, fromKey, zones, lpSeat, pointer]);

  // The target lights up while the tip is over it.
  useEffect(() => {
    if (!snapped || !snap) return;
    const nodes = hotNodes(snap);
    for (const node of nodes) node.setAttribute("data-aim-hot", "true");
    return () => {
      for (const node of nodes) node.removeAttribute("data-aim-hot");
    };
    // `snap` is read through its two parts.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [snapped, zones, lpSeat]);

  if (!host) return null;
  const rgb = hexToRgbTriplet(SEAT_TONE_HEX[tone].main);
  const targetRgb = hexToRgbTriplet(SEAT_TONE_HEX[targetTone ?? tone].main);
  const vars: CSSProperties & Record<string, string> = { "--aim-from": rgb, "--aim-to": targetRgb };
  return createPortal(
    <div
      ref={layerRef}
      className={styles.layer}
      style={vars}
      data-aim-arrow={snapped ? "snapped" : "free"}
      data-found="false"
      aria-hidden="true"
    >
      <svg className={styles.svg}>
        <defs>
          <filter id="aim-arrow-glow" x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <linearGradient ref={gradRef} id="aim-arrow-grad" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor={`rgb(${rgb})`} />
            <stop offset="0.3" stopColor="#f0a46a" />
            <stop offset="1" stopColor="#ffd2ad" />
          </linearGradient>
          <marker id="aim-arrow-head" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth="20" markerHeight="20" orient="auto">
            <path d="M0 0L10 5L0 10L2.6 5z" fill="#ffd2ad" />
          </marker>
        </defs>
        <path ref={glowRef} stroke={`rgb(217 141 82 / ${snapped ? 0.55 : 0.4})`} strokeWidth={snapped ? 14 : 10} fill="none" filter="url(#aim-arrow-glow)" />
        <path
          ref={pathRef}
          className={snapped ? styles.solid : styles.march}
          stroke="url(#aim-arrow-grad)"
          strokeWidth={3.4}
          strokeLinecap="round"
          fill="none"
          markerEnd="url(#aim-arrow-head)"
        />
        <g ref={startRef}>
          <circle r="7" fill={`rgb(${rgb})`} stroke="#fff" strokeOpacity="0.7" strokeWidth="1.2" />
          <circle r="13" fill="none" stroke={`rgb(${rgb} / 0.5)`} />
        </g>
        <g ref={endRef}>
          {snapped ? <circle ref={ringRef} r="30" className={styles.ring} fill="none" stroke="#ffd2ad" strokeOpacity="0.85" strokeWidth="1.6" strokeDasharray="6 5" /> : null}
        </g>
      </svg>
      <div ref={labelRef} className={styles.label} data-aim-label hidden={!snapped || !label}>
        <i aria-hidden="true" style={{ background: `rgb(${targetRgb})` }} />
        {label}
      </div>
    </div>,
    host,
  );
}

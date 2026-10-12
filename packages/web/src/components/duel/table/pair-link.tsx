"use client";

import { useEffect, useRef } from "react";
import { aimCurve } from "./attack-line";
import { findShown } from "./zone-find";
import styles from "./pair-link.module.css";

export interface PairLinkProps {
  /** The two seats of a facing pair (`sharedExtraWith`). Zone 5 of one is zone 6 of the other. */
  a: number;
  b: number;
  /** Text on the link, e.g. "Linked columns". */
  label: string;
}

/** The two physical shared zones: a's zone 5 with b's zone 6, and a's zone 6 with b's zone 5. */
const ZONES: ReadonlyArray<readonly [number, number]> = [
  [5, 6],
  [6, 5],
];

/**
 * The plaza link of a facing pair: a thin gold and violet line from each Extra Monster Zone of one seat to the same
 * zone on the facing seat's field, with a small label between them. It measures the live zone elements on every frame
 * (like the attack line), so it follows a camera that moves. No pointer events; the motion stops under reduced motion.
 */
export function PairLink({ a, b, label }: PairLinkProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const pathRefs = useRef<Array<SVGPathElement | null>>([]);
  const nodeRefs = useRef<Array<SVGCircleElement | null>>([]);
  const labelRef = useRef<SVGGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const root = svg.closest("[data-table-stage]") ?? document;
    let frame = 0;
    const centre = (node: Element, origin: DOMRect, k: number) => {
      const r = node.getBoundingClientRect();
      return { x: (r.left + r.width / 2 - origin.left) / k, y: (r.top + r.height / 2 - origin.top) / k };
    };
    const draw = () => {
      frame = requestAnimationFrame(draw);
      const origin = svg.getBoundingClientRect();
      const k = origin.width / 1100;
      if (!(k > 0)) return svg.setAttribute("data-found", "false");
      const mids: Array<{ x: number; y: number }> = [];
      ZONES.forEach(([zoneA, zoneB], index) => {
        const fromEl = findShown(root, `[data-testid="seat-field-${a}"] [data-link-seq="${zoneA}"]`);
        const toEl = findShown(root, `[data-testid="seat-field-${b}"] [data-link-seq="${zoneB}"]`);
        const paths = [pathRefs.current[index * 2], pathRefs.current[index * 2 + 1]];
        if (!fromEl || !toEl) return paths.forEach((path) => path?.setAttribute("d", ""));
        const p0 = centre(fromEl, origin, k);
        const p1 = centre(toEl, origin, k);
        const d = aimCurve(p0, p1);
        paths.forEach((path) => path?.setAttribute("d", d));
        nodeRefs.current[index * 2]?.setAttribute("transform", `translate(${p0.x} ${p0.y})`);
        nodeRefs.current[index * 2 + 1]?.setAttribute("transform", `translate(${p1.x} ${p1.y})`);
        mids.push({ x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 });
      });
      if (mids.length === 0) return svg.setAttribute("data-found", "false");
      // The label rides on the first line, a fifth of the way from its start: the middle of both lines is where the turn hub sits.
      const first = pathRefs.current[1];
      const length = first?.getTotalLength?.() ?? 0;
      const spot = first && length > 0 ? first.getPointAtLength(length * 0.2) : mids[0];
      labelRef.current?.setAttribute("transform", `translate(${spot.x} ${spot.y})`);
      svg.setAttribute("data-found", "true");
    };
    draw();
    return () => cancelAnimationFrame(frame);
  }, [a, b]);

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
        <rect className={styles.tag} x="-46" y="-9" width="92" height="18" rx="9" />
        <text className={styles.text} textAnchor="middle" y="4">{label}</text>
      </g>
    </svg>
  );
}

"use client";

/**
 * The pick clock: a line of light round the inside edge of the mat. It drains clockwise from the far side
 * and the spark is where it is burning. Built from opacity segments, so it only ever animates opacity and transform.
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useDraftStore } from "@/lib/stores/draft-store";
import { motionOff } from "./motion";
import { buildRingSegments, clockFraction, litSegments, ringGeometry, type Turn } from "./room-model";

interface Props {
  w: number;
  h: number;
  turn: Turn;
  total: number;
  /** Changes at each new pick: the line lays itself back round the table. */
  relayKey: string;
  /** Changes when everyone is in: the gold flare. */
  flareKey: number;
}

export const EdgeClock = memo(function EdgeClock({ w, h, turn, total, relayKey, flareKey }: Props) {
  const geo = useMemo(() => ringGeometry(w, h), [w, h]);
  const segs = useMemo(() => buildRingSegments(geo), [geo]);
  const svg = useRef<SVGSVGElement>(null);
  const segsRef = useRef<SVGGElement>(null);
  const spark = useRef<SVGGElement>(null);
  const litN = useRef(-1);
  const turnRef = useRef(turn);
  turnRef.current = turn;
  const relayTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // a fresh set of segments starts from whatever the clock says
  useLayoutEffect(() => {
    litN.current = -1;
  }, [segs]);

  useEffect(() => {
    let lastSeconds = useDraftStore.getState().timerSeconds;
    let lastTick = performance.now();
    const unsub = useDraftStore.subscribe((s) => {
      if (s.timerSeconds !== lastSeconds) {
        lastSeconds = s.timerSeconds;
        lastTick = performance.now();
      }
    });
    let raf = 0;
    const frame = () => {
      raf = requestAnimationFrame(frame);
      const group = segsRef.current;
      if (!group) return;
      const frac = clockFraction({
        seconds: lastSeconds,
        total,
        sinceTickMs: performance.now() - lastTick,
        smooth: !motionOff(),
      });
      const n = segs.length;
      const lit = litSegments(frac, n);
      const kids = group.children;
      const set = (k: number, on: boolean) => {
        const el = kids[k];
        if (!el) return;
        if (on) el.removeAttribute("data-off");
        else el.setAttribute("data-off", "");
      };
      const t = turnRef.current;
      if (litN.current < 0) {
        for (let k = 0; k < n; k++) set(k, k >= n - lit);
        litN.current = lit;
      } else if (lit !== litN.current && t !== "settling" && t !== "done") {
        const hi = Math.max(lit, litN.current);
        const lo = Math.min(lit, litN.current);
        for (let k = n - hi; k < n - lo; k++) set(k, lit > litN.current);
        litN.current = lit;
      }
      const p = geo.pointAt(geo.length * (1 - frac));
      if (spark.current) spark.current.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      unsub();
    };
  }, [geo, segs, total]);

  // a new pick: the line lays itself back round the table
  useLayoutEffect(() => {
    const el = svg.current;
    const group = segsRef.current;
    if (!el || !group) return;
    el.removeAttribute("data-flare");
    const kids = Array.from(group.children) as SVGElement[];
    kids.forEach((k) => {
      k.style.transition = "none";
      k.setAttribute("data-off", "");
    });
    void el.getBoundingClientRect();
    kids.forEach((k) => (k.style.transition = ""));
    litN.current = 0;
    el.setAttribute("data-relay", "");
    clearTimeout(relayTimer.current);
    relayTimer.current = setTimeout(() => el.removeAttribute("data-relay"), 1100);
    return () => clearTimeout(relayTimer.current);
  }, [relayKey, segs]);

  // everyone is in: the flare
  useEffect(() => {
    if (flareKey === 0) return;
    const el = svg.current;
    if (!el) return;
    el.removeAttribute("data-relay");
    el.setAttribute("data-flare", "");
  }, [flareKey]);

  return (
    <svg ref={svg} className="dr-ring" width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true">
      <path className="groove" d={geo.path} />
      <g className="segs" ref={segsRef}>
        {segs.map((s, k) => (
          <g key={k} className="sg" style={{ "--d": `${s.delay}ms` } as React.CSSProperties}>
            <polyline className="h" points={s.soft} />
            <polyline className="m" points={s.soft} />
            <polyline className="c" points={s.core} />
          </g>
        ))}
      </g>
      <g className="spark" ref={spark}>
        <circle className="glow" r="9" />
        <circle className="fz" r="1.3" />
        <circle className="fz" r="1.1" />
        <circle className="fz" r="1.2" />
        <circle className="hot" r="2.6" />
      </g>
    </svg>
  );
});

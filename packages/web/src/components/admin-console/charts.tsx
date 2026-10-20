"use client";

import { useEffect, useRef, useState, type PointerEvent } from "react";
import styles from "./admin-console.module.css";

export interface Series { name: string; color: string; values: number[] }

/** Width and height of an element, kept current with a ResizeObserver. */
function useSize<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    read();
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size] as const;
}

function niceMax(v: number): number {
  const p = Math.pow(10, Math.floor(Math.log10(v || 1)));
  for (const m of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const nf = (n: number) => n.toLocaleString("en-US");

interface Tip { x: number; y: number; head: string; rows: { color: string; value: string; name: string }[] }
function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  return (
    <div className={styles.tt} style={{ left: tip.x, top: tip.y, transform: "translate(-50%, calc(-100% - 12px))" }} role="tooltip">
      <div className={styles.ttH}>{tip.head}</div>
      {tip.rows.map((r) => <div key={r.name} className={styles.ttR}><i style={{ background: r.color }} /><b>{r.value}</b><span>{r.name}</span></div>)}
    </div>
  );
}

/**
 * Line chart. `axis` adds a zero baseline, two grid lines and first/last labels (trend charts); without it the chart
 * is a bare sparkline scaled to its own range. Hover or focus shows the values for the nearest point.
 */
export function LineChart({ labels, series, axis, area, unit = "", className, label }: {
  labels: string[]; series: Series[]; axis?: boolean; area?: boolean; unit?: string; className?: string; label: string;
}) {
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = labels.length;
  const all = series.flatMap((s) => s.values);
  const ready = W > 0 && H > 0 && n > 0 && all.length > 0;
  const padL = axis ? 0 : 2, padR = axis ? 2 : 5, padT = axis ? 14 : 5, padB = axis ? 22 : 5;
  const min = axis ? 0 : Math.min(...all);
  const max = axis ? niceMax(Math.max(...all, 1)) : Math.max(...all);
  const span = (max - min) || 1;
  const x = (i: number) => padL + (W - padL - padR) * (n === 1 ? .5 : i / (n - 1));
  // A flat sparkline sits in the middle instead of on the floor.
  const y = (v: number) => (!axis && max === min) ? H / 2 : padT + (H - padT - padB) * (1 - (v - min) / span);

  const pick = (clientX: number) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const i = Math.max(0, Math.min(n - 1, Math.round(((clientX - r.left) - padL) / ((W - padL - padR) / Math.max(1, n - 1)))));
    setHover(i);
  };
  const tip: Tip | null = ready && hover !== null ? {
    x: x(hover), y: y(Math.max(...series.map((s) => s.values[hover] ?? 0))), head: labels[hover],
    rows: series.map((s) => ({ color: s.color, value: `${nf(s.values[hover] ?? 0)}${unit}`, name: s.name })),
  } : null;

  return (
    <div
      ref={ref} className={className} tabIndex={0} role="img" aria-label={label}
      onPointerMove={(e: PointerEvent) => pick(e.clientX)} onPointerLeave={() => setHover(null)}
      onFocus={() => setHover(n - 1)} onBlur={() => setHover(null)}
    >
      {ready ? (
        <svg className={styles.chartSvg} width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-hidden="true">
          {axis ? (
            <>
              {[max / 2, max].map((t) => (
                <g key={t}><line className={styles.grid} x1={0} x2={W} y1={y(t)} y2={y(t)} /><text x={0} y={y(t) - 5}>{nf(t)}</text></g>
              ))}
              <line className={styles.base} x1={0} x2={W} y1={y(0)} y2={y(0)} />
              <text x={x(0)} y={H - 5} textAnchor="start">{labels[0]}</text>
              {n > 1 ? <text x={x(n - 1)} y={H - 5} textAnchor="end">{labels[n - 1]}</text> : null}
            </>
          ) : null}
          {series.map((s) => {
            const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
            return (
              <g key={s.name}>
                {area ? <polygon points={`${x(0)},${y(min)} ${pts} ${x(n - 1)},${y(min)}`} style={{ fill: s.color, opacity: .13 }} /> : null}
                <polyline points={pts} fill="none" style={{ stroke: s.color }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                <circle cx={x(n - 1)} cy={y(s.values[n - 1] ?? 0)} r={axis ? 4 : 3} style={{ fill: s.color, stroke: "var(--bg)" }} strokeWidth={2} />
              </g>
            );
          })}
          {hover !== null ? (
            <>
              <line className={styles.xh} x1={x(hover)} x2={x(hover)} y1={padT - 4} y2={H - padB} />
              {series.map((s) => <circle key={s.name} cx={x(hover)} cy={y(s.values[hover] ?? 0)} r={4.5} style={{ fill: s.color, stroke: "var(--bg)" }} strokeWidth={2} />)}
            </>
          ) : null}
        </svg>
      ) : null}
      <Tooltip tip={tip} />
    </div>
  );
}

/** 24 hourly bars for one Sentry issue. Hover shows the hour and the count. */
export function HourBars({ values, color, label }: { values: number[]; color: string; label: string }) {
  const [ref, { w: W, h: H }] = useSize<HTMLDivElement>();
  const [hover, setHover] = useState<number | null>(null);
  const n = values.length;
  const gap = 2;
  const bw = n > 0 ? (W - gap * (n - 1)) / n : 0;
  const max = Math.max(1, ...values);
  const hourLabel = (i: number) => {
    const hoursAgo = n - 1 - i;
    return hoursAgo === 0 ? "This hour" : `${hoursAgo} h ago`;
  };
  return (
    <div
      ref={ref} className={styles.bars24} role="img" aria-label={label}
      onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); setHover(Math.max(0, Math.min(n - 1, Math.floor((e.clientX - r.left) / (bw + gap))))); }}
      onPointerLeave={() => setHover(null)}
    >
      {W > 0 ? (
        <svg width={W} height={H} aria-hidden="true">
          <line className={styles.base} x1={0} x2={W} y1={H - .5} y2={H - .5} />
          {values.map((v, i) => {
            if (!v) return null;
            const h = Math.max(3, (H - 2) * v / max);
            return <rect key={i} x={i * (bw + gap)} y={H - 1 - h} width={bw} height={h} rx={1.5} style={{ fill: color, opacity: hover === null || hover === i ? 1 : .55 }} />;
          })}
        </svg>
      ) : null}
      <Tooltip tip={hover !== null ? { x: hover * (bw + gap) + bw / 2, y: 0, head: hourLabel(hover), rows: [{ color, value: String(values[hover] ?? 0), name: values[hover] === 1 ? "event" : "events" }] } : null} />
    </div>
  );
}

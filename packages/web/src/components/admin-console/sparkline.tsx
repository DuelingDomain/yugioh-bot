/** A tiny inline SVG line for a short series. No library. `values` run oldest to newest. */
export function Sparkline({ values, label, width = 96, height = 28 }: { values: number[]; label: string; width?: number; height?: number }) {
  const max = Math.max(1, ...values);
  const step = values.length > 1 ? (width - 4) / (values.length - 1) : 0;
  const points = values.map((v, i) => `${(2 + i * step).toFixed(1)},${(height - 3 - (v / max) * (height - 6)).toFixed(1)}`);
  const last = points[points.length - 1]?.split(",");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} focusable="false">
      <polyline points={points.join(" ")} fill="none" stroke="var(--pen)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      {last ? <circle cx={last[0]} cy={last[1]} r="2.2" fill="var(--chain)" /> : null}
    </svg>
  );
}

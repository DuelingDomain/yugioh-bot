"use client";

import useSWR from "swr";
import type { HealthPoint, VpsHealth } from "@yugidraft/shared/health";
import { ago, duration, gb } from "@/lib/admin-console/format";
import { ADMIN_TIME_ZONE_LABEL, formatDayMonthClock } from "@/lib/admin-console/time";
import styles from "./vps-health.module.css";

const pct = (n: number | null | undefined) => n == null ? "n/a" : `${Math.round(n)}%`;
const bytes = (n: number | null | undefined) => n == null ? "n/a" : gb(n);
const count = (n: number | null | undefined) => n == null ? "n/a" : String(n);

function Sparkline({ history, field, label, ceiling, threshold }: {
  history: HealthPoint[]; field: Exclude<keyof HealthPoint, "at">; label: string; ceiling: number; threshold?: number;
}) {
  const values = history.flatMap(p => p[field] == null ? [] : [p[field]!]);
  if (!values.length) return <p className={styles.muted}>{label}: n/a</p>;
  const top = Math.max(ceiling, ...values, 1), end = Date.now(), start = end - 86_400_000;
  let prior: number | null = null, path = "";
  for (const point of history) {
    const value = point[field];
    if (value == null) { prior = null; continue; }
    const x = 2 + 296 * (point.at - start) / 86_400_000, y = 48 - 44 * value / top;
    path += `${prior === null || point.at - prior > 90_000 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)} `;
    prior = point.at;
  }
  const last = history.at(-1)!;
  return <figure className={styles.chart}>
    <figcaption>{label}<span>{field === "load1" ? "load" : field === "engineWorkers" ? "workers" : "%"}</span></figcaption>
    <svg viewBox="0 0 300 52" role="img" aria-label={`${label}: minimum ${Math.min(...values).toFixed(1)}, maximum ${Math.max(...values).toFixed(1)}. Gaps mean unavailable samples.`}>
      {threshold !== undefined ? <line x1="0" x2="300" y1={48 - 44 * threshold / top} y2={48 - 44 * threshold / top} className={styles.threshold} /> : null}
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.5" />
      {last[field] != null ? <circle cx={2 + 296 * (last.at - start) / 86_400_000} cy={48 - 44 * last[field]! / top} r="2" fill="currentColor" /> : null}
    </svg>
  </figure>;
}

export function VpsHealthPanel({ data }: { data: VpsHealth }) {
  const stale = data.stale || !data.current || Date.now() - data.current.at > 180_000;
  const sample = stale ? null : data.current;
  const host = sample?.host, duel = sample?.services.duel?.capacity;
  const status = stale ? null : data.status;
  return <section className={styles.section} aria-label="VPS health">
    <div className={styles.heading}><h2>VPS health</h2><strong className={styles.status} data-status={status ?? "na"}>{status ?? "n/a"}</strong></div>
    <p className={styles.muted}>Host and service totals · sampled every minute · {data.current ? `Measured ${ago(data.current.at)}` : "Waiting for the worker’s first sample"}</p>
    {data.reasons.length ? <ul className={styles.reasons}>{data.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul> : null}
    <div className={styles.host}>
      <div><small>CPU</small><b>{pct(host?.cpuPercent)}</b><span>{host?.vcpuCount ? `${host.vcpuCount} vCPU` : "vCPU count n/a"}</span></div>
      <div><small>Load · 1 / 5 / 15 min</small><b>{host?.load?.map(n => n.toFixed(2)).join(" / ") ?? "n/a"}</b><span>Compare with {host?.vcpuCount ?? "n/a"} vCPU</span></div>
      <div><small>RAM used / total</small><b>{bytes(host?.memory?.usedBytes)} / {bytes(host?.memory?.totalBytes)} · {pct(host?.memory?.usedPercent)}</b><span>{bytes(host?.memory?.availableBytes)} available</span></div>
      <div><small>Swap used / total</small><b>{host?.swap?.totalBytes === 0 ? "No swap" : `${bytes(host?.swap?.usedBytes)} / ${bytes(host?.swap?.totalBytes)}`}</b><span>Uptime {host?.uptimeSeconds != null ? duration(host.uptimeSeconds * 1000) : "n/a"}</span></div>
    </div>
    <div className={styles.capacity}>
      <div><small>Live duels · this guild</small><b>{count(sample?.activity?.liveDuels)}</b></div>
      <div><small>Engine workers · all guilds</small><b>{count(duel?.engineWorkers)} / {count(duel?.maxWorkers)}</b></div>
      <div><small>Queued replay rebuilds</small><b>{count(duel?.queuedRebuilds)}</b></div>
      <div><small>Live drafts · this guild</small><b>{count(sample?.activity?.liveDrafts)}</b></div>
      <div><small>Connected WS sockets · total</small><b>{count(sample?.services.ws?.capacity?.connectedSockets)}</b></div>
    </div>
    <div className={styles.tableWrap}><table className={styles.table}>
      <caption>Service containers · CPU 100% = one vCPU</caption>
      <thead><tr><th scope="col">Service</th><th scope="col">Memory / limit</th><th scope="col">Used</th><th scope="col">CPU</th><th scope="col">Cgroup OOM kills</th><th scope="col">Sample</th><th scope="col">Restarted · 24h</th></tr></thead>
      <tbody>{(["ws", "duel", "web", "worker"] as const).map(id => {
        const report = sample?.services[id], c = report?.cgroup;
        const restartedAt = data.restarts?.[id];
        const percent = c?.memoryBytes != null && c.memoryLimitBytes ? 100 * c.memoryBytes / c.memoryLimitBytes : null;
        return <tr key={id}><th scope="row">{id}</th><td>{c ? `${bytes(c.memoryBytes)} / ${c.memoryLimitBytes == null ? "n/a (no readable limit)" : bytes(c.memoryLimitBytes)}` : "n/a"}</td><td>{pct(percent)}</td><td>{pct(c?.cpuPercent)}</td><td data-warning={(c?.oomKills ?? 0) > 0}>{count(c?.oomKills)}</td><td>{report ? ago(report.at) : "n/a"}</td><td>{restartedAt != null ? <time dateTime={new Date(restartedAt).toISOString()} title={`${formatDayMonthClock(restartedAt)} ${ADMIN_TIME_ZONE_LABEL}`}>Restarted {ago(restartedAt)}</time> : "—"}</td></tr>;
      })}</tbody>
    </table></div>
    <div className={styles.historyHead}><h3>Last 24 hours</h3><span>{data.history.length} / 1440 minute samples · gaps are n/a</span></div>
    <div className={styles.charts}>
      <Sparkline history={data.history} field="cpuPercent" label="Host CPU" ceiling={100} />
      <Sparkline history={data.history} field="ramPercent" label="RAM" ceiling={100} threshold={80} />
      <Sparkline history={data.history} field="load1" label="1-minute load" ceiling={(host?.vcpuCount ?? 2) * 1.5} threshold={host?.vcpuCount ?? undefined} />
      <Sparkline history={data.history} field="engineWorkers" label="Engine workers" ceiling={duel?.maxWorkers ?? 12} threshold={duel?.maxWorkers ? Math.ceil(duel.maxWorkers * 2 / 3) : undefined} />
    </div>
    <details className={styles.details}><summary>Thresholds and data coverage</summary>
      <p>High: current RAM above 80%, CPU above 85%, load above vCPU count, engine workers at two-thirds capacity, or at least 4 queued rebuilds for 5 continuous minutes. Upgrade soon: RAM or load stays high for 15 continuous minutes; workers reach two-thirds capacity (8 of 12) in 15 sampled minutes of the last hour; or a host OOM kill observed in the last 24 hours. An OOM can also mean a service limit needs raising.</p>
      <p>Host OOM events come from changes in the host counter, even when a container restarts. Service OOM counters cover the current cgroup lifetime. Restart markers mean the reporter instance changed between observations; deployments also cause restarts. Caddy metrics are not collected.</p>
      <p>Dashed lines mark pressure thresholds. CPU needs two samples. Missing reports become n/a after 3 minutes. History survives restarts; the first 15 minutes cannot establish sustained host pressure. Limits come from the running service; unlimited or unreadable limits show n/a.</p>
      {data.incomplete.length ? <ul>{data.incomplete.map(message => <li key={message}>{message}</li>)}</ul> : null}
    </details>
  </section>;
}

async function fetchHealth(url: string): Promise<VpsHealth> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) throw new Error("VPS health could not be refreshed.");
  return response.json();
}
export function VpsHealthSection() {
  const { data, error } = useSWR<VpsHealth>("/api/admin/console/vps-health", fetchHealth, {
    refreshInterval: 60_000, refreshWhenHidden: false, revalidateOnFocus: true, errorRetryInterval: 60_000,
  });
  return <>
    {error ? <p role="status" className={styles.error}>VPS health could not be refreshed. Last received readings may be stale.</p> : null}
    {data ? <VpsHealthPanel data={data} /> : <p className={styles.muted}>Loading VPS health…</p>}
  </>;
}

"use client";

import { VpsHealthSection } from "./vps-health";
import type { ReactNode } from "react";
import { duration, gb, plural } from "@/lib/admin-console/format";
import type { DiskStatus, ServiceHealth, SystemData } from "@/lib/admin-console/types";
import { SERVICE_TONE, SERVICE_WORD, okData, type Snapshots } from "../model";
import { Notice, SectionHead, Since, StatusIcon, useNow } from "../parts";
import styles from "../admin-console.module.css";

function metrics(service: ServiceHealth, data: SystemData, now: number, checkedAt: number): [{ k: string; v: ReactNode }, { k: string; v: ReactNode }] {
  const first = service.lastBeatAt !== undefined
    ? { k: "Heartbeat", v: service.lastBeatAt ? <Since at={service.lastBeatAt} suffix=" ago" /> : "None yet" }
    : { k: "Response", v: service.latencyMs != null ? `${service.latencyMs} ms` : "-" };
  const second = service.id === "web" ? { k: "Up", v: duration(now - data.startedAt) }
    : service.id === "duel" ? { k: "Live tables", v: data.duelServer.activeTables ?? "-" }
    : service.id === "database" && data.database ? { k: "Size", v: gb(data.database.bytes + data.database.walBytes) }
    : { k: "Checked", v: <Since at={checkedAt} suffix=" ago" /> };
  return [first, second];
}

function Disk({ disk }: { disk: DiskStatus }) {
  const b = disk.breakdown;
  const parts: [string, number, string][] = b ? [
    ["Database", b.database.bytes + b.database.walBytes, "var(--s1)"],
    ["Card images", b.images.bytes, "var(--s2)"],
    ...(b.engine ? [["Engine data", b.engine.bytes, "var(--s3)"] as [string, number, string]] : []),
    ...(b.backups ? [["Backups", b.backups.bytes, "var(--s4)"] as [string, number, string]] : []),
    ["Other app data", b.other.bytes, "var(--s5)"],
    ["System and images", Math.max(0, disk.usedBytes - b.dataBytes), "var(--other)"],
  ] : [["Used", disk.usedBytes, "var(--other)"]];
  const days = disk.trend?.daysUntilFull ?? null;
  const tone = disk.tone === "fail" ? "crit" : disk.tone === "warn" ? "warn" : undefined;
  return (
    <>
      <div className={styles.diskBig}><span className={styles.pct}>{Math.round(disk.usedPercent)}%</span><span className={styles.of}><b>{gb(disk.usedBytes)}</b> of {gb(disk.totalBytes)} used</span></div>
      <p className={styles.diskLeft}>
        {days !== null ? <>About <b data-tone={tone}>{plural(days, "day", "days")}</b> until full at the current rate. </> : <><b data-tone={tone}>{gb(disk.freeBytes)}</b> free. </>}
        {b ? <>Measured <Since at={b.measuredAt} suffix=" ago" />.</> : "The worker has not measured the folders yet."}
      </p>
      <div className={styles.dbar} role="img" aria-label={`Disk use: ${parts.map(([n, v]) => `${n} ${gb(v)}`).join(", ")}, free ${gb(disk.freeBytes)}`}>
        {parts.filter(([, v]) => v > 0).map(([name, value, color]) => (
          <span key={name} title={`${name} · ${gb(value)} · ${Math.round((value / disk.totalBytes) * 100)}%`} style={{ width: `${(value / disk.totalBytes) * 100}%`, background: color }} />
        ))}
        <span className={styles.dbarFree} title={`Free · ${gb(disk.freeBytes)}`} />
      </div>
      <div className={styles.legend}>
        {parts.map(([name, value, color]) => <div key={name}><i style={{ background: color }} /><span>{name}</span><b>{gb(value)}</b></div>)}
      </div>
    </>
  );
}

export function HealthView({ s }: { s: Snapshots }) {
  const now = useNow();
  const result = s.system.result;
  const data = okData(s.system);
  if (result && result.state !== "ok") return <Notice tone="warn" title="Health is not available">{result.message}</Notice>;
  if (!data) return <div className={styles.empty}>Loading</div>;
  const services = (data.services ?? []).filter((service) => service.state !== "not-deployed");
  const update = data.cardData?.lastUpdate ?? null;

  return (
    <>
      <div className={styles.svc} role="table" aria-label="Services">
        <div className={styles.tblHead} role="row"><span role="columnheader">Service</span><span role="columnheader">State</span><span role="columnheader">Metric</span><span role="columnheader">Metric</span></div>
        {services.map((service) => {
          const tone = SERVICE_TONE[service.state];
          const [m1, m2] = metrics(service, data, now, s.system.fetchedAt ?? now);
          return (
            <div key={service.id} className={styles.tblRow} role="row">
              <div className={styles.svcName} role="cell"><StatusIcon tone={tone} /><div className={styles.minw}><b>{service.label}</b><small title={service.detail}>{service.detail}</small></div></div>
              <div className={styles.svcState} data-tone={tone === "good" ? undefined : tone} role="cell">{SERVICE_WORD[service.state]}</div>
              <div className={`${styles.kv} ${styles.cM1}`} role="cell"><small>{m1.k}</small><span>{m1.v}</span></div>
              <div className={`${styles.kv} ${styles.cM2}`} role="cell"><small>{m2.k}</small><span>{m2.v}</span></div>
            </div>
          );
        })}
      </div>

      <VpsHealthSection />

      <div className={styles.healthSplit}>
        <div>
          <SectionHead title="Disk" flush aside={<span className={styles.aside}>Data volume</span>} />
          {data.disk ? <Disk disk={data.disk} /> : <p className={styles.muted} style={{ marginTop: 18 }}>The data folder could not be read.</p>}
        </div>
        <div>
          <SectionHead title="Versions" flush />
          <dl className={styles.vlist}>
            <div>
              <dt>App</dt>
              <dd>
                {data.commit ? <a href={data.commit.url} target="_blank" rel="noreferrer" className={styles.mono}>{data.commit.short}</a> : data.version ?? "Unknown"}
                <small>Web running since {new Date(data.startedAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</small>
              </dd>
            </div>
            <div>
              <dt>Card data</dt>
              <dd>
                {update ? update.label : data.cardData?.headline ?? "Unknown"}
                <small>
                  {data.cardData && update ? <>{data.cardData.headline} · <a href={update.pullRequestUrl} target="_blank" rel="noreferrer">PR #{update.pullRequestNumber}</a></> : null}
                  {!update ? <a href="/settings/card-data">Open card data details</a> : null}
                </small>
              </dd>
            </div>
            <div>
              <dt>Duel engine</dt>
              <dd>{data.duelServer.ok ? "Answering" : "Not answering"}<small>{data.duelServer.detail ?? (data.cardData?.dataAsOf ? `Engine data from ${data.cardData.dataAsOf.slice(0, 10)}` : "")}</small></dd>
            </div>
            {data.database ? (
              <div><dt>Database</dt><dd>SQLite · {gb(data.database.bytes)}<small>Write-ahead log {gb(data.database.walBytes)}</small></dd></div>
            ) : null}
          </dl>
        </div>
      </div>
    </>
  );
}

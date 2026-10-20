"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FloorList, FloorRow, StatusLine, type StatusTone } from "@/components/sheet";
import { ago } from "@/lib/admin-console/format";
import type { DiskStatus, ServiceHealth, SystemData } from "@/lib/admin-console/types";
import { Sparkline } from "../sparkline";
import { SectionPanel } from "../section-panel";
import styles from "./system-panel.module.css";

const COLS = "150px minmax(0,1fr)";
const PHONE_COLS = "minmax(0,1fr)";

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <FloorRow cols={COLS} phoneCols={PHONE_COLS}>
      <span className={styles.label}>{label}</span>
      <div className={styles.value}>{children}</div>
    </FloorRow>
  );
}

const CARD_TONE: Record<NonNullable<SystemData["cardData"]>["state"], StatusTone> = { "up-to-date": "ready", behind: "warn", unknown: "neutral" };
const SERVICE_TONE: Record<ServiceHealth["state"], StatusTone> = { up: "ready", stale: "warn", down: "block", "not-deployed": "neutral", "not-configured": "neutral" };
const SERVICE_WORD: Record<ServiceHealth["state"], string> = { up: "", stale: "Stale. ", down: "Down. ", "not-deployed": "", "not-configured": "Not configured. " };
const DISK_TONE: Record<DiskStatus["tone"], StatusTone> = { ok: "ready", warn: "warn", fail: "block" };

function serviceMetric(service: ServiceHealth, now: number): string | null {
  if (service.lastBeatAt !== undefined) return service.lastBeatAt === null ? null : `Last heartbeat ${ago(service.lastBeatAt, now)}`;
  return service.latencyMs != null ? `${service.latencyMs} ms` : null;
}

function Overall({ data }: { data: SystemData }) {
  const problems = data.problems ?? 0;
  const failing = (data.services ?? []).some((s) => s.state === "down") || data.disk?.tone === "fail";
  if (problems === 0) return <StatusLine className={styles.status} tone="ready">All systems up</StatusLine>;
  return <StatusLine className={styles.status} tone={failing ? "block" : "warn"}>{problems === 1 ? "1 problem" : `${problems} problems`}</StatusLine>;
}

function Disk({ disk, now }: { disk: DiskStatus; now: number }) {
  const b = disk.breakdown;
  const lines: { label: string; value: string }[] = b ? [
    { label: "Database", value: `${size(b.database.bytes)}, write-ahead log ${size(b.database.walBytes)}` },
    { label: "Card images", value: `${size(b.images.bytes)} of ${size(b.images.capBytes)}` },
    ...(b.engine ? [{ label: "Engine data", value: size(b.engine.bytes) }] : []),
    ...(b.backups ? [{ label: "Backups", value: size(b.backups.bytes) }] : []),
    { label: "Other", value: size(b.other.bytes) },
  ] : [];
  return (
    <Row label="Disk space">
      <StatusLine className={styles.status} tone={DISK_TONE[disk.tone]}>
        {size(disk.freeBytes)} free of {size(disk.totalBytes)}. {disk.usedPercent}% used.
        {disk.tone === "fail" ? " Free space is critically low." : disk.tone === "warn" ? " Free space is getting low." : ""}
      </StatusLine>
      <div className={styles.bar} role="meter" aria-label="Disk space used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={disk.usedPercent} data-tone={disk.tone}>
        <span style={{ width: `${Math.min(100, Math.max(0, disk.usedPercent))}%` }} />
      </div>
      {b ? (
        <>
          <dl className={styles.breakdown}>
            {lines.map((line) => <div key={line.label}><dt>{line.label}</dt><dd>{line.value}</dd></div>)}
          </dl>
          <p className={styles.sub}>Measured {ago(b.measuredAt, now)}</p>
        </>
      ) : <p className={styles.sub}>Not measured yet. The worker measures the data folders once an hour.</p>}
      {disk.trend && disk.trend.values.length > 1 ? (
        <p className={`${styles.sub} ${styles.trend}`}>
          <Sparkline values={disk.trend.values} label="Used space over the last 7 days" width={120} height={28} />
          <span>{disk.trend.daysUntilFull !== null ? `About ${disk.trend.daysUntilFull} ${disk.trend.daysUntilFull === 1 ? "day" : "days"} until full at this pace.` : "Used space, last 7 days."}</span>
        </p>
      ) : null}
    </Row>
  );
}

export function SystemPanel() {
  return (
    <SectionPanel id="system">
      {(data) => {
        const now = Date.now();
        const update = data.cardData?.lastUpdate ?? null;
        return (
          <>
            <Overall data={data} />
            <FloorList aria-label="System status">
              {(data.services ?? []).map((service) => {
                const metric = serviceMetric(service, now);
                return (
                  <Row key={service.id} label={service.label}>
                    <StatusLine className={styles.status} tone={SERVICE_TONE[service.state]}>{SERVICE_WORD[service.state]}{service.detail}</StatusLine>
                    {metric ? <p className={styles.sub}>{metric}</p> : null}
                  </Row>
                );
              })}
              {data.disk ? <Disk disk={data.disk} now={now} /> : null}
              <Row label="Version">
                <p className={styles.line}>
                  {data.commit
                    ? <a className={`${styles.link} ${styles.mono}`} href={data.commit.url} target="_blank" rel="noreferrer">{data.commit.short}</a>
                    : <span>{data.version ?? "Unknown version"}</span>}
                </p>
                <p className={styles.sub}>Web running since {new Date(data.startedAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false })} ({ago(data.startedAt, now)})</p>
              </Row>
              <Row label="Card data">
                {data.cardData ? <StatusLine className={styles.status} tone={CARD_TONE[data.cardData.state]}>{data.cardData.headline}</StatusLine> : <StatusLine className={styles.status} tone="neutral">Card data status is unavailable.</StatusLine>}
                {update ? (
                  <p className={styles.sub}>
                    Last update: {update.label}, <a className={styles.link} href={update.pullRequestUrl} target="_blank" rel="noreferrer">PR #{update.pullRequestNumber}</a>, {ago(new Date(update.date).getTime(), now)}
                  </p>
                ) : null}
                <p className={styles.sub}><Link className={styles.link} href="/settings/card-data">Open card data details</Link></p>
              </Row>
            </FloorList>
          </>
        );
      }}
    </SectionPanel>
  );
}

"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { FloorList, FloorRow, StatusLine, type StatusTone } from "@/components/sheet";
import { ago } from "@/lib/admin-console/format";
import type { SystemData } from "@/lib/admin-console/types";
import { SectionPanel } from "../section-panel";
import styles from "./system-panel.module.css";

const COLS = "150px minmax(0,1fr)";
const PHONE_COLS = "minmax(0,1fr)";
/** A duel server answer slower than this is a warning, not a failure. */
const SLOW_MS = 1500;

function size(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB"];
  let value = bytes / 1024, unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value >= 100 ? Math.round(value) : value.toFixed(1)} ${units[unit]}`;
}

function when(time: number | string): string {
  const date = new Date(time);
  return Number.isNaN(date.getTime()) ? "unknown" : date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
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

export function SystemPanel() {
  return (
    <SectionPanel id="system">
      {(data) => {
        const now = Date.now();
        const duel = data.duelServer;
        const duelTone: StatusTone = !duel.ok ? "block" : (duel.latencyMs ?? 0) > SLOW_MS ? "warn" : "ready";
        const workerTone: StatusTone = data.worker.ok ? "ready" : "warn";
        const update = data.cardData?.lastUpdate ?? null;
        return (
          <FloorList aria-label="System status">
            <Row label="Version">
              <p className={styles.line}>
                {data.commit
                  ? <a className={`${styles.link} ${styles.mono}`} href={data.commit.url} target="_blank" rel="noreferrer">{data.commit.short}</a>
                  : <span>{data.version ?? "Unknown version"}</span>}
              </p>
              <p className={styles.sub}>Web running since {when(data.startedAt)} ({ago(data.startedAt, now)})</p>
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
            <Row label="Duel server">
              <StatusLine className={styles.status} tone={duelTone}>
                {duel.ok
                  ? `Reachable${duel.latencyMs != null ? `, ${duel.latencyMs} ms` : ""}${duelTone === "warn" ? ". Slow answer." : ""}`
                  : duel.detail ?? "Not reachable."}
              </StatusLine>
              {duel.activeTables != null ? <p className={styles.sub}>{duel.activeTables} active {duel.activeTables === 1 ? "table" : "tables"}</p> : null}
            </Row>
            <Row label="Worker">
              <StatusLine className={styles.status} tone={workerTone}>
                {data.worker.lastTickAt === null
                  ? "No heartbeat yet. The worker has not run against this database."
                  : data.worker.ok ? `Alive. Last heartbeat ${ago(data.worker.lastTickAt, now)}.` : `No heartbeat for ${ago(data.worker.lastTickAt, now).replace(" ago", "")}. The worker may be down.`}
              </StatusLine>
            </Row>
            {data.database ? (
              <Row label="Database">
                <p className={styles.line}>{size(data.database.bytes)}</p>
                <p className={styles.sub}>Write-ahead log {size(data.database.walBytes)}</p>
              </Row>
            ) : null}
          </FloorList>
        );
      }}
    </SectionPanel>
  );
}

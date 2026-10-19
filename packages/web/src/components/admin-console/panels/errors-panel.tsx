"use client";

import { FloorList, FloorRow } from "@/components/sheet";
import { ago, count } from "@/lib/admin-console/format";
import { EmptyNote, SectionPanel } from "../section-panel";
import styles from "./errors-panel.module.css";

const BAD_LEVELS = new Set(["error", "fatal"]);

export function ErrorsPanel() {
  return (
    <SectionPanel id="errors">
      {(data) => {
        const now = Date.now();
        return (
          <>
            <div className={styles.top}>
              <p className={styles.total}>
                <span className={`${styles.big} ${data.last24h > 0 ? styles.bigWarn : ""}`}>{count(data.last24h)}</span>
                <span className={styles.label}>error events in the last 24 h</span>
              </p>
              {data.dashboardUrl ? <a className={styles.link} href={data.dashboardUrl} target="_blank" rel="noopener noreferrer">Open Sentry</a> : null}
            </div>
            {data.issues.length === 0 ? <EmptyNote>No open errors in the last 24 hours.</EmptyNote> : (
              <FloorList aria-label="Open Sentry issues">
                {data.issues.map((issue) => (
                  <FloorRow key={issue.id} cols="minmax(0,1fr) 92px 84px 80px" phoneCols="auto auto minmax(0,1fr)" phoneAreas={'"hd hd hd" "ev pe seen"'}>
                    <span className={`${styles.head} ${styles.aHd}`}>
                      <a className={styles.title} href={issue.url} target="_blank" rel="noopener noreferrer">{issue.title}</a>
                      <span className={styles.where}>
                        <span className={issue.level && BAD_LEVELS.has(issue.level) ? styles.levelBad : styles.level}>{issue.level ?? "unknown"}</span>
                        {issue.culprit ? ` · ${issue.culprit}` : ""}
                      </span>
                    </span>
                    <span className={`${styles.num} ${styles.aEv}`}>{count(issue.count)}<span className={styles.meta}> events</span></span>
                    <span className={`${styles.num} ${styles.aPe}`}>{count(issue.users ?? null)}<span className={styles.meta}> people</span></span>
                    <span className={`${styles.seen} ${styles.aSeen}`}>{issue.lastSeen ? ago(Date.parse(issue.lastSeen), now) : "-"}</span>
                  </FloorRow>
                ))}
              </FloorList>
            )}
          </>
        );
      }}
    </SectionPanel>
  );
}

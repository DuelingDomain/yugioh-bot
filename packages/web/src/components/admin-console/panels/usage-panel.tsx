"use client";

import { FloorList, FloorRow } from "@/components/sheet";
import { count } from "@/lib/admin-console/format";
import { EmptyNote, SectionPanel } from "../section-panel";
import { Sparkline } from "../sparkline";
import styles from "./usage-panel.module.css";

export function UsagePanel() {
  return (
    <SectionPanel id="usage">
      {(data) => {
        const pages = data.topPages ?? [];
        const series = data.dauSeries ?? [];
        return (
          <>
            <div className={styles.figures}>
              <p className={styles.figure}><span className={styles.big}>{count(data.dau)}</span><span className={styles.label}>Visitors today</span></p>
              <p className={styles.figure}><span className={styles.big}>{count(data.wau)}</span><span className={styles.label}>Visitors, 7 days</span></p>
              <p className={styles.figure}><span className={styles.big}>{count(data.pageviewsToday)}</span><span className={styles.label}>Page views today</span></p>
            </div>
            {series.length > 1 ? (
              <div className={styles.trend}>
                <Sparkline values={series} label={`Visitors per day, last ${series.length} days: ${series.join(", ")}`} width={160} height={36} />
                <span>Visitors per day, last {series.length} days</span>
              </div>
            ) : null}
            <p className={styles.heading}>Top pages today</p>
            {pages.length === 0 ? <EmptyNote>No page views yet today.</EmptyNote> : (
              <FloorList aria-label="Top pages today">
                {pages.map((page) => (
                  <FloorRow key={page.path} cols="minmax(0,1fr) 72px" phoneCols="minmax(0,1fr) auto">
                    <span className={styles.page}>{page.path}</span>
                    <span className={styles.views}>{count(page.views)}</span>
                  </FloorRow>
                ))}
              </FloorList>
            )}
            <p className={styles.sub}>Visitors are anonymous and counted per day, so the 7 day figure can count a returning visitor twice.</p>
            {data.dashboardUrl ? <a className={styles.link} href={data.dashboardUrl} target="_blank" rel="noopener noreferrer">Open PostHog</a> : null}
          </>
        );
      }}
    </SectionPanel>
  );
}

"use client";

import type { ReactNode } from "react";
import { plural } from "@/lib/admin-console/format";
import type { SectionResult, StatsData } from "@/lib/admin-console/types";
import { HourBars, LineChart, type Series } from "../charts";
import { delta, isNewIssue, okData, shortDay, type Snapshots } from "../model";
import { Icon, Notice, SectionHead, Tag, useNow } from "../parts";
import styles from "../admin-console.module.css";

const nf = (n: number | null | undefined) => (n == null ? "-" : n.toLocaleString("en-US"));

function Trend({ label, value, sub, labels, series, area }: { label: string; value: ReactNode; sub: ReactNode; labels: string[]; series: Series[]; area?: boolean }) {
  return (
    <div className={styles.trend}>
      <div className={styles.trendLabel}>{label}</div>
      <div className={styles.trendNum}>{value}</div>
      <div className={styles.trendSub}>{sub}</div>
      <LineChart className={styles.chart} labels={labels} series={series} axis area={area} label={`${label} per day, last 7 days`} />
    </div>
  );
}

function Unavailable({ result, what }: { result: SectionResult<unknown> | null; what: string }) {
  if (!result) return <p className={styles.muted} style={{ marginTop: 14 }}>Loading</p>;
  if (result.state === "ok") return null;
  return <Notice tone={result.state === "error" ? "warn" : "info"} title={result.state === "error" ? `${what} did not answer` : `${what} is not set up`}>{result.message}</Notice>;
}

function Trends({ stats }: { stats: StatsData }) {
  const labels = stats.days.map(shortDay);
  const signupDelta = stats.previous7Days ? delta(stats.last7Days.signups, stats.previous7Days.signups) : null;
  return (
    <div className={styles.trends}>
      <Trend label="Sign-ups" value={nf(stats.last7Days.signups)} labels={labels} area
        series={[{ name: "Sign-ups", color: "var(--s1)", values: stats.series.signups }]}
        sub={signupDelta ? <span><b data-dir={signupDelta.dir}>{signupDelta.text}</b> vs last week</span> : <span>First web sign-ins</span>} />
      <Trend label="Active users" value={nf(stats.last7Days.activeUsers)} labels={labels} area
        series={[{ name: "Active users", color: "var(--s1)", values: stats.series.activeUsers }]}
        sub={<span>Different people this week · {nf(stats.today.activeUsers)} today</span>} />
      <Trend label="Duels" value={nf(stats.last7Days.duelsStarted)} labels={labels}
        series={[{ name: "Started", color: "var(--s1)", values: stats.series.duelsStarted }, { name: "Finished", color: "var(--s2)", values: stats.series.duelsFinished }]}
        sub={<><span className={styles.key}><i style={{ background: "var(--s1)" }} />Started {nf(stats.last7Days.duelsStarted)}</span><span className={styles.key}><i style={{ background: "var(--s2)" }} />Finished {nf(stats.last7Days.duelsFinished)}</span></>} />
      <Trend label="Drafts" value={nf(stats.last7Days.draftsStarted)} labels={labels} area
        series={[{ name: "Drafts started", color: "var(--s1)", values: stats.series.draftsStarted }]}
        sub={<span>{nf(stats.last7Days.draftsCompleted)} completed</span>} />
    </div>
  );
}

export function InsightsView({ s }: { s: Snapshots }) {
  const now = useNow();
  const stats = okData(s.stats);
  const errors = okData(s.errors);
  const usage = okData(s.usage);
  const fresh = errors?.issues.filter((issue) => isNewIssue(issue, now)).length ?? 0;
  const pages = usage?.topPages ?? [];
  const maxPage = Math.max(1, ...pages.map((p) => p.views));
  const views7d = usage?.pageviews7d ?? null;

  return (
    <>
      <div className={styles.rangeRow}>
        <span className={styles.rangeLbl}>Range · 7 days</span>
        <p>Days are Eastern time (ET). Errors use the last 24 hours.</p>
      </div>
      {stats ? <Trends stats={stats} /> : <Unavailable result={s.stats.result} what="Stats" />}

      <div className={styles.insSplit}>
        <div>
          <SectionHead title="Errors" n="Sentry · 24 h" flush
            aside={errors?.dashboardUrl ? <a className={styles.link} href={errors.dashboardUrl} target="_blank" rel="noreferrer">Open Sentry <Icon name="ext" /></a> : null} />
          {errors ? (
            <>
              <div className={styles.bigInline}>
                <b>{nf(errors.last24h)}</b>
                <span>events · {plural(errors.issues.length, "issue", "issues")}{fresh ? <> · <span style={{ color: "var(--crit)" }}>{fresh} new</span></> : null}</span>
              </div>
              {errors.issues.length === 0 ? <div className={`${styles.empty} ${styles.emptySm}`}>No unresolved issue had an event in the last 24 hours.</div> : errors.issues.map((issue) => {
                const isNew = isNewIssue(issue, now);
                return (
                  <div key={issue.id} className={styles.errRow}>
                    <div className={styles.minw}>
                      <a className={styles.errT} href={issue.url} target="_blank" rel="noreferrer" title={issue.title}>{issue.title}</a>
                      <div className={styles.errM}>
                        {issue.project ? <Tag>{issue.project}</Tag> : null}
                        {isNew ? <Tag tone="crit">New</Tag> : null}
                        {issue.level && issue.level !== "error" ? <Tag tone="warn">{issue.level}</Tag> : null}
                        {issue.users ? <span>{plural(issue.users, "person", "people")}</span> : null}
                        {issue.culprit ? <span title={issue.culprit}>{issue.culprit}</span> : null}
                      </div>
                    </div>
                    {issue.hourly ? <HourBars values={issue.hourly} color={isNew ? "var(--crit)" : "var(--t3)"} label={`Events per hour for ${issue.title}`} /> : <span />}
                    <div className={styles.errN}><b>{nf(issue.count)}</b><small>events</small></div>
                  </div>
                );
              })}
            </>
          ) : <Unavailable result={s.errors.result} what="Sentry" />}
        </div>
        <div>
          <SectionHead title="Usage" n="PostHog · 7 days" flush
            aside={usage?.dashboardUrl ? <a className={styles.link} href={usage.dashboardUrl} target="_blank" rel="noreferrer">Open PostHog <Icon name="ext" /></a> : null} />
          {usage ? (
            <>
              <div className={styles.uNums}>
                <div><small>Visitors</small><b>{nf(usage.wau)}</b></div>
                <div><small>Page views</small><b>{nf(views7d)}</b></div>
                <div><small>Today</small><b>{nf(usage.dau)}</b></div>
              </div>
              <div className={styles.pagesH}><span>Top pages</span><span>Views</span></div>
              {pages.length === 0 ? <div className={`${styles.empty} ${styles.emptySm}`}>No page views yet.</div> : pages.map((page) => (
                <div key={page.path} className={styles.pageRow} title={`${page.path} · ${nf(page.views)} views${views7d ? ` · ${Math.round((page.views / views7d) * 100)}% of all` : ""}`}>
                  <div className={styles.minw}><div className={styles.p}>{page.path}</div><div className={styles.hb}><span style={{ width: `${(page.views / maxPage) * 100}%` }} /></div></div>
                  <div className={styles.v}>{nf(page.views)}</div>
                </div>
              ))}
            </>
          ) : <Unavailable result={s.usage.result} what="PostHog" />}
        </div>
      </div>
    </>
  );
}

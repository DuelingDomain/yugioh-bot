"use client";

import * as React from "react";
import { RefreshCw } from "lucide-react";
import type { CardDataStatus } from "@yugidraft/shared/types";
import { StatusLine, SvButton } from "@/components/sheet";
import { absoluteTime, relativeTime, summarize, type OverallState } from "@/lib/card-data-status-model";
import { CatalogSection, EngineSection, WorkflowSection } from "./card-data-sections";
import { CachedCatalogSection, GapSection } from "./card-data-gap";
import styles from "./card-data.module.css";

type LoadFailure = "forbidden" | "unauthorized" | "unavailable";

const STATE_WORD: Record<OverallState, string> = { "up-to-date": "Up to date", behind: "Behind", unknown: "Unknown" };

export function CardDataStatusPanel() {
  const [status, setStatus] = React.useState<CardDataStatus | null>(null);
  const [failure, setFailure] = React.useState<LoadFailure | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [updated, setUpdated] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  const load = React.useCallback(async () => {
    setLoading(true);
    setUpdated(false);
    try {
      const res = await fetch("/api/admin/card-data-status", { cache: "no-store" });
      if (res.status === 403) { setFailure("forbidden"); return; }
      if (res.status === 401) { setFailure("unauthorized"); return; }
      if (!res.ok) { setFailure("unavailable"); return; }
      setStatus((await res.json()) as CardDataStatus);
      setFailure(null);
      setNow(Date.now());
      setUpdated(true);
    } catch {
      setFailure("unavailable");
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  if (failure === "forbidden" || failure === "unauthorized") {
    return (
      <div role="alert">
        <StatusLine tone="block">
          {failure === "forbidden"
            ? <><b>Admins only.</b> You need Manage Server permission in the Discord server to see card data status.</>
            : <><b>Sign in needed.</b> Sign in with Discord to see card data status.</>}
        </StatusLine>
      </div>
    );
  }

  if (!status) {
    if (failure === "unavailable") {
      return (
        <div className={styles.loadError}>
          <div role="alert">
            <StatusLine tone="block">
              <b>Couldn&apos;t load card data status.</b> The duel host or the database did not answer. Nothing has changed.
            </StatusLine>
          </div>
          <SvButton variant="quiet" onClick={() => void load()}>Retry</SvButton>
        </div>
      );
    }
    return (
      <div className={styles.block} role="status" aria-busy="true">
        <span className="sv-sr">Loading card data status</span>
        <span className="sk" style={{ width: "30%", height: 26 }} />
        <span className="sk" style={{ width: "60%" }} />
        <span className="sk" style={{ width: "48%" }} />
      </div>
    );
  }

  const summary = summarize(status);
  const checked = relativeTime(status.upstream.checkedAt, now);
  const expires = absoluteTime(status.upstream.expiresAt);

  return (
    <div className={styles.page} aria-busy={loading || undefined}>
      <section className={styles.summary} data-state={summary.state} aria-labelledby="cd-summary">
        <div className={styles.summaryMain}>
          <h2 className={styles.stateWord} id="cd-summary" data-state={summary.state}>
            <i className={styles.stateDot} aria-hidden="true" />
            {STATE_WORD[summary.state]}
          </h2>
          <p className={styles.headline}>{summary.headline}</p>
          {summary.reasons.length > 1 ? (
            <ul className={styles.reasons}>
              {summary.reasons.slice(1).map((reason) => <li key={reason}>{reason}</li>)}
            </ul>
          ) : null}
        </div>
        <div className={styles.summaryAside}>
          <SvButton variant="ghost" onClick={() => void load()} disabled={loading}>
            <RefreshCw className="ic sm" aria-hidden="true" /> {loading ? "Refreshing" : "Refresh"}
          </SvButton>
          <p className={styles.rowNote}>
            {status.upstream.checkedAt === null ? "GitHub has not been checked yet." : `GitHub checked ${checked ?? "at an unknown time"}.`}
            {expires ? <> It is cached until {expires}.</> : null}
          </p>
          <p role="status" className="sv-sr">{updated ? "Card data status updated" : ""}</p>
          {failure === "unavailable" ? (
            <div role="alert"><StatusLine tone="warn">Refresh failed. This is the last result.</StatusLine></div>
          ) : null}
        </div>
      </section>
      <div className="set-page">
        <EngineSection status={status} now={now} />
        <CatalogSection status={status} now={now} />
        <GapSection status={status} now={now} />
        <WorkflowSection status={status} now={now} />
        <CachedCatalogSection status={status} />
      </div>
    </div>
  );
}

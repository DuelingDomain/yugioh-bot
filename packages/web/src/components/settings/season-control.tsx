"use client";

import * as React from "react";
import { AlertTriangle, Lock, RotateCw, RefreshCw } from "lucide-react";
import { ConfirmPanel, DangerRow, DangerZone, SheetPanel } from "@/components/sheet";

type Season = {
  id: number;
  number: number;
  name: string | null;
  status: "active" | "ended";
  startedAt: string;
  endedAt: string | null;
};

const DAY_MS = 86_400_000;

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Day 1 is the day it started. */
export function seasonDay(startedAt: string, now: number = Date.now()): number {
  const started = new Date(startedAt).getTime();
  if (Number.isNaN(started)) return 1;
  return Math.max(1, Math.floor((now - started) / DAY_MS) + 1);
}

function seasonTitle(season: Season) {
  return season.name ? `Season ${season.number} · ${season.name}` : `Season ${season.number}`;
}

export function SeasonControl() {
  // undefined = loading, null = no season running
  const [season, setSeason] = React.useState<Season | null | undefined>(undefined);
  const [loadError, setLoadError] = React.useState(false);

  const [seasonName, setSeasonName] = React.useState("");
  const [startLoading, setStartLoading] = React.useState(false);
  const [startError, setStartError] = React.useState<string | null>(null);

  const [endLoading, setEndLoading] = React.useState(false);
  const [endError, setEndError] = React.useState<string | null>(null);
  const [confirmEnd, setConfirmEnd] = React.useState(false);

  const fetchSeason = React.useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/admin/season");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = (await res.json()) as { season: Season | null };
      setSeason(data.season);
    } catch {
      setLoadError(true);
    }
  }, []);

  React.useEffect(() => {
    void fetchSeason();
  }, [fetchSeason]);

  const handleStart = async (event: React.FormEvent) => {
    event.preventDefault();
    if (startLoading) return;
    setStartError(null);
    setStartLoading(true);
    try {
      const res = await fetch("/api/admin/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", name: seasonName.trim() || undefined }),
      });
      const data = (await res.json()) as { season?: Season; error?: string };
      if (!res.ok || data.error) {
        setStartError(data.error ?? `Failed to start season (${res.status}).`);
        return;
      }
      setSeason(data.season ?? null);
      setSeasonName("");
    } catch {
      setStartError("Couldn't start a season. Try again.");
    } finally {
      setStartLoading(false);
    }
  };

  const handleEnd = async () => {
    if (!season) return;
    setEndError(null);
    setEndLoading(true);
    try {
      const res = await fetch("/api/admin/season", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "end" }),
      });
      const data = (await res.json()) as { season?: Season; error?: string };
      if (!res.ok || data.error) {
        setEndError(`Couldn't end Season ${season.number}. It's still running. Try again.`);
        return;
      }
      setSeason(data.season ?? null);
      setConfirmEnd(false);
    } catch {
      setEndError(`Couldn't end Season ${season.number}. It's still running. Try again.`);
    } finally {
      setEndLoading(false);
    }
  };

  const retry = () => {
    setSeason(undefined);
    void fetchSeason();
  };

  let body: React.ReactNode;
  if (loadError && season === undefined) {
    body = (
      <div className="banner banner-bad" role="alert">
        <AlertTriangle className="ic" aria-hidden="true" />
        <div>
          <b>Couldn&apos;t load the season.</b> Nothing has changed. Try again in a moment.
        </div>
        <button className="btn btn-secondary btn-sm" type="button" style={{ marginLeft: "auto" }} onClick={retry}>
          <RotateCw className="ic sm" aria-hidden="true" />
          Retry
        </button>
      </div>
    );
  } else if (season === undefined) {
    body = (
      <div className="panel panel-pad season-card" aria-busy="true" aria-label="Loading season">
        <div style={{ display: "grid", gap: 10 }}>
          <span className="sk" style={{ width: "22%" }} />
          <span className="sk" style={{ width: "46%", height: 22 }} />
        </div>
        <div style={{ display: "grid", gap: 10, paddingTop: 14, borderTop: "1px solid var(--rule-lo)" }}>
          <span className="sk" style={{ width: "58%" }} />
          <span className="sk" style={{ width: "40%" }} />
        </div>
      </div>
    );
  } else if (season?.status === "active") {
    body = confirmEnd ? (
      <ConfirmPanel
          title={`End Season ${season.number}?`}
          confirmLabel={`End Season ${season.number}`}
          cancelLabel="Keep it running"
          onConfirm={() => void handleEnd()}
          onCancel={() => {
            setConfirmEnd(false);
            setEndError(null);
          }}
          busy={endLoading}
        >
          <ul className="endlist">
            <li>
              <Lock className="ic sm" aria-hidden="true" />
              <span><b>Standings freeze.</b> They&apos;re kept as Season {season.number}&apos;s final table.</span>
            </li>
            <li>
              <RefreshCw className="ic sm" aria-hidden="true" />
              <span><b>Nothing resets.</b> Elo, tiers, career winnings and achievements carry on.</span>
            </li>
            <li>
              <AlertTriangle className="ic sm" aria-hidden="true" />
              <span>
                <b>Season {season.number + 1} starts by itself</b> on the next approved match, with no name, unless you start it here first.
              </span>
            </li>
          </ul>
          {endError && (
            <p className="ferr" role="alert">
              <AlertTriangle className="ic sm" aria-hidden="true" />
              {endError}
            </p>
          )}
      </ConfirmPanel>
    ) : (
      <SheetPanel
        className="season-card"
        headingLevel={3}
        title={seasonTitle(season)}
        aside={<small className="ssn">{`running · day ${seasonDay(season.startedAt)}`}</small>}
        bodyClassName="stack"
      >
        <dl className="rows">
          <div>
            <dt>Started</dt>
            <dd>{formatDate(season.startedAt)}</dd>
          </div>
        </dl>
        <DangerZone >
          <DangerRow
            title={`End Season ${season.number}`}
            description="Freezes the standings as its final table. Nothing resets."
            action={
              <button
                className="btn btn-danger btn-sm"
                type="button"
                onClick={() => {
                  setEndError(null);
                  setConfirmEnd(true);
                }}
              >
                End season
              </button>
            }
          />
        </DangerZone>
      </SheetPanel>
    );
  } else {
    body = (
      <div className="panel panel-pad season-card">
        <p style={{ color: "var(--ink-3)", fontSize: 13 }}>No season running</p>
        <form
          onSubmit={(e) => void handleStart(e)}
          style={{ display: "grid", gap: 12, paddingTop: 14, borderTop: "1px solid var(--rule-lo)" }}
        >
          <div>
            <label className="label" htmlFor="season-name">
              Name for the next season <span style={{ color: "var(--ink-3)" }}>optional</span>
            </label>
            <div style={{ display: "flex", gap: 10 }}>
              <input
                className="input"
                id="season-name"
                type="text"
                value={seasonName}
                onChange={(e) => setSeasonName(e.target.value)}
                placeholder="e.g. Autumn Circuit"
              />
              <button className="btn btn-primary" type="submit" style={{ flex: "none" }} disabled={startLoading} aria-busy={startLoading || undefined}>
                Start season
              </button>
            </div>
          </div>
          <p className="small" style={{ color: "var(--ink-3)" }}>
            Or leave it. The next approved match starts a new season with no name.
          </p>
          {startError && (
            <p className="ferr" role="alert">
              <AlertTriangle className="ic sm" aria-hidden="true" />
              {startError}
            </p>
          )}
        </form>
      </div>
    );
  }

  return (
    <section className="set-sec" aria-labelledby="set-season">
      <div className="set-intro">
        <h2 id="set-season">Season</h2>
        <p>Leaderboard winnings and records count per season. Elo, career winnings and achievements never reset.</p>
      </div>
      <div className="stack" style={{ gap: 16 }}>{body}</div>
    </section>
  );
}

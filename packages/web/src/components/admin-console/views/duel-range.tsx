"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { plural } from "@/lib/admin-console/format";
import { easternDayKey, formatDayMonth, formatDate, ADMIN_TIME_ZONE_LABEL } from "@/lib/admin-console/time";
import {
  DUEL_RANGE_MAX_DAYS, type DuelHistoryPage, type DuelPeriodStats, type DuelRangePreset, type DuelStatsData, type SectionResult, type TodayCounts, type TodayDuel, type UserKey,
} from "@/lib/admin-console/types";
import { TODAY_ANCHOR, delta, shortDay } from "../model";
import { LineChart } from "../charts";
import { Notice, SectionHead, useNow } from "../parts";
import styles from "../admin-console.module.css";
import { TodayRow } from "./duel-parts";

type Choice = { kind: "preset"; preset: DuelRangePreset } | { kind: "custom"; from: string; to: string };
type Tab = "all" | "1v1" | "multi" | "ranked";
const PRESETS: [DuelRangePreset, string, string][] = [["today", "", "Today"], ["7d", "Last ", "7 days"], ["30d", "Last ", "30 days"]];
const TABS: [Tab, string, keyof TodayCounts][] = [["all", "All", "all"], ["1v1", "1v1", "oneVsOne"], ["multi", "Multi", "multi"], ["ranked", "Ranked", "ranked"]];
const POLL_MS = 60_000;
const nf = (n: number) => n.toLocaleString("en-US");

const rangeQuery = (choice: Choice, bots: boolean) => {
  const base = choice.kind === "preset" ? `range=${choice.preset}` : `from=${choice.from}&to=${choice.to}`;
  return bots ? `${base}&bots=1` : base;
};
/** "Nov 2 to Nov 8" from two Eastern day keys; the year shows when it is not this one. */
const dayLabel = (key: string) => formatDayMonth(Date.parse(`${key}T12:00:00Z`));
const spanLabel = (from: string, to: string) => from === to ? dayLabel(from) : `${dayLabel(from)} to ${dayLabel(to)}`;
/** The same span with the year, for the section header. */
const spanLabelYear = (from: string, to: string) => from === to ? formatDate(Date.parse(`${from}T12:00:00Z`)) : `${dayLabel(from)} to ${formatDate(Date.parse(`${to}T12:00:00Z`))}`;
const hourLabel = (h: number) => `${h % 12 || 12} ${h < 12 ? "AM" : "PM"}`;

/** One JSON request that keeps the last answer on screen while the next one loads. */
function useApi<T>(url: string | null, refresh: number) {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: true });
  useEffect(() => {
    if (!url) return;
    const abort = new AbortController();
    setState((s) => ({ ...s, loading: true }));
    fetch(url, { cache: "no-store", signal: abort.signal })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as SectionResult<T> | null;
        if (body?.state === "ok") setState({ data: body.data, error: null, loading: false });
        else setState((s) => ({ data: s.data, error: body ? body.message : res.status === 404 || res.status === 403 ? "You do not have access to this page." : "The duels could not be loaded.", loading: false }));
      })
      .catch((error) => { if (!abort.signal.aborted) setState((s) => ({ ...s, error: String(error?.name) === "AbortError" ? s.error : "The duels could not be loaded.", loading: false })); });
    return () => abort.abort();
  }, [url, refresh]);
  return state;
}

/* ---------------- stats ---------------- */

type Dir = "up" | "down" | "flat";
/** A change against the previous period. `bad` marks a number where more is worse (it turns red when it grows). */
function Change({ cur, prev, bad, absolute }: { cur: number; prev: number; bad?: boolean; absolute?: boolean }) {
  const d = absolute ? delta(Math.round(cur * 10) / 10, Math.round(prev * 10) / 10) : delta(cur, prev, true);
  const dir: Dir = bad ? (d.dir === "up" ? "down" : d.dir === "down" ? "up" : "flat") : d.dir;
  return <span className={styles.change}><b data-dir={dir}>{d.text}</b></span>;
}

function StatRow({ label, value, cur, prev, bad, bar, note }: { label: string; value?: ReactNode; cur: number; prev: number; bad?: boolean; bar?: number; note?: string }) {
  return (
    <div className={styles.dsRow}>
      <span className={styles.dsLabel} title={note}>{label}</span>
      <b className={styles.dsValue}>{value ?? nf(cur)}</b>
      <Change cur={cur} prev={prev} bad={bad} />
      {bar !== undefined ? <i className={styles.dsBar} style={{ width: `${Math.round(bar * 100)}%` }} aria-hidden="true" /> : null}
    </div>
  );
}

function Block({ title, note, more, children }: { title: string; note?: ReactNode; more?: boolean; children: ReactNode }) {
  return <section className={styles.dsBlock} data-more={more ? "1" : undefined}><h3>{title}</h3>{children}{note ? <p className={styles.dsNote}>{note}</p> : null}</section>;
}

function HourStrip({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const peak = values.indexOf(Math.max(...values));
  const total = values.reduce((a, b) => a + b, 0);
  return (
    <>
      <div className={styles.hours} role="img" aria-label={total ? `Duels started per hour of day, ${ADMIN_TIME_ZONE_LABEL}. Busiest hour ${hourLabel(peak)}, ${plural(values[peak], "duel", "duels")}.` : "No duels in this range."}>
        {values.map((v, h) => (
          <span key={h} className={styles.hourCol} title={`${hourLabel(h)} ${ADMIN_TIME_ZONE_LABEL}: ${plural(v, "duel", "duels")}`}>
            <i style={{ height: v ? `${Math.max(8, (v / max) * 100)}%` : "2px" }} data-peak={total > 0 && h === peak ? "1" : undefined} />
          </span>
        ))}
      </div>
      <div className={styles.hourAxis} aria-hidden="true"><span>12 AM</span><span>6 AM</span><span>12 PM</span><span>6 PM</span><span>11 PM</span></div>
      <p className={styles.dsNote}>{total ? <>Busiest hour: <b>{hourLabel(peak)} {ADMIN_TIME_ZONE_LABEL}</b> with {plural(values[peak], "duel", "duels")}.</> : "No duel started in this range."}</p>
    </>
  );
}

const FORMAT_ROWS: [keyof DuelPeriodStats["byFormat"], string][] = [["1v1", "1v1"], ["ffa3", "3-way"], ["ffa4", "4-way"], ["tag", "Tag"], ["remote", "Remote"]];
const CARD_ROWS: [keyof DuelPeriodStats["byCardFormat"], string][] = [["domain", "Domain"], ["genesys", "Genesys"], ["genesysDomain", "Genesys Domain"], ["normal", "Normal"]];
const END_ROWS: [keyof DuelPeriodStats["endings"], string, string?][] = [
  ["win", "Won"], ["surrender", "Surrender"], ["timeout", "Timeout", "A player ran out of turn time."],
  ["idle", "Idle close", "Closed after 10 minutes without a move."], ["interrupted", "Interrupted", "Closed early for another reason."],
];

function StatsPanel({ stats, loading, bots, onBots }: { stats: DuelStatsData; loading: boolean; bots: boolean; onBots: (on: boolean) => void }) {
  const { current: c, previous: p, range } = stats;
  const sum = (o: object) => Object.values(o as Record<string, number>).reduce((a, b) => a + b, 0);
  const engineTotal = sum(c.byCardFormat);
  const [open, setOpen] = useState(false);
  const other = c.endings.draw + c.endings.cancelled + c.endings.running;
  const otherPrev = p.endings.draw + p.endings.cancelled + p.endings.running;
  return (
    <aside className={styles.dsPanel} aria-label="Duel stats for the range" aria-busy={loading} data-loading={loading ? "1" : undefined} data-open={open ? "1" : undefined}>
      <div className={styles.dsHead}>
        <div className={styles.dsK}>Stats</div>
        <div className={styles.dsRange}>{spanLabel(range.from, range.to)}</div>
        <div className={styles.dsVs}>Change against {spanLabel(range.previous.from, range.previous.to)}, the {range.days === 1 ? "day" : `${range.days} days`} before. Days run midnight to midnight {ADMIN_TIME_ZONE_LABEL}.</div>
      </div>

      <Block title="Duels">
        <div className={styles.dsBig}><b>{nf(c.total)}</b><Change cur={c.total} prev={p.total} /></div>
        {range.days > 1 ? (
          <LineChart className={styles.dsChart} axis area labels={stats.perDay.map((d) => shortDay(d.day))}
            series={[{ name: "Duels", color: "var(--s1)", values: stats.perDay.map((d) => d.n) }]} label={`Duels started per day, ${spanLabel(range.from, range.to)}`} />
        ) : null}
      </Block>

      <Block title="By format">
        {FORMAT_ROWS.map(([key, label]) => <StatRow key={key} label={label} cur={c.byFormat[key]} prev={p.byFormat[key]} bar={c.total ? c.byFormat[key] / c.total : 0} />)}
      </Block>

      <button type="button" className={`${styles.btn} ${styles.btnSm} ${styles.dsExpand}`} aria-expanded={open} onClick={() => setOpen((v) => !v)}>{open ? "Show fewer stats" : "Show all stats"}</button>

      <Block more title="By card format" note="Engine duels. Remote tables have no card format.">
        {CARD_ROWS.map(([key, label]) => <StatRow key={key} label={label} cur={c.byCardFormat[key]} prev={p.byCardFormat[key]} bar={engineTotal ? c.byCardFormat[key] / engineTotal : 0} />)}
      </Block>

      <Block more title="Players" note="People signed in and seated in a counted duel. New: their first counted duel is in this range.">
        <StatRow label="Unique" cur={c.players.unique} prev={p.players.unique} />
        <StatRow label="New" cur={c.players.new} prev={p.players.new} />
        <StatRow label="Returning" cur={c.players.returning} prev={p.players.returning} />
      </Block>

      <Block more title={`Busiest hours (${ADMIN_TIME_ZONE_LABEL})`}>
        <HourStrip values={stats.perHour} />
      </Block>

      <Block more title="How duels ended" note="Engine duels. Won includes wins by the last opponent leaving.">
        {END_ROWS.map(([key, label, note]) => <StatRow key={key} label={label} note={note} cur={c.endings[key]} prev={p.endings[key]} bar={engineTotal ? c.endings[key] / engineTotal : 0} />)}
        {other > 0 || otherPrev > 0 ? <StatRow label="Other" note="Draws, cancelled tables and duels still running." cur={other} prev={otherPrev} /> : null}
      </Block>

      <Block more title="Practice bot and test duels"
        note={bots ? "Counted in every number above." : "Counted apart. Not in any number above, and not in the list."}>
        <StatRow label="Practice bot" cur={c.practice} prev={p.practice} />
        <StatRow label="Test duels" cur={c.test} prev={p.test} />
        <label className={styles.dsToggle}>
          <input type="checkbox" checked={bots} onChange={(e) => onBots(e.target.checked)} />
          <span>Include them in totals and the list</span>
        </label>
      </Block>

      <Block more title="Length" note="Completed engine duels with a saved turn count and end time.">
        <StatRow label="Average turns" value={c.avgTurns === null ? "-" : c.avgTurns.toFixed(1)} cur={c.avgTurns ?? 0} prev={p.avgTurns ?? 0} />
        <StatRow label="Average minutes" value={c.avgMinutes === null ? "-" : c.avgMinutes.toFixed(1)} cur={c.avgMinutes ?? 0} prev={p.avgMinutes ?? 0} />
      </Block>

      <Block more title="Growth" note="Sign-ups are first web sign-ins. Waitlist joins are requests with a recorded join alert; they are not counted while join alerts are off.">
        <StatRow label="New sign-ups" cur={c.signups} prev={p.signups} />
        <StatRow label="Waitlist joins" cur={c.waitlistJoins} prev={p.waitlistJoins} />
      </Block>

      <Block more title="Problems" note="No engine error counter exists. Errors from Sentry are in the Health view. Replay checks run when a replay opens.">
        <StatRow label="Bug reports filed" cur={c.bugReports} prev={p.bugReports} bad />
        <StatRow label="Replay checks failed" cur={c.replayChecksFailed} prev={p.replayChecksFailed} bad note="Duels whose saved replay did not match the saved board when it was checked." />
      </Block>
    </aside>
  );
}

/* ---------------- list ---------------- */

function DuelList({ query, tab, onTab, onOpen, live, rangeLabel, onCounts }: {
  query: string; tab: Tab; onTab: (tab: Tab) => void; onOpen: (userId: UserKey) => void; live: boolean; rangeLabel: string; onCounts: (counts: TodayCounts | null) => void;
}) {
  const now = useNow();
  const [tick, setTick] = useState(0);
  const first = useApi<DuelHistoryPage>(`/api/admin/console/duel-history?${query}&tab=${tab}`, tick);
  const [more, setMore] = useState<{ duels: TodayDuel[]; next: string | null; key: string } | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);
  const key = `${query}|${tab}`;
  const extra = more?.key === key ? more : null;
  const counts = first.data?.counts ?? null;
  useEffect(() => { onCounts(counts); }, [counts, onCounts]);
  // A new range or tab starts again from the first page. The 60 second refresh only runs while no extra page is loaded.
  const extraRef = useRef(extra);
  extraRef.current = extra;
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible" && !extraRef.current) setTick((t) => t + 1); }, POLL_MS);
    return () => clearInterval(timer);
  }, [live]);

  const duels = useMemo(() => {
    const seen = new Set<string>();
    return [...(first.data?.duels ?? []), ...(extra?.duels ?? [])].filter((d) => !seen.has(d.slug) && seen.add(d.slug));
  }, [first.data, extra]);
  const next = extra ? extra.next : first.data?.next ?? null;
  const loadMore = useCallback(async () => {
    if (!next || moreLoading) return;
    setMoreLoading(true); setMoreError(null);
    try {
      const res = await fetch(`/api/admin/console/duel-history?${query}&tab=${tab}&before=${encodeURIComponent(next)}`, { cache: "no-store" });
      const body = (await res.json()) as SectionResult<DuelHistoryPage>;
      if (body.state !== "ok") throw new Error(body.message);
      setMore((prev) => ({ duels: [...(prev?.key === key ? prev.duels : []), ...body.data.duels], next: body.data.next, key }));
    } catch { setMoreError("More duels could not be loaded."); }
    finally { setMoreLoading(false); }
  }, [next, moreLoading, query, tab, key]);

  // Reaching the end of the list loads the next page; the button does the same.
  const sentinel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !next || moreError) return;
    const io = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) void loadMore(); }, { rootMargin: "240px" });
    io.observe(el);
    return () => io.disconnect();
  }, [next, loadMore, moreError]);

  const c = first.data?.counts;
  const total = c ? c[TABS.find(([k]) => k === tab)![2]] : 0;
  return (
    <div className={styles.dsList}>
      <div className={`${styles.toolbar} ${styles.toolbarTight}`}>
        <div className={styles.seg} role="group" aria-label="Filter the duels of the range">
          {TABS.map(([k, label, field]) => (
            <button key={k} type="button" aria-pressed={tab === k} aria-label={`${label}, ${c ? c[field] : 0}`} onClick={() => onTab(k)}>{label}<span>{c ? c[field] : 0}</span></button>
          ))}
        </div>
        <span className={`${styles.aside} ${styles.toolbarEnd}`}>{c && duels.length < total ? `Showing ${duels.length} of ${nf(total)} · ` : ""}Replays open in a new tab</span>
      </div>
      {first.error && !first.data ? <Notice tone="warn" title="The duels are not available">{first.error}</Notice> : (
        <div className={styles.todayTbl} role="table" aria-label={`Duels, ${rangeLabel}`} aria-busy={first.loading}>
          <div className={styles.tblHead} role="row">
            <span role="columnheader">Format</span><span role="columnheader">Players</span><span role="columnheader">Result</span>
            <span role="columnheader" className={styles.hAt}>Started</span><span role="columnheader"><span className={styles.srOnly}>Open</span></span>
          </div>
          {duels.length === 0
            ? <div className={`${styles.empty} ${styles.emptySm}`} role="row"><span role="cell">{!first.data ? "Loading" : c && c.all === 0 ? "No duel started in this range." : "No duel of this range fits this filter."}</span></div>
            : duels.map((d) => <TodayRow key={d.slug} duel={d} onOpen={onOpen} now={now} showDay={rangeLabel !== "today"} />)}
        </div>
      )}
      {next ? (
        <div className={styles.dsMore} ref={sentinel}>
          {moreError ? <span className={styles.aside}>{moreError}</span> : null}
          <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={moreLoading} onClick={() => void loadMore()}>{moreLoading ? "Loading" : moreError ? "Try again" : "Load more"}</button>
        </div>
      ) : null}
    </div>
  );
}

/* ---------------- the section ---------------- */

/** Duels of an Eastern day range with the stats beside them. */
export function DuelRangeSection({ onOpen }: { onOpen: (userId: UserKey) => void }) {
  const [choice, setChoice] = useState<Choice>({ kind: "preset", preset: "today" });
  const [bots, setBots] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const nowMs = useNow();
  const todayKey = easternDayKey(nowMs);
  const [draft, setDraft] = useState<{ from: string; to: string }>({ from: todayKey, to: todayKey });
  const [tick, setTick] = useState(0);
  const [, setCounts] = useState<TodayCounts | null>(null);

  const query = rangeQuery(choice, bots);
  const live = choice.kind === "preset" || choice.to >= todayKey;
  const stats = useApi<DuelStatsData>(`/api/admin/console/duel-stats?${query}`, tick);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") setTick((t) => t + 1); }, POLL_MS);
    return () => clearInterval(timer);
  }, [live]);

  const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
  const draftProblem = !draft.from || !draft.to ? "Pick both days." : draft.from > draft.to ? "The first day is after the last day."
    : days(draft.from, draft.to) > DUEL_RANGE_MAX_DAYS ? `A range is at most ${DUEL_RANGE_MAX_DAYS} days.` : null;
  const range = stats.data?.range;
  const label = choice.kind === "preset" && choice.preset === "today" ? "today" : range ? spanLabel(range.from, range.to) : "the range";
  const onCounts = useCallback((next: TodayCounts | null) => setCounts(next), []);

  return (
    <div id={TODAY_ANCHOR} className={styles.anchor}>
      <SectionHead title="Duel history" n={stats.data ? plural(stats.data.current.total, "duel", "duels") : undefined}
        aside={<span className={styles.aside}>{range ? spanLabelYear(range.from, range.to) : null}</span>} />
      <div className={`${styles.toolbar} ${styles.toolbarTight} ${styles.dsRangeBar}`}>
        <div className={styles.seg} role="group" aria-label="Date range">
          {PRESETS.map(([preset, lead, text]) => (
            <button key={preset} type="button" aria-pressed={choice.kind === "preset" && choice.preset === preset} onClick={() => { setChoice({ kind: "preset", preset }); setTab("all"); }}>{lead ? <i className={styles.dsLead}>{lead}</i> : null}{text}</button>
          ))}
          <button type="button" aria-pressed={choice.kind === "custom"} onClick={() => { setDraft({ from: range?.from ?? todayKey, to: range?.to ?? todayKey }); setChoice({ kind: "custom", from: range?.from ?? todayKey, to: range?.to ?? todayKey }); setTab("all"); }}>Custom</button>
        </div>
        {choice.kind === "custom" ? (
          <div className={styles.dsDates}>
            <label>From<input type="date" value={draft.from} max={todayKey} onChange={(e) => { const from = e.target.value; setDraft((d) => ({ ...d, from })); }} /></label>
            <label>To<input type="date" value={draft.to} max={todayKey} onChange={(e) => { const to = e.target.value; setDraft((d) => ({ ...d, to })); }} /></label>
            <button type="button" className={`${styles.btn} ${styles.btnSm}`} disabled={draftProblem !== null}
              onClick={() => { setChoice({ kind: "custom", from: draft.from, to: draft.to }); setTab("all"); }}>Show</button>
            {draftProblem ? <span className={styles.aside} role="status">{draftProblem}</span> : null}
          </div>
        ) : null}
        <label className={`${styles.dsToggle} ${styles.toolbarEnd}`}>
          <input type="checkbox" checked={bots} onChange={(e) => setBots(e.target.checked)} />
          <span>Include practice bot and test duels</span>
        </label>
      </div>
      {stats.error && !stats.data ? <Notice tone="warn" title="The duel stats are not available">{stats.error}</Notice> : null}
      <div className={styles.dsLayout}>
        <DuelList query={query} tab={tab} onTab={setTab} onOpen={onOpen} live={live} rangeLabel={label} onCounts={onCounts} />
        {stats.data ? <StatsPanel stats={stats.data} loading={stats.loading} bots={bots} onBots={setBots} /> : <aside className={styles.dsPanel} aria-busy="true"><div className={styles.dsK}>Stats</div><p className={styles.dsNote}>{stats.error ?? "Loading"}</p></aside>}
      </div>
    </div>
  );
}

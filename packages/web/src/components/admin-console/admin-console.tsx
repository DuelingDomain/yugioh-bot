"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { duration } from "@/lib/admin-console/format";
import type { UserKey } from "@/lib/admin-console/types";
import { TODAY_ANCHOR, VIEWS, VIEW_META, headerFor, isView, liveCounts, okData, serviceSummary, type Snapshots, type View } from "./model";
import { Icon, StatusIcon, useNow, type Tone } from "./parts";
import { useAdminSection } from "./use-admin-section";
import { OverviewView } from "./views/overview";
import { PeopleView } from "./views/people";
import { DuelsView } from "./views/duels";
import { WaitlistView } from "./views/waitlist";
import { HealthView } from "./views/health";
import { InsightsView } from "./views/insights";
import styles from "./admin-console.module.css";

export interface ConsoleActions {
  go: (view: View) => void;
  openPerson: (userId: UserKey) => void;
  toast: (text: string, tone?: "crit") => void;
}

function useSnapshots(): Snapshots {
  const online = useAdminSection("online");
  const live = useAdminSection("live");
  const today = useAdminSection("today");
  const waitlist = useAdminSection("waitlist");
  const system = useAdminSection("system");
  const errors = useAdminSection("errors");
  const stats = useAdminSection("stats");
  const usage = useAdminSection("usage");
  return { online, live, today, waitlist, system, errors, stats, usage };
}

/** Badge text per view for the left menu and the phone tab bar. */
function useBadges(s: Snapshots) {
  const online = okData(s.online);
  const live = liveCounts(okData(s.live));
  const waitlist = okData(s.waitlist);
  const errors = okData(s.errors);
  const health = serviceSummary(okData(s.system));
  const healthTone: Tone = health.failing ? "crit" : health.problems > 0 ? "warn" : "good";
  const rail: Partial<Record<View, ReactNode>> = {
    people: online ? <span className={styles.count}><span className={styles.dot} data-tone="good" />{online.count}</span> : null,
    duels: s.live.result?.state === "ok" ? <span className={styles.count}>{live.drafts.length ? `${live.duels.length} + ${live.drafts.length}` : live.duels.length}</span> : null,
    waitlist: waitlist && waitlist.pending > 0 ? <span className={`${styles.count} ${styles.pill}`}>{waitlist.pending}</span> : null,
    health: s.system.result?.state === "ok" ? <span className={styles.count}><span className={styles.dot} data-tone={healthTone} />{health.problems > 0 ? health.problems : null}</span> : null,
    insights: errors && errors.last24h > 0 ? <span className={`${styles.count} ${styles.countCrit}`}>{errors.last24h.toLocaleString("en-US")} err</span> : null,
  };
  const tabs: Partial<Record<View, ReactNode>> = {
    people: online ? <span className={styles.bdg}>{online.count}</span> : null,
    duels: s.live.result?.state === "ok" && live.duels.length + live.drafts.length > 0 ? <span className={styles.bdg}>{live.duels.length + live.drafts.length}</span> : null,
    waitlist: waitlist && waitlist.pending > 0 ? <span className={styles.bdg} data-tone="gold">{waitlist.pending}</span> : null,
    health: health.problems > 0 ? <span className={`${styles.bdg} ${styles.bdgDot}`} data-tone={healthTone} /> : null,
  };
  return { rail, tabs, health, healthTone };
}

function LiveChip({ s, label }: { s: Snapshots; label?: boolean }) {
  const now = useNow();
  const times = [s.online.fetchedAt, s.live.fetchedAt].filter((t): t is number => t !== null);
  const last = times.length ? Math.max(...times) : null;
  const failed = s.online.failure || s.live.failure;
  const text = failed === "unauthorized" ? "Signed out. Sign in again."
    : failed ? "Connection lost, retrying"
    : last === null ? "Loading"
    : now - last < 2000 ? "updated just now" : `updated ${duration(now - last)} ago`;
  return (
    <span className={styles.liveChip} role="status" aria-live="off">
      <span className={styles.pulse} data-tone={failed ? "warn" : undefined} />
      {label ? <b>Live</b> : null}
      <span>{text}</span>
    </span>
  );
}

/** The /admin console: a left menu with six views, one large view at a time. */
export function AdminConsole() {
  const s = useSnapshots();
  const [view, setView] = useState<View>("overview");
  const [person, setPerson] = useState<UserKey | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [toast, setToast] = useState<{ text: string; tone?: "crit"; on: boolean }>({ text: "", on: false });
  const mainRef = useRef<HTMLElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const focusFilter = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const now = useNow();
  const badges = useBadges(s);

  const go = useCallback((next: View) => {
    setView(next);
    setSheetOpen(false);
    if (window.location.hash !== `#${next}`) window.history.replaceState(null, "", `#${next}`);
    mainRef.current?.scrollTo({ top: 0 });
    if (window.matchMedia("(max-width: 760px)").matches) window.scrollTo({ top: 0 });
  }, []);

  // Per-view links (#people, #health ...). Read after mount so the server and first client render agree.
  // #duels-today opens the Duels view and scrolls to the Today list.
  const anchor = useRef<string | null>(null);
  useEffect(() => {
    const read = () => {
      const hash = window.location.hash.slice(1);
      if (hash === TODAY_ANCHOR) { anchor.current = hash; setView("duels"); return; }
      setView(isView(hash) ? hash : "overview");
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);

  // Scroll once the list is on the page; the live tables above it must have loaded first, or the list moves down.
  const anchorReady = view === "duels" && s.live.result !== null && s.today.result !== null;
  useEffect(() => {
    if (!anchorReady || !anchor.current) return;
    const id = anchor.current;
    anchor.current = null;
    requestAnimationFrame(() => document.getElementById(id)?.scrollIntoView({ block: "start" }));
  }, [anchorReady, view]);

  const openPerson = useCallback((userId: UserKey) => {
    setPerson(userId);
    setView("people");
    if (window.location.hash !== "#people") { window.history.replaceState(null, "", "#people"); mainRef.current?.scrollTo({ top: 0 }); }
    if (window.matchMedia("(max-width: 760px)").matches) setSheetOpen(true);
  }, []);

  const showToast = useCallback((text: string, tone?: "crit") => {
    setToast({ text, tone, on: true });
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast((t) => ({ ...t, on: false })), 2600);
  }, []);
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current); }, []);

  // Keys: 1-6 switch views, "/" filters people, Escape closes the phone sheet.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target?.closest("input, textarea, select, [contenteditable='true']");
      if (typing) { if (e.key === "Escape") (target as HTMLElement).blur(); return; }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= "1" && e.key <= "6") { go(VIEWS[Number(e.key) - 1]); return; }
      if (e.key === "/") {
        e.preventDefault();
        if (view === "people") filterRef.current?.focus();
        else { focusFilter.current = true; go("people"); }
        return;
      }
      if (e.key === "Escape") setSheetOpen(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [go, view]);
  useEffect(() => {
    if (view === "people" && focusFilter.current) { focusFilter.current = false; filterRef.current?.focus(); }
  }, [view]);

  const actions = useMemo<ConsoleActions>(() => ({ go, openPerson, toast: showToast }), [go, openPerson, showToast]);
  const header = headerFor(view, s, now);
  const system = okData(s.system);
  const health = badges.health;

  return (
    <div className={styles.app}>
      <aside className={styles.rail} aria-label="Admin navigation">
        <a className={styles.brand} href="/dashboard" title="Back to the app">
          <span className={styles.mark} aria-hidden="true" />
          <div className={styles.brandText}><div className={styles.brandName}>Dueling Domain</div><div className={styles.brandSub}>Admin console</div></div>
        </a>
        <nav className={styles.nav}>
          {VIEWS.map((v, i) => (
            <button key={v} type="button" className={styles.navItem} aria-current={view === v ? "page" : undefined}
              title={`${VIEW_META[v].label} (${i + 1})`} onClick={() => go(v)}>
              <Icon name={VIEW_META[v].icon} />
              <span className={styles.navLbl}>{VIEW_META[v].label}</span>
              {badges.rail[v] ?? <span />}
            </button>
          ))}
        </nav>
        <p className={styles.railHint}>Press <kbd className={styles.kbd}>1</kbd>–<kbd className={styles.kbd}>6</kbd> to switch views</p>
        <div className={styles.railFoot}>
          <button type="button" className={styles.sys} onClick={() => go("health")} title="Open Health">
            <StatusIcon tone={s.system.result?.state === "ok" ? badges.healthTone : "quiet"} />
            <div className={styles.sysText}>
              <div className={styles.sysT}>{s.system.result?.state !== "ok" ? "Health" : health.problems === 0 ? "All systems up" : `${health.problems} ${health.problems === 1 ? "warning" : "warnings"}`}</div>
              <div className={styles.sysD}>{health.total ? `${health.up} of ${health.total} services healthy` : "Checking services"}</div>
            </div>
          </button>
          <div className={styles.ver}>
            {system?.commit ? <a href={system.commit.url} target="_blank" rel="noreferrer">Build {system.commit.short}</a> : system?.version ? `Build ${system.version.slice(0, 12)}` : "Build unknown"}
            {system ? <> · up {duration(now - system.startedAt)}</> : null}
            {system?.cardData ? <><br />Cards: {(system.cardData.lastUpdate?.label ?? system.cardData.headline).replace(/^Project /, "")}</> : null}
          </div>
        </div>
      </aside>

      <main className={styles.main} ref={mainRef}>
        <div className={styles.wrap}>
          <div className={styles.mBrand}>
            <a className={styles.mBrandL} href="/dashboard" title="Back to the app"><span className={styles.mark} aria-hidden="true" />Admin</a>
            <LiveChip s={s} />
          </div>
          <header className={styles.top}>
            <div>
              <div className={styles.eyebrow}>{header.eyebrow}</div>
              <h1 className={styles.title}>{header.title}{header.em ? <em>{header.em}</em> : null}</h1>
              <p className={styles.sub}>{header.sub}</p>
            </div>
            <div className={styles.topR}><LiveChip s={s} label /></div>
          </header>

          <section key={view} className={styles.view} aria-label={VIEW_META[view].label}>
            {view === "overview" ? <OverviewView s={s} actions={actions} />
              : view === "people" ? <PeopleView s={s} actions={actions} selected={person} sheetOpen={sheetOpen} onCloseSheet={() => setSheetOpen(false)} filterRef={filterRef} />
              : view === "duels" ? <DuelsView s={s} actions={actions} />
              : view === "waitlist" ? <WaitlistView s={s} actions={actions} />
              : view === "health" ? <HealthView s={s} />
              : <InsightsView s={s} />}
          </section>
        </div>
      </main>

      <nav className={styles.tabbar} aria-label="Admin views">
        {VIEWS.map((v) => (
          <button key={v} type="button" className={styles.tab} aria-current={view === v ? "page" : undefined} onClick={() => go(v)}>
            <Icon name={VIEW_META[v].icon} />{VIEW_META[v].label}{badges.tabs[v] ?? null}
          </button>
        ))}
      </nav>
      <div className={`${styles.toast} ${toast.on ? styles.toastOn : ""}`} data-tone={toast.tone} role="status">{toast.text}</div>
    </div>
  );
}

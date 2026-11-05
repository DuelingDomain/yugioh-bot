"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { ScrollText } from "lucide-react";
import { fetchReleases, markReleaseSeen } from "@/lib/updates/client";
import { compareVersions, isQuietPath, isUnseen, modalIsOpen } from "@/lib/updates/model";
import type { Release } from "@/lib/updates/types";
import { CompactPanel, ExpandedPanel } from "./panels";
import { RevealCard } from "./reveal-card";
import styles from "./updates-board.module.css";

type View = "dock" | "reveal" | "compact" | "expanded";

/** How long the reveal card stays before it flies into the chip. Hover and focus pause it. */
const REVEAL_MS = 15000;
const LEAVE_MS = 340;
const PANEL_MS = 180;
/** The reveal waits this long after load (and re-checks at this pace) so the page settles first. */
const REVEAL_POLL_MS = 700;

const reducedMotion = () => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Keeps a panel mounted while its close animation plays. */
function usePresence(active: boolean) {
  const [mounted, setMounted] = useState(active);
  const [closing, setClosing] = useState(false);
  const wasActive = useRef(active);
  useEffect(() => {
    if (active) {
      wasActive.current = true;
      setMounted(true);
      setClosing(false);
      return;
    }
    if (!wasActive.current) return;
    wasActive.current = false;
    setClosing(true);
    const id = window.setTimeout(() => {
      setMounted(false);
      setClosing(false);
    }, reducedMotion() ? 120 : PANEL_MS);
    return () => window.clearTimeout(id);
  }, [active]);
  return { mounted: mounted || active, closing: closing && !active };
}

interface UpdatesBoardProps {
  /** How far a bottom bar on the page lifts the dock, in px (see fab-lift). */
  lift: number;
  /** Where the dock sits. */
  className: string;
  /** The Report bug chip. It shares the dock, so both lift together. */
  children: ReactNode;
}

/**
 * The Updates chip, its panels and the one-time reveal for a new release. It renders the dock (the chip and the Report
 * bug button beside it) and the floating parts as siblings: the dock lifts with a transform, which would trap a fixed
 * child. Everything about "seen" comes from the server, per person. If the releases cannot load or there are none, only
 * the Report bug button shows.
 */
export function UpdatesBoard({ lift, className, children }: UpdatesBoardProps) {
  const pathname = usePathname();
  const [releases, setReleases] = useState<Release[]>([]);
  const [seenVersion, setSeenVersion] = useState<string | null>(null);
  /** The release that was unseen when the page loaded: it keeps its New tag for this visit. */
  const [newVersion, setNewVersion] = useState<string | null>(null);
  const [view, setView] = useState<View>("dock");
  const [leaving, setLeaving] = useState(false);
  const [activeVersion, setActiveVersion] = useState("");
  const [announce, setAnnounce] = useState("");

  const launcherRef = useRef<HTMLButtonElement>(null);
  const revealRef = useRef<HTMLDivElement>(null);
  const cardRef = useRef<HTMLElement>(null);
  const barRef = useRef<HTMLElement>(null);
  const compactRef = useRef<HTMLElement>(null);
  const readRef = useRef<HTMLButtonElement>(null);
  const shrinkRef = useRef<HTMLButtonElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const revealed = useRef(false);
  const posted = useRef<string | null>(null);
  const pendingGoto = useRef<string | null>(null);
  const timer = useRef({ left: REVEAL_MS, start: 0, paused: false, frame: 0 });
  const dismissRef = useRef<() => void>(() => {});
  const [landing, setLanding] = useState(false);

  const latest: Release | undefined = releases[0];
  const unseen = isUnseen(latest, seenVersion);

  useEffect(() => {
    const controller = new AbortController();
    void fetchReleases(controller.signal).then((res) => {
      if (!res || res.releases.length === 0) return;
      const sorted = [...res.releases].sort((a, b) => compareVersions(b.version, a.version));
      setReleases(sorted);
      setSeenVersion(res.lastSeenVersion);
      setActiveVersion(sorted[0]!.version);
      if (isUnseen(sorted[0], res.lastSeenVersion)) setNewVersion(sorted[0]!.version);
    });
    return () => controller.abort();
  }, []);

  /** The reveal or a panel opened: this person has seen the newest release. Sent once per version. */
  const markSeen = useCallback(() => {
    if (!latest) return;
    setSeenVersion(latest.version);
    if (posted.current === latest.version) return;
    posted.current = latest.version;
    void markReleaseSeen(latest.version);
  }, [latest]);

  /* ---- Reveal timer: a bar that runs down, paused while the pointer or focus is on the card. ---- */
  const tick = useCallback(() => {
    const t = timer.current;
    if (t.paused) return;
    const left = Math.max(0, t.left - (performance.now() - t.start));
    if (barRef.current) barRef.current.style.transform = `scaleX(${left / REVEAL_MS})`;
    if (left <= 0) {
      dismissRef.current();
      return;
    }
    t.frame = requestAnimationFrame(tick);
  }, []);
  const startTimer = useCallback(() => {
    const t = timer.current;
    t.paused = false;
    t.start = performance.now();
    cancelAnimationFrame(t.frame);
    t.frame = requestAnimationFrame(tick);
  }, [tick]);
  const pauseTimer = useCallback(() => {
    const t = timer.current;
    if (t.paused) return;
    t.paused = true;
    t.left -= performance.now() - t.start;
    cancelAnimationFrame(t.frame);
  }, []);
  const resumeTimer = useCallback(() => {
    const root = revealRef.current;
    if (!timer.current.paused || !root || root.matches(":hover") || root.contains(document.activeElement)) return;
    startTimer();
  }, [startTimer]);

  const playReveal = useCallback(() => {
    timer.current = { left: REVEAL_MS, start: 0, paused: false, frame: 0 };
    setLeaving(false);
    setView("reveal");
    // Showing the card is the "seen" moment: the ping clears now, the New tags stay for this visit.
    markSeen();
    if (latest) setAnnounce(`New update: ${latest.title}.`);
  }, [markSeen, latest]);

  useEffect(() => {
    if (view !== "reveal") return;
    startTimer();
    const frame = timer.current;
    return () => cancelAnimationFrame(frame.frame);
  }, [view, startTimer]);

  /** Auto-open the reveal for a new release, unless this page or a dialog must not be interrupted. */
  useEffect(() => {
    if (!latest || !unseen || revealed.current || view !== "dock") return;
    const id = window.setInterval(() => {
      if (isQuietPath(pathname) || modalIsOpen() || document.hidden) return;
      window.clearInterval(id);
      revealed.current = true;
      playReveal();
    }, REVEAL_POLL_MS);
    return () => window.clearInterval(id);
  }, [latest, unseen, view, pathname, playReveal]);

  /** Fly the card into the chip, then the chip gives one small pulse. */
  const dismissReveal = useCallback(() => {
    if (view !== "reveal" || leaving) return;
    cancelAnimationFrame(timer.current.frame);
    const card = cardRef.current;
    const launcher = launcherRef.current;
    if (card && launcher) {
      const c = card.getBoundingClientRect();
      const l = launcher.getBoundingClientRect();
      card.style.setProperty("--dx", `${l.left + l.width / 2 - c.right}px`);
      card.style.setProperty("--dy", `${l.top + l.height / 2 - c.bottom}px`);
    }
    if (revealRef.current?.contains(document.activeElement)) launcher?.focus({ preventScroll: true });
    setLeaving(true);
    window.setTimeout(() => {
      setView("dock");
      setLeaving(false);
      setLanding(true);
    }, reducedMotion() ? 120 : LEAVE_MS);
  }, [view, leaving]);

  useEffect(() => {
    dismissRef.current = dismissReveal;
  }, [dismissReveal]);

  // Walking into a duel or a draft room while the card shows: put it away.
  useEffect(() => {
    if (view === "reveal" && isQuietPath(pathname)) dismissReveal();
  }, [pathname, view, dismissReveal]);

  /* ---- Opening and closing the panels ---- */
  const openCompact = useCallback(() => {
    setView("compact");
    markSeen();
  }, [markSeen]);
  const openExpanded = useCallback((goto?: string) => {
    pendingGoto.current = goto ?? null;
    setView("expanded");
    markSeen();
  }, [markSeen]);
  const closeToDock = useCallback((focusLauncher = false) => {
    setView("dock");
    if (focusLauncher) launcherRef.current?.focus({ preventScroll: true });
  }, []);

  const onLauncher = () => {
    if (view === "compact" || view === "expanded") closeToDock();
    else openCompact();
  };

  const compact = usePresence(view === "compact");
  const expanded = usePresence(view === "expanded");

  useEffect(() => {
    if (view === "compact") readRef.current?.focus({ preventScroll: true });
  }, [view]);

  const scrollToRelease = useCallback((version: string, smooth: boolean) => {
    const body = bodyRef.current;
    const target = body?.querySelector<HTMLElement>(`[data-rel="${CSS.escape(version)}"]`);
    if (!body || !target) return;
    if (target instanceof HTMLDetailsElement) target.open = true;
    const tabs = body.querySelector<HTMLElement>("[data-vtabs]")?.offsetHeight ?? 0;
    const top = version === releases[0]?.version ? 0 : body.scrollTop + target.getBoundingClientRect().top - body.getBoundingClientRect().top - tabs;
    body.scrollTo({ top, behavior: smooth && !reducedMotion() ? "smooth" : "auto" });
    setActiveVersion(version);
  }, [releases]);

  const expandedMounted = expanded.mounted;
  useEffect(() => {
    if (!expandedMounted || view !== "expanded") return;
    shrinkRef.current?.focus({ preventScroll: true });
    const goto = pendingGoto.current;
    pendingGoto.current = null;
    if (goto) scrollToRelease(goto, false);
    else {
      setActiveVersion(releases[0]?.version ?? "");
      if (bodyRef.current) bodyRef.current.scrollTop = 0;
    }
    // Runs when the view opens; later release changes must not scroll it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expandedMounted, view]);

  const onGoto = (version: string) => {
    if (view === "expanded") scrollToRelease(version, true);
    else openExpanded(version);
  };

  const onBodyScroll = () => {
    const body = bodyRef.current;
    if (!body) return;
    const tabs = body.querySelector<HTMLElement>("[data-vtabs]")?.offsetHeight ?? 0;
    const line = body.getBoundingClientRect().top + tabs + 12;
    let current = releases[0]?.version ?? "";
    for (const r of releases) {
      const el = body.querySelector<HTMLElement>(`[data-rel="${CSS.escape(r.version)}"]`);
      if (el && el.getBoundingClientRect().top <= line) current = r.version;
    }
    setActiveVersion((prev) => (prev === current ? prev : current));
  };

  // Escape: expanded goes back to the summary, anything else to the chip. A modal dialog keeps its own Escape.
  useEffect(() => {
    if (view === "dock") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || modalIsOpen()) return;
      if (view === "expanded") setView("compact");
      else if (view === "compact") closeToDock(true);
      else dismissReveal();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [view, closeToDock, dismissReveal]);

  // The summary is a light popover: a press anywhere else on the page closes it. The expanded view stays until minimized.
  useEffect(() => {
    if (view !== "compact") return;
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (compactRef.current?.contains(target) || launcherRef.current?.contains(target)) return;
      closeToDock();
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [view, closeToDock]);

  const dockStyle = useMemo<CSSProperties>(
    () => ({ transform: lift > 0 ? `translateY(-${lift}px)` : undefined }),
    [lift],
  );
  const older = releases.slice(1);

  return (
    <>
      <div className={`${className} ${styles.dock}`} style={dockStyle}>
        {latest ? (
          <button
            ref={launcherRef}
            type="button"
            className={`${styles.launcher} ${landing ? styles.land : ""}`}
            aria-haspopup="dialog"
            aria-expanded={view === "compact" || view === "expanded"}
            aria-label={unseen ? `Updates, new: ${latest.title}` : `Updates, ${latest.title}`}
            data-unseen={unseen}
            data-updates-launcher
            onClick={onLauncher}
            onAnimationEnd={(e) => {
              if (e.target === e.currentTarget && e.pseudoElement === "") setLanding(false);
            }}
          >
            <span className={styles.ico}><ScrollText aria-hidden="true" /><span className={styles.ping} aria-hidden="true" /></span>
            <span className={styles.lbl}>Updates</span>
            <span className={`${styles.ver} ${styles.lbl}`}>v{latest.version}</span>
          </button>
        ) : null}
        {children}
      </div>

      {latest && view === "reveal" ? (
        <div style={{ "--upd-lift": `${lift}px` } as CSSProperties} onPointerEnter={pauseTimer} onPointerLeave={resumeTimer} onFocus={pauseTimer} onBlur={() => window.setTimeout(resumeTimer, 0)}>
          <RevealCard ref={revealRef} release={latest} leaving={leaving} onRead={() => openExpanded()} onLater={dismissReveal} barRef={barRef} cardRef={cardRef} />
        </div>
      ) : null}

      {latest && compact.mounted ? (
        <CompactPanel
          ref={compactRef}
          release={latest}
          older={older}
          isNew={latest.version === newVersion}
          closing={compact.closing}
          lift={lift}
          readRef={readRef}
          onExpand={() => openExpanded()}
          onMinimize={() => closeToDock(true)}
          onGoto={onGoto}
        />
      ) : null}

      {releases.length > 0 && expanded.mounted ? (
        <ExpandedPanel
          releases={releases}
          newVersion={newVersion}
          activeVersion={activeVersion}
          closing={expanded.closing}
          lift={lift}
          shrinkRef={shrinkRef}
          bodyRef={bodyRef}
          onShrink={openCompact}
          onMinimize={() => closeToDock(true)}
          onGoto={onGoto}
          onScroll={onBodyScroll}
        />
      ) : null}

      <div className={styles.srOnly} aria-live="polite">{announce}</div>
    </>
  );
}

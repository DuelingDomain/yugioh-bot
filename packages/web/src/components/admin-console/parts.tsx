"use client";

import { useEffect, useState, type ReactNode } from "react";
import { duration } from "@/lib/admin-console/format";
import styles from "./admin-console.module.css";

/* ---------- icons (stroke icons from the concept) ---------- */
const PATHS = {
  overview: <><rect x="3.5" y="3.5" width="7" height="9" rx="1.6" /><rect x="13.5" y="3.5" width="7" height="5" rx="1.6" /><rect x="13.5" y="11.5" width="7" height="9" rx="1.6" /><rect x="3.5" y="15.5" width="7" height="5" rx="1.6" /></>,
  people: <><circle cx="9" cy="8.5" r="3.5" /><path d="M2.8 19.5c.8-3.3 3.3-5 6.2-5s5.4 1.7 6.2 5" /><path d="M15.5 5.3a3.4 3.4 0 0 1 0 6.4" /><path d="M17.8 14.8c1.8.6 3 2.2 3.5 4.7" /></>,
  duels: <><rect x="3.2" y="5.5" width="9.5" height="13.5" rx="1.6" transform="rotate(-9 8 12)" /><rect x="11.3" y="4.8" width="9.5" height="13.5" rx="1.6" transform="rotate(9 16 11.5)" /></>,
  waitlist: <><path d="M3.5 13.5 6 5.8A2 2 0 0 1 7.9 4.5h8.2A2 2 0 0 1 18 5.8l2.5 7.7V18a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2z" /><path d="M3.5 13.5h4.8l1.4 2.5h4.6l1.4-2.5h4.8" /></>,
  health: <path d="M2.5 12.5h4.2l2.4-6 4.4 12 2.6-6h5.4" />,
  insights: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M21 20H3" /></>,
  eye: <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" /><circle cx="12" cy="12" r="3" /></>,
  chev: <path d="m9 6 6 6-6 6" />,
  search: <><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></>,
  x: <path d="M6 6l12 12M18 6 6 18" />,
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  deck: <><rect x="5" y="3.5" width="12" height="16" rx="1.6" /><path d="M8 20.5h10.5a1.5 1.5 0 0 0 1.5-1.5V7" /></>,
  draft: <path d="M4 7.5h16M4 12h16M4 16.5h10" />,
  ext: <><path d="M14 4.5h5.5V10" /><path d="M19.5 4.5 11 13" /><path d="M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" /></>,
  play: <path d="M7 5.5v13l11-6.5z" />,
  back: <path d="m15 6-6 6 6 6" />,
  creators: <><rect x="3" y="4.5" width="18" height="13" rx="2.2" /><path d="m10.3 8.4 4.6 2.6-4.6 2.6z" /><path d="M8.5 20.5h7" /></>,
  link: <><path d="M10.2 13.8a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1.1 1.1" /><path d="M13.8 10.2a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1.1-1.1" /></>,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2" /><path d="M15.5 8.5V6A1.5 1.5 0 0 0 14 4.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
} as const;
export type IconName = keyof typeof PATHS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return <svg className={className ?? styles.ic} viewBox="0 0 24 24" aria-hidden="true" focusable="false">{PATHS[name]}</svg>;
}

export type Tone = "good" | "warn" | "crit" | "info" | "quiet";
/** Filled status shapes: circle-check, triangle, octagon, circle-i. Shape and color both carry the meaning. */
export function StatusIcon({ tone, className }: { tone: Tone; className?: string }) {
  const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.7, strokeLinecap: "round" as const };
  const body = { fill: "currentColor", fillOpacity: .14, stroke: "currentColor", strokeWidth: 1.5, strokeLinejoin: "round" as const };
  return (
    <svg className={`${styles.st} ${className ?? ""}`} data-tone={tone} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      {tone === "warn" ? <><path d="M10 2.6 18.2 17H1.8z" {...body} /><path d="M10 8v4" {...stroke} /><circle cx="10" cy="14.4" r="1" fill="currentColor" /></>
        : tone === "crit" ? <><path d="M6.7 2.2h6.6l4.5 4.5v6.6l-4.5 4.5H6.7l-4.5-4.5V6.7z" {...body} /><path d="M10 6.2v4.6" {...stroke} /><circle cx="10" cy="13.6" r="1" fill="currentColor" /></>
        : tone === "info" || tone === "quiet" ? <><circle cx="10" cy="10" r="8" {...body} /><path d="M10 9v5" {...stroke} /><circle cx="10" cy="6.3" r="1" fill="currentColor" /></>
        : <><circle cx="10" cy="10" r="8" {...body} /><path d="m6.5 10.2 2.4 2.4 4.6-4.9" {...stroke} strokeLinejoin="round" /></>}
    </svg>
  );
}

/* ---------- avatar ---------- */
function hue(name: string): number { let h = 7; for (const c of name) h = (h * 31 + c.charCodeAt(0)) % 360; return h; }
export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(" ").filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : parts[0].slice(0, 2)).toUpperCase();
}

export function Avatar({ name, url, size, online, bot }: { name: string; url?: string | null; size?: "sm" | "lg"; online?: boolean; bot?: boolean }) {
  const [broken, setBroken] = useState(false);
  const cls = [styles.av, size === "sm" ? styles.avSm : size === "lg" ? styles.avLg : "", online ? styles.avOn : "", bot ? styles.avBot : ""].join(" ");
  if (bot) return <span className={cls} aria-hidden="true">B</span>;
  return (
    <span className={cls} style={{ ["--h" as string]: hue(name) }} aria-hidden="true">
      {url && !broken ? <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

/* ---------- time ---------- */
const tickers = new Set<() => void>();
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** One shared 1-second clock for every "online 25m" label on the page. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tickers.add(tick);
    tickTimer ??= setInterval(() => tickers.forEach((t) => t()), 1000);
    return () => {
      tickers.delete(tick);
      if (tickers.size === 0 && tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    };
  }, []);
  return now;
}

/** "25m", "1h 04m", with an optional suffix (" ago"). Ticks every second. */
export function Since({ at, suffix = "" }: { at: number | null | undefined; suffix?: string }) {
  const now = useNow();
  if (at === null || at === undefined) return <>-</>;
  return <>{duration(now - at)}{suffix}</>;
}

/* ---------- small pieces ---------- */
export function Tag({ children, tone }: { children: ReactNode; tone?: "gold" | "crit" | "warn" }) {
  return <span className={styles.tag} data-tone={tone}>{children}</span>;
}

export function SectionHead({ title, n, aside, flush }: { title: string; n?: ReactNode; aside?: ReactNode; flush?: boolean }) {
  return (
    <div className={`${styles.secH} ${flush ? styles.flush : ""}`}>
      <h2>{title}{n !== undefined ? <span className={styles.n}>{n}</span> : null}</h2>
      {aside}
    </div>
  );
}

/** A section that is not set up or did not answer. One line, never a stack or key. */
export function Notice({ tone = "info", title, children }: { tone?: Tone; title: string; children?: ReactNode }) {
  return (
    <div className={styles.notice} role="status">
      <StatusIcon tone={tone} />
      <div><b>{title}</b>{children}</div>
    </div>
  );
}

export function WatchLink({ href, label = "Watch", primary, icon = "eye", title }: { href: string; label?: string; primary?: boolean; icon?: IconName; title?: string }) {
  return (
    <a className={`${styles.btn} ${styles.btnSm} ${primary ? styles.btnPrimary : ""}`} href={href} target="_blank" rel="noopener" title={title}>
      <Icon name={icon} />{label}
    </a>
  );
}

"use client";

import { count } from "@/lib/admin-console/format";
import { SECTION_BY_ID } from "@/lib/admin-console/sections";
import type { SectionId } from "@/lib/admin-console/types";
import { useAdminSection } from "./use-admin-section";
import { scrollToSection } from "./scroll";
import styles from "./admin-console.module.css";

type Tone = "gold" | "warn" | "quiet" | undefined;

function Figure({ id, label, value, tone }: { id: SectionId; label: string; value: number | string | null; tone: Tone }) {
  return (
    <li>
      <a className={styles.figureLink} href={`#${id}`} data-tone={value === null ? "quiet" : tone} onClick={(e) => { e.preventDefault(); scrollToSection(id); }}
        aria-label={`${label}: ${value === null ? "not available" : value}. Go to ${SECTION_BY_ID[id].title}`}>
        <span className={styles.figure}>{typeof value === "string" ? value : count(value)}</span>
        <span className={styles.figureLabel}>{label}</span>
      </a>
    </li>
  );
}

/** Six key figures, each a link to its section. A section that is not "ok" shows "-". */
export function SummaryStrip() {
  const online = useAdminSection("online");
  const live = useAdminSection("live");
  const waitlist = useAdminSection("waitlist");
  const errors = useAdminSection("errors");
  const stats = useAdminSection("stats");
  const system = useAdminSection("system");
  const pending = waitlist.result?.state === "ok" ? waitlist.result.data.pending : null;
  const errs = errors.result?.state === "ok" ? errors.result.data.last24h : null;
  // System: "OK" when nothing is down or stale and disk is fine, otherwise the number of problems.
  const problems = system.result?.state === "ok" ? system.result.data.problems ?? null : null;
  return (
    <ul className={styles.strip} aria-label="Key numbers">
      <Figure id="online" label="Online now" value={online.result?.state === "ok" ? online.result.data.count : null} tone={undefined} />
      <Figure id="live" label="Live duels" value={live.result?.state === "ok" ? live.result.data.duels.filter((d) => d.status === "active").length : null} tone={undefined} />
      <Figure id="waitlist" label="Pending waitlist" value={pending} tone={pending ? "gold" : undefined} />
      <Figure id="errors" label="Errors, last 24 h" value={errs} tone={errs ? "warn" : undefined} />
      <Figure id="stats" label="Sign-ups today (UTC)" value={stats.result?.state === "ok" ? stats.result.data.today.signups : null} tone={undefined} />
      <Figure id="system" label={problems === 1 ? "System problem" : problems === null || problems === 0 ? "System" : "System problems"}
        value={problems === null ? null : problems === 0 ? "OK" : problems} tone={problems ? "warn" : undefined} />
    </ul>
  );
}

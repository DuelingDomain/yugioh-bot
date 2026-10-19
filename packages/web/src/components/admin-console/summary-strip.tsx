"use client";

import { count } from "@/lib/admin-console/format";
import { SECTION_BY_ID } from "@/lib/admin-console/sections";
import type { SectionId } from "@/lib/admin-console/types";
import { useAdminSection } from "./use-admin-section";
import { scrollToSection } from "./scroll";
import styles from "./admin-console.module.css";

type Tone = "gold" | "warn" | "quiet" | undefined;

function Figure({ id, label, value, tone }: { id: SectionId; label: string; value: number | null; tone: Tone }) {
  return (
    <li>
      <a className={styles.figureLink} href={`#${id}`} data-tone={value === null ? "quiet" : tone} onClick={(e) => { e.preventDefault(); scrollToSection(id); }}
        aria-label={`${label}: ${value === null ? "not available" : value}. Go to ${SECTION_BY_ID[id].title}`}>
        <span className={styles.figure}>{count(value)}</span>
        <span className={styles.figureLabel}>{label}</span>
      </a>
    </li>
  );
}

/** Five key numbers, each a link to its section. A section that is not "ok" shows "-". */
export function SummaryStrip() {
  const online = useAdminSection("online");
  const live = useAdminSection("live");
  const waitlist = useAdminSection("waitlist");
  const errors = useAdminSection("errors");
  const stats = useAdminSection("stats");
  const pending = waitlist.result?.state === "ok" ? waitlist.result.data.pending : null;
  const errs = errors.result?.state === "ok" ? errors.result.data.last24h : null;
  return (
    <ul className={styles.strip} aria-label="Key numbers">
      <Figure id="online" label="Online now" value={online.result?.state === "ok" ? online.result.data.count : null} tone={undefined} />
      <Figure id="live" label="Live duels" value={live.result?.state === "ok" ? live.result.data.duels.filter((d) => d.status === "active").length : null} tone={undefined} />
      <Figure id="waitlist" label="Pending waitlist" value={pending} tone={pending ? "gold" : undefined} />
      <Figure id="errors" label="Errors, last 24 h" value={errs} tone={errs ? "warn" : undefined} />
      <Figure id="stats" label="Sign-ups today (UTC)" value={stats.result?.state === "ok" ? stats.result.data.today.signups : null} tone={undefined} />
    </ul>
  );
}

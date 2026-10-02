import { Fragment } from "react";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import sheet from "@/components/sheet/sheet.module.css";
import { formatWhen } from "../sheet-dates";
import { formatLabel, rulesSummary } from "../sheet-rules";
import type { TournamentDetail } from "../types";
import { statusPresentation, type TournamentProgress } from "./sheet-model";
import styles from "./tournament-sheet.module.css";

export function SheetHeader({ tournament, progress }: { tournament: TournamentDetail; progress: TournamentProgress }) {
  const status = statusPresentation(tournament.status);
  const rules = rulesSummary(tournament);
  const started = formatWhen(tournament.startedAt);
  const deadline = formatWhen(tournament.deadlineAt);
  const metadata = [
    formatLabel(tournament.format),
    ...(rules ? [`Best of ${rules.bestOf}`] : []),
    `${tournament.participants.length} players`,
    ...(started ? [`Started ${started}`] : []),
    ...(progress.currentRound !== null ? [`Round ${progress.currentRound} of ${progress.totalRounds}`] : []),
  ];
  const segments = [
    { id: "decided", count: progress.done, className: "d", label: null },
    { id: "live", count: progress.live, className: "l", label: "live" },
    { id: "to-confirm", count: progress.toConfirm, className: "w", label: "to confirm" },
    { id: "yours", count: progress.yours, className: "y", label: "yours" },
    { id: "not-started", count: progress.notStarted, className: "open", label: "not started" },
  ].filter((segment) => segment.count > 0);

  return <>
    <Link href="/tournaments" className={styles.crumb}><ChevronLeft className={`${styles.ic} ${styles.sm}`} aria-hidden="true" />All tournaments</Link>
    <header className={styles["t-head"]}>
      <div>
        <h1 className={sheet.title}>{tournament.name}</h1>
        <p className={styles["t-meta"]}>
          <span className={styles.status}><span className={sheet.lamp} data-s={status.lamp} aria-hidden="true" />{status.label}</span>
          {metadata.map((value) => <Fragment key={value}><span className={styles.dot} aria-hidden="true" /><span>{value}</span></Fragment>)}
        </p>
      </div>
      <div className={styles.prog} role="group" aria-label={`${progress.done} of ${progress.total} matches done`}>
        <div className={styles["prog-top"]}>
          <span className={styles.sr}>{progress.done}/{progress.total} matches done</span>
          <span className={styles["prog-n"]} aria-hidden="true">{progress.done}<span>/{progress.total}</span></span>
          <span className={styles["prog-l"]}><span aria-hidden="true">matches done</span>{deadline && <><br />deadline {deadline}</>}</span>
        </div>
        <div className={styles["prog-bar"]} aria-hidden="true">
          {segments.map((segment) => <i key={segment.id} data-segment={segment.id} className={styles[segment.className]} style={{ flex: segment.count }} />)}
        </div>
        <div className={styles["prog-key"]}>
          {segments.filter((segment) => segment.label).map((segment) => <span key={segment.id}><i className={styles[segment.className]} aria-hidden="true" />{segment.count} {segment.label}</span>)}
        </div>
      </div>
    </header>
  </>;
}

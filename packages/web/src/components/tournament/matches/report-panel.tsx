"use client";

import type { MatchProjection } from "@yugidraft/shared/scoring";
import { MatchButton } from "./match-controls";
import styles from "./matches.module.css";

export function ReportPanel({ projection, opponentName, confirmWindowHours, loading, onReport }: {
  projection: MatchProjection; opponentName: string; confirmWindowHours: number; loading: boolean; onReport: (result: "win" | "loss") => void;
}) {
  return (
    <div className={styles.report}>
      <p className={styles.reportText}>How did it go? {opponentName} confirms within {confirmWindowHours} hours, or it approves itself.</p>
      <div className={styles.reportActs}>
        <MatchButton variant="primary" disabled={loading} onClick={() => onReport("win")}>I won <span className={styles.up}>+{projection.winRating}</span></MatchButton>
        <MatchButton disabled={loading} onClick={() => onReport("loss")}>I lost <span className={styles.dn}>−{Math.abs(projection.loseRating)}</span></MatchButton>
      </div>
    </div>
  );
}

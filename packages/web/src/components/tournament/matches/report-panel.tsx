"use client";

import sheet from "@/components/sheet/sheet.module.css";
import type { MatchProjection } from "@yugidraft/shared/scoring";
import { MatchButton } from "./match-controls";
import styles from "./matches.module.css";

export function ReportPanel({ projection, opponentName, confirmWindowHours, loading, onReport }: {
  projection: MatchProjection; opponentName: string; confirmWindowHours: number; loading: boolean; onReport: (result: "win" | "loss") => void;
}) {
  return <div className={styles.report}>
    <p>How did it go? A win also earns <b className={styles["report-number"]}>{projection.winWinnings}</b> winnings. {opponentName} confirms within {confirmWindowHours} hours, or it approves itself.</p>
    <div className={`${sheet.acts} ${styles["report-acts"]} ${styles.controls}`}>
      <MatchButton disabled={loading} onClick={() => onReport("win")}>I won <small className={styles.up}>+{projection.winRating}</small></MatchButton>
      <MatchButton disabled={loading} onClick={() => onReport("loss")}>I lost <small className={styles.down}>−{Math.abs(projection.loseRating)}</small></MatchButton>
    </div>
  </div>;
}

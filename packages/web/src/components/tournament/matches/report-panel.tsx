"use client";

import type { MatchProjection } from "@yugidraft/shared/scoring";
import { MatchButton } from "./match-controls";
import styles from "./matches.module.css";

export function ReportPanel({ projection, opponentName, confirmWindowHours, loading, onReport }: {
  projection: MatchProjection; opponentName: string; confirmWindowHours: number; loading: boolean; onReport: (result: "win" | "loss") => void;
}) {
  return (
    <div className="report">
      <p>How did it go? A win also earns <b className={styles.number}>{projection.winWinnings}</b> winnings. {opponentName} confirms within {confirmWindowHours} hours, or it approves itself.</p>
      <div className="acts">
        <MatchButton disabled={loading} onClick={() => onReport("win")}>I won <span className="lp-d up">+{projection.winRating}</span></MatchButton>
        <MatchButton disabled={loading} onClick={() => onReport("loss")}>I lost <span className="lp-d down">−{Math.abs(projection.loseRating)}</span></MatchButton>
      </div>
    </div>
  );
}

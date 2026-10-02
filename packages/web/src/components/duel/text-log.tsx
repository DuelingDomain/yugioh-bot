"use client";

import { useEffect, useRef } from "react";
import { phaseTitle } from "./constants";
import styles from "./room.module.css";

/** The engine log of the match sheet: how a line reads, and the list itself. The 1v1 room and the table shell share it. */

const LOG_PHASE_KEYS: ReadonlySet<string> = new Set([
  "draw", "standby", "main1", "battle_start", "battle_step", "damage", "damage_cal", "battle", "main2", "end",
]);

export type LogKind = "turn" | "phase" | "loss" | "gain" | "chain" | "result" | "line";

export function logKind(text: string): LogKind {
  if (/^Turn \d+/.test(text)) return "turn";
  if (LOG_PHASE_KEYS.has(text)) return "phase";
  if (/ wins \(|^Draw \(/.test(text)) return "result";
  if (/ takes \d+ damage| pays \d+ LP/.test(text)) return "loss";
  if (/ gains \d+ LP/.test(text)) return "gain";
  if (/ is activating$|^A chain link was negated$|^Chain ended$/.test(text)) return "chain";
  return "line";
}

/** The engine log names seats "Player N"; show the table's display names instead (a table has up to four seats). */
export function logText(text: string, kind: LogKind, playerName: (seat: number) => string): string {
  if (kind === "phase") return phaseTitle(text);
  return text.replace(/\bPlayer ([1-4])\b/g, (_match, seat: string) => playerName(Number(seat) - 1));
}

export function MatchSheetLog({
  entries,
  playerName,
  players,
}: {
  entries: ReadonlyArray<{ id: number; text: string }>;
  playerName: (seat: number) => string;
  players: string;
}) {
  const listRef = useRef<HTMLOListElement>(null);
  const count = entries.length;
  // Follow the newest entry id: the engine caps the log at 400 lines, so the length stops changing.
  const lastId = entries[count - 1]?.id;
  useEffect(() => {
    // Scroll only the sheet's own list; scrollIntoView would also scroll the side pane
    // and push the history rail above it out of view.
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [lastId, count]);
  return (
    <div className={styles.sheet}>
      <div className={styles.sheetHead}>
        <h2>Match sheet</h2>
        <span>{players}</span>
      </div>
      <ol ref={listRef} className={styles.log} aria-label="Duel log">
        {entries.map((entry) => {
          const kind = logKind(entry.text);
          return (
            <li key={entry.id} data-kind={kind}>
              {logText(entry.text, kind, playerName)}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

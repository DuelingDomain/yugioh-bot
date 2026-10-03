// One line of the Text log, shared by the live room's match sheet and the replay, so both colour and label
// lines the same way. The line sits inside an <ol className={styles.log}> from room.module.css.
import { useEffect, useMemo, useRef, type Ref } from "react";
import { phaseLabel } from "./constants";
import { categoriesForLog, categoryForLogText, summonMethodForLogText, type LogCategory } from "./log-category";
import { LogCategoryGlyph } from "./log-category-glyph";
import styles from "./room.module.css";

export function phaseTitle(phase: string | null | undefined): string {
  const label = phaseLabel(phase);
  switch (label) {
    case "Draw":
    case "Standby":
    case "Battle":
    case "End":
      return `${label} Phase`;
    case "Main 1":
      return "Main Phase 1";
    case "Main 2":
      return "Main Phase 2";
    case "Damage":
      return "Damage Step";
    case "Damage calculation":
      return "Damage Calculation";
    default:
      return label;
  }
}

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

/** The engine log names seats "Player N"; show the table's display names instead, and phase keys as titles. */
export function logText(text: string, kind: LogKind, playerName: (seat: number) => string): string {
  if (kind === "phase") return phaseTitle(text);
  return text.replace(/\bPlayer ([12])\b/g, (_match, seat: string) => playerName(Number(seat) - 1));
}

/** The categories of a whole log (see categoriesForLog), recomputed only when the entries change. */
export function useLogCategories(entries: ReadonlyArray<{ text: string }>): Array<LogCategory | null> {
  return useMemo(() => categoriesForLog(entries.map((entry) => entry.text)), [entries]);
}

export function DuelLogLine({
  text,
  category: given,
  playerName,
  className,
  ref,
}: {
  /** The raw engine line, before display names are filled in. */
  text: string;
  /** The line's category in context (useLogCategories); without it the line is classified on its own. */
  category?: LogCategory | null;
  playerName: (seat: number) => string;
  className?: string;
  ref?: Ref<HTMLLIElement>;
}) {
  const kind = logKind(text);
  // Classify the raw line: a display name can never pass for one of the engine's sentence templates.
  const category = given === undefined ? categoryForLogText(text) : given;
  const summon = summonMethodForLogText(text);
  return (
    <li ref={ref} className={className} data-kind={kind} data-cat={category ?? undefined} data-summon={summon ?? undefined}>
      {category ? <LogCategoryGlyph category={category} className={styles.logGlyph} /> : null}
      {logText(text, kind, playerName)}
    </li>
  );
}

/** The live room's Text log (the match sheet). It follows the newest line. */
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
  const categories = useLogCategories(entries);
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
        {entries.map((entry, i) => (
          <DuelLogLine key={entry.id} text={entry.text} category={categories[i]} playerName={playerName} />
        ))}
      </ol>
    </div>
  );
}

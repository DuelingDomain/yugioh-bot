// The replay's battle log: the live match history (history-model.ts, history-entries.ts) run over the whole replay,
// one frame at a time. Every row remembers the first frame where it appeared, so a click can seek there and the
// log can follow the playhead. The frames of a replay are already cut to what the viewer may see, and the history
// model hides more on top (an opponent's Set card), so nothing here can show a card the viewer must not see.
import { buildHistoryView, type HistoryEntry, type HistoryPhaseRow, type HistoryViewOptions } from "./history-entries";
import { emptyHistory, ingestHistory } from "./history-model";
import { contextFor } from "./history-rail";
import type { ReplayTimeline } from "./replay-timeline";

export type ReplayLogRow =
  | { type: "entry"; entry: HistoryEntry; frame: number }
  | { type: "phase"; phase: HistoryPhaseRow; frame: number };

export interface ReplayLogGroup {
  key: string;
  /** "Turn 3 · You" */
  label: string;
  /** First frame of the group. */
  frame: number;
  /** Oldest row first. */
  rows: ReplayLogRow[];
}

export interface ReplayBattleLog {
  /** Oldest turn first. */
  groups: ReplayLogGroup[];
  /** Every entry (not phase rows) in order, for finding the one the playhead is on. */
  entries: Array<{ key: number; frame: number }>;
}

/**
 * The battle log of a whole replay: no cap on rows (the live rail keeps 400), and each frame adds only its own events.
 * Build it once per timeline and view options, not per step.
 */
export function buildReplayBattleLog(timeline: ReplayTimeline, options: HistoryViewOptions): ReplayBattleLog {
  let state = emptyHistory();
  const firstFrame = new Map<string, number>();
  let seen = 0;
  for (let frame = 0; frame < timeline.length; frame += 1) {
    const view = timeline.deltaViewAt(frame);
    state = ingestHistory(state, view.events, contextFor(view), { maxItems: Infinity });
    // Rows are only added at the end (a turn's draws move behind their header, a few places back).
    for (let i = Math.max(0, seen - 16); i < state.items.length; i += 1) {
      const item = state.items[i];
      const id = `${item.type === "tile" ? "e" : "p"}${item.key}`;
      if (!firstFrame.has(id)) firstFrame.set(id, frame);
    }
    seen = state.items.length;
  }
  const view = buildHistoryView(state.items, options);
  const entries: ReplayBattleLog["entries"] = [];
  const groups: ReplayLogGroup[] = view.groups.slice().reverse().map((group) => {
    const rows: ReplayLogRow[] = group.rows.slice().reverse().map((row) => {
      if (row.type === "phase") return { type: "phase", phase: row, frame: firstFrame.get(`p${row.key}`) ?? 0 };
      const frame = firstFrame.get(`e${row.key}`) ?? 0;
      return { type: "entry", entry: row, frame };
    });
    // Oldest first by the frame a row appeared, so "everything up to this frame" is a prefix of the group.
    rows.sort((a, b) => a.frame - b.frame);
    for (const row of rows) if (row.type === "entry") entries.push({ key: row.entry.key, frame: row.frame });
    return { key: group.key, label: group.label, frame: rows[0]?.frame ?? 0, rows };
  });
  return { groups, entries };
}

/** The key of the newest entry that has happened by this frame, or null before the first one. */
export function playheadKey(log: ReplayBattleLog, frame: number): number | null {
  for (let i = log.entries.length - 1; i >= 0; i -= 1) {
    if (log.entries[i].frame <= frame) return log.entries[i].key;
  }
  return null;
}

/** How many rows of a group have happened by this frame (the rows are in frame order). */
export function visibleRowCount(group: ReplayLogGroup, frame: number): number {
  let low = 0;
  let high = group.rows.length;
  while (low < high) {
    const mid = (low + high) >> 1;
    if (group.rows[mid].frame <= frame) low = mid + 1;
    else high = mid;
  }
  return low;
}

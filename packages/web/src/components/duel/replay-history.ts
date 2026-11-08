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
 * The battle log of a whole replay. Cost grows with frames × rows (a few hundred each), so build it once per
 * timeline and view options, not per step.
 */
export function buildReplayBattleLog(timeline: ReplayTimeline, options: HistoryViewOptions): ReplayBattleLog {
  let state = emptyHistory();
  const firstFrame = new Map<string, number>();
  for (let frame = 0; frame < timeline.length; frame += 1) {
    const view = timeline.viewAt(frame);
    state = ingestHistory(state, view.events, contextFor(view));
    for (const item of state.items) {
      const id = `${item.type === "tile" ? "e" : "p"}${item.key}`;
      if (!firstFrame.has(id)) firstFrame.set(id, frame);
    }
  }
  const view = buildHistoryView(state.items, options);
  const entries: ReplayBattleLog["entries"] = [];
  const groups: ReplayLogGroup[] = view.groups.slice().reverse().map((group) => {
    const rows: ReplayLogRow[] = group.rows.slice().reverse().map((row) => {
      if (row.type === "phase") return { type: "phase", phase: row, frame: firstFrame.get(`p${row.key}`) ?? 0 };
      const frame = firstFrame.get(`e${row.key}`) ?? 0;
      entries.push({ key: row.key, frame });
      return { type: "entry", entry: row, frame };
    });
    return { key: group.key, label: group.label, frame: rows[0]?.frame ?? 0, rows };
  });
  return { groups, entries };
}

/** The key of the newest entry that has happened by this frame, or null before the first one. */
export function playheadKey(log: ReplayBattleLog, frame: number): number | null {
  let key: number | null = null;
  for (const entry of log.entries) {
    if (entry.frame <= frame) key = entry.key;
  }
  return key;
}

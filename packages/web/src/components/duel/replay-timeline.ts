import type { DuelEngineView, DuelReplayFrame } from "@yugidraft/shared/duels";

/** The engine keeps at most this many log lines and events per view. */
export const REPLAY_HISTORY_CAP = 400;

export type ReplayLogEntry = DuelEngineView["log"][number];

export interface ReplayTimeline {
  length: number;
  frame(index: number): DuelReplayFrame;
  /** Full board at a frame; log and events are cumulative, capped at the last 400. */
  viewAt(index: number): DuelEngineView;
  /** Log lines that first appear at this frame. */
  newLogAt(index: number): ReplayLogEntry[];
}

/**
 * Frames carry only the log and events added since the previous frame. This
 * flattens them once and records where each frame ends, so any frame's
 * cumulative window is a single slice instead of a repeated concatenation.
 */
export function buildReplayTimeline(frames: readonly DuelReplayFrame[]): ReplayTimeline {
  const log: ReplayLogEntry[] = [];
  const events: DuelEngineView["events"] = [];
  const logEnd: number[] = [];
  const eventEnd: number[] = [];
  for (const frame of frames) {
    for (const entry of frame.view.log) log.push(entry);
    for (const event of frame.view.events) events.push(event);
    logEnd.push(log.length);
    eventEnd.push(events.length);
  }
  const clamp = (index: number) => Math.min(Math.max(Math.trunc(index) || 0, 0), Math.max(frames.length - 1, 0));
  const window = <T,>(items: T[], end: number) => items.slice(Math.max(0, end - REPLAY_HISTORY_CAP), end);

  return {
    length: frames.length,
    frame: (index) => frames[clamp(index)],
    viewAt(index) {
      const i = clamp(index);
      return {
        ...frames[i].view,
        prompt: null,
        log: window(log, logEnd[i]),
        events: window(events, eventEnd[i]),
      };
    },
    newLogAt(index) {
      const i = clamp(index);
      return log.slice(i === 0 ? 0 : logEnd[i - 1], logEnd[i]);
    },
  };
}

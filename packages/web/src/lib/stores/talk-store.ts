import { create } from "zustand";
import { TALK_SHOW_MS, isTalkLine, type TalkLineId } from "@yugidraft/shared/ws/talk";

export interface HeardLine {
  line: TalkLineId;
  /** Grows with each line, so a repeat of the same words still counts as new. */
  seq: number;
}

interface TalkState {
  /** What each seat is saying right now, by player id. */
  heard: Record<number, HeardLine>;
  hear: (playerId: number, line: unknown) => void;
  clear: () => void;
}

const timers = new Map<number, ReturnType<typeof setTimeout>>();
let seq = 0;

/** Table talk heard from the live feed. A line stays up for a few seconds, then goes. */
export const useTalkStore = create<TalkState>((set) => ({
  heard: {},
  hear: (playerId, line) => {
    if (!Number.isInteger(playerId) || !isTalkLine(line)) return;
    const mine = ++seq;
    clearTimeout(timers.get(playerId));
    timers.set(
      playerId,
      setTimeout(() => {
        timers.delete(playerId);
        set((state) => {
          if (state.heard[playerId]?.seq !== mine) return state;
          const { [playerId]: _gone, ...rest } = state.heard;
          return { heard: rest };
        });
      }, TALK_SHOW_MS),
    );
    set((state) => ({ heard: { ...state.heard, [playerId]: { line, seq: mine } } }));
  },
  clear: () => {
    for (const timer of timers.values()) clearTimeout(timer);
    timers.clear();
    set({ heard: {} });
  },
}));

// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { PHASE_TIMING } from "@/components/duel/duel-timing";
import { resetPhaseBeats } from "@/components/duel/phase-beats";
import { useStartBeats } from "@/components/duel/use-start-beats";

const phase = (id: number, text: string): DuelEvent => ({ id, kind: "phase", text }) as DuelEvent;
const draw = (id: number): DuelEvent => ({ id, kind: "move", reason: "draw", text: "draw" }) as unknown as DuelEvent;
const view = (over: Partial<DuelEngineView>): DuelEngineView =>
  ({ revision: 0, turn: 1, phase: "main1", events: [], ...over }) as unknown as DuelEngineView;

beforeEach(() => {
  vi.useFakeTimers();
  resetPhaseBeats("duel");
});
afterEach(() => vi.useRealTimers());

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe("useStartBeats", () => {
  it("replays the opening: holds the player and walks the bar Draw, Standby, Main 1", () => {
    const events = [phase(1, "Draw Phase"), phase(2, "Standby Phase"), phase(3, "Main Phase 1")];
    const { result } = renderHook(() => useStartBeats({ engine: view({ events }), duelKey: "duel", reducedMotion: false, ready: true }), { wrapper: strict });
    expect(result.current.replayFrom).toBe(0);
    expect(result.current.active).toBe(true);
    const seen: Array<string | null | undefined> = [];
    for (let step = 0; step < 40 && result.current.active; step += 1) {
      seen.push(result.current.phase);
      act(() => {
        vi.advanceTimersByTime(100);
      });
    }
    expect(result.current.active).toBe(false);
    expect(result.current.phase).toBeUndefined();
    const order = seen.filter((value, index) => value != null && value !== seen[index - 1]);
    expect(order).toEqual(["draw", "standby", "main1"]);
    // Two beats of one phase plus the lead of the third: about 2 x beat + lead, never an instant skip.
    expect(seen.length * 100).toBeGreaterThanOrEqual(PHASE_TIMING.beatMs * 2);
  });

  it("waits, with the hands hidden, until the card layers are ready, then plays the opening", () => {
    const events = [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")];
    let ready = false;
    const { result, rerender } = renderHook(() => useStartBeats({ engine: view({ events }), duelKey: "duel", reducedMotion: false, ready }));
    expect(result.current.waiting).toBe(true);
    expect(result.current.active).toBe(false);
    ready = true;
    rerender();
    expect(result.current.waiting).toBe(false);
    expect(result.current.active).toBe(true);
  });

  it("does not replay or hold a duel that was joined later", () => {
    const events = [phase(1, "Draw Phase"), phase(2, "Standby Phase"), phase(3, "Main Phase 1")];
    const { result } = renderHook(() => useStartBeats({ engine: view({ revision: 5, turn: 3, events }), duelKey: "duel", reducedMotion: false, ready: true }), { wrapper: strict });
    expect(result.current.replayFrom).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it("holds the player for the Draw and Standby Phase of a later turn", () => {
    const first = [phase(1, "Battle Phase"), phase(2, "End Phase")];
    let engine = view({ revision: 4, turn: 2, events: first });
    const { result, rerender } = renderHook(() => useStartBeats({ engine, duelKey: "duel", reducedMotion: false, ready: true }));
    expect(result.current.active).toBe(false);
    engine = view({ revision: 5, turn: 3, events: [...first, draw(3), phase(4, "Draw Phase"), phase(5, "Standby Phase"), phase(6, "Main Phase 1")] });
    rerender();
    expect(result.current.active).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PHASE_TIMING.capMs);
    });
    expect(result.current.active).toBe(false);
  });
});

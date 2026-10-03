// @vitest-environment jsdom
import { StrictMode, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, renderHook } from "@testing-library/react";
import type { DuelClock, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { PHASE_TIMING } from "@/components/duel/duel-timing";
import { resetPhaseBeats } from "@/components/duel/phase-beats";
import { useStartBeats } from "@/components/duel/use-start-beats";
import { MoveFx } from "@/components/duel/move-fx";
import { resetMoveSchedule } from "@/components/duel/move-plan";
import { DuelFeedback } from "@/components/duel/feedback";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const phase = (id: number, text: string): DuelEvent => ({ id, kind: "phase", text }) as DuelEvent;
const draw = (id: number): DuelEvent => ({ id, kind: "move", reason: "draw", text: "draw" }) as unknown as DuelEvent;
const view = (over: Partial<DuelEngineView>): DuelEngineView =>
  ({ revision: 0, turn: 1, phase: "main1", events: [], ...over }) as unknown as DuelEngineView;

let duelKey: string;
let game = 0;
beforeEach(() => {
  vi.useFakeTimers();
  duelKey = `duel-${game++}`;
  resetPhaseBeats(duelKey);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const strict = ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>;

describe("useStartBeats", () => {
  it("replays the opening: holds the player and walks the bar Draw, Standby, Main 1", () => {
    const events = [phase(1, "Draw Phase"), phase(2, "Standby Phase"), phase(3, "Main Phase 1")];
    const { result } = renderHook(() => useStartBeats({ engine: view({ events }), duelKey, reducedMotion: false, ready: true }), { wrapper: strict });
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
    const { result, rerender } = renderHook(() => useStartBeats({ engine: view({ events }), duelKey, reducedMotion: false, ready }));
    expect(result.current.waiting).toBe(true);
    expect(result.current.active).toBe(false);
    ready = true;
    rerender();
    expect(result.current.waiting).toBe(false);
    expect(result.current.active).toBe(true);
  });

  it("does not replay or hold a duel that was joined later", () => {
    const events = [phase(1, "Draw Phase"), phase(2, "Standby Phase"), phase(3, "Main Phase 1")];
    const { result } = renderHook(() => useStartBeats({ engine: view({ revision: 5, turn: 3, events }), duelKey, reducedMotion: false, ready: true }), { wrapper: strict });
    expect(result.current.replayFrom).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it("skips a late opening when the server grace has already ended", () => {
    const engine = view({ events: [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")] });
    const clock: DuelClock = { turn: 1, remainingMs: [30_000, 30_000], activeSeat: 0, startedAt: 9_000, serverNow: 10_000 };
    const { result } = renderHook(() => useStartBeats({ engine, clock, duelKey, reducedMotion: false, ready: true }));
    expect(result.current.active).toBe(false);
    expect(result.current.replayFrom).toBeNull();
  });

  it("skips the opening if recovery consumed too much of the remaining grace", () => {
    const engine = view({ events: [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")] });
    const clock: DuelClock = { turn: 1, remainingMs: [30_000, 30_000], activeSeat: 0, startedAt: 9_000, serverNow: 1_000 };
    let ready = false;
    const { result, rerender } = renderHook(() => useStartBeats({ engine, clock, duelKey, reducedMotion: false, ready }));
    expect(result.current.waiting).toBe(true);
    act(() => vi.advanceTimersByTime(7_000));
    ready = true;
    rerender();
    expect(result.current.active).toBe(false);
    expect(result.current.replayFrom).toBeNull();
  });

  it("holds the player for the Draw and Standby Phase of a later turn", () => {
    const first = [phase(1, "Battle Phase"), phase(2, "End Phase")];
    let engine = view({ revision: 4, turn: 2, events: first });
    const { result, rerender } = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready: true }));
    expect(result.current.active).toBe(false);
    engine = view({ revision: 5, turn: 3, events: [...first, draw(3), phase(4, "Draw Phase"), phase(5, "Standby Phase"), phase(6, "Main Phase 1")] });
    rerender();
    expect(result.current.active).toBe(true);
    act(() => {
      vi.advanceTimersByTime(PHASE_TIMING.capMs);
    });
    expect(result.current.active).toBe(false);
  });

  it("does not deal again when an opening snapshot recovers after the first interaction", () => {
    const events = [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")];
    let ready = true;
    let engine = view({ events });
    const { result, rerender } = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready }));
    act(() => vi.advanceTimersByTime(PHASE_TIMING.capMs + 1));
    expect(result.current.active).toBe(false);
    ready = false;
    rerender();
    expect(result.current.waiting).toBe(false);
    // No command was accepted: revision is still zero, but the prompt/cards are new objects.
    engine = view({ events: [...events], prompt: { id: "opening-prompt" } as DuelEngineView["prompt"] });
    ready = true;
    rerender();
    expect(result.current.replayFrom).toBeNull();
    expect(result.current.active).toBe(false);
  });

  it("remembers a presented opening across a room remount", () => {
    const engine = view({ events: [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase")] });
    const first = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready: true }));
    act(() => vi.advanceTimersByTime(PHASE_TIMING.capMs + 1));
    first.unmount();
    const second = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready: true }));
    expect(second.result.current.replayFrom).toBeNull();
    expect(second.result.current.active).toBe(false);
  });

  it("consumes an opening that arrives after an empty engine snapshot", () => {
    let engine = view({ events: [] });
    const first = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready: true }));
    engine = view({ events: [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase")] });
    first.rerender();
    expect(first.result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(PHASE_TIMING.capMs + 1));
    first.unmount();
    const second = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready: true }));
    expect(second.result.current.replayFrom).toBeNull();
    expect(second.result.current.active).toBe(false);
  });

  it("publishes the consumed opening cursor even before any phase events arrive", () => {
    const engine = view({ turn: 0, events: [draw(1)] });
    const { result } = renderHook(() => useStartBeats({ engine, duelKey, reducedMotion: false, ready: true }));
    expect(result.current.replayFrom).toBeNull();
    expect(result.current.skipThrough).toBe(1);
  });

  it("plays game 2 once after the between-games screen, even when event ids restart", () => {
    const opening = view({ events: [draw(1), phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")] });
    let engine: DuelEngineView | null = opening;
    let key = `${duelKey}-game1`;
    const { result, rerender } = renderHook(() => useStartBeats({ engine, duelKey: key, reducedMotion: false, ready: true }));
    act(() => vi.advanceTimersByTime(PHASE_TIMING.capMs + 1));
    // The next game has a new duel slug and briefly has no engine in its lobby.
    key = `${duelKey}-game2`;
    engine = null;
    rerender();
    engine = opening;
    rerender();
    expect(result.current.active).toBe(true);
    act(() => vi.advanceTimersByTime(PHASE_TIMING.capMs + 1));
    engine = view({ ...opening, events: [...opening.events] });
    rerender();
    expect(result.current.active).toBe(false);
    expect(result.current.replayFrom).toBeNull();
  });

  it("keeps landed cards visible when the card layer remounts in game 2", async () => {
    resetMoveSchedule(duelKey);
    const rect = { left: 0, top: 0, width: 70, height: 100, right: 70, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const engine = view({ events: [{ ...draw(1), from: { controller: 0, location: 1, sequence: 0 }, zone: { controller: 0, location: 2, sequence: 0 } }, phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")] });
    function Board({ ready }: { ready: boolean }) {
      const beats = useStartBeats({ engine, duelKey, reducedMotion: false, ready });
      return <div>
        <button data-testid="card" data-zones="0:2:0">Hand card</button>
        {ready ? <MoveFx events={engine.events} duelKey={duelKey} reducedMotion={false} replayFrom={beats.replayFrom} skipThrough={beats.skipThrough} /> : null}
      </div>;
    }
    const board = render(<StrictMode><Board ready /></StrictMode>);
    expect(board.container.querySelectorAll('[data-style="draw"]')).toHaveLength(1);
    expect(board.getByTestId("card").style.visibility).toBe("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(PHASE_TIMING.capMs + 1); });
    expect(board.container.querySelectorAll('[data-style="draw"]')).toHaveLength(0);
    expect(board.getByTestId("card").style.visibility).toBe("");
    board.rerender(<StrictMode><Board ready={false} /></StrictMode>);
    board.rerender(<StrictMode><Board ready /></StrictMode>);
    expect(board.container.querySelectorAll('[data-style="draw"]')).toHaveLength(0);
    expect(board.getByTestId("card").style.visibility).toBe("");
  });

  it("keeps a late opening out of an already mounted card layer with an empty history", () => {
    resetMoveSchedule(duelKey);
    const rect = { left: 0, top: 0, width: 70, height: 100, right: 70, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const clock: DuelClock = { turn: 1, remainingMs: [30_000, 30_000], activeSeat: 0, startedAt: 9_000, serverNow: 10_000 };
    function Board({ engine }: { engine: DuelEngineView }) {
      const beats = useStartBeats({ engine, clock, duelKey, reducedMotion: false, ready: true });
      return <div>
        <button data-testid="card" data-zones="0:2:0">Hand card</button>
        <MoveFx events={engine.events} duelKey={duelKey} reducedMotion={false} replayFrom={beats.replayFrom} skipThrough={beats.skipThrough} />
        <DuelFeedback events={engine.events} duelKey={duelKey} reducedMotion={false} soundEnabled={false} replayFrom={beats.replayFrom} skipThrough={beats.skipThrough} />
      </div>;
    }
    const board = render(<Board engine={view({ events: [] })} />);
    board.rerender(<Board engine={view({ events: [{ ...draw(1), from: { controller: 0, location: 1, sequence: 0 }, zone: { controller: 0, location: 2, sequence: 0 } }, phase(2, "Draw Phase")] })} />);
    expect(board.container.querySelectorAll('[data-style="draw"]')).toHaveLength(0);
    expect(board.getByTestId("card").style.visibility).toBe("");
    expect(board.getByRole("status").textContent).toBe("");
  });

  it("presents the opening ribbons once in Strict Mode and keeps them out of an FX remount", async () => {
    resetMoveSchedule(duelKey);
    const rect = { left: 0, top: 0, width: 70, height: 100, right: 70, bottom: 100, x: 0, y: 0, toJSON: () => ({}) };
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
    const engine = view({ events: [{ ...draw(1), from: { controller: 0, location: 1, sequence: 0 }, zone: { controller: 0, location: 2, sequence: 0 } }, phase(2, "Draw Phase"), phase(3, "Standby Phase"), phase(4, "Main Phase 1")] });
    function Board({ ready }: { ready: boolean }) {
      const beats = useStartBeats({ engine, duelKey, reducedMotion: false, ready });
      return <div>
        <button data-testid="card" data-zones="0:2:0">Hand card</button>
        {ready ? <>
          <MoveFx events={engine.events} duelKey={duelKey} reducedMotion={false} replayFrom={beats.replayFrom} skipThrough={beats.skipThrough} />
          <DuelFeedback events={engine.events} duelKey={duelKey} reducedMotion={false} soundEnabled={false} replayFrom={beats.replayFrom} skipThrough={beats.skipThrough} />
        </> : null}
      </div>;
    }
    const board = render(<StrictMode><Board ready /></StrictMode>);
    expect(board.container.querySelectorAll('[data-style="draw"]')).toHaveLength(1);
    const seen: string[] = [];
    for (let i = 0; i < 50; i++) {
      await act(async () => { await vi.advanceTimersByTimeAsync(100); });
      const text = board.getByRole("status").textContent ?? "";
      if (text && text !== seen[seen.length - 1]) seen.push(text);
    }
    expect(seen).toEqual(["Draw Phase", "Standby Phase", "Main Phase 1"]);
    expect(board.getByTestId("card").style.visibility).toBe("");
    board.rerender(<StrictMode><Board ready={false} /></StrictMode>);
    board.rerender(<StrictMode><Board ready /></StrictMode>);
    expect(board.getByRole("status").textContent).toBe("");
    expect(board.container.querySelectorAll('[data-style="draw"]')).toHaveLength(0);
  });
});

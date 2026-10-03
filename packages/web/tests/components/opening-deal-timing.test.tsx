// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { MoveFx } from "@/components/duel/move-fx";
import { DuelFeedback } from "@/components/duel/feedback";
import { useStartBeats } from "@/components/duel/use-start-beats";
import { clearZoneSnapshots, getMovePlan, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { planPhaseBeats, resetPhaseBeats } from "@/components/duel/phase-beats";
import { PHASE_TIMING } from "@/components/duel/duel-timing";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const phase = (id: number, text: string): DuelEvent => ({ id, kind: "phase", text });
const opening: DuelEvent[] = [
  ...Array.from({ length: 10 }, (_, i): DuelEvent => ({ id: i + 1, kind: "move", reason: "draw", text: "Draw",
    from: { controller: Math.floor(i / 5), location: 1, sequence: 0 },
    zone: { controller: Math.floor(i / 5), location: 2, sequence: i % 5 } })),
  phase(11, "Draw Phase"), phase(12, "Standby Phase"), phase(13, "Main Phase 1"),
];
const rect = { left: 0, top: 0, width: 70, height: 100, x: 0, y: 0, right: 70, bottom: 100, toJSON: () => ({}) };
let key: string;
let run = 0;

beforeEach(() => {
  vi.useFakeTimers();
  key = `opening-order-${run++}`;
  resetMoveSchedule(key);
  resetPhaseBeats(key);
  clearZoneSnapshots();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: (_frames: Keyframe[], options: KeyframeAnimationOptions) => {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const timer = window.setTimeout(resolve, Number(options.duration ?? 0) + Number(options.delay ?? 0));
    return { finished, cancel: () => { window.clearTimeout(timer); resolve(); } };
  } });
});
afterEach(() => {
  cleanup(); clearZoneSnapshots(); vi.useRealTimers(); vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
});

function Anchors() {
  return <div>
    {[0, 1].map((seat) => <div key={seat}>
      <div data-zones={`${seat}:1:0`} data-side={seat === 0 ? "you" : "opp"} />
      <div data-hand-seat={seat} data-side={seat === 0 ? "you" : "opp"}>
        {Array.from({ length: 5 }, (_, sequence) => <div key={sequence} data-zones={`${seat}:2:${sequence}`} data-side={seat === 0 ? "you" : "opp"} />)}
      </div>
    </div>)}
  </div>;
}

function PhaseStatus({ reduced }: { reduced: boolean }) {
  const beats = useStartBeats({ engine: { revision: 0, turn: 1, phase: "main1", events: opening } as DuelEngineView,
    duelKey: key, reducedMotion: reduced, ready: true });
  return <span data-testid="phase-bar">{beats.phase ?? ""}</span>;
}

describe.each([false, true])("opening order (reduced motion: %s)", (reduced) => {
  it("plans card landings before phases even when the phase consumer runs first", () => {
    render(<Anchors />);
    const phases = planPhaseBeats(opening, 0, { now: 0, reduced, duelKey: key })!;
    const flights = planMoves(opening, { now: 0, reduced, duelKey: key });
    const lastLanding = Math.max(...opening.filter((event) => event.kind === "move").map((event) => getMovePlan(event.id)!.landAt));
    expect(phases.beats[0].startAt).toBeGreaterThanOrEqual(lastLanding + PHASE_TIMING.afterMovesMs);
    expect(phases.beats[1].startAt).toBeGreaterThan(phases.beats[0].endAt - 1);
    // A later caller reuses the schedule rather than queuing the deal twice.
    expect(flights).toHaveLength(0);
  });

  it("holds the phase bar and ribbons until all opening cards have landed", async () => {
    const board = render(<div>
      <Anchors />
      <PhaseStatus reduced={reduced} />
      <MoveFx events={opening} duelKey={key} reducedMotion={reduced} replayFrom={0} />
      <DuelFeedback events={opening} duelKey={key} reducedMotion={reduced} soundEnabled={false} replayFrom={0} />
    </div>);
    const lastLanding = Math.max(...opening.filter((event) => event.kind === "move").map((event) => getMovePlan(event.id)!.landAt));
    expect(board.getByTestId("phase-bar").textContent).toBe("");
    expect(board.container.querySelector('[data-style="draw"], [data-style="fade"]')).not.toBeNull();
    const beforeLanding = Math.floor(lastLanding) - 1;
    while (performance.now() < beforeLanding) {
      // Commit each timer tick so queued ghosts mount at their scheduled starts.
      const step = Math.min(100, beforeLanding - performance.now());
      await act(async () => { await vi.advanceTimersByTimeAsync(step); });
    }
    expect(board.getByTestId("phase-bar").textContent).toBe("");
    expect(board.getByRole("status").textContent).toBe("");
    await act(async () => { await vi.advanceTimersByTimeAsync(PHASE_TIMING.afterMovesMs + 2); });
    expect(board.getByTestId("phase-bar").textContent).toBe("draw");
    expect(board.getByRole("status").textContent).toBe("Draw Phase");
    for (const card of board.container.querySelectorAll<HTMLElement>('[data-hand-seat] [data-zones]')) {
      expect(card.style.visibility).toBe("");
    }
    await act(async () => { await vi.advanceTimersByTimeAsync(reduced ? PHASE_TIMING.reducedBeatMs : PHASE_TIMING.beatMs); });
    expect(board.getByRole("status").textContent).toBe("Standby Phase");
    expect(board.container.querySelector('[data-style="draw"], [data-style="fade"]')).toBeNull();
  });
});

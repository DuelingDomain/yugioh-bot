import { describe, expect, it } from "vitest";
import {
  deadlineAt,
  freezeContinueClock,
  isClockDue,
  liveRemainingMs,
  startDecisionClock,
  syncDecisionClock,
  timeoutLossSeat,
  withServerNow,
} from "../src/clock.js";

describe("decision clock", () => {
  it("is absent when turnSeconds is unlimited", () => {
    expect(startDecisionClock({ turn: 1, promptSeat: 0 }, 0, 10_000)).toBeNull();
    expect(syncDecisionClock({ turn: 1, remainingMs: [1000, 1000] as [number, number], activeSeat: 0, startedAt: 1 }, { turn: 1, promptSeat: 0 }, 0, 10_000)).toBeNull();
  });

  it("starts both seats with the full per-turn budget and only the prompt owner ticking", () => {
    const clock = startDecisionClock({ turn: 3, promptSeat: 1 }, 30, 50_000);
    expect(clock).toEqual({
      turn: 3,
      remainingMs: [30_000, 30_000],
      activeSeat: 1,
      startedAt: 50_000,
    });
    expect(liveRemainingMs(clock!, 50_400)).toEqual([30_000, 29_600]);
    expect(deadlineAt(clock!)).toBe(80_000);
    expect(isClockDue(clock!, 79_999)).toBe(false);
    expect(isClockDue(clock!, 80_000)).toBe(true);
  });

  it("lets an opponent response consume only their seat during the same turn", () => {
    const previous = {
      turn: 1,
      remainingMs: [20_000, 20_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 1000,
    };
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 1 }, 30, 1500);
    expect(after).toEqual({
      turn: 1,
      remainingMs: [19_500, 20_000],
      activeSeat: 1,
      startedAt: 1500,
    });
    expect(liveRemainingMs(after!, 2500)).toEqual([19_500, 19_000]);
  });

  it("refills both seats when the duel turn changes", () => {
    const previous = {
      turn: 1,
      remainingMs: [250, 18_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 9000,
    };
    expect(syncDecisionClock(previous, { turn: 2, promptSeat: 1 }, 30, 12_000)).toEqual({
      turn: 2,
      remainingMs: [30_000, 30_000],
      activeSeat: 1,
      startedAt: 12_000,
    });
  });

  it("does not invent a clock during recovery when none was persisted", () => {
    expect(syncDecisionClock(null, { turn: 1, promptSeat: 0 }, 240, 1)).toBeNull();
  });

  it("rebases the same owner after an accepted command without moving the deadline", () => {
    const previous = {
      turn: 1,
      remainingMs: [10_000, 10_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 0,
    };
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 30, 2_000, 2_000);
    expect(after).toEqual({
      turn: 1,
      remainingMs: [8_000, 10_000],
      activeSeat: 0,
      startedAt: 2_000,
    });
    expect(deadlineAt(after!)).toBe(deadlineAt(previous));
  });

  it("freezes remaining at decision time and starts the next prompt later", () => {
    const previous = {
      turn: 1,
      remainingMs: [20_000, 20_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 1000,
    };
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 1 }, 30, 1_500, 4_000, "loss");
    expect(after).toEqual({
      turn: 1,
      remainingMs: [19_500, 20_000],
      activeSeat: 1,
      startedAt: 4_000,
    });
    expect(deadlineAt(after!)).toBe(24_000);
  });

  it("starts a new turn at resume time rather than charging engine processing", () => {
    const previous = {
      turn: 1,
      remainingMs: [250, 18_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 9_000,
    };
    expect(syncDecisionClock(previous, { turn: 2, promptSeat: 1 }, 30, 9_249, 15_000, "loss")).toEqual({
      turn: 2,
      remainingMs: [30_000, 30_000],
      activeSeat: 1,
      startedAt: 15_000,
    });
  });

  it("does not turn a due loss clock into a continue freeze at zero", () => {
    const previous = {
      turn: 1,
      remainingMs: [30_000, 30_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 1_000,
    };
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 30, 31_001, 31_001, "loss");
    expect(after).toEqual({
      turn: 1,
      remainingMs: [0, 30_000],
      activeSeat: 0,
      startedAt: 1_000,
    });
    expect(isClockDue(after!, 31_001)).toBe(true);
    expect(isClockDue(after!, 1_000_000)).toBe(true);
  });

  it("freezes continue at zero so the same deadline cannot fire again", () => {
    const clock = {
      turn: 4,
      remainingMs: [5_000, 8_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 1000,
    };
    expect(timeoutLossSeat(clock, 6000)).toBe(0);
    const frozen = freezeContinueClock(clock, 7000);
    expect(frozen).toEqual({
      turn: 4,
      remainingMs: [0, 8_000],
      activeSeat: 0,
      startedAt: null,
    });
    expect(isClockDue(frozen, 99_000)).toBe(false);
    expect(timeoutLossSeat(frozen, 99_000)).toBeNull();
    const nextTurn = syncDecisionClock(frozen, { turn: 5, promptSeat: 1 }, 30, 20_000);
    expect(nextTurn).toEqual({
      turn: 5,
      remainingMs: [30_000, 30_000],
      activeSeat: 1,
      startedAt: 20_000,
    });
  });

  it("keeps remaining frozen while a continue seat plays at zero in the same turn", () => {
    const frozen = {
      turn: 1,
      remainingMs: [0, 12_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: null,
    };
    expect(syncDecisionClock(frozen, { turn: 1, promptSeat: 0 }, 30, 40_000)).toEqual({
      turn: 1,
      remainingMs: [0, 12_000],
      activeSeat: 0,
      startedAt: null,
    });
  });

  it("publishes frozen remaining plus serverNow rather than live-subtracted remaining", () => {
    const clock = {
      turn: 1,
      remainingMs: [30_000, 30_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 5,
    };
    expect(withServerNow(clock, 25)).toEqual({
      turn: 1,
      remainingMs: [30_000, 30_000],
      activeSeat: 0,
      startedAt: 5,
      serverNow: 25,
    });
    expect(withServerNow(null, 25)).toBeNull();
  });
});

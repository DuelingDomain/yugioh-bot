import { describe, expect, it } from "vitest";
import {
  deadlineAt,
  freezeContinueClock,
  isClockDue,
  liveRemainingMs,
  startDecisionClock,
  stopSeatClock,
  syncDecisionClock,
  timeoutLossSeat,
  withServerNow,
} from "../src/clock.js";
import { duelClockRegainMs, duelClockRulesText } from "@yugidraft/shared/duels";

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
      remainingMs: [22_500, 20_000],
      activeSeat: 1,
      startedAt: 1500,
    });
    expect(liveRemainingMs(after!, 2500)).toEqual([22_500, 19_000]);
  });

  it("regains a quarter of the bank (min 30 s) per seat when the duel turn changes", () => {
    const previous = {
      turn: 1,
      remainingMs: [3_250, 18_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 9000,
    };
    // 240 s bank: seat 0 has 3 s left when it decides (+3 s), then both seats regain 60 s.
    expect(syncDecisionClock(previous, { turn: 2, promptSeat: 1 }, 240, 9_250, 12_000)).toEqual({
      turn: 2,
      remainingMs: [66_000, 78_000],
      activeSeat: 1,
      startedAt: 12_000,
    });
  });

  it("uses at least 30 s of regain on small banks and never exceeds the bank", () => {
    expect(duelClockRegainMs(240)).toBe(60_000);
    expect(duelClockRegainMs(120)).toBe(30_000);
    expect(duelClockRegainMs(60)).toBe(30_000);
    expect(duelClockRegainMs(30)).toBe(30_000);
    expect(duelClockRegainMs(0)).toBe(0);
    const previous = {
      turn: 1,
      remainingMs: [50_000, 20_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 1_000,
    };
    // 60 s bank: seat 0 charged 1 s, +3 s, regain 30 s -> capped at 60 s. Seat 1 20 s + 30 s.
    expect(syncDecisionClock(previous, { turn: 2, promptSeat: 1 }, 60, 2_000, 2_000)).toEqual({
      turn: 2,
      remainingMs: [60_000, 50_000],
      activeSeat: 1,
      startedAt: 2_000,
    });
  });

  it("adds the per-move increment to the deciding seat and caps it at the bank", () => {
    const previous = {
      turn: 1,
      remainingMs: [100_000, 100_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 0,
    };
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 240, 10_000, 10_000);
    expect(after!.remainingMs).toEqual([93_000, 100_000]);
    const nearFull = { ...previous, remainingMs: [240_000, 240_000] as [number, number] };
    // 1 s charged, +3 s would reach 242 s: capped at the 240 s bank.
    expect(syncDecisionClock(nearFull, { turn: 1, promptSeat: 0 }, 240, 1_000, 1_000)!.remainingMs).toEqual([240_000, 240_000]);
    const oneShort = { ...previous, remainingMs: [238_000, 240_000] as [number, number] };
    expect(syncDecisionClock(oneShort, { turn: 1, promptSeat: 0 }, 240, 500, 500)!.remainingMs[0]).toBe(240_000);
  });

  it("credits the seat that decided, including bot seats, not the next prompt owner", () => {
    const previous = {
      turn: 1,
      remainingMs: [50_000, 50_000] as [number, number],
      activeSeat: 1 as const,
      startedAt: 0,
    };
    // Bot is seat 1: its answer earns +3 s, the human (seat 0) is untouched.
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 240, 2_000, 2_000, "loss", 1);
    expect(after).toEqual({
      turn: 1,
      remainingMs: [50_000, 51_000],
      activeSeat: 0,
      startedAt: 2_000,
    });
  });

  it("does not award an increment to a seat frozen at zero in continue mode", () => {
    const frozen = {
      turn: 1,
      remainingMs: [0, 12_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: null,
    };
    expect(syncDecisionClock(frozen, { turn: 1, promptSeat: 0 }, 240, 40_000, 40_000, "continue", 0)!.remainingMs).toEqual([0, 12_000]);
    // ...but the next turn regains time and the clock ticks again.
    expect(syncDecisionClock(frozen, { turn: 2, promptSeat: 1 }, 240, 40_000, 41_000, "continue", 0)).toEqual({
      turn: 2,
      remainingMs: [60_000, 72_000],
      activeSeat: 1,
      startedAt: 41_000,
    });
  });

  it("gives a saved pre-bank clock the new rules from its next turn", () => {
    const legacy = {
      turn: 7,
      remainingMs: [240_000, 240_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 5_000,
    };
    const after = syncDecisionClock(legacy, { turn: 8, promptSeat: 1 }, 240, 65_000, 65_000);
    expect(after!.remainingMs).toEqual([240_000, 240_000]);
  });

  it("does not invent a clock during recovery when none was persisted", () => {
    expect(syncDecisionClock(null, { turn: 1, promptSeat: 0 }, 240, 1)).toBeNull();
  });

  it("rebases the same owner after an accepted command and extends the deadline by the increment", () => {
    const previous = {
      turn: 1,
      remainingMs: [10_000, 10_000] as [number, number],
      activeSeat: 0 as const,
      startedAt: 0,
    };
    const after = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 30, 2_000, 2_000);
    // 2 s charged, +3 s increment: the deadline moves out by exactly the increment.
    expect(after).toEqual({
      turn: 1,
      remainingMs: [11_000, 10_000],
      activeSeat: 0,
      startedAt: 2_000,
    });
    expect(deadlineAt(after!)).toBe(deadlineAt(previous)! + 3_000);
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
      remainingMs: [22_500, 20_000],
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
    const nextTurn = syncDecisionClock(frozen, { turn: 5, promptSeat: 1 }, 240, 20_000);
    expect(nextTurn).toEqual({
      turn: 5,
      remainingMs: [60_000, 68_000],
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

  it("describes the bank rules in one string", () => {
    expect(duelClockRulesText(240)).toBe("4 min bank · +3 s per move · +1 min each turn");
    expect(duelClockRulesText(120)).toBe("2 min bank · +3 s per move · +30 s each turn");
    expect(duelClockRulesText(300)).toBe("5 min bank · +3 s per move · +1 min 15 s each turn");
    expect(duelClockRulesText(0)).toBe("");
  });
});

describe("N-seat decision clock", () => {
  it("starts every seat with the bank and ticks only the prompt owner", () => {
    const clock = startDecisionClock({ turn: 1, promptSeat: 2 }, 30, 1000, 4)!;
    expect(clock.remainingMs).toEqual([30_000, 30_000, 30_000, 30_000]);
    expect(clock.activeSeat).toBe(2);
    expect(liveRemainingMs(clock, 1500)).toEqual([30_000, 30_000, 29_500, 30_000]);
    expect(deadlineAt(clock)).toBe(31_000);
    expect(timeoutLossSeat(clock, 31_000)).toBe(2);
  });

  it("keeps two seats when no seat count is given", () => {
    expect(startDecisionClock({ turn: 1, promptSeat: 0 }, 30, 0)!.remainingMs).toHaveLength(2);
  });

  it("charges the deciding seat, adds the increment, and regains time for every seat on a new turn", () => {
    const previous = { turn: 1, remainingMs: [10_000, 10_000, 10_000], activeSeat: 2, startedAt: 0 };
    const next = syncDecisionClock(previous, { turn: 2, promptSeat: 0 }, 60, 4_000, 4_000, "continue")!;
    const regain = duelClockRegainMs(60);
    expect(next.remainingMs).toEqual([10_000 + regain, 10_000 + regain, 6_000 + 3_000 + regain]);
    expect(next.activeSeat).toBe(0);
    expect(next.startedAt).toBe(4_000);
  });

  it("copies through withServerNow and freezes a continue clock", () => {
    const clock = { turn: 1, remainingMs: [5, 6, 7, 8], activeSeat: 3, startedAt: 10 };
    expect(withServerNow(clock, 99)).toEqual({ ...clock, serverNow: 99 });
    expect(freezeContinueClock(clock, 12).remainingMs).toEqual([5, 6, 7, 6]);
    expect(isClockDue({ ...clock, remainingMs: [5, 6, 7, 1] }, 11)).toBe(true);
  });

  it("does not run the clock of a stopped seat and never gives it time back", () => {
    const started = startDecisionClock({ turn: 1, promptSeat: 1, stoppedSeats: [1] }, 60, 0, 3)!;
    expect(started.activeSeat).toBeNull();
    expect(started.startedAt).toBeNull();
    const previous = { turn: 1, remainingMs: [10_000, 5_000, 10_000], activeSeat: 0, startedAt: 0 };
    const next = syncDecisionClock(previous, { turn: 2, promptSeat: 1, stoppedSeats: [1] }, 60, 1_000, 1_000, "loss")!;
    expect(next.activeSeat).toBeNull();
    expect(next.startedAt).toBeNull();
    // The stopped seat gets no turn regain; the others do.
    expect(next.remainingMs[1]).toBe(5_000);
    expect(next.remainingMs[2]).toBeGreaterThan(10_000);
  });

  it("stops the clock of a seat that leaves the game", () => {
    const clock = { turn: 1, remainingMs: [5_000, 6_000, 7_000], activeSeat: 2, startedAt: 1_000 };
    expect(stopSeatClock(clock, 2, 3_000)).toEqual({ turn: 1, remainingMs: [5_000, 6_000, 5_000], activeSeat: null, startedAt: null });
    expect(stopSeatClock(clock, 0, 3_000)).toBe(clock);
  });
});

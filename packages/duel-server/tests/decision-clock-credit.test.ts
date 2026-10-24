import { expect, it } from "vitest";
import { isClockDue, syncDecisionClock } from "../src/clock.js";

it("keeps a zero-bank loss deadline enforceable when the prompt returns to that seat", () => {
  const previous = { turn: 1, activeSeat: 1, startedAt: 100_000, remainingMs: [0, 60_000] };
  const next = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 60, 101_000, 101_000, "loss", 1)!;
  expect(next).toMatchObject({ activeSeat: 0, startedAt: 101_000 });
  expect(isClockDue(next, 101_000)).toBe(true);
});

it("keeps a zero-bank continue clock frozen when its prompt returns", () => {
  const previous = { turn: 1, activeSeat: 1, startedAt: 100_000, remainingMs: [0, 60_000] };
  const next = syncDecisionClock(previous, { turn: 1, promptSeat: 0 }, 60, 101_000, 101_000, "continue", 1)!;
  expect(next).toMatchObject({ activeSeat: 0, startedAt: null });
  expect(isClockDue(next, 101_000)).toBe(false);
});

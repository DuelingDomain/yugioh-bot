import { describe, expect, it } from "vitest";
import { formatDuelTime } from "@/components/remote/ui/chrome";
import { matchClockDisplay, type Match } from "@/components/remote/ui/match-model";

describe("duel clock", () => {
  it("shows mm:ss, then h:mm:ss from one hour", () => {
    expect(formatDuelTime(0)).toBe("00:00");
    expect(formatDuelTime(65_900)).toBe("01:05");
    expect(formatDuelTime(59 * 60_000 + 59_000)).toBe("59:59");
    expect(formatDuelTime(3_600_000)).toBe("1:00:00");
    expect(formatDuelTime(3_600_000 * 2 + 61_000)).toBe("2:01:01");
    expect(formatDuelTime(-5000)).toBe("00:00");
  });
});

it("displays the recorded match clock, warning thresholds and extra turns", () => {
  const match: Match = { bestOf: 3, phase: "duel", games: [], clock: { minutes: 60, tie: "draw", startedAt: 5_000 } };
  const deadline = 3_605_000;
  expect(matchClockDisplay(match, 1, 5_000)?.text).toBe("60:00");
  expect(matchClockDisplay(match, 1, deadline - 300_000)?.tone).toBeUndefined();
  expect(matchClockDisplay(match, 1, deadline - 299_999)?.tone).toBe("amber");
  expect(matchClockDisplay(match, 1, deadline - 59_999)?.tone).toBe("red");
  match.clock!.called = { at: deadline, turn: 8, seat: 1 };
  expect(matchClockDisplay(match, 8, deadline)?.label).toBe("Time — Turn 0");
  expect(matchClockDisplay(match, 11, deadline + 90_000)?.text).toBe("Extra 3/3");
  match.clock!.offAt = deadline + 100_000;
  expect(matchClockDisplay(match, 11, deadline + 100_000)?.text).toBe("Off");
});

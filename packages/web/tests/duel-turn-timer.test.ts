import { describe, expect, it } from "vitest";
import { TURN_TIMER_CHOICES, turnTimerLabel, UNLIMITED_TURN_LABEL } from "../src/components/duel/turn-timer";
import { turnSecondsChoices } from "../src/components/tournament/duel-rules";

describe("turn timer choices", () => {
  it("offers Unlimited (stored as 0) next to the timed choices", () => {
    expect(TURN_TIMER_CHOICES[0]).toEqual({ value: 0, label: "Unlimited" });
    expect(TURN_TIMER_CHOICES.map((c) => c.value)).toEqual([0, 60, 120, 180, 240, 300, 600]);
  });

  it("labels timed choices as before", () => {
    expect(turnTimerLabel(60)).toBe("1 minute per turn");
    expect(turnTimerLabel(240)).toBe("4 minutes per turn");
    expect(turnTimerLabel(45)).toBe("45 seconds per turn");
    expect(turnTimerLabel(0)).toBe(UNLIMITED_TURN_LABEL);
  });

  it("uses the same wording in the tournament rules form", () => {
    expect(turnSecondsChoices(240)[0]).toEqual({ value: 0, label: "Unlimited" });
  });
});

import { describe, expect, it } from "vitest";
import { battleSeekMs, joinBattleClock } from "@/components/duel/battle-clock";

describe("the shared battle playback clock", () => {
  it.each([[undefined, 1000, 0], [1100, 1000, 0], [1000, 1020, 20], [1000, 1120, 120], [1000, 1400, 120]])(
    "caps the initial seek from %s at %i to %i ms", (start, now, expected) => {
      expect(battleSeekMs(start, now)).toBe(expected);
    },
  );

  it("rebases delayed playback once and keeps that origin for the next join", () => {
    const clock = { startedAt: 1000 };
    expect(joinBattleClock(clock, 1400)).toBe(1280);
    expect(joinBattleClock(clock, 1400)).toBe(1280);
    expect(clock.startedAt + 800).toBe(2080);
  });
});

import { beforeEach, describe, expect, it } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { PHASE_TIMING } from "../../src/components/duel/duel-timing";
import { getPhaseBeat, isOpeningView, openingPresentationMs, phaseKeyOfText, planPhaseBeats, resetPhaseBeats } from "../../src/components/duel/phase-beats";
import { planMoves, resetMoveSchedule } from "../../src/components/duel/move-plan";

const phase = (id: number, text: string): DuelEvent => ({ id, kind: "phase", text }) as DuelEvent;
const draw = (id: number): DuelEvent => ({ id, kind: "move", reason: "draw", text: "draw" }) as unknown as DuelEvent;

beforeEach(() => resetPhaseBeats("t"));

describe("phaseKeyOfText", () => {
  it("reads the announced phase names", () => {
    expect(phaseKeyOfText("Draw Phase")).toBe("draw");
    expect(phaseKeyOfText("Standby Phase")).toBe("standby");
    expect(phaseKeyOfText("Main Phase 1")).toBe("main1");
    expect(phaseKeyOfText("Main Phase 2")).toBe("main2");
    expect(phaseKeyOfText("Battle Phase")).toBe("battle");
    expect(phaseKeyOfText("End Phase")).toBe("end");
    expect(phaseKeyOfText("Something")).toBeNull();
  });
});

describe("isOpeningView", () => {
  it("is true at the very start of a duel only", () => {
    const events = [draw(1), phase(2, "Draw Phase")];
    expect(isOpeningView({ revision: 0, turn: 1, events })).toBe(true);
    expect(isOpeningView({ revision: 1, turn: 1, events })).toBe(false);
    expect(isOpeningView({ revision: 0, turn: 2, events })).toBe(false);
    expect(isOpeningView({ revision: 0, turn: 1, events: [] })).toBe(false);
  });
});

describe("opening presentation duration", () => {
  it.each([false, true])("covers the opening hand and phase beats (reduced motion: %s)", (reduced) => {
    resetMoveSchedule("t");
    const opening = [
      ...Array.from({ length: 10 }, (_, i) => ({ ...draw(i + 1), from: { controller: Math.floor(i / 5), location: 1, sequence: 0 }, zone: { controller: Math.floor(i / 5), location: 2, sequence: i % 5 } })),
      phase(11, "Draw Phase"), phase(12, "Standby Phase"), phase(13, "Main Phase 1"),
    ];
    planMoves(opening, { now: 0, reduced, duelKey: "t", geometry: () => ({ distance: 240 }) });
    const plan = planPhaseBeats(opening, 0, { now: 0, reduced, duelKey: "t" })!;
    expect(openingPresentationMs(opening, reduced)).toBeGreaterThanOrEqual(plan.releaseAt);
    expect(openingPresentationMs(opening, reduced)).toBeLessThan(8_000);
  });
});

describe("planPhaseBeats", () => {
  const events = [draw(1), draw(2), phase(3, "Draw Phase"), phase(4, "Standby Phase"), phase(5, "Main Phase 1")];
  const landAtOf = (event: DuelEvent) => (event.kind === "move" ? 1000 + event.id * 100 : null);

  it("plays Draw, Standby and Main 1 in order, one beat each, after the cards have landed", () => {
    const plan = planPhaseBeats(events, 0, { now: 0, reduced: false, duelKey: "t", landAtOf });
    expect(plan?.beats.map((beat) => beat.phase)).toEqual(["draw", "standby", "main1"]);
    const [dp, sp, m1] = plan!.beats;
    expect(dp.startAt).toBe(1200 + PHASE_TIMING.afterMovesMs);
    expect(dp.endAt - dp.startAt).toBe(PHASE_TIMING.beatMs);
    expect(sp.startAt).toBe(dp.endAt);
    expect(m1.startAt).toBe(sp.endAt);
    expect(plan!.holdPhase).toBeNull();
    expect(plan!.releaseAt).toBe(m1.startAt + PHASE_TIMING.releaseLeadMs);
    expect(getPhaseBeat(4)).toEqual(sp);
  });

  it("keeps each empty phase between 0.8 and 1.2 seconds", () => {
    expect(PHASE_TIMING.beatMs).toBeGreaterThanOrEqual(800);
    expect(PHASE_TIMING.beatMs).toBeLessThanOrEqual(1200);
  });

  it("is shorter with reduced motion, and returns the same plan on a second call", () => {
    const reduced = planPhaseBeats(events, 0, { now: 0, reduced: true, duelKey: "t", landAtOf });
    expect(reduced!.beats[0].endAt - reduced!.beats[0].startAt).toBe(PHASE_TIMING.reducedBeatMs);
    expect(planPhaseBeats(events, 0, { now: 500, reduced: true, duelKey: "t", landAtOf })).toBe(reduced);
  });

  it("returns null when the batch has no turn-start phase", () => {
    expect(planPhaseBeats([phase(7, "Battle Phase"), phase(8, "End Phase")], 0, { now: 0, reduced: false, duelKey: "t", landAtOf })).toBeNull();
    // A Main Phase 1 that comes back from the Battle Phase is not a turn start.
    expect(planPhaseBeats([phase(7, "Battle Phase"), phase(8, "Main Phase 2")], 0, { now: 0, reduced: false, duelKey: "t", landAtOf })).toBeNull();
  });

  it("holds the player to the end of a Draw Phase that stops at a response window", () => {
    const plan = planPhaseBeats([phase(1, "Draw Phase")], 0, { now: 100, reduced: false, duelKey: "t", landAtOf });
    expect(plan!.releaseAt).toBe(100 + PHASE_TIMING.beatMs);
  });

  it("joins a later Standby Phase and Main Phase 1 to the Draw Phase that came before the cursor", () => {
    const later = [phase(1, "Draw Phase"), phase(2, "Standby Phase"), phase(3, "Main Phase 1")];
    const plan = planPhaseBeats(later, 1, { now: 0, reduced: false, duelKey: "t", landAtOf });
    expect(plan!.beats.map((beat) => beat.phase)).toEqual(["standby", "main1"]);
    expect(plan!.holdPhase).toBe("draw");
  });

  it("waits for the beats of an earlier batch", () => {
    const first = planPhaseBeats([phase(1, "Draw Phase")], 0, { now: 0, reduced: false, duelKey: "t", landAtOf });
    const second = planPhaseBeats([phase(1, "Draw Phase"), phase(2, "Standby Phase")], 1, { now: 100, reduced: false, duelKey: "t", landAtOf });
    expect(second!.beats[0].startAt).toBe(first!.beats[0].endAt);
  });
});

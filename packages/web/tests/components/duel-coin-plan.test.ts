import { describe, expect, it } from "vitest";
import {
  COIN_TIMING as SHARED_COIN_TIMING,
  COIN_TOSS_MS,
  MIN_DUEL_FX_SPEED,
  coinTossDurationMs,
  type DuelEvent,
} from "@yugidraft/shared/duels";
import {
  COIN_FACES,
  COIN_TIMING,
  coinPose,
  coinResults,
  coinSpec,
  coinView,
  frameAt,
  planCoinToss,
  queueStart,
  type CoinStep,
} from "../../src/components/duel/coin-plan";

function toss(id: number, results: Array<"heads" | "tails">, extra: Partial<DuelEvent> = {}): DuelEvent {
  return { id, kind: "toss", seat: 0, text: "Coin toss", toss: { type: "coin", results }, ...extra } as DuelEvent;
}

describe("coin plan", () => {
  it("keeps the approved timings: about 3.2 s per toss at 1x", () => {
    const plan = planCoinToss(toss(1, ["heads"]), 0, false)!;
    const step = plan.segments[0] as CoinStep;
    expect(step.flipAt).toBe(220);
    expect(step.landAt - step.flipAt).toBe(1500);
    expect(step.holdEnd - step.landAt).toBe(1200);
    expect(step.end).toBe(220 + 1500 + 1200 + 260);
    expect(plan.segments).toHaveLength(1);
  });

  it("plays one step per result in order, each after the one before has ended, then a summary", () => {
    const plan = planCoinToss(toss(7, ["heads", "tails", "heads"]), 1000, false)!;
    const steps = plan.segments.filter((segment): segment is CoinStep => segment.kind === "toss");
    expect(steps.map((step) => step.face)).toEqual(["heads", "tails", "heads"]);
    for (let i = 1; i < steps.length; i++) expect(steps[i].start).toBe(steps[i - 1].end);
    const summary = plan.segments[3];
    expect(summary.kind).toBe("summary");
    expect(summary.start).toBe(steps[2].end);
    expect(plan.end).toBe(summary.end);
    expect(plan.finalLandAt).toBe(steps[2].landAt);
    // The result of a step is after its own landing, never during the spin.
    for (const step of steps) expect(step.landAt).toBeGreaterThan(step.flipAt);
  });

  it("gives a single toss no summary", () => {
    const plan = planCoinToss(toss(2, ["tails"]), 0, false)!;
    expect(plan.segments.some((segment) => segment.kind === "summary")).toBe(false);
  });

  it("reduced motion: a short fade to the face, no spin, the same 1.2 s hold", () => {
    const step = planCoinToss(toss(3, ["tails"]), 0, true)!.segments[0] as CoinStep;
    expect(step.reduced).toBe(true);
    expect(step.landAt).toBe(COIN_TIMING.reducedFadeMs);
    expect(step.holdEnd - step.landAt).toBe(COIN_TIMING.holdMs);
  });

  it("shortens the fade, the air time and the hand-off from the third of five coins, keeping the hold", () => {
    const plan = planCoinToss(toss(4, ["heads", "tails", "heads", "tails", "heads"]), 0, false)!;
    const steps = plan.segments.filter((segment): segment is CoinStep => segment.kind === "toss");
    expect(steps[1].end - steps[1].start).toBe(220 + 1500 + 1200 + 260);
    expect(steps[2].end - steps[2].start).toBeLessThan(steps[1].end - steps[1].start);
    expect(steps[2].holdEnd - steps[2].landAt).toBe(COIN_TIMING.holdMs);
    expect(planCoinToss(toss(5, ["heads", "tails", "heads"]), 0, false)!.end).toBe(3 * 3180 + 260 + 1000 + 260);
  });

  it("reads results and ignores dice and empty tosses", () => {
    expect(coinResults(toss(1, ["heads", "tails"]))).toEqual(["heads", "tails"]);
    expect(coinResults({ kind: "toss", toss: { type: "dice", results: [3] } } as DuelEvent)).toBeNull();
    expect(planCoinToss(toss(1, []), 0, false)).toBeNull();
  });

  it("names the card that tossed", () => {
    const plan = planCoinToss(toss(1, ["heads", "tails"], { card: { code: 10, name: "Barrel Dragon" } as DuelEvent["card"] }), 0, false)!;
    expect(plan.source).toEqual({ code: 10, name: "Barrel Dragon" });
  });

  it("queues a second toss event behind the first, with a gap", () => {
    expect(queueStart(100, null)).toBe(100);
    expect(queueStart(100, 5000)).toBe(5000 + COIN_TIMING.gapMs);
    expect(queueStart(9000, 5000)).toBe(9000);
  });

  it("lands the coin on the right face: whole turns, plus a half turn for tails", () => {
    for (const index of [0, 1, 2, 3]) {
      const heads = coinSpec("heads", index);
      const tails = coinSpec("tails", index);
      expect(heads.final % 360).toBe(0);
      expect(tails.final % 360).toBe(180);
      const end = coinPose(1500, tails);
      expect(end.ang).toBeCloseTo(tails.final, 5);
      expect(end.h).toBeCloseTo(0, 5);
      expect(coinPose(0, heads).h).toBe(0);
    }
    // It rises in the air and is at its top in the middle of the air time.
    expect(coinPose(525, coinSpec("heads", 0)).h).toBeCloseTo(1, 5);
  });

  it("frames the time line: fade, flip, hold, outro, summary, done", () => {
    const plan = planCoinToss(toss(1, ["heads", "tails"]), 0, false)!;
    const stage = (t: number) => {
      const frame = frameAt(plan.segments, t);
      return frame.phase === "step" || frame.phase === "summary" ? frame.stage : frame.phase;
    };
    expect(stage(100)).toBe("fade");
    expect(stage(800)).toBe("flip");
    expect(stage(1800)).toBe("hold");
    expect(stage(3000)).toBe("outro");
    expect(stage(3180 + 800)).toBe("flip");
    expect(stage(plan.end - 100)).toBe("out");
    expect(stage(plan.end + 1)).toBe("done");
  });

  it("shows the label only after landing and the summary after more than one toss", () => {
    const plan = planCoinToss(toss(1, ["heads", "tails", "heads"], { card: { code: 10, name: "Barrel Dragon" } as DuelEvent["card"] }), 0, false)!;
    const view = (t: number) => coinView(frameAt(plan.segments, t), [plan]);
    expect(view(800).verdict?.on).toBe(false);
    expect(view(800).live).toBe("");
    expect(view(800).tray?.faces).toEqual([null, null, null]);
    expect(view(1800).verdict).toMatchObject({ on: true, face: "heads", kick: "Toss 1 of 3" });
    expect(view(1800).live).toBe("Toss 1: Heads");
    expect(view(3000).tray?.faces).toEqual(["heads", null, null]);
    const summaryAt = plan.segments[3].start + 400;
    const summary = view(summaryAt).summary!;
    expect(summary.on).toBe(true);
    expect(summary.kick).toBe("Barrel Dragon: 3 coin tosses");
    expect(summary.counts).toBe("2 heads, 1 tails");
    expect(view(summaryAt).live).toBe("Result: Heads, Tails, Heads");
    expect(COIN_FACES.heads.name).toBe("Blue-Eyes White Dragon");
    expect(COIN_FACES.tails.name).toBe("Dark Magician");
  });

  it("uses the timings of the duel server, which sizes the clock grace from them", () => {
    expect(COIN_TIMING).toBe(SHARED_COIN_TIMING);
  });

  describe("against the server grace at the slowest FX speed", () => {
    const heads = (count: number) => Array.from({ length: count }, (_, i) => (i % 2 ? "tails" : "heads") as "heads" | "tails");
    const real = (plan: { end: number }, start: number) => (plan.end - start) / MIN_DUEL_FX_SPEED;

    it.each([1, 3, 5, 8])("%i coin(s): the client plan is not longer than coinTossDurationMs", (count) => {
      const plan = planCoinToss(toss(1, heads(count)), 1000, false)!;
      expect(real(plan, 1000)).toBeLessThanOrEqual(coinTossDurationMs(count, MIN_DUEL_FX_SPEED));
      const reduced = planCoinToss(toss(1, heads(count)), 1000, true)!;
      expect(real(reduced, 1000)).toBeLessThanOrEqual(coinTossDurationMs(count, MIN_DUEL_FX_SPEED));
    });

    it("one coin lasts exactly the shared coin length", () => {
      const plan = planCoinToss(toss(1, ["heads"]), 0, false)!;
      expect(plan.end).toBe(COIN_TOSS_MS);
    });

    it("the fallback unlock (plan, chain lead and margin) stays inside the grace of the server", () => {
      for (const count of [1, 3]) {
        const plan = planCoinToss(toss(1, heads(count)), 0, false)!;
        const lock = (COIN_TIMING.chainLeadMs + plan.end) / MIN_DUEL_FX_SPEED + COIN_TIMING.safetyMarginMs;
        const grace = coinTossDurationMs(count, MIN_DUEL_FX_SPEED) + COIN_TIMING.chainLeadMs / MIN_DUEL_FX_SPEED + COIN_TIMING.safetyMarginMs;
        expect(lock).toBeLessThanOrEqual(grace);
      }
    });
  });
});

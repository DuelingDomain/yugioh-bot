import { describe, expect, it } from "vitest";
import type { DuelEngineView, DuelReplayFrame } from "@yugidraft/shared/duels";
import { buildReplayTimeline, REPLAY_HISTORY_CAP } from "../../src/components/duel/replay-timeline";

function frame(step: number, logIds: number[], eventIds: number[] = []): DuelReplayFrame {
  const view: DuelEngineView = {
    revision: step, turn: 1, turnSeat: 0, phase: "main1", seats: [], prompt: null, chain: [],
    events: eventIds.map((id) => ({ id, kind: "phase" as const, text: `e${id}` })),
    log: logIds.map((id) => ({ id, text: `l${id}` })),
    result: null,
  };
  return { step, actorSeat: step === 0 ? null : 0, view };
}

describe("buildReplayTimeline", () => {
  it("concatenates deltas into cumulative views", () => {
    const t = buildReplayTimeline([frame(0, [1, 2], [1]), frame(1, [], []), frame(2, [3], [2, 3])]);
    expect(t.length).toBe(3);
    expect(t.viewAt(0).log.map((l) => l.id)).toEqual([1, 2]);
    expect(t.viewAt(1).log.map((l) => l.id)).toEqual([1, 2]);
    expect(t.viewAt(2).log.map((l) => l.id)).toEqual([1, 2, 3]);
    expect(t.viewAt(2).events.map((e) => e.id)).toEqual([1, 2, 3]);
    expect(t.viewAt(1).revision).toBe(1);
  });

  it("returns only new log lines per frame", () => {
    const t = buildReplayTimeline([frame(0, [1, 2]), frame(1, []), frame(2, [3])]);
    expect(t.newLogAt(0).map((l) => l.id)).toEqual([1, 2]);
    expect(t.newLogAt(1)).toEqual([]);
    expect(t.newLogAt(2).map((l) => l.id)).toEqual([3]);
  });

  it("caps cumulative history at 400 entries", () => {
    const ids = Array.from({ length: 300 }, (_, i) => i + 1);
    const more = Array.from({ length: 300 }, (_, i) => i + 301);
    const t = buildReplayTimeline([frame(0, ids, ids), frame(1, more, more)]);
    expect(t.viewAt(0).log).toHaveLength(300);
    const last = t.viewAt(1);
    expect(last.log).toHaveLength(REPLAY_HISTORY_CAP);
    expect(last.log[0].id).toBe(201);
    expect(last.log.at(-1)?.id).toBe(600);
    expect(last.events).toHaveLength(REPLAY_HISTORY_CAP);
    expect(t.newLogAt(1)).toHaveLength(300);
  });

  it("clamps out-of-range indexes and does not mutate frames", () => {
    const frames = [frame(0, [1]), frame(1, [2])];
    const t = buildReplayTimeline(frames);
    expect(t.viewAt(99).log.map((l) => l.id)).toEqual([1, 2]);
    expect(t.viewAt(-5).log.map((l) => l.id)).toEqual([1]);
    expect(frames[1].view.log.map((l) => l.id)).toEqual([2]);
  });
});

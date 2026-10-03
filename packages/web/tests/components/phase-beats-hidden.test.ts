// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { planPhaseBeats, resetPhaseBeats } from "@/components/duel/phase-beats";
import { getMovePlan, movesSettleAt, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

it("skips hidden-tab opening flights so the next visible batch has no phantom queue", () => {
  resetPhaseBeats("hidden"); resetMoveSchedule("hidden");
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 70, height: 100 } as DOMRect);
  document.body.innerHTML = '<div data-zones="0:1:0" data-side="you"></div>' +
    Array.from({ length: 10 }, (_, i) => `<div data-zones="0:2:${i}" data-side="you"></div>`).join("");
  const draw = (id: number): DuelEvent => ({ id, kind: "move", text: "draw", reason: "draw",
    from: { controller: 0, location: 1, sequence: 0 }, zone: { controller: 0, location: 2, sequence: id - 1 } });
  const events: DuelEvent[] = [...Array.from({ length: 10 }, (_, i) => draw(i + 1)),
    { id: 11, kind: "phase", text: "Draw Phase" }, { id: 12, kind: "phase", text: "Standby Phase" },
    { id: 13, kind: "phase", text: "Main Phase 1" }];
  const beats = planPhaseBeats(events, 0, { now: 1000, reduced: false, duelKey: "hidden" })!;
  expect(getMovePlan(1)).toBeNull();
  expect(movesSettleAt(1000)).toBe(1000);
  expect(beats.beats[0].startAt).toBe(1000);
  hidden.mockReturnValue(false);
  const [next] = planMoves([draw(14)], { now: 1100, reduced: false, duelKey: "hidden", geometry: () => ({ distance: 300 }) });
  expect(next.startAt).toBe(1100);
});

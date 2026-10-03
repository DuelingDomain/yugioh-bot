// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";
import { SummonFx } from "@/components/duel/summon-fx";
import { MoveFx } from "@/components/duel/move-fx";
import { ChainFx } from "@/components/duel/chain-fx";
import { getMovePlan, resetMoveSchedule } from "@/components/duel/move-plan";
import { CARDS as C } from "@/components/duel/fx-lab/cards";
import { resetChainBeats } from "@/components/duel/chain-beats";
import { duelFxClock } from "@/components/duel/fx-clock";
import { setAnimationSpeed } from "@/components/duel/animation-speed";

vi.mock("@/components/duel/fx3d/use-fx3d", async () => {
  const { useRef } = await import("react");
  return { useFx3d: () => useRef(null) };
});

const source = { controller: 0, location: 8, sequence: 0 };
const victim = { controller: 1, location: 4, sequence: 0 };
const events: DuelEvent[] = [
  { id: 1, kind: "move", text: "move", card: C.mst, from: { controller: 0, location: 2, sequence: 0 }, zone: source, reason: "activate" },
  { id: 2, kind: "activate", text: "activate", card: C.mst, zone: source, chainIndex: 1 },
  { id: 3, kind: "chain-resolving", text: "resolve", chainIndex: 1 },
  { id: 4, kind: "move", text: "move", card: C.celtic, from: victim, zone: { controller: 1, location: 16, sequence: 0 }, reason: "destroy" },
  { id: 5, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
  { id: 6, kind: "destroy", text: "destroy", card: C.celtic, zone: victim, cause: "effect", sourceCode: C.mst.code, sourceKind: "spell", sourceSeat: 0 },
  { id: 7, kind: "move", text: "move", card: C.mst, from: source, zone: { controller: 0, location: 16, sequence: 0 }, reason: "send" },
  { id: 8, kind: "chain-end", text: "end" },
];
let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  resetMoveSchedule("render-sequence"); resetChainBeats("render-sequence");
  vi.spyOn(performance, "now").mockReturnValue(1000);
  setAnimationSpeed(1); duelFxClock.setReducedMotion(false); duelFxClock.resetReviewTimeline();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 70, height: 100, right: 70, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
  animate = vi.fn(() => ({ finished: new Promise(() => {}), cancel: vi.fn() }));
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: animate });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks();
  setAnimationSpeed(1); duelFxClock.setReducedMotion(false); duelFxClock.resetReviewTimeline();
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
});

function Board({ events, reduced, live = false }: { events: DuelEvent[]; reduced: boolean; live?: boolean }) {
  return <div>
    {["0:2:0", "0:8:0", "1:4:0", "0:16:0", "1:16:0"].map((key) => <div key={key} data-zones={key} data-side="you">
      {key === "0:8:0" && live && <span data-card-art><img src={`/api/cards/${C.mst.code}/image`} /></span>}
    </div>)}
    <SummonFx events={events} duelKey="render-sequence" reducedMotion={reduced} shake="off" />
    <ChainFx events={events} chain={[]} duelKey="render-sequence" reducedMotion={reduced} mySeat={0} playerName={() => "Player"} />
  </div>;
}

it.each([0.5, 2])("keeps activation and cleanup on the same clock at %sx viewer pace", (speed) => {
  setAnimationSpeed(speed); duelFxClock.resetReviewTimeline();
  const view = render(<Board events={[]} reduced={false} />);
  view.rerender(<Board events={events} reduced={false} />);
  const ghost = view.container.querySelector(`img[src*="/cards/${C.mst.code}/image"]`)!.parentElement;
  const index = animate.mock.contexts.indexOf(ghost);
  const timing = animate.mock.calls[index][1];
  const animation = animate.mock.results[index].value;
  expect(animation.playbackRate).toBe(speed);
  const sourceEnd = 1000 + (timing.delay + timing.duration) / animation.playbackRate;
  expect(sourceEnd).toBeGreaterThanOrEqual(1000 + (getMovePlan(7)!.startAt - 1000) / speed);
});

it.each([false, true])("shows a paired activation card through target destruction until its source flight starts (reduced=%s)", (reduced) => {
  const view = render(<Board events={[]} reduced={reduced} />);
  view.rerender(<Board events={events} reduced={reduced} />);
  const image = view.container.querySelector(`img[src*="/cards/${C.mst.code}/image"]`)!;
  expect(image).not.toBeNull();
  const index = animate.mock.contexts.indexOf(image.parentElement);
  expect(index).toBeGreaterThanOrEqual(0);
  const timing = animate.mock.calls[index][1];
  const cleanupPlan = getMovePlan(7)!;
  expect(1000 + timing.delay + timing.duration).toBeGreaterThanOrEqual(cleanupPlan.startAt);
  if (reduced) expect(animate.mock.calls[index][0].some((frame: Keyframe) => typeof frame.transform === "string" && frame.transform.includes("rotateY"))).toBe(false);
});

it.each([false, true])("keeps a source ghost through a resolution arriving during activation (reduced=%s)", (reduced) => {
  const view = render(<Board events={[]} reduced={reduced} live />);
  view.rerender(<Board events={events.slice(0, 2)} reduced={reduced} live />);
  const ghost = view.container.querySelector(`img[src*="/cards/${C.mst.code}/image?size=small"]`)!.parentElement;
  expect(animate.mock.contexts).toContain(ghost);
  vi.mocked(performance.now).mockReturnValue(1100);
  view.rerender(<Board events={events} reduced={reduced} />);
  const index = animate.mock.contexts.lastIndexOf(ghost);
  const timing = animate.mock.calls[index][1];
  expect(1100 + timing.delay + timing.duration).toBeGreaterThanOrEqual(getMovePlan(7)!.startAt);
});

it("resumes the source copy after an activation completed in an earlier response window", async () => {
  const finish: Array<() => void> = [];
  animate.mockImplementation(() => ({ finished: new Promise<void>((resolve) => finish.push(resolve)), cancel: vi.fn() }));
  const view = render(<Board events={[]} reduced={false} live />);
  view.rerender(<Board events={events.slice(0, 2)} reduced={false} live />);
  const ghost = view.container.querySelector(`img[src*="/cards/${C.mst.code}/image?size=small"]`)!.parentElement;
  await act(async () => { finish.forEach((resolve) => resolve()); });
  expect(view.container.contains(ghost)).toBe(true);
  vi.mocked(performance.now).mockReturnValue(5000);
  view.rerender(<Board events={events} reduced={false} />);
  const index = animate.mock.contexts.lastIndexOf(ghost);
  const timing = animate.mock.calls[index][1];
  expect(timing.delay).toBeLessThan(0);
  expect(5000 + timing.delay + timing.duration).toBeGreaterThanOrEqual(getMovePlan(7)!.startAt);
});

it.each([false, true])("hands an activated source to destruction when another chain link destroys it (reduced=%s)", (reduced) => {
  const batch: DuelEvent[] = [
    { id: 1, kind: "activate", text: "Mirror Force", card: C.mirrorForce, zone: source, chainIndex: 1 },
    { id: 2, kind: "activate", text: "MST", card: C.mst, zone: { controller: 1, location: 8, sequence: 0 }, chainIndex: 2 },
    { id: 3, kind: "chain-resolving", text: "MST resolves", chainIndex: 2 },
    { id: 4, kind: "move", text: "destroy", card: C.mirrorForce, from: source, zone: { controller: 0, location: 16, sequence: 0 }, reason: "destroy" },
    { id: 5, kind: "chain-resolved", text: "resolved", chainIndex: 2 },
    { id: 6, kind: "destroy", text: "destroy", card: C.mirrorForce, zone: source, cause: "effect", sourceCode: C.mst.code, sourceKind: "spell", sourceSeat: 1 },
    { id: 7, kind: "chain-resolving", text: "Mirror Force resolves", chainIndex: 1 },
    { id: 8, kind: "chain-resolved", text: "resolved", chainIndex: 1 },
    { id: 9, kind: "chain-end", text: "end" },
  ];
  const view = render(<Board events={[]} reduced={reduced} />);
  view.rerender(<Board events={batch} reduced={reduced} />);
  const ghost = view.container.querySelector(`img[src*="/cards/${C.mirrorForce.code}/image"]`)!.parentElement;
  const index = animate.mock.contexts.indexOf(ghost);
  const timing = animate.mock.calls[index][1];
  const departure = getMovePlan(4)!;
  expect(1000 + timing.delay + timing.duration).toBeLessThanOrEqual(departure.startAt - departure.leadMs);
});


it("keeps a destroyed Set Trap upright despite its combined facedown position bits", () => {
  const view = render(<Board events={[]} reduced={false} />);
  view.rerender(<Board events={[{ id: 1, kind: "destroy", text: "destroy", card: C.mirrorForce,
    zone: source, fromPosition: 0xA, cause: "effect" }]} reduced={false} />);
  const whole = view.container.querySelector(`img[src*="/cards/${C.mirrorForce.code}/image"]`)!.parentElement!;
  expect(whole.parentElement!.style.rotate).toBe("");
});

it("starts a resolved Spell's Graveyard flight upright", () => {
  function FlightBoard({ batch }: { batch: DuelEvent[] }) {
    return <div>
      <div data-zones="0:8:0" data-side="you" data-defense="false"><span data-card-art /></div>
      <div data-zones="0:16:0" data-side="you" />
      <MoveFx events={batch} duelKey="render-sequence" reducedMotion={false} />
    </div>;
  }
  const view = render(<FlightBoard batch={[]} />);
  view.rerender(<FlightBoard batch={[{ id: 1, kind: "move", text: "cleanup", card: C.mst,
    from: source, fromPosition: 0x5, zone: { controller: 0, location: 16, sequence: 0 }, reason: "send" }]} />);
  const flight = animate.mock.calls.find(call => String(call[0][0]?.transform).startsWith("translate3d"));
  expect(flight).toBeDefined();
  expect(flight![0][0].transform).toContain("rotate(0.00deg)");
});

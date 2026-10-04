// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelClock, DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { MoveFx } from "@/components/duel/move-fx";
import { useStartBeats } from "@/components/duel/use-start-beats";
import { clearZoneSnapshots, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { resetPhaseBeats } from "@/components/duel/phase-beats";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const phase = (id: number, text: string): DuelEvent => ({ id, kind: "phase", text });
const opening: DuelEvent[] = [
  ...Array.from({ length: 10 }, (_, i): DuelEvent => ({ id: i + 1, kind: "move", reason: "draw", text: "Draw",
    handId: `${i < 5 ? "hand" : "sleeve"}-${i + 1}`,
    from: { controller: Math.floor(i / 5), location: 1, sequence: 0 },
    zone: { controller: Math.floor(i / 5), location: 2, sequence: i % 5 } })),
  phase(11, "Draw Phase"), phase(12, "Standby Phase"), phase(13, "Main Phase 1"),
];
const rect = { left: 0, top: 0, width: 70, height: 100, x: 0, y: 0, right: 70, bottom: 100, toJSON: () => ({}) };
let key: string;
let run = 0;

beforeEach(() => {
  vi.useFakeTimers();
  key = `opening-draw-order-${run++}`;
  resetMoveSchedule(key);
  resetPhaseBeats(key);
  clearZoneSnapshots();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(rect);
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: (_frames: Keyframe[], options: KeyframeAnimationOptions) => {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const timer = window.setTimeout(resolve, Number(options.duration ?? 0) + Number(options.delay ?? 0));
    return { finished, cancel: () => { window.clearTimeout(timer); resolve(); } };
  } });
});
afterEach(() => {
  cleanup(); clearZoneSnapshots(); vi.useRealTimers(); vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
});

function Hands({ deck = 35 }: { deck?: number }) {
  return <div>
    {[0, 1].map((seat) => <div key={seat}>
      <div data-zones={`${seat}:1:0`} data-side={seat === 0 ? "you" : "opp"}><b data-testid={`deck-${seat}`} data-pile-count={deck}>{deck}</b></div>
      <div data-hand-seat={seat} data-side={seat === 0 ? "you" : "opp"}>
        {Array.from({ length: 5 }, (_, sequence) => <div key={sequence} data-hand-card="true" data-hand-id={`${seat === 0 ? "hand" : "sleeve"}-${seat * 5 + sequence + 1}`}>
          <div data-zones={`${seat}:2:${sequence}`} data-side={seat === 0 ? "you" : "opp"} />
        </div>)}
      </div>
    </div>)}
  </div>;
}

type RoomProps = { events?: DuelEvent[]; clock?: DuelClock | null; ready?: boolean; recovering?: boolean; reduced?: boolean };

/** The room's wiring of useStartBeats into the move layer, with the same hand-over and the same layer gate. */
function Room({ events = opening, clock, ready = true, recovering = false, reduced = false }: RoomProps) {
  const beats = useStartBeats({ engine: { revision: 0, turn: 1, phase: "main1", events } as DuelEngineView, clock, duelKey: key, reducedMotion: reduced, ready, recovering });
  return <div>
    <Hands />
    {ready && (!recovering || beats.dealing) ? <MoveFx events={events} duelKey={key} reducedMotion={reduced} replayFrom={beats.replayFrom} skipThrough={beats.skipThrough} /> : null}
  </div>;
}

const graceClock = (leftMs: number): DuelClock => ({ startedAt: Date.now() + leftMs, serverNow: Date.now() } as DuelClock);
/** Advances in small steps and commits after each one, so ghosts mount at their scheduled starts. */
async function tick(ms: number) {
  for (let left = ms; left > 0; left -= 10) await act(async () => { await vi.advanceTimersByTimeAsync(Math.min(10, left)); });
}

/**
 * Watches the hands for `total` ms: when each drawn card went from hidden (waiting for its flight) to visible
 * (landed), the most flights in the air at once, and what the Deck of seat 0 showed over time.
 */
async function watch(view: ReturnType<typeof render>, total: number) {
  const hiddenAtStart = new Set<string>();
  const landed = new Map<string, number>();
  const deck: number[] = [];
  let ghosts = 0;
  const start = performance.now();
  for (let first = true; performance.now() - start <= total; first = false) {
    for (const card of view.container.querySelectorAll<HTMLElement>("[data-hand-id]")) {
      const id = card.dataset.handId!;
      const hidden = card.querySelector<HTMLElement>("[data-zones]")!.style.visibility === "hidden";
      if (first && hidden) hiddenAtStart.add(id);
      if (!hidden && hiddenAtStart.has(id) && !landed.has(id)) landed.set(id, performance.now() - start);
    }
    ghosts = Math.max(ghosts, view.container.querySelectorAll('[data-style="draw"], [data-style="fade"]').length);
    const shown = Number(view.getByTestId("deck-0").textContent);
    if (deck[deck.length - 1] !== shown) deck.push(shown);
    await tick(10);
  }
  return { hiddenAtStart, landed, deck, ghosts };
}

const sorted = (landed: Map<string, number>) => [...landed.entries()].sort((a, b) => a[1] - b[1]);
const ORDER = ["hand-1", "hand-2", "hand-3", "hand-4", "hand-5", "sleeve-6", "sleeve-7", "sleeve-8", "sleeve-9", "sleeve-10"];

describe("the draw queue paces a deal card by card", () => {
  const options = (reduced: boolean) => ({ now: 0, reduced, duelKey: key, geometry: () => ({ distance: 300 }) });

  it("plans 5 cards as 5 flights in order, one every 0.15-0.25 s, with no two at once", () => {
    const plans = planMoves(opening.slice(0, 5), options(false));
    expect(plans.map((plan) => plan.id)).toEqual([1, 2, 3, 4, 5]);
    for (let i = 1; i < plans.length; i += 1) {
      const gap = plans[i].startAt - plans[i - 1].startAt;
      expect(gap).toBeGreaterThanOrEqual(150);
      expect(gap).toBeLessThanOrEqual(250);
    }
    // The hand is full in about one second: the first card starts at once, the last one lands within 1.4 s.
    expect(plans[0].startAt).toBe(0);
    expect(plans[4].landAt).toBeLessThanOrEqual(1400);
    expect(plans.every((plan) => plan.durationMs === 480)).toBe(true);
  });

  it("plans both opening hands as 10 flights that keep the engine order", () => {
    const plans = planMoves(opening.filter((event) => event.kind === "move"), options(false));
    expect(plans).toHaveLength(10);
    expect(plans.map((plan) => plan.startAt)).toEqual([...plans.map((plan) => plan.startAt)].sort((a, b) => a - b));
    expect(new Set(plans.map((plan) => plan.startAt)).size).toBe(10);
    expect(plans[9].landAt).toBeLessThanOrEqual(2500);
  });

  it("keeps reduced motion in order with short fades", () => {
    const plans = planMoves(opening.slice(0, 5), options(true));
    expect(plans.map((plan) => plan.startAt)).toEqual([0, 200, 400, 600, 800]);
    expect(plans.every((plan) => plan.style === "fade" && plan.durationMs === 150)).toBe(true);
  });

  it("keeps the ordinary pace for a lone draw and for a two-card draw effect", () => {
    const two = planMoves(opening.slice(0, 2), options(false));
    expect(two[0].durationMs).toBe(667);
    expect(two[1].startAt - two[0].startAt).toBeGreaterThan(400);
  });
});

describe("the opening deal through the room hand-over", () => {
  it("lands the cards one by one in order, and the Deck counts down card by card", async () => {
    const view = render(<Room clock={graceClock(8000)} />);
    const { hiddenAtStart, landed, deck, ghosts } = await watch(view, 4500);
    // Nothing is in the hand before its flight: every drawn card waits hidden at the start.
    expect(hiddenAtStart.size).toBe(10);
    expect(sorted(landed).map(([id]) => id)).toEqual(ORDER);
    const times = sorted(landed).map(([, at]) => at);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(150);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeLessThanOrEqual(260);
    expect(times[4]).toBeLessThanOrEqual(1500);
    expect(ghosts).toBeLessThanOrEqual(4);
    // Seat 0 drew first: 5 cards still to leave at the start (40), then one fewer per flight, down to 35.
    expect(deck[0]).toBe(39);
    expect(deck.at(-1)).toBe(35);
    expect(deck).toEqual([...deck].sort((a, b) => b - a));
    expect(new Set(deck).size).toBe(5);
  });

  it("keeps the cards flying one by one when the connection blips while they deal", async () => {
    const clock = graceClock(8000);
    const view = render(<Room clock={clock} />);
    await tick(700);
    // A window focus raises `recovering` for a moment: the layers must stay up.
    view.rerender(<Room clock={clock} recovering />);
    await tick(250);
    view.rerender(<Room clock={clock} />);
    const { landed } = await watch(view, 4000);
    const before = new Set(ORDER.filter((id) => !landed.has(id)));
    // Cards 1 and 2 had landed (or were in flight) before the blip; every later card still lands alone, in order.
    const times = sorted(landed).map(([, at]) => at);
    expect(sorted(landed).map(([id]) => id)).toEqual(ORDER.filter((id) => landed.has(id)));
    expect(landed.size + before.size).toBe(10);
    expect(landed.size).toBeGreaterThanOrEqual(7);
    for (let i = 1; i < times.length; i += 1) expect(times[i] - times[i - 1]).toBeGreaterThanOrEqual(150);
  });

  it("deals in order under reduced motion", async () => {
    const view = render(<Room clock={graceClock(8000)} reduced />);
    // The real cards stay in place (a short fade plays over them); the Deck still counts down card by card.
    const { hiddenAtStart, deck, ghosts } = await watch(view, 4000);
    expect(hiddenAtStart.size).toBe(0);
    expect(ghosts).toBeGreaterThan(0);
    expect(deck[0]).toBe(39);
    expect(deck.at(-1)).toBe(35);
    expect(deck).toEqual([...deck].sort((a, b) => b - a));
  });

  it("does not replay the deal after the player reloads late", async () => {
    // A reload after the grace time: the clock already runs, so the opening is history.
    const view = render(<Room clock={graceClock(-3000)} />);
    const { hiddenAtStart, ghosts } = await watch(view, 300);
    expect(hiddenAtStart.size).toBe(0);
    expect(ghosts).toBe(0);
    expect(view.container.querySelectorAll('[data-style="draw"], [data-style="fade"]')).toHaveLength(0);
  });

  it("does not replay the deal when the room remounts after it was shown", async () => {
    const clock = graceClock(8000);
    const first = render(<Room clock={clock} />);
    await watch(first, 3500);
    first.unmount();
    const again = render(<Room clock={clock} />);
    const { hiddenAtStart, ghosts } = await watch(again, 300);
    expect(hiddenAtStart.size).toBe(0);
    expect(ghosts).toBe(0);
  });

  it("does not play the deal when the layers were not mounted yet and the grace time ran out", async () => {
    const clock = graceClock(1500);
    const view = render(<Room clock={clock} ready={false} />);
    await tick(400);
    view.rerender(<Room clock={clock} />);
    const { hiddenAtStart, ghosts } = await watch(view, 300);
    expect(hiddenAtStart.size).toBe(0);
    expect(ghosts).toBe(0);
  });
});

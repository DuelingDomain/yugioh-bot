// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

import { MoveFx } from "@/components/duel/move-fx";
import { CardStrip, type StripCard } from "@/components/duel/card-strip";
import { showcasePhases } from "@/components/duel/add-to-hand";
import { ADD_TO_HAND, CARD_FX } from "@/components/duel/duel-timing";
import { resetMoveSchedule } from "@/components/duel/move-plan";
import { resetPickRects, takePickRect } from "@/components/duel/pick-rects";

const HAND = 0x02;
const GRAVE = 0x10;
const info = (code: number) => ({ code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 1, attribute: 1, race: "Warrior" });

const addEvent = (extra: Partial<DuelEvent> = {}): DuelEvent =>
  ({
    id: 5,
    kind: "move",
    text: "added",
    seat: 0,
    from: { controller: 0, location: GRAVE, sequence: 0 },
    zone: { controller: 0, location: HAND, sequence: 3 },
    card: info(1234),
    ...extra,
  }) as DuelEvent;

/** A hand with one slot (the added card), the way field.tsx draws it, and the flight layer next to it. */
function Board({ events, reduced = false, slotCode = 1234, handId, sequence = 3 }: { events: DuelEvent[]; reduced?: boolean; slotCode?: number; handId?: string; sequence?: number }) {
  return (
    <div data-testid="board">
      <div data-hand-seat="0" data-side="you">
        <div key={handId} data-hand-card="true" data-hand-id={handId}>
          <div data-testid="slot" data-zones={`0:2:${sequence}`} data-side="you">
            {slotCode > 0 ? <span data-card-art><img src={`/api/cards/${slotCode}/image?size=small`} alt="" /></span> : <span data-card-art />}
          </div>
        </div>
      </div>
      <MoveFx events={events} duelKey="room" reducedMotion={reduced} />
    </div>
  );
}

const boxes = new Map<string, { left: number; top: number; width: number; height: number }>();
let animate: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  resetMoveSchedule("room");
  resetPickRects();
  boxes.set("slot", { left: 500, top: 700, width: 70, height: 100 });
  boxes.set("layer", { left: 0, top: 0, width: 1200, height: 800 });
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const b = this.hasAttribute("data-zones") ? boxes.get("slot") : this.getAttribute("aria-hidden") === "true" && this.tagName === "DIV" ? boxes.get("layer") : undefined;
    const r = b ?? { left: 0, top: 0, width: 0, height: 0 };
    return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r } as DOMRect;
  });
  animate = vi.fn(() => ({ finished: Promise.resolve(), cancel: vi.fn(), getComputedTiming: () => ({ progress: 0 }) }));
  Object.defineProperty(Element.prototype, "animate", { configurable: true, writable: true, value: animate });
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, writable: true, value: () => [] });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete (Element.prototype as unknown as Record<string, unknown>).animate;
  delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
});

const advance = (ms: number) => act(() => { vi.advanceTimersByTime(ms); });

/** Mounts the board with no events, then delivers the move (the first render only sets the cursor). */
function deliver(event: DuelEvent, props: { reduced?: boolean; slotCode?: number; handId?: string } = {}) {
  const view = render(<Board events={[]} {...props} />);
  view.rerender(<Board events={[event]} {...props} />);
  return view;
}

describe("the Added to hand showcase on the board", () => {
  it.each([0x01, GRAVE, 0x20, 0x04, 0x40])("plays just one landing glow for an effect arrival from %s", (source) => {
    const view = deliver(addEvent({ addedToHand: true, from: { controller: 0, location: source, sequence: 0 } }));
    const ring = view.getByTestId("added-ring");
    advance(showcasePhases(1, false).totalMs + 5);
    expect(animate.mock.contexts.filter((el) => el === ring)).toHaveLength(1);
    expect(view.getByTestId("slot").parentElement?.dataset.handArrived).toBeUndefined();
  });
  it("keeps the fading ghost and landing ring on the card when the engine re-sequences just after landing", () => {
    const event = addEvent({ handId: "arrival" });
    const view = deliver(event, { handId: "arrival" });
    const phases = showcasePhases(1, false);
    advance(phases.riseMs + phases.holdMs + phases.flyMs + 20);
    expect(view.getByTestId("slot").style.visibility).toBe("");
    boxes.set("slot", { left: 200, top: 700, width: 70, height: 100 });
    view.rerender(<Board events={[event]} handId="arrival" sequence={1} />);
    advance(20);
    expect(view.getByTestId("added-ring").style.left).toBe("200px");
    const ghost = view.getByTestId("added-ghost");
    expect(Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2).toBe(235);
    expect(view.getByTestId("slot").parentElement?.dataset.handArrived).toBeUndefined();
    expect(animate.mock.contexts.filter((el) => el === view.getByTestId("added-ring"))).toHaveLength(1);
  });
  it("follows a new engine slot during the flight before showing the real card", () => {
    const view = deliver(addEvent({ handId: "arrival" }), { handId: "arrival" });
    const phases = showcasePhases(1, false);
    advance(phases.riseMs + phases.holdMs + phases.flyMs / 2);
    boxes.set("slot", { left: 200, top: 700, width: 70, height: 100 });
    view.rerender(<Board events={[addEvent({ handId: "arrival" })]} handId="arrival" sequence={1} />);
    advance(phases.flyMs / 2);
    expect(view.getByTestId("slot").style.visibility).toBe("hidden");
    const correction = animate.mock.calls.find((call) => (call[1] as { duration: number }).duration === CARD_FX.glideMs);
    expect(correction).toBeDefined();
    expect(String((correction![0] as Keyframe[]).at(-1)?.transform)).toContain("-300.00px");
    advance(CARD_FX.glideMs + 1);
    expect(view.getByTestId("slot").style.visibility).toBe("");
    expect(view.getByTestId("added-ring").style.left).toBe("200px");
  });
  it.each([true, false])("lands on the same hand card through an in-flight engine shuffle (known=%s)", (known) => {
    const event = addEvent({ handId: "arrival", card: known ? info(1234) : undefined });
    const props = { handId: "arrival", slotCode: known ? 1234 : 0 };
    const view = render(<Board events={[]} {...props} />);
    view.rerender(<Board events={[event]} {...props} />);
    const slot = view.getByTestId("slot");
    advance(200);
    view.rerender(<Board events={[event]} {...props} sequence={0} />);
    expect(view.getByTestId("slot")).toBe(slot);
    expect(slot.style.visibility).toBe("hidden");
    advance(showcasePhases(1, false).totalMs);
    expect(slot.style.visibility).toBe("");
    expect(slot.parentElement?.dataset.handArrived).toBeUndefined();
    expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe(String(known));
  });

  it("does not hide or highlight a replacement if the arrival leaves before landing", () => {
    const event = addEvent({ handId: "arrival" });
    const view = render(<Board events={[]} handId="arrival" />);
    view.rerender(<Board events={[event]} handId="arrival" />);
    advance(200);
    view.rerender(<Board events={[event]} handId="replacement" slotCode={777} />);
    expect(view.getByTestId("slot").style.visibility).toBe("");
    advance(showcasePhases(1, false).totalMs);
    expect(view.getByTestId("slot").parentElement?.dataset.handArrived).toBeUndefined();
    const ghost = view.getByTestId("added-ghost");
    expect(animate.mock.contexts.some((el, index) => el === ghost && (animate.mock.calls[index][1] as KeyframeAnimationOptions).duration === showcasePhases(1, false).flyMs)).toBe(true);
    expect(animate.mock.contexts).not.toContain(view.getByTestId("added-ring"));
  });
  it("plays an add then discard from the same chain even when the final hand has no arrival", () => {
    const added = addEvent({ handId: "departed-5" });
    const discarded: DuelEvent = { ...added, id: 6, handId: undefined, from: added.zone, zone: { controller: 0, location: GRAVE, sequence: 0 }, reason: "discard" };
    const view = render(<Board events={[]} handId="replacement" slotCode={777} />);
    view.rerender(<Board events={[added, discarded]} handId="replacement" slotCode={777} />);
    const slot = view.getByTestId("slot");
    expect(slot.style.visibility).toBe("");
    const ghost = view.getByTestId("added-ghost");
    expect(view.getByTestId("added-label").textContent).toContain("Added to hand");
    advance(showcasePhases(1, false).totalMs);
    expect(animate.mock.contexts.some((el, index) => el === ghost && (animate.mock.calls[index][1] as KeyframeAnimationOptions).duration === showcasePhases(1, false).flyMs)).toBe(true);
    expect(animate.mock.contexts).not.toContain(view.getByTestId("added-ring"));
    expect(slot.style.visibility).toBe("");
  });
  it("shows the card large with the label and its source, then lands it in the hand: hidden until then", () => {
    const view = deliver(addEvent());
    const slot = view.getByTestId("slot");
    const phases = showcasePhases(1, false);
    // The real hand card waits invisible from the first moment: it is never seen twice.
    expect(slot.style.visibility).toBe("hidden");
    expect(view.getByTestId("added-ghost")).toBeTruthy();
    expect(view.getByTestId("added-label").textContent).toContain("Added to hand");
    expect(view.getByTestId("added-label").textContent).toContain("from GY");

    advance(phases.riseMs + phases.holdMs - 20);
    expect(slot.style.visibility).toBe("hidden");
    expect(view.queryByTestId("added-ghost")).not.toBeNull();

    // It flies in, lands, and the real card takes over under the ring of light.
    advance(20 + phases.flyMs + 5);
    expect(slot.style.visibility).toBe("");
    expect(slot.parentElement?.dataset.handArrived).toBeUndefined();
    expect(view.getByTestId("added-ring").style.width).toBe("70px");
    expect(animate.mock.contexts.filter((el) => el === view.getByTestId("added-ring"))).toHaveLength(1);

    advance(ADD_TO_HAND.glowMs + 50);
    expect(view.queryByTestId("added-ghost")).toBeNull();
    expect(slot.style.visibility).toBe("");
    advance(1250);
    expect(slot.parentElement?.dataset.handArrived).toBeUndefined();
  });

  it("animates a rise, a hold and a flight with the face of the card", () => {
    const view = deliver(addEvent());
    const ghost = view.getByTestId("added-ghost");
    expect(ghost.getAttribute("data-known")).toBe("true");
    expect(ghost.querySelector("img")?.getAttribute("src")).toContain("/api/cards/1234/image");
    // Stage animation on the card, the aura and the label.
    const durations = animate.mock.calls.map((call) => (call[1] as { duration: number }).duration);
    const phases = showcasePhases(1, false);
    expect(durations.filter((d) => d === phases.riseMs + phases.holdMs).length).toBeGreaterThanOrEqual(3);
    advance(phases.riseMs + phases.holdMs + 1);
    expect(animate.mock.calls.some((call) => (call[1] as { duration: number }).duration === phases.flyMs)).toBe(true);
  });

  it("shows a card back for a card the viewer cannot see, and turns it over when the engine reveals it", () => {
    const view = deliver(addEvent({ card: undefined, from: { controller: 0, location: 0x01, sequence: 0 }, addedToHand: true } as Partial<DuelEvent>), { slotCode: 0 });
    const ghost = view.getByTestId("added-ghost");
    expect(ghost.getAttribute("data-known")).toBe("false");
    expect(ghost.querySelector("img")).toBeNull();
    expect(view.getByTestId("added-label").textContent).toContain("Added to hand");
    // A reveal puts the face in the hand slot.
    const art = view.getByTestId("slot").querySelector("[data-card-art]")!;
    art.innerHTML = '<img src="/api/cards/777/image?size=small" alt="" />';
    advance(300);
    expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe("true");
    expect(view.getByTestId("added-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
  });

  it("fades in and out with the label under reduced motion, and shows the hand card as it fades out", () => {
    const view = deliver(addEvent(), { reduced: true });
    const slot = view.getByTestId("slot");
    const phases = showcasePhases(1, true);
    expect(slot.style.visibility).toBe("hidden");
    expect(view.getByTestId("added-label").textContent).toContain("Added to hand");
    // No travel: no keyframe moves the card away from the showcase spot.
    const stage = animate.mock.calls.find((call) => (call[1] as { duration: number }).duration === phases.riseMs + phases.holdMs)!;
    const spots = new Set((stage[0] as Keyframe[]).map((frame) => String(frame.transform)));
    expect(spots.size).toBe(1);
    advance(phases.riseMs + phases.holdMs + 5);
    expect(slot.style.visibility).toBe("");
    expect(slot.parentElement?.dataset.handArrived).toBeUndefined();
    expect(animate.mock.contexts).not.toContain(view.getByTestId("added-ring"));
    advance(phases.flyMs + 20);
    expect(view.queryByTestId("added-ghost")).toBeNull();
  });

  it("keeps a normal draw out of the showcase", () => {
    const view = deliver(addEvent({ reason: "draw", from: { controller: 0, location: 0x01, sequence: 0 } }));
    expect(view.queryByTestId("added-ghost")).toBeNull();
    advance(1000);
    expect(view.getByTestId("slot").parentElement?.dataset.handArrived).toBeUndefined();
  });
});

describe("the card strip remembers where its cards are", () => {
  const strip = (): StripCard[] => [11, 22].map((code) => ({ id: `c${code}`, card: info(code), label: `Card ${code}`, selected: false, order: null, location: GRAVE }));

  it("records the rect of each card while open and keeps it for the flight after it closes", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
      const code = Number(this.dataset.stripCode ?? 0);
      // The strip itself is wide; each card sits at 10 px per passcode.
      const r = code > 0 ? { left: code * 10, top: 300, width: 120, height: 170 } : { left: 0, top: 280, width: 2000, height: 220 };
      return { ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => r } as DOMRect;
    });
    const view = render(<CardStrip items={strip()} highlight={0} busy={false} multi={false} label="Pick" onPick={() => {}} />);
    expect(view.container.querySelector('[data-strip-code="22"]')?.getAttribute("data-strip-loc")).toBe(String(GRAVE));
    view.unmount();
    expect(takePickRect(22, GRAVE, performance.now())).toEqual({ left: 220, top: 300, width: 120, height: 170 });
    expect(takePickRect(11, GRAVE, performance.now())).toEqual({ left: 110, top: 300, width: 120, height: 170 });
    expect(takePickRect(11, GRAVE, performance.now())).toBeNull();
  });
});

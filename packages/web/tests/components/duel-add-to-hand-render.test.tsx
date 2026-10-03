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

import { HandIdentities } from "../../../duel-server/src/hand-identities";

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
function Board({ events, reduced = false, slotCode = 1234, handId, sequence = 3, slotZone = `0:2:${sequence}`, side = "you", replayFrom = null, duelKey = "room" }: { events: DuelEvent[]; reduced?: boolean; slotCode?: number; handId?: string; sequence?: number; slotZone?: string; side?: "you" | "opp"; replayFrom?: number | null; duelKey?: string }) {
  return (
    <div data-testid="board">
      <div data-hand-seat="0" data-side={side}>
        <div key={handId} data-hand-card="true" data-hand-id={handId}>
          <div data-testid="slot" data-zones={slotZone} data-side={side}>
            {slotCode > 0 ? <span data-card-art><img src={`/api/cards/${slotCode}/image?size=small`} alt="" /></span> : <span data-card-art />}
          </div>
        </div>
      </div>
      <MoveFx events={events} duelKey={duelKey} reducedMotion={reduced} replayFrom={replayFrom} />
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
    expect(view.getByTestId("added-ring").style.width).toBe("70px");
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
    expect(Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2 + (Number.parseFloat(ghost.style.translate) || 0)).toBe(235);
    expect(view.getByTestId("added-ring").style.top).toBe("700px");
    expect(animate.mock.contexts.filter((el) => el === view.getByTestId("added-ring"))).toHaveLength(1);
  });
  it("retargets in flight and lands on the live engine slot without a second glide", () => {
    const view = deliver(addEvent({ handId: "arrival" }), { handId: "arrival" });
    const phases = showcasePhases(1, false);
    advance(phases.riseMs + phases.holdMs + phases.flyMs / 2);
    boxes.set("slot", { left: 200, top: 700, width: 70, height: 100 });
    view.rerender(<Board events={[addEvent({ handId: "arrival" })]} handId="arrival" sequence={1} />);
    advance(phases.flyMs / 2);
    expect(view.getByTestId("slot").style.visibility).toBe("");
    const correction = animate.mock.calls.find((call) => (call[1] as { duration: number }).duration === CARD_FX.glideMs);
    expect(correction).toBeUndefined();
    const ghost = view.getByTestId("added-ghost");
    expect(Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2 + (Number.parseFloat(ghost.style.translate) || 0)).toBe(235);
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
    expect(view.getByTestId("added-ring").style.width).toBe("70px");
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
    expect(view.getByTestId("added-ring").style.width).toBe("");
    const ghost = view.getByTestId("added-ghost");
    expect(animate.mock.contexts.some((el, index) => el === ghost && (animate.mock.calls[index][1] as KeyframeAnimationOptions).duration === showcasePhases(1, false).flyMs)).toBe(true);
    expect(animate.mock.contexts).not.toContain(view.getByTestId("added-ring"));
  });
  it("hides the live opponent sleeve for a same-batch append and private SHUFFLE_HAND", () => {
    const ids = new HandIdentities();
    [10, 20, 30, 40].forEach((code, sequence) => ids.add(0, code, sequence));
    // The core appends every non-draw hand arrival, then shuffles before publishing its view.
    ids.add(0, 1234, 4, 5);
    ids.shuffle(0, [1234, 20, 10, 40, 30]);
    ids.syncPublic(0, [1234, 20, 10, 40, 30].map((code) => ({ code, isPublic: false })));
    const handId = ids.at(0, false, 4)!;
    const event = addEvent({ handId: ids.arrival(0, false, 5)?.id ?? "departed-5", card: undefined,
      from: { controller: 0, location: 0x01, sequence: 0 }, zone: { controller: 0, location: HAND, sequence: 4 }, addedToHand: true });
    const view = deliver(event, { handId, slotCode: 0 });
    expect(event.handId).toBe(handId);
    expect(view.getByTestId("slot").style.visibility).toBe("hidden");
    advance(300);
    expect(view.getByTestId("slot").style.visibility).toBe("hidden");
    expect(view.getByTestId("added-ghost").dataset.known).toBe("false");
    expect(view.getByTestId("added-ghost").querySelector("img")).toBeNull();
    advance(showcasePhases(1, false).totalMs);
    expect(view.getByTestId("slot").style.visibility).toBe("");
    expect(animate.mock.contexts).toContain(view.getByTestId("added-ring"));
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
    expect(view.getByTestId("added-ring").style.width).toBe("70px");
    expect(animate.mock.contexts.filter((el) => el === view.getByTestId("added-ring"))).toHaveLength(1);

    advance(ADD_TO_HAND.glowMs + 50);
    expect(view.queryByTestId("added-ghost")).toBeNull();
    expect(slot.style.visibility).toBe("");
    expect(view.queryByTestId("added-ring")).toBeNull();
    advance(1250);
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
    // Confirmation identity survives even though SHUFFLE_HAND leaves the slot redacted.
    const move = addEvent({ card: undefined, from: { controller: 0, location: 0x01, sequence: 0 }, addedToHand: true });
    view.rerender(<Board events={[move, { id: 6, kind: "confirm", moveId: 5, text: "Confirmed Card 777", seat: 0, zone: move.zone, card: info(777) }]} slotCode={0} />);
    advance(300);
    expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe("true");
    expect(view.getByTestId("added-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    expect(view.getByTestId("slot").querySelector("img")).toBeNull();
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
    expect(animate.mock.contexts).not.toContain(view.getByTestId("added-ring"));
    advance(phases.flyMs + 20);
    expect(view.queryByTestId("added-ghost")).toBeNull();
  });


  it("uses a same-snapshot confirmation for a hidden hand slot", () => {
    const move = addEvent({ card: undefined, from: { controller: 0, location: 1, sequence: 0 }, addedToHand: true });
    const view = render(<Board events={[]} slotCode={0} />);
    view.rerender(<Board events={[move, { id: 6, kind: "confirm", text: "Confirmed Card 777", moveId: 5, zone: move.zone, card: info(777) }]} slotCode={0} />);
    expect(view.getByTestId("added-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });

  it.each([
    { later: false, reduced: false },
    { later: false, reduced: true },
    { later: true, reduced: false },
    { later: true, reduced: true },
  ])("shows the real opponent search pair in the addition showcase (later=$later, reduced=$reduced)", ({ later, reduced }) => {
    // Exact public event pair from the stock-core search-reveal proof snapshot.
    const move: DuelEvent = {
      id: 17, kind: "move", text: "A card moved", seat: 0,
      from: { controller: 0, location: 1, sequence: 0 },
      zone: { controller: 0, location: 2, sequence: 4 },
      reason: "add", addedToHand: true,
    };
    const confirm: DuelEvent = {
      id: 18, kind: "confirm", text: "Confirmed Kojikocy", seat: 0,
      zone: { controller: 0, location: 2, sequence: 4 }, moveId: 17,
      card: { code: 1184620, name: "Kojikocy",
        description: "A man-hunter with powerful arms that can crush boulders.",
        type: 17, attack: 1500, defense: 1200, level: 4, attribute: 1, race: "warrior" },
    };
    const props = { slotCode: 0, slotZone: "0:2:4", side: "opp" as const, reduced };
    const view = render(<Board events={[]} {...props} />);
    if (later) {
      view.rerender(<Board events={[move]} {...props} />);
      expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe("false");
      expect(view.getByTestId("added-ghost").querySelector("img")).toBeNull();
      advance(200);
    }
    view.rerender(<Board events={[move, confirm]} {...props} />);
    expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe("true");
    expect(view.getByTestId("added-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/1184620/image");
    expect(view.getByTestId("added-label").textContent).toContain("Opponent · from Deck");
    expect(view.getByTestId("slot").querySelector("img")).toBeNull();
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
    advance(300);
    expect(view.queryByTestId("added-ghost")).not.toBeNull();
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });

  it.each([false, true])("briefly shows a field confirmation while its zone stays redacted (reduced=%s)", (reduced) => {
    const confirm: DuelEvent = { id: 6, kind: "confirm", text: "Confirmed Card 777", zone: { controller: 0, location: 8, sequence: 0 }, card: info(777) };
    const view = render(<Board events={[]} reduced={reduced} slotCode={0} slotZone="0:8:0" side="opp" />);
    view.rerender(<Board events={[confirm]} reduced={reduced} slotCode={0} slotZone="0:8:0" side="opp" />);
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    expect(view.getByTestId("confirmed-label").textContent).toContain("Confirmed");
    expect(view.getByTestId("slot").querySelector("img")).toBeNull();
    advance(3000);
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });



  it("retains confirmation identity when a queued showcase outlives the rolling event window", () => {
    const move = addEvent({ card: undefined, from: { controller: 0, location: 1, sequence: 0 }, addedToHand: true });
    const next = { ...move, id: 6 };
    const view = render(<Board events={[]} slotCode={0} />);
    view.rerender(<Board events={[move, next, { id: 7, kind: "confirm", text: "Confirmed Card 777", moveId: 6, zone: next.zone, card: info(777) }]} slotCode={0} />);
    view.rerender(<Board events={[{ id: 8, kind: "phase", text: "Main Phase 1" }]} slotCode={0} />);
    advance(2300);
    expect([...view.container.querySelectorAll('[data-testid="added-ghost"] img')].some((image) => image.getAttribute("src")?.includes("/api/cards/777/image"))).toBe(true);
  });

  it("shows a confirmation that arrives after the addition animation finished", () => {
    const move = addEvent({ card: undefined, from: { controller: 0, location: 1, sequence: 0 }, addedToHand: true });
    const view = deliver(move, { slotCode: 0 });
    advance(4000);
    expect(view.queryByTestId("added-ghost")).toBeNull();
    view.rerender(<Board events={[move, { id: 6, kind: "confirm", text: "Confirmed Card 777", moveId: 5, zone: move.zone, card: info(777) }]} slotCode={0} />);
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    expect(view.getByTestId("slot").querySelector("img")).toBeNull();
    advance(1600);
    view.rerender(<Board events={[move, { id: 6, kind: "confirm", text: "Confirmed Card 777", moveId: 5, zone: move.zone, card: info(777) }]} slotCode={0} />);
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });

  it("routes a confirmation after landing only to the standalone presentation", () => {
    const move = addEvent({ card: undefined, from: { controller: 0, location: 1, sequence: 0 }, addedToHand: true });
    const view = deliver(move, { slotCode: 0 });
    advance(showcasePhases(1, false).totalMs + 1);
    expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe("false");
    view.rerender(<Board events={[move, { id: 6, kind: "confirm", text: "Confirmed Card 777", moveId: 5, zone: move.zone, card: info(777) }]} slotCode={0} />);
    expect(view.getByTestId("added-ghost").getAttribute("data-known")).toBe("false");
    expect(view.getByTestId("added-ghost").querySelector("img")).toBeNull();
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    advance(1600);
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });

  it("shows multiple confirmed cards one at a time", () => {
    const first: DuelEvent = { id: 6, kind: "confirm", text: "Confirmed Card 777", card: info(777) };
    const second: DuelEvent = { id: 7, kind: "confirm", text: "Confirmed Card 888", card: info(888) };
    const view = render(<Board events={[]} slotCode={0} />);
    view.rerender(<Board events={[first, second]} slotCode={0} />);
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    advance(1510);
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/888/image");
    advance(1600);
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });

  it("presents a replayed standalone confirmation once under Strict Mode", () => {
    // Time can advance between Strict Mode's first setup and its replay.
    vi.spyOn(performance, "now").mockReturnValueOnce(1000).mockReturnValue(1020);
    const event: DuelEvent = { id: 6, kind: "confirm", text: "Confirmed Card 777", card: info(777) };
    const view = render(<React.StrictMode><Board events={[event]} replayFrom={0} slotCode={0} /></React.StrictMode>);
    expect(view.getAllByTestId("confirmed-ghost")).toHaveLength(1);
    advance(1490);
    expect(view.getAllByTestId("confirmed-ghost")).toHaveLength(1);
    advance(20);
    expect(view.queryAllByTestId("confirmed-ghost")).toHaveLength(0);
    advance(1600);
    expect(view.queryAllByTestId("confirmed-ghost")).toHaveLength(0);
  });

  it("preserves queued replay confirmations through Strict Mode cleanup and presents each once", () => {
    const events: DuelEvent[] = [777, 888].map((code, index) => ({ id: 6 + index, kind: "confirm", text: `Confirmed Card ${code}`, card: info(code) }));
    const view = render(<React.StrictMode><Board events={events} replayFrom={0} slotCode={0} /></React.StrictMode>);
    expect(view.getAllByTestId("confirmed-ghost")).toHaveLength(1);
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    advance(1510);
    expect(view.getAllByTestId("confirmed-ghost")).toHaveLength(1);
    expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/888/image");
    advance(1600);
    expect(view.queryAllByTestId("confirmed-ghost")).toHaveLength(0);
  });

  it("allows the same confirmation id in a new duel", () => {
    const event: DuelEvent = { id: 6, kind: "confirm", text: "Confirmed Card 777", card: info(777) };
    const view = render(<Board events={[event]} replayFrom={0} slotCode={0} />);
    expect(view.getByTestId("confirmed-ghost")).toBeTruthy();
    advance(1600);
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
    view.rerender(<Board events={[event]} replayFrom={0} slotCode={0} duelKey="next-room" />);
    expect(view.getByTestId("confirmed-ghost")).toBeTruthy();
  });

  it.each([0, 1, null])("only presents a recipient-only field confirmation in viewer %s's overlay", (viewer) => {
    const event: DuelEvent = { id: 6, kind: "confirm", zone: { controller: 1, location: 4, sequence: 0 },
      text: viewer === 0 ? "Confirmed Card 777" : "A card was confirmed",
      card: viewer === 0 ? info(777) : undefined,
    };
    const view = render(<Board events={[]} slotCode={0} slotZone="1:4:0" />);
    view.rerender(<Board events={[event]} slotCode={0} slotZone="1:4:0" />);
    if (viewer === 0) expect(view.getByTestId("confirmed-ghost").querySelector("img")?.getAttribute("src")).toContain("/api/cards/777/image");
    else expect(view.queryByTestId("confirmed-ghost")).toBeNull();
    expect(view.getByTestId("slot").querySelector("img")).toBeNull();
  });

  it("does not animate redacted confirmations or replay confirmations on initial mount", () => {
    const confirm: DuelEvent = { id: 6, kind: "confirm", text: "A card was confirmed" };
    const view = render(<Board events={[confirm]} slotCode={0} />);
    view.rerender(<Board events={[confirm, { ...confirm, id: 7 }]} slotCode={0} />);
    expect(view.queryByTestId("confirmed-ghost")).toBeNull();
  });

  it("keeps a normal draw out of the showcase", () => {
    const view = deliver(addEvent({ reason: "draw", from: { controller: 0, location: 0x01, sequence: 0 } }));
    expect(view.queryByTestId("added-ghost")).toBeNull();
    advance(1000);
    expect(view.queryByTestId("added-ring")).toBeNull();
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

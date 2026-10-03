// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEngineView, DuelEvent } from "@yugidraft/shared/duels";
import { DuelField } from "@/components/duel/field";
import { findZoneElement } from "@/components/duel/event-queue";
import { captureDepartureSnapshots, captureZoneSnapshots, clearZoneSnapshots, getMovePlan, planMoves, resetMoveSchedule } from "@/components/duel/move-plan";
import { MoveFx } from "@/components/duel/move-fx";
import { LOCATION_DECK, LOCATION_HAND } from "@/components/duel/constants";
import { newBoard } from "@/components/duel/fx-lab/board";
import { CARDS } from "@/components/duel/fx-lab/cards";

vi.mock("next/font/google", () => {
  const font = () => ({ variable: "font-var", className: "font-class" });
  return { Oxanium: font, Sofia_Sans_Semi_Condensed: font, Sofia_Sans_Extra_Condensed: font, Newsreader: font };
});

const perspectives = [0, 1, null] as const;
const turns = [0, 1] as const;
const rect = (left: number, top: number, width = 70, height = 100): DOMRect => ({
  left, top, width, height, x: left, y: top, right: left + width, bottom: top + height, toJSON: () => ({}),
});
const draw = (id: number, seat: number, sequence: number): DuelEvent => ({
  id, kind: "move", reason: "draw", seat, text: "Draw a card",
  from: { controller: seat, location: LOCATION_DECK, sequence: 0 },
  zone: { controller: seat, location: LOCATION_HAND, sequence },
});

function engine(mySeat: number | null, turnSeat: number, events: DuelEvent[]): DuelEngineView {
  const hand = (seat: number) => Array.from({ length: 6 }, () => seat === mySeat ? CARDS.sangan : null);
  const board = newBoard({ hand: hand(0), deck: 34 }, { hand: hand(1), deck: 34 }, "main1", turnSeat);
  return { ...board, revision: 0, turn: 1, events, prompt: null, log: [], result: null };
}

function Field({ mySeat, turnSeat = 0, events = [] }: { mySeat: number | null; turnSeat?: number; events?: DuelEvent[] }) {
  return <DuelField engine={engine(mySeat, turnSeat, events)} mySeat={mySeat} masterRule={5} reducedMotion
    legalKeys={new Set()} selectedKeys={new Set()} onActivate={() => {}} onInspect={() => {}}
    bottomName="Bottom player" topName="Top player" />;
}

beforeEach(() => {
  clearZoneSnapshots();
  resetMoveSchedule("draw-sources");
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const half = this.closest<HTMLElement>("[data-field-seat]");
    if (this.dataset.kind === "deck") return half?.dataset.side === "bottom" ? rect(900, 600) : rect(100, 100);
    if (this.dataset.kind === "hand") {
      const hand = this.closest<HTMLElement>("[data-hand-seat]");
      const sequence = Number(this.dataset.zones?.split(":")[2] ?? 0);
      return rect(300 + sequence * 50, hand?.dataset.side === "opp" ? 0 : 800);
    }
    return rect(0, 0, 1000, 1000);
  });
});
afterEach(() => { cleanup(); clearZoneSnapshots(); vi.restoreAllMocks(); });

function expectOwnDeck(events: DuelEvent[], mySeat: number | null, reduced = false) {
  const plans = planMoves(events, { now: 100, reduced, duelKey: "draw-sources" });
  expect(plans).toHaveLength(events.length);
  for (const plan of plans) {
    const deck = findZoneElement(plan.event.from)!;
    expect(deck.closest("[data-field-seat]")?.getAttribute("data-field-seat")).toBe(String(plan.event.zone!.controller));
    const { left, top, width, height } = deck.getBoundingClientRect();
    expect(plan.source?.rect).toEqual({ left, top, width, height });
    expect(plan.source?.side).toBe(plan.event.zone!.controller === (mySeat ?? 0) ? "you" : "opp");
  }
}

describe.each(perspectives)("draw deck sources for viewer seat %s", (mySeat) => {
  it.each(turns)("deals both opening hands from their own displayed decks with turn seat %s", (turnSeat) => {
    const events = Array.from({ length: 10 }, (_, i) => draw(i + 1, Math.floor(i / 5), i % 5));
    render(<Field mySeat={mySeat} turnSeat={turnSeat} events={events} />);
    expectOwnDeck(events, mySeat);
  });

  it.each(turns)("ignores mirrored cached and pre-commit deck positions when turn seat is %s", (turnSeat) => {
    const events = Array.from({ length: 10 }, (_, i) => draw(i + 1, Math.floor(i / 5), i % 5));
    const board = render(<Field mySeat={mySeat === 1 ? 0 : 1} />);
    captureZoneSnapshots(board.container);
    captureDepartureSnapshots(events, board.container);
    board.rerender(<Field mySeat={mySeat} turnSeat={turnSeat} events={events} />);
    expectOwnDeck(events, mySeat);
  });

  it.each(turns)("uses the drawing player's deck for ordinary turn %s draws", (turnSeat) => {
    const board = render(<Field mySeat={mySeat} turnSeat={1 - turnSeat} />);
    captureZoneSnapshots(board.container);
    const events = [draw(21, turnSeat, 5)];
    captureDepartureSnapshots(events, board.container);
    board.rerender(<Field mySeat={mySeat} turnSeat={turnSeat} events={events} />);
    expectOwnDeck(events, mySeat);
  });

  it("resolves the owner's deck with reduced motion", () => {
    const events = [draw(1, 0, 0), draw(2, 1, 0)];
    render(<Field mySeat={mySeat} events={events} />);
    expectOwnDeck(events, mySeat, true);
  });
});

it("uses game 2's new seat assignment when Bo3 event ids restart", () => {
  const events = [draw(1, 0, 0), draw(2, 1, 0)];
  const board = render(<Field mySeat={0} events={events} />);
  expectOwnDeck(events, 0);
  captureZoneSnapshots(board.container);
  resetMoveSchedule("game-2");
  board.rerender(<Field mySeat={1} events={events} />);
  expectOwnDeck(events, 1);
});

it("measures a staggered draw's own deck when that flight launches after a perspective change", async () => {
  vi.useFakeTimers();
  const starts: Array<{ ghost: HTMLElement; frame: Keyframe }> = [];
  const animations = Object.getOwnPropertyDescriptor(Element.prototype, "animate");
  const getAnimations = Object.getOwnPropertyDescriptor(Element.prototype, "getAnimations");
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] });
  Object.defineProperty(Element.prototype, "animate", { configurable: true, value: function(this: HTMLElement, frames: Keyframe[]) {
    if (this.dataset.style === "draw" && frames[0]?.transform) starts.push({ ghost: this, frame: frames[0] });
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    return { finished, cancel: resolve };
  } });
  try {
    const events = [draw(1, 0, 0), draw(2, 0, 1)];
    const Board = ({ mySeat }: { mySeat: number }) => <div>
      <Field mySeat={mySeat} events={events} />
      <MoveFx events={events} duelKey="draw-sources" reducedMotion={false} replayFrom={0} />
    </div>;
    const board = render(<Board mySeat={0} />);
    expect(starts).toHaveLength(1);
    board.rerender(<Board mySeat={1} />);
    await act(async () => { await vi.advanceTimersByTimeAsync(Math.ceil(getMovePlan(2)!.startAt - performance.now())); });
    expect(starts).toHaveLength(2);
    const { ghost, frame } = starts[1];
    const offset = String(frame.transform).match(/translate3d\(([-\d.]+)px, ([-\d.]+)px/)!;
    const flightX = Number.parseFloat(ghost.style.left) + Number.parseFloat(ghost.style.width) / 2 + Number(offset[1]);
    const flightY = Number.parseFloat(ghost.style.top) + Number.parseFloat(ghost.style.height) / 2 + Number(offset[2]);
    const deck = findZoneElement(events[1].from)!.getBoundingClientRect();
    expect(flightX).toBeCloseTo(deck.left + deck.width / 2);
    expect(flightY).toBeCloseTo(deck.top + deck.height / 2);
  } finally {
    cleanup();
    if (animations) Object.defineProperty(Element.prototype, "animate", animations);
    else delete (Element.prototype as unknown as Record<string, unknown>).animate;
    if (getAnimations) Object.defineProperty(Element.prototype, "getAnimations", getAnimations);
    else delete (Element.prototype as unknown as Record<string, unknown>).getAnimations;
    vi.useRealTimers();
  }
});

// @vitest-environment jsdom
import React from "react";
import { act, cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelCardInfo, DuelChainLink, DuelEvent, DuelZoneRef } from "@yugidraft/shared/duels";

import { ChainFx } from "@/components/duel/chain-fx";
import { handGhostFrame } from "@/components/duel/chain-frame";
import { deriveChainState, handLinkPlaces } from "@/components/duel/chain-state";

const HAND = 0x02;
const MZONE = 0x04;
const GRAVE = 0x10;
const OVERLAY = 0x80;
const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });
const info = (code: number): DuelCardInfo => ({
  code, name: `Card ${code}`, description: "", type: 1, attack: 0, defense: 0, level: 4, attribute: 1, race: "Warrior",
});
const activate = (id: number, code: number, slot: DuelZoneRef, chainIndex = 1) =>
  ({ id, kind: "activate", text: "a", seat: slot.controller, card: info(code), chainIndex, zone: slot }) as DuelEvent;
const move = (id: number, code: number | null, from: DuelZoneRef, to: DuelZoneRef) =>
  ({ id, kind: "move", text: "m", seat: from.controller, card: code == null ? undefined : info(code), from, zone: to }) as DuelEvent;
const chainEnd = (id: number) => ({ id, kind: "chain-end", text: "e", seat: 0 }) as DuelEvent;
const placesOf = (events: DuelEvent[], chain: DuelChainLink[]) => handLinkPlaces(events, deriveChainState(events, chain).links);
const link = (code: number, seat = 0): DuelChainLink => ({ index: 1, seat, code });

describe("handLinkPlaces", () => {
  it("maps a hand link whose card went to the Graveyard to that zone", () => {
    const events = [activate(10, 7, z(0, HAND, 4)), move(11, 7, z(0, HAND, 4), z(0, GRAVE, 0))];
    expect(placesOf(events, [link(7)]).get(1)).toEqual(z(0, GRAVE, 0));
  });

  it("finds a cost that was paid before the activation was announced", () => {
    const events = [move(9, 7, z(0, HAND, 2), z(0, GRAVE, 3)), activate(10, 7, z(0, HAND, 2))];
    expect(placesOf(events, [link(7)]).get(1)).toEqual(z(0, GRAVE, 3));
  });

  it("leaves a card that still stands in its slot out of the map", () => {
    const events = [activate(10, 7, z(0, HAND, 4))];
    expect(placesOf(events, [link(7)]).has(1)).toBe(false);
  });

  it("ignores a move of another card from that slot, and a move of an earlier chain", () => {
    const events = [
      move(3, 7, z(0, HAND, 4), z(0, GRAVE, 0)),
      chainEnd(5),
      activate(10, 7, z(0, HAND, 4)),
      move(11, 99, z(0, HAND, 4), z(0, GRAVE, 1)),
    ];
    expect(placesOf(events, [link(7)]).has(1)).toBe(false);
  });

  it("follows the card to its last place", () => {
    const events = [
      activate(10, 7, z(0, HAND, 1)),
      move(11, 7, z(0, HAND, 1), z(0, GRAVE, 0)),
      move(12, 7, z(0, GRAVE, 0), z(0, MZONE, 2)),
    ];
    expect(placesOf(events, [link(7)]).get(1)).toEqual(z(0, MZONE, 2));
  });

  it("maps to null when the card went somewhere the board does not draw", () => {
    const events = [activate(10, 7, z(0, HAND, 1)), move(11, 7, z(0, HAND, 1), z(0, OVERLAY, 0))];
    expect(placesOf(events, [link(7)]).get(1)).toBeNull();
  });

  it("ignores a link that did not come from the hand", () => {
    const events = [activate(10, 7, z(0, MZONE, 1)), move(11, 7, z(0, MZONE, 1), z(0, GRAVE, 0))];
    expect(placesOf(events, [link(7)]).has(1)).toBe(false);
  });
});

/** A 60 x 80 card box in a hand strip that starts at x = 200. */
const CARD = { w: 60, h: 80, step: 70, left: 200, top: 400 };
const BOARD = [100, 50, 900, 600];
const GY = { left: 640, top: 300, w: 60, h: 80 };
let hand: HTMLElement;
let gy: HTMLElement | null;

function rectOf(el: HTMLElement): [number, number, number, number] {
  if (el.hasAttribute("data-hand-seat")) {
    const n = el.children.length;
    return [CARD.left, CARD.top, Math.max(n, 1) * CARD.step - (CARD.step - CARD.w), CARD.h];
  }
  if (el.parentElement?.hasAttribute("data-hand-seat")) {
    const at = [...el.parentElement.children].indexOf(el);
    return [CARD.left + at * CARD.step, CARD.top, CARD.w, CARD.h];
  }
  if (el.dataset.zones) return [GY.left, GY.top, GY.w, GY.h];
  if (el.hasAttribute("data-duel-fx-speed-root") || el.hasAttribute("data-chain-fx") || el.hasAttribute("data-board")) return [BOARD[0], BOARD[1], BOARD[2], BOARD[3]];
  return [0, 0, 0, 0];
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    const [left, top, width, height] = rectOf(this);
    return { left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}) } as DOMRect;
  });
  vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockImplementation(function (this: HTMLElement) { return rectOf(this)[2]; });
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(function (this: HTMLElement) { return rectOf(this)[3]; });
  hand = document.createElement("div");
  hand.dataset.handSeat = "0";
  for (let i = 0; i < 4; i += 1) hand.appendChild(document.createElement("div"));
  document.body.appendChild(hand);
  gy = document.createElement("div");
  gy.dataset.zones = `0:${GRAVE}:0`;
  document.body.appendChild(gy);
});
afterEach(() => {
  cleanup();
  hand.remove();
  gy?.remove();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

const overlay = { left: BOARD[0], top: BOARD[1], width: BOARD[2], height: BOARD[3] } as DOMRect;

describe("handGhostFrame", () => {
  it("is one card, never the whole hand", () => {
    const frame = handGhostFrame(overlay, hand, 1)!;
    expect(frame.ring.width).toBeCloseTo(CARD.w, 3);
    expect(frame.ring.height).toBeCloseTo(CARD.h, 3);
  });

  it("stands between its neighbours for a middle slot", () => {
    const frame = handGhostFrame(overlay, hand, 2)!;
    // Between card 1 (left 270) and card 2 (left 340): left 305, in board pixels 205.
    expect(frame.ring.left).toBeCloseTo(305 - BOARD[0], 3);
  });

  it("stands one card step past the last card for an end slot", () => {
    const frame = handGhostFrame(overlay, hand, 4)!;
    expect(frame.ring.left).toBeCloseTo(CARD.left + 4 * CARD.step - BOARD[0], 3);
  });

  it("gives a card-sized box for an empty hand", () => {
    hand.replaceChildren();
    const frame = handGhostFrame(overlay, hand, 0)!;
    expect(frame.ring.width).toBeLessThanOrEqual(CARD.w + 0.001);
    expect(frame.ring.height).toBeCloseTo(CARD.h, 3);
  });
});

function mount(events: DuelEvent[], chain: DuelChainLink[]) {
  const view = render(
    <div data-duel-fx-speed-root>
      <div data-board data-format="ffa4">
        <ChainFx events={events} chain={chain} duelKey="t" reducedMotion mySeat={0} playerName={(s) => `P${s}`} table="ffa4" />
      </div>
    </div>,
  );
  act(() => { vi.advanceTimersByTime(60); });
  return view.container.querySelector("[data-chain-card='1']") as HTMLElement;
}

describe("ChainFx mark of a hand link whose card left the hand", () => {
  it("rings the Graveyard card, not the hand", () => {
    const ring = mount([activate(10, 7, z(0, HAND, 3)), move(11, 7, z(0, HAND, 3), z(0, GRAVE, 0))], [link(7)]);
    expect(ring.dataset.placed).toBe("true");
    expect(parseFloat(ring.style.width)).toBeCloseTo(GY.w, 3);
    const [x, y] = ring.style.translate.split(" ").map(parseFloat);
    expect(x).toBeCloseTo(GY.left - BOARD[0], 3);
    expect(y).toBeCloseTo(GY.top - BOARD[1], 3);
  });

  it("leaves a ghost of one card at the hand slot when the card went somewhere undrawn", () => {
    const ring = mount([activate(10, 7, z(0, HAND, 4)), move(11, 7, z(0, HAND, 4), z(0, OVERLAY, 0))], [link(7)]);
    expect(ring.dataset.placed).toBe("true");
    expect(parseFloat(ring.style.width)).toBeCloseTo(CARD.w, 3);
    expect(parseFloat(ring.style.height)).toBeCloseTo(CARD.h, 3);
    // Never the width of the whole hand strip.
    expect(parseFloat(ring.style.width)).toBeLessThan(rectOf(hand)[2]);
  });

  it("still rings the card itself while it stands in its hand slot", () => {
    // A hand card is keyed by its slot, as in the real hand.
    (hand.children[1] as HTMLElement).dataset.zones = `0:${HAND}:1`;
    const ring = mount([activate(10, 7, z(0, HAND, 1))], [link(7)]);
    expect(parseFloat(ring.style.width)).toBeCloseTo(CARD.w, 3);
    const [x] = ring.style.translate.split(" ").map(parseFloat);
    expect(x).toBeCloseTo(CARD.left + CARD.step - BOARD[0], 3);
  });
});

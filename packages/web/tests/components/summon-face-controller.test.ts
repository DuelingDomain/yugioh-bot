// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DuelEvent } from "@yugidraft/shared/duels";

// jsdom has no layout: the live turn of a seat field is the one thing the test sets by hand.
const pose = vi.hoisted(() => ({ turn: 0 as number | null, calls: 0 }));
vi.mock("@/components/duel/attack-fx", async (original) => ({
  ...(await original<typeof import("@/components/duel/attack-fx")>()),
  screenPose: () => {
    pose.calls += 1;
    return pose.turn == null ? null : { w: 60, h: 88, turn: pose.turn };
  },
}));

import { departureTurn, moveDestinationRotation, nearestTurn, seatFieldTurn } from "@/components/duel/event-queue";
import { retargetFlight } from "@/components/duel/live-flight";
import { flipCopyBase } from "@/components/duel/position-fx";
import { copyTurn } from "@/components/duel/summon-fx";

/** A zone of a seat field (a multiplayer table) by default; `seat = false` is a 1v1 zone, which no field turns. */
function zone(side: "you" | "opp", defense = false, seat = true): HTMLElement {
  const node = document.createElement("div");
  node.dataset.side = side;
  node.dataset.defense = String(defense);
  if (seat) {
    const field = document.createElement("div");
    field.dataset.seatField = "1";
    field.appendChild(node);
    document.body.appendChild(field);
  } else document.body.appendChild(node);
  return node;
}

afterEach(() => {
  pose.turn = 0;
  pose.calls = 0;
  document.body.innerHTML = "";
});

describe("nearestTurn", () => {
  it("returns the equal angle closest to the reference", () => {
    expect(nearestTurn(180, 0)).toBe(180);
    expect(nearestTurn(-170, 175)).toBe(190);
    expect(nearestTurn(170, -175)).toBe(-190);
    expect(nearestTurn(0, 360)).toBe(360);
  });
});

describe("moveDestinationRotation follows the controller's seat", () => {
  it("keeps the side-based turn on a 1v1 table and never probes the DOM there", () => {
    pose.turn = 33;
    expect(moveDestinationRotation(zone("you", false, false))).toBe(0);
    expect(moveDestinationRotation(zone("opp", false, false))).toBe(180);
    expect(moveDestinationRotation(zone("opp", true, false))).toBe(270);
    expect(seatFieldTurn(zone("you", false, false))).toBe(0);
    expect(pose.calls).toBe(0);
  });

  it("adds the live turn of a turned seat field", () => {
    pose.turn = 170;
    expect(moveDestinationRotation(zone("you"))).toBe(170);
    pose.turn = -170;
    expect(moveDestinationRotation(zone("you"))).toBe(-170);
  });

  it("follows a face-off field turned to 180 without a half turn on the zone", () => {
    pose.turn = 180;
    expect(moveDestinationRotation(zone("you"))).toBe(180);
  });

  it("keeps the viewer's own seat upright", () => {
    pose.turn = 0;
    expect(moveDestinationRotation(zone("you"))).toBe(0);
  });

  it("reads null when the field has no readable pose", () => {
    pose.turn = null;
    expect(moveDestinationRotation(zone("opp"))).toBe(180);
  });

  it("picks the equal angle nearest to the start of the flight", () => {
    pose.turn = -170;
    expect(moveDestinationRotation(zone("you"), false, 175)).toBe(190);
    pose.turn = 170;
    expect(moveDestinationRotation(zone("you"), false, -175)).toBe(-190);
    pose.turn = 0;
    expect(moveDestinationRotation(zone("you"), false, 5)).toBe(0);
  });

  it("does not add the field turn to a hand card (the fan angle is its own)", () => {
    pose.turn = 90;
    const hand = document.createElement("div");
    hand.dataset.handSeat = "0";
    hand.dataset.many = "true";
    hand.style.setProperty("--hn", "3");
    const card = document.createElement("div");
    card.dataset.handCard = "";
    card.style.setProperty("--i", "2");
    const art = document.createElement("div");
    art.dataset.side = "you";
    card.appendChild(art);
    hand.appendChild(card);
    document.body.appendChild(hand);
    expect(moveDestinationRotation(art)).toBeCloseTo(1.15, 5);
  });
});

describe("flip and typed-summon copies", () => {
  it("flipCopyBase adds the seat turn to the far-side half turn", () => {
    expect(flipCopyBase({ side: "you", turn: 0 })).toBe(0);
    expect(flipCopyBase({ side: "opp", turn: 0 })).toBe(180);
    expect(flipCopyBase({ side: "you", turn: -170 })).toBe(-170);
    expect(flipCopyBase({ side: "you", turn: 180 })).toBe(180);
  });

  it("copyTurn adds the seat turn to the half turn and the Defense quarter", () => {
    expect(copyTurn({ side: "you", defense: false })).toBe(0);
    expect(copyTurn({ side: "opp", defense: true })).toBe(270);
    expect(copyTurn({ side: "you", defense: false, seat: { turn: 170, fit: 1, w: 1, h: 1 } })).toBe(170);
    expect(copyTurn({ side: "you", defense: true, seat: { turn: -170, fit: 1, w: 1, h: 1 } })).toBe(-80);
  });
});

describe("a flight reads the seat turn only when its zone moves", () => {
  const event: DuelEvent = { id: 1, kind: "move", text: "summon", zone: { controller: 0, location: 4, sequence: 0 } };
  let left: number;
  let destination: HTMLElement;
  let overlay: HTMLElement;

  beforeEach(() => {
    vi.useFakeTimers();
    left = 500;
    overlay = document.createElement("div");
    document.body.appendChild(overlay);
    vi.spyOn(overlay, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0 } as DOMRect);
  });
  afterEach(() => vi.useRealTimers());

  function fly(seat: boolean): void {
    destination = zone("you", false, seat);
    destination.dataset.zones = "0:4:0";
    vi.spyOn(destination, "getBoundingClientRect").mockImplementation(() => ({ left, top: 700, width: 70, height: 100 }) as DOMRect);
    const ghost = document.createElement("div");
    const flight = retargetFlight({ event, el: ghost, overlay, cx: 535, cy: 750, duration: 500 });
    pose.turn = 170;
    vi.advanceTimersByTime(17 * 20);
    flight.stop();
  }

  it("never probes in a 1v1 flight, frame after frame", () => {
    fly(false);
    expect(pose.calls).toBe(0);
  });

  it("probes a seat field once while the zone stays, and again when it moves", () => {
    fly(true);
    expect(pose.calls).toBe(1);
    left = 520;
    const ghost = document.createElement("div");
    const flight = retargetFlight({ event, el: ghost, overlay, cx: 535, cy: 750, duration: 500 });
    vi.advanceTimersByTime(17);
    left = 540;
    vi.advanceTimersByTime(17);
    flight.stop();
    expect(pose.calls).toBe(3);
  });
});

describe("a departing card starts at the turn its seat gives it", () => {
  const hand = { controller: 3, location: 0x02, sequence: 0 };

  function rail(side: "you" | "opp", seat = 3): HTMLElement {
    const node = document.createElement("div");
    node.dataset.handSeat = String(seat);
    node.dataset.side = side;
    document.body.appendChild(node);
    return node;
  }
  function field(): void {
    const node = document.createElement("div");
    node.dataset.seatField = "3";
    document.body.appendChild(node);
  }

  it("takes the live turn of a rival hand rail in a seat table (FFA4 seat 3 and a turned FFA3 rival)", () => {
    field();
    rail("opp");
    pose.turn = 0;
    expect(departureTurn(hand, 180)).toBe(0);
    pose.turn = 170;
    expect(departureTurn(hand, 180)).toBe(170);
    pose.turn = -170;
    expect(departureTurn(hand, 180)).toBe(-170);
  });

  it("leaves a card of the viewer's own hand and a 1v1 table to the side turn, without a probe", () => {
    rail("you", 0);
    pose.turn = 90;
    expect(departureTurn({ ...hand, controller: 0 }, 0)).toBeNull();
    field();
    expect(departureTurn({ ...hand, controller: 0 }, 0)).toBeNull();
    document.body.innerHTML = "";
    rail("opp", 1);
    pose.calls = 0;
    expect(departureTurn({ ...hand, controller: 1 }, 180)).toBeNull();
    expect(pose.calls).toBe(0);
  });

  it("adds the seat turn to the side turn of a card that leaves a field zone", () => {
    const zoneNode = zone("you");
    zoneNode.dataset.zones = "2:4:1";
    pose.turn = -170;
    expect(departureTurn({ controller: 2, location: 0x04, sequence: 1 }, 90)).toBe(-80);
  });

  it("flies the short way: the end turn lands within 1 degree of the start", () => {
    field();
    rail("opp");
    for (const turn of [0, 180, 170, -170]) {
      pose.turn = turn;
      const start = departureTurn(hand, 180)!;
      const end = moveDestinationRotation(zone("you"), false, start);
      expect(Math.abs(end - start)).toBeLessThan(1);
    }
  });
});

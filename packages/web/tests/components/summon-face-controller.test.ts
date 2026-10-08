// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no layout: the live turn of a seat field is the one thing the test sets by hand.
const pose = vi.hoisted(() => ({ turn: 0 as number | null }));
vi.mock("@/components/duel/attack-fx", async (original) => ({
  ...(await original<typeof import("@/components/duel/attack-fx")>()),
  screenPose: () => (pose.turn == null ? null : { w: 60, h: 88, turn: pose.turn }),
}));

import { moveDestinationRotation, nearestTurn } from "@/components/duel/event-queue";
import { flipCopyBase } from "@/components/duel/position-fx";
import { copyTurn } from "@/components/duel/summon-fx";

function zone(side: "you" | "opp", defense = false): HTMLElement {
  const node = document.createElement("div");
  node.dataset.side = side;
  node.dataset.defense = String(defense);
  document.body.appendChild(node);
  return node;
}

afterEach(() => {
  pose.turn = 0;
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
  it("keeps the side-based turn on a 1v1 table (no field turn)", () => {
    expect(moveDestinationRotation(zone("you"))).toBe(0);
    expect(moveDestinationRotation(zone("opp"))).toBe(180);
    expect(moveDestinationRotation(zone("opp", true))).toBe(270);
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

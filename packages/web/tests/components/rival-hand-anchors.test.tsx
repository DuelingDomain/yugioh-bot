// @vitest-environment jsdom
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LOCATION_HAND, zoneKey } from "@/components/duel/constants";
import { handArrivalTarget } from "@/components/duel/event-queue";
import { RivalHand } from "@/components/duel/table/rival-hand";

afterEach(cleanup);

describe("the hand of a rival on a grid seat", () => {
  it("carries the anchors of a 1v1 hand: a hand id and a hand zone on every back, and a size probe", () => {
    const { container } = render(<RivalHand seat={2} count={2} name="Rival" cards={[{ handId: "h-a", sequence: 0 }, { handId: "h-b", sequence: 1 }]} />);
    const hand = container.querySelector<HTMLElement>("[data-hand-seat='2']")!;
    expect([...hand.querySelectorAll("[data-hand-id]")].map((el) => el.getAttribute("data-hand-id"))).toEqual(["h-a", "h-b"]);
    expect([...hand.querySelectorAll("[data-zones]")].map((el) => el.getAttribute("data-zones"))).toEqual([zoneKey(2, LOCATION_HAND, 0), zoneKey(2, LOCATION_HAND, 1)]);
    expect(container.querySelector("[data-hand-size-probe]")).not.toBeNull();
  });

  it("keys the backs by index when the view has no hand ids", () => {
    const { container } = render(<RivalHand seat={1} count={3} name="Rival" />);
    expect([...container.querySelectorAll("[data-zones]")].map((el) => el.getAttribute("data-zones"))).toEqual([0, 1, 2].map((n) => zoneKey(1, LOCATION_HAND, n)));
  });

  it("is a place a returning card can fly to (the opponent hand of a card that leaves the field)", () => {
    render(<RivalHand seat={2} count={2} name="Rival" cards={[{ handId: "h-a", sequence: 0 }, { handId: "h-b", sequence: 1 }]} />);
    const target = handArrivalTarget({ type: "move", zone: { controller: 2, location: LOCATION_HAND, sequence: 1 } } as never);
    expect(target).not.toBeNull();
    expect(target?.side).toBe("opp");
  });

  it("lands a card of a hand of more than 12 on the end of the drawn backs, not one past it (the count chip is not a card)", () => {
    const cards = Array.from({ length: 14 }, (_, index) => ({ handId: `h-${index}`, sequence: index }));
    const { container } = render(<RivalHand seat={2} count={14} name="Rival" cards={cards} />);
    const hand = container.querySelector<HTMLElement>("[data-hand-seat='2']")!;
    expect(hand.querySelectorAll("[data-hand-id]")).toHaveLength(12);
    expect(hand.children).toHaveLength(13);
    // Each drawn back is 10 px to the left of the one before (the far hand runs left).
    hand.querySelectorAll<HTMLElement>("[data-zones]").forEach((node, index) => {
      node.getBoundingClientRect = () => ({ left: 200 - index * 10, top: 5, width: 8, height: 12, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    });
    const target = handArrivalTarget({ type: "move", zone: { controller: 2, location: LOCATION_HAND, sequence: 13 } } as never);
    // The last drawn back is the 12th (index 11); sequence 13 is two steps past it.
    expect(target?.rect.left).toBe(200 - 11 * 10 - 2 * 10);
  });
});

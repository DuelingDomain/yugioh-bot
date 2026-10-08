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
});

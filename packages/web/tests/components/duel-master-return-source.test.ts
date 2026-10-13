// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { LOCATION_GRAVE } from "../../src/components/duel/constants";
import { clearZoneSnapshots } from "../../src/components/duel/move-plan";
import { resolveReturnSource } from "../../src/components/duel/master-return-fx";

const GY = { controller: 0, location: LOCATION_GRAVE, sequence: 0 };

describe("where a returning Deck Master starts when its zone has no snapshot", () => {
  beforeEach(() => { clearZoneSnapshots(); document.body.innerHTML = ""; });

  function pile(kind: string, side: "you" | "opp", keys: string, left: number) {
    const el = document.createElement("div");
    el.dataset.kind = kind;
    el.dataset.side = side;
    el.dataset.zones = keys;
    el.getBoundingClientRect = () => ({ left, top: 100, width: 60, height: 80, x: left, y: 100, right: left + 60, bottom: 180, toJSON: () => ({}) });
    document.body.append(el);
  }

  it("takes the Graveyard of the master's own seat on a table with several rivals", () => {
    pile("gy", "opp", "1:16:0", 100); // another rival, first in the page
    pile("gy", "opp", "2:16:4 2:16:5", 300); // its own key for the master (2:16:0) is gone: the card left the pile
    pile("gy", "opp", "3:16:0", 500);
    pile("gy", "you", "0:16:0", 700);
    const of = (seat: number) => ({ ...GY, controller: seat, sequence: 9 });
    expect(resolveReturnSource(of(2), 2, 0)).toMatchObject({ rect: { left: 300 }, side: "opp" });
    expect(resolveReturnSource(of(3), 3, 0)?.rect.left).toBe(500);
    expect(resolveReturnSource(of(0), 0, 0)).toMatchObject({ rect: { left: 700 }, side: "you" });
  });

  it("keeps the side rule when no pile names the seat", () => {
    pile("gy", "opp", "9:16:0", 100);
    pile("gy", "you", "8:16:0", 700);
    const of = (seat: number) => ({ ...GY, controller: seat, sequence: 9 });
    expect(resolveReturnSource(of(1), 1, 0)?.rect.left).toBe(100);
    expect(resolveReturnSource(of(0), 0, 0)?.rect.left).toBe(700);
  });
});

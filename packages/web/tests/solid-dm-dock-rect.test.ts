// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCATION_DMZONE } from "../src/components/duel/constants";
import { clearZoneSnapshots, captureDepartureSnapshots } from "../src/components/duel/move-plan";
import { findDockRect } from "../src/components/duel/solid/dm-summon-bridge";

// Where the 3D Deck Master hologram starts. With the master out of its zone, the rail plate shows "In use" and has no
// picture, so the start must come from the plate (before the update, else now), not from the phone chip or a point under the zone.
const BOX = (left: number, top: number) => ({ left, top, width: 90, height: 130, x: left, y: top, right: left + 90, bottom: top + 130, toJSON: () => ({}) });
let PLATE = BOX(40, 300);
const CHIP = BOX(500, 20);
const IMG = BOX(40, 300);

beforeEach(() => {
  PLATE = BOX(40, 300);
  clearZoneSnapshots();
  document.body.innerHTML = "";
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    if (this.hasAttribute("data-sv-dm-chip")) return CHIP as DOMRect;
    if (this.hasAttribute("data-master-dock")) return PLATE as DOMRect;
    if (this.tagName === "IMG") return IMG as DOMRect;
    return BOX(0, 0) as DOMRect;
  });
});
afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ""; clearZoneSnapshots(); });

const rail = (inner: string) => `<div data-master-dock="0" data-master-source="0">${inner}</div><div data-sv-dm-chip="0"></div>`;

describe("findDockRect", () => {
  it("starts at the rail plate when the master is out of its zone (no picture), not at the chip", () => {
    document.body.innerHTML = rail('<span>In use</span>');
    expect(findDockRect(0)).toMatchObject({ left: PLATE.left, top: PLATE.top });
  });

  it("prefers the plate's box from before the update over where the plate is now", () => {
    // The snapshot is taken from the plate before the commit, while the master is still in its zone.
    document.body.innerHTML = rail('<img alt="" />');
    captureDepartureSnapshots([{ id: 1, kind: "move", seat: 0, from: { controller: 0, location: LOCATION_DMZONE, sequence: 0 }, zone: { controller: 0, location: 4, sequence: 2 } } as never]);
    // After the commit: the plate says "In use", and the layout has moved.
    document.body.innerHTML = rail("<span>In use</span>");
    PLATE = BOX(700, 50);
    expect(findDockRect(0)).toMatchObject({ left: 40, top: 300 });
  });

  it("uses the picture when the master is in its zone", () => {
    document.body.innerHTML = rail('<img alt="" />');
    expect(findDockRect(0)).toMatchObject({ left: IMG.left, top: IMG.top });
  });

  it("falls back to the chip on a phone, which has no plate", () => {
    document.body.innerHTML = '<div data-sv-dm-chip="0"></div>';
    expect(findDockRect(0)).toMatchObject({ left: CHIP.left, top: CHIP.top });
  });

  it("is null when nothing is on the page", () => {
    expect(findDockRect(0)).toBeNull();
  });
});

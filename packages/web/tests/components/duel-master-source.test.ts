// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { DuelZoneRef } from "@yugidraft/shared/duels";
import { captureDepartureSnapshots, captureZoneSnapshots, clearZoneSnapshots, getZoneSnapshot, resolveSource } from "../../src/components/duel/move-plan";

const z = (controller: number, location: number, sequence: number): DuelZoneRef => ({ controller, location, sequence });

describe("the Deck Master plate as the source of a Deck Master summon", () => {
  const DMZONE = 0x4000;
  const rect = { left: 20, top: 700, width: 90, height: 130 };

  function plate(seat: number) {
    const el = document.createElement("span");
    el.dataset.masterSource = String(seat);
    el.getBoundingClientRect = () => ({ ...rect, x: rect.left, y: rect.top, right: rect.left + rect.width, bottom: rect.top + rect.height, toJSON: () => ({}) });
    document.body.append(el);
    return el;
  }

  beforeEach(() => { clearZoneSnapshots(); document.body.innerHTML = ""; });

  it("finds the plate rect for the Deck Master Zone, as 0x4000 and as the byte-sized location 0", () => {
    plate(0);
    captureZoneSnapshots();
    for (const location of [DMZONE, 0]) {
      expect(getZoneSnapshot(z(0, location, 0))?.rect).toEqual(rect);
      expect(resolveSource(z(0, location, 0), 7)).toMatchObject({ rect, side: "you", faceUp: true, defense: false });
    }
  });

  it("keeps the seats apart and finds nothing without a plate", () => {
    plate(0);
    captureZoneSnapshots();
    expect(getZoneSnapshot(z(1, DMZONE, 0))).toBeNull();
    clearZoneSnapshots();
    document.body.innerHTML = "";
    captureZoneSnapshots();
    expect(getZoneSnapshot(z(0, DMZONE, 0))).toBeNull();
  });

  it("lets a real Deck Master Zone cell win over the plate", () => {
    plate(0);
    const cell = document.createElement("div");
    cell.dataset.zones = `0:${DMZONE}:0`;
    cell.getBoundingClientRect = () => ({ left: 500, top: 50, width: 60, height: 80, x: 500, y: 50, right: 560, bottom: 130, toJSON: () => ({}) });
    document.body.append(cell);
    captureZoneSnapshots();
    expect(getZoneSnapshot(z(0, DMZONE, 0))?.rect.left).toBe(500);
  });

  it("ignores a plate in a closed drawer: it keeps its box but is hidden", () => {
    const drawer = document.createElement("aside");
    drawer.style.visibility = "hidden"; // the closed drawer slides away and turns invisible
    document.body.append(drawer);
    const hidden = plate(0);
    drawer.append(hidden);
    const inert = document.createElement("div");
    inert.setAttribute("inert", "");
    document.body.append(inert);
    inert.append(plate(1));
    captureZoneSnapshots();
    expect(getZoneSnapshot(z(0, DMZONE, 0))).toBeNull();
    expect(getZoneSnapshot(z(1, DMZONE, 0))).toBeNull();
    // The open one of the same seat is used, whichever comes first in the page.
    const open = plate(0);
    open.getBoundingClientRect = () => ({ left: 300, top: 40, width: 90, height: 130, x: 300, y: 40, right: 390, bottom: 170, toJSON: () => ({}) });
    captureZoneSnapshots();
    expect(getZoneSnapshot(z(0, DMZONE, 0))?.rect.left).toBe(300);
  });

  it("finds a plate outside the board root: the pre-commit capture is scoped to the board, the HUD is not inside it", () => {
    const board = document.createElement("div");
    document.body.append(board);
    plate(0); // the HUD layer: a sibling of the board
    const summon = { id: 9, kind: "move", text: "", zone: z(0, 4, 4), from: z(0, DMZONE, 0), card: { code: 1 } } as never;
    captureDepartureSnapshots([summon], board);
    expect(resolveSource(z(0, DMZONE, 0), 9)?.rect).toEqual(rect);
    // The byte-sized location 0 reads the same.
    expect(getZoneSnapshot(z(0, 0, 0))?.rect).toEqual(rect);
  });
});

// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { findShown, tableZoneAnchor } from "@/components/duel/table/zone-find";

afterEach(() => {
  document.body.innerHTML = "";
});

const sized = (el: Element) => {
  el.getBoundingClientRect = () => ({ width: 40, height: 60, top: 0, left: 0, right: 40, bottom: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
};

/** A compact seat: the hidden real board comes first in the DOM, the chip after it, both with the same key. */
function compactSeat() {
  document.body.innerHTML = `
    <div data-compact="true">
      <div data-seat-field="2"><div data-zones="2:4:0" id="board"><button id="boardBtn"></button></div></div>
      <button data-chip data-zones="2:4:0" id="chip"></button>
    </div>
    <div data-seat-field="0"><div data-zones="0:4:0" id="mine"></div></div>`;
  document.querySelectorAll("#board, #boardBtn, #chip, #mine").forEach(sized);
}

describe("zone finder on a compact table", () => {
  it("prefers the chip over the hidden board that carries the same key", () => {
    compactSeat();
    expect(findShown(document, '[data-zones~="2:4:0"]')?.id).toBe("chip");
    expect(tableZoneAnchor("2:4:0")?.id).toBe("chip");
  });

  it("still finds a plain field zone and its card button", () => {
    compactSeat();
    expect(tableZoneAnchor("0:4:0")?.id).toBe("mine");
    document.body.innerHTML = `<div data-seat-field="1"><div data-zones="1:4:0"><button id="card"></button></div></div>`;
    expect(tableZoneAnchor("1:4:0")?.id).toBe("card");
  });

  it("falls back to the hidden board when there is no chip, and to null when nothing matches", () => {
    document.body.innerHTML = `<div data-compact="true"><div data-seat-field="2"><div data-zones="2:4:0" id="board"></div></div></div>`;
    expect(findShown(document, '[data-zones~="2:4:0"]')?.id).toBe("board");
    expect(findShown(document, '[data-zones~="9:4:0"]')).toBeNull();
  });
});

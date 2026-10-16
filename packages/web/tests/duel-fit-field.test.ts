import { describe, expect, it } from "vitest";
import { availableRoom, capAutoZoom, fitFieldBox, fitFieldScale, fitLimit } from "@/components/duel/edge-drawer";
import { fieldFrameVars } from "@/components/duel/edge-drawer/field-frame";

describe("availableRoom", () => {
  it("takes the bars, insets and padding out of the viewport", () => {
    expect(availableRoom({ viewportWidth: 1920, viewportHeight: 1080, topBar: 28, bottomBar: 32, pad: 4 })).toEqual({ width: 1912, height: 1012 });
    expect(availableRoom({ viewportWidth: 1000, viewportHeight: 600, leftInset: 100, rightInset: 50 })).toEqual({ width: 850, height: 600 });
  });
  it("never goes negative", () => {
    expect(availableRoom({ viewportWidth: 10, viewportHeight: 10, topBar: 50, pad: 20 })).toEqual({ width: 0, height: 0 });
  });
});

describe("fitFieldScale", () => {
  it("is the tighter of the two directions", () => {
    expect(fitFieldScale({ roomWidth: 1000, roomHeight: 500, contentWidth: 100, contentHeight: 100 })).toBe(5);
    expect(fitFieldScale({ roomWidth: 300, roomHeight: 900, contentWidth: 100, contentHeight: 100 })).toBe(3);
  });
  it("has no ceiling unless one is given", () => {
    expect(fitFieldScale({ roomWidth: 4000, roomHeight: 4000, contentWidth: 10, contentHeight: 10 })).toBe(400);
    expect(fitFieldScale({ roomWidth: 4000, roomHeight: 4000, contentWidth: 10, contentHeight: 10, maxScale: 3 })).toBe(3);
  });
  it("applies a floor", () => {
    expect(fitFieldScale({ roomWidth: 10, roomHeight: 10, contentWidth: 100, contentHeight: 100, minScale: 0.5 })).toBe(0.5);
  });
  it("is 0 for an empty room or empty content", () => {
    expect(fitFieldScale({ roomWidth: 0, roomHeight: 500, contentWidth: 1, contentHeight: 1 })).toBe(0);
    expect(fitFieldScale({ roomWidth: 500, roomHeight: 500, contentWidth: 0, contentHeight: 1 })).toBe(0);
  });
});

describe("fitLimit", () => {
  it("names the direction that decides", () => {
    expect(fitLimit({ roomWidth: 1920, roomHeight: 800, contentWidth: 10, contentHeight: 8 })).toBe("height");
    expect(fitLimit({ roomWidth: 600, roomHeight: 900, contentWidth: 10, contentHeight: 8 })).toBe("width");
  });
});

describe("capAutoZoom", () => {
  it("never lets an automatic step zoom in past the fit", () => {
    expect(capAutoZoom(2, 1.5)).toBe(1.5);
    expect(capAutoZoom(1.2, 1.5)).toBe(1.2);
    expect(capAutoZoom(Number.NaN, 1.5)).toBe(1.5);
  });
});

describe("fitFieldBox", () => {
  it("centres the scaled content in the room", () => {
    const box = fitFieldBox({ roomWidth: 1000, roomHeight: 600, contentWidth: 100, contentHeight: 100 });
    expect(box).toEqual({ scale: 6, width: 600, height: 600, left: 200, top: 0 });
  });
});

describe("fieldFrameVars", () => {
  it("sets only the vars it is given", () => {
    expect(fieldFrameVars({ cols: 11.3, rows: 6.4 })).toEqual({ "--bf-cols": "11.3", "--bf-rows": "6.4" });
    expect(fieldFrameVars({ cols: 5, rows: 5, barTop: "24px", zMin: "20px" })).toEqual({ "--bf-cols": "5", "--bf-rows": "5", "--bf-bar-top": "24px", "--bf-z-min": "20px" });
  });
});

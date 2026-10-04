// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cutTurnStyle, screenPose } from "@/components/duel/attack-fx";

afterEach(() => vi.restoreAllMocks());

describe("cutTurnStyle", () => {
  it("is empty for an upright card and a `rotate` for a card in a turned seat field", () => {
    expect(cutTurnStyle({})).toBe("");
    expect(cutTurnStyle({ turn: 0 })).toBe("");
    expect(cutTurnStyle({ turn: -12.5 })).toBe("rotate:-12.5deg;");
  });
});

describe("screenPose", () => {
  const boxOf = (position: string) => {
    const box = document.createElement("div");
    box.style.position = position;
    document.body.append(box);
    return box;
  };

  it("reads the edge lengths and the screen angle of a turned box, and leaves no probe behind", () => {
    const box = boxOf("relative");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
      const el = this as HTMLElement;
      // A 60 x 88 card turned 180 degrees (a far-side seat field).
      const x = el.style.left === "100%" ? -60 : 0, y = el.style.top === "100%" ? -88 : 0;
      return { left: 300 + x, top: 300 + y, width: 0, height: 0 } as DOMRect;
    });
    expect(screenPose(box)).toEqual({ w: 60, h: 88, turn: 180 });
    expect(box.children.length).toBe(0);
    box.remove();
  });

  it("gives nothing for an unpositioned box or one without a size", () => {
    const flat = boxOf("static");
    expect(screenPose(flat)).toBeNull();
    const empty = boxOf("relative");
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({ left: 0, top: 0, width: 0, height: 0 } as DOMRect);
    expect(screenPose(empty)).toBeNull();
    flat.remove();
    empty.remove();
  });
});

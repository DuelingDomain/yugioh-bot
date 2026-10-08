// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ROOF_FIELD } from "@/components/duel/tag/roof-camera";
import { Baton, batonNotch } from "@/components/duel/tag/roof-world";
import { batonOrder } from "@/components/duel/tag/tag-logic";

afterEach(cleanup);

const NOTCH_Y = Math.round(ROOF_FIELD.offsetY * 0.5);

function pillAt(root: HTMLElement, seat: number): string {
  const node = root.querySelector<HTMLElement>(`[data-roof="baton-pills"] [data-seat="${seat}"]`)!;
  const match = /translate\((-?\d+)px, (-?\d+)px\)/.exec(node.style.transform);
  return `${match![1]},${match![2]}`;
}

function mount(anchorSeat: number) {
  return render(
    <Baton stops={batonOrder(0)} anchorSeat={anchorSeat} nameOf={(seat) => `Player ${seat}`} rgbOf={() => "255 255 255"} out={new Set()} />,
  ).container;
}

describe("Baton notches follow the field slots", () => {
  it("puts each pill on the side and row of its field for every viewer (left near, left far, right near, right far)", () => {
    expect([0, 1, 2, 3].map((seat) => batonNotch(0, seat))).toEqual([0, 1, 2, 3]);
    // Viewer 2A (anchor 1): 2A near left, 1B near right, 1A far left, 2B far right.
    expect([0, 1, 2, 3].map((seat) => batonNotch(1, seat))).toEqual([1, 0, 3, 2]);
    // Viewer 2B (anchor 3): 2B near left, 2A near right, 1B far left, 1A far right.
    expect([0, 1, 2, 3].map((seat) => batonNotch(3, seat))).toEqual([3, 2, 1, 0]);
  });

  it("anchor 1: seat 0 at the far-left notch, seat 2 at the far-right notch", () => {
    const root = mount(1);
    expect(pillAt(root, 0)).toBe(`-610,${-NOTCH_Y}`);
    expect(pillAt(root, 2)).toBe(`610,${-NOTCH_Y}`);
    expect(pillAt(root, 1)).toBe(`-610,${NOTCH_Y}`);
    expect(pillAt(root, 3)).toBe(`610,${NOTCH_Y}`);
  });

  it("anchor 3: seat 2 at the far-left notch, seat 0 at the far-right notch", () => {
    const root = mount(3);
    expect(pillAt(root, 2)).toBe(`-610,${-NOTCH_Y}`);
    expect(pillAt(root, 0)).toBe(`610,${-NOTCH_Y}`);
    expect(pillAt(root, 3)).toBe(`-610,${NOTCH_Y}`);
    expect(pillAt(root, 1)).toBe(`610,${NOTCH_Y}`);
  });
});

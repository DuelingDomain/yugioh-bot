// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

// jsdom has no layout: the on-screen size of a card box is the one thing the test sets by hand.
const size = vi.hoisted(() => ({ value: { w: 122, h: 173 } as { w: number; h: number } | null, calls: 0 }));
vi.mock("@/components/duel/attack-fx", async (original) => ({
  ...(await original<typeof import("@/components/duel/attack-fx")>()),
  screenSize: () => {
    size.calls += 1;
    return size.value;
  },
}));

import { destinationCardSize } from "@/components/duel/event-queue";

const LAYOUT = { width: 77, height: 112 };

/** A box with the layout (offset) size a zone has in a seat field; jsdom has no layout, so the test sets it. */
function sized(node: HTMLElement, width = 77, height = 112): HTMLElement {
  Object.defineProperty(node, "offsetWidth", { configurable: true, value: width });
  Object.defineProperty(node, "offsetHeight", { configurable: true, value: height });
  return node;
}

/** A zone inside `host`: a seat field of a grid table or the Tag Rooftop (`data-seat-field`), the shared band of the Tag facing seats (`data-shared-band`), or nothing (a 1v1 zone). */
function zone(host: "seat" | "band" | "none" = "seat", attrs: Record<string, string> = {}): HTMLElement {
  const node = document.createElement("div");
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  if (host === "none") document.body.appendChild(node);
  else {
    const field = document.createElement("div");
    field.setAttribute(host === "seat" ? "data-seat-field" : "data-shared-band", "1");
    field.appendChild(node);
    document.body.appendChild(field);
  }
  return sized(node);
}

afterEach(() => {
  size.value = { w: 122, h: 173 };
  size.calls = 0;
  document.body.innerHTML = "";
});

describe("destinationCardSize", () => {
  it("scales the zone's own size to how large it looks on screen in a camera-scaled seat field", () => {
    const { width, height } = destinationCardSize(zone(), LAYOUT);
    expect(width).toBeCloseTo(122, 5);
    expect(height).toBeCloseTo((122 / 77) * 112, 5);
  });

  it("measures the Tag shared Extra Monster Zone band as well", () => {
    expect(destinationCardSize(zone("band"), LAYOUT).width).toBeCloseTo(122, 5);
    expect(size.calls).toBe(1);
  });

  it("measures a hand card of a seat field too: it sits inside the scaled field", () => {
    expect(destinationCardSize(zone("seat", { "data-hand-card": "" }), LAYOUT).width).toBeCloseTo(122, 5);
    expect(size.calls).toBe(1);
  });

  it("keeps the card's shape under tilt: the foreshortened height does not shrink the width", () => {
    size.value = { w: 154, h: 112 }; // 2x wide on screen, but tilted: the height is only 1x
    const { width, height } = destinationCardSize(zone(), LAYOUT);
    expect(width).toBeCloseTo(154, 5);
    expect(height).toBeCloseTo(224, 5);
  });

  it("keeps the layout size on a 1v1 table and never probes the DOM there", () => {
    expect(destinationCardSize(zone("none"), LAYOUT)).toEqual(LAYOUT);
    expect(size.calls).toBe(0);
  });

  it("falls back to the layout size when the field has no readable size", () => {
    size.value = null;
    expect(destinationCardSize(zone(), LAYOUT)).toEqual(LAYOUT);
  });

  it("uses the on-screen size as it is when the zone has no layout size", () => {
    expect(destinationCardSize(sized(zone(), 0, 0), LAYOUT)).toEqual({ width: 122, height: 173 });
  });

  it("falls back to the layout size when there is no destination", () => {
    expect(destinationCardSize(null, LAYOUT)).toEqual(LAYOUT);
  });
});

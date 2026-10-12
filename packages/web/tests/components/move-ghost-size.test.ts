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

/** A zone of a seat field (the Tag Rooftop or a grid table) by default; `seat = false` is a 1v1 zone. */
function zone(seat = true): HTMLElement {
  const node = document.createElement("div");
  if (seat) {
    const field = document.createElement("div");
    field.dataset.seatField = "1";
    field.appendChild(node);
    document.body.appendChild(field);
  } else document.body.appendChild(node);
  return node;
}

afterEach(() => {
  size.value = { w: 122, h: 173 };
  size.calls = 0;
  document.body.innerHTML = "";
});

describe("destinationCardSize", () => {
  it("reads the on-screen size of a zone in a camera-scaled seat field, not its layout size", () => {
    expect(destinationCardSize(zone(), LAYOUT)).toEqual({ width: 122, height: 173 });
  });

  it("keeps the layout size on a 1v1 table and never probes the DOM there", () => {
    expect(destinationCardSize(zone(false), LAYOUT)).toEqual(LAYOUT);
    expect(size.calls).toBe(0);
  });

  it("falls back to the layout size when the field has no readable size", () => {
    size.value = null;
    expect(destinationCardSize(zone(), LAYOUT)).toEqual(LAYOUT);
  });

  it("falls back to the layout size when there is no destination", () => {
    expect(destinationCardSize(null, LAYOUT)).toEqual(LAYOUT);
  });
});

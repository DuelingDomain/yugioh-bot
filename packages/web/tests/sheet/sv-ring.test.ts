import { describe, expect, it } from "vitest";
import { RING_PALETTE, ringColour } from "@/components/sheet";

describe("ringColour", () => {
  it("is stable for the same player and comes from the palette", () => {
    expect(ringColour(42)).toBe(ringColour("42"));
    expect(RING_PALETTE).toContain(ringColour(7));
  });

  it("spreads players across the palette", () => {
    const seen = new Set(Array.from({ length: 50 }, (_, i) => ringColour(i + 1)));
    expect(seen.size).toBeGreaterThan(4);
  });
});

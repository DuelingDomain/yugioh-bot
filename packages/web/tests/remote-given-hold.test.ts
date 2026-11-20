import { describe, expect, it } from "vitest";
import { givenSpotHolds } from "@/lib/remote/given-hold";

describe("a card given to the opponent stays held by identity", () => {
  const spots = new Map([["fw-1", { zone: "M3", cardId: "86673403" }]]);
  const given = (ref: string) => ref === "fw-1";
  it("holds a new track of the same card on the same spot, and an unread one", () => {
    expect(givenSpotHolds(spots, { zone: "M3", cardId: "86673403" }, given)).toBe(true);
    expect(givenSpotHolds(spots, { zone: "M3" }, given)).toBe(true);
  });
  it("lets another card, another spot, or a taken-back card through", () => {
    expect(givenSpotHolds(spots, { zone: "M3", cardId: "1" }, given)).toBe(false);
    expect(givenSpotHolds(spots, { zone: "M2", cardId: "86673403" }, given)).toBe(false);
    expect(givenSpotHolds(spots, { zone: "M3", cardId: "86673403" }, () => false)).toBe(false);
  });
});

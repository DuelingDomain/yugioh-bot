import { describe, expect, it } from "vitest";
import { givenSpotHolds, type GivenSpot } from "@/lib/remote/given-hold";

describe("a card given to the opponent stays held by identity", () => {
  const spots = new Map<string, GivenSpot>([["fw-1", { zone: "M3", cardId: "86673403", at: 100 }]]);
  const faceUp = (ref: string) => ref === "fw-1" ? { faceUp: true } : undefined;
  const noProof = () => undefined;
  it("holds a new track of the same card on the same spot, and an unread face-up one", () => {
    expect(givenSpotHolds(spots, { zone: "M3", cardId: "86673403", faceDown: false }, faceUp, noProof)).toBe(true);
    expect(givenSpotHolds(spots, { zone: "M3", faceDown: false }, faceUp, noProof)).toBe(true);
  });
  it("lets another card, another spot, a taken-back card or a face-down unread track on the spot through", () => {
    expect(givenSpotHolds(spots, { zone: "M3", cardId: "1", faceDown: false }, faceUp, noProof)).toBe(false);
    expect(givenSpotHolds(spots, { zone: "M2", cardId: "86673403", faceDown: false }, faceUp, noProof)).toBe(false);
    expect(givenSpotHolds(spots, { zone: "M3", cardId: "86673403", faceDown: false }, () => undefined, noProof)).toBe(false);
    expect(givenSpotHolds(spots, { zone: "M3", faceDown: true }, faceUp, noProof)).toBe(false);
  });
  it("releases the spot after the cell is learned empty, not before", () => {
    expect(givenSpotHolds(spots, { zone: "M3", faceDown: false }, faceUp, () => 50)).toBe(true);
    expect(givenSpotHolds(spots, { zone: "M3", faceDown: false }, faceUp, () => 200)).toBe(false);
  });
  it("an unknown given card holds unread tracks of its face only, never a named one", () => {
    const unknown = new Map<string, GivenSpot>([["fw-2", { zone: "M1", at: 100 }]]);
    const down = () => ({ faceUp: false });
    expect(givenSpotHolds(unknown, { zone: "M1", faceDown: true }, down, noProof)).toBe(true);
    expect(givenSpotHolds(unknown, { zone: "M1", cardId: "5", faceDown: true }, down, noProof)).toBe(false);
    expect(givenSpotHolds(unknown, { zone: "M1", faceDown: false }, down, noProof)).toBe(false);
  });
});

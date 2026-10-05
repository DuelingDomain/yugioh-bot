import { describe, expect, it } from "vitest";
import { cardArtworkId, cardImageUrl } from "../src/lib/card-image-url";

describe("card image URLs", () => {
  it("uses the artwork passcode while keeping the draft instance ID", () => {
    const card = { id: 42, passcode: 81480461 };
    expect(cardImageUrl(cardArtworkId(card))).toBe("/api/cards/81480461/image?variant=full");
    expect(card.id).toBe(42);
    expect(cardArtworkId({ id: 81480461 })).toBe(81480461);
  });
  it.each(["full", "small", "cropped"] as const)("uses the local image cache for %s", (variant) => {
    expect(cardImageUrl(81480461, variant)).toBe(`/api/cards/81480461/image?variant=${variant}`);
  });
});

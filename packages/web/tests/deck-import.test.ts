import { describe, expect, it } from "vitest";
import { deckNameFromFile } from "../src/components/decks/import.js";

describe("deckNameFromFile", () => {
  it("drops the extension and turns underscores into spaces", () => {
    expect(deckNameFromFile("Blue-Eyes_Chaos_2024.ydk")).toBe("Blue-Eyes Chaos 2024");
    expect(deckNameFromFile("snake-eye.YDK")).toBe("snake-eye");
  });

  it("falls back to the default name and clamps long names", () => {
    expect(deckNameFromFile(".ydk")).toBe("Untitled deck");
    expect(deckNameFromFile(`${"a".repeat(140)}.ydk`)).toHaveLength(100);
  });
});

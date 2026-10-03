import { describe, expect, it } from "vitest";
import { deckNameFromFile, prepareDeckImport } from "../src/components/decks/import.js";

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

describe("prepareDeckImport", () => {
  const ydk = "#created by someone\n#main\n89631139\n89631139\n#extra\n44508094\n!side\n14558127\n";

  it("keeps the picked mode and all sections for a plain YDK", () => {
    expect(prepareDeckImport(ydk, "Blue-Eyes.ydk", "normal")).toEqual({
      name: "Blue-Eyes",
      mode: "normal",
      deck: { main: [89631139, 89631139], extra: [44508094], side: [14558127] },
    });
  });

  it("makes a lone Side card the Deck Master for Domain", () => {
    const prepared = prepareDeckImport(ydk, "Blue-Eyes.ydk", "domain");
    expect(prepared.mode).toBe("domain");
    expect(prepared.deck).toEqual({ main: [89631139, 89631139], extra: [44508094], side: [], deckMaster: 14558127 });
  });

  it("saves a #deckmaster file as Domain even when Standard was picked", () => {
    const prepared = prepareDeckImport(`#deckmaster\n14558127\n${ydk}`, "dm.ydk", "normal");
    expect(prepared.mode).toBe("domain");
    expect(prepared.deck.deckMaster).toBe(14558127);
  });

  it("rejects a file with no cards", () => {
    expect(() => prepareDeckImport("just some notes", "notes.txt", "normal")).toThrow("No cards found");
  });
});

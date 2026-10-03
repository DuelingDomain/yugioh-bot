import { describe, expect, it } from "vitest";
import { isDraftTemplate, nextCubeName, parseAddTab } from "@/components/cubes/library-model";

describe("library model", () => {
  it("spots a draft template by its shape", () => {
    expect(isDraftTemplate({ id: 1, name: "t", archetype: null, mainCount: 0, extraCount: 0, setNames: ["LOB"], customCardIds: [] })).toBe(true);
    expect(isDraftTemplate({ id: 1, name: "t", archetype: null, mainCount: 5, extraCount: 0, setNames: ["LOB"], customCardIds: [] })).toBe(false);
    expect(isDraftTemplate({ id: 1, name: "t", archetype: "Blue-Eyes", mainCount: 0, extraCount: 0, setNames: ["LOB"], customCardIds: [] })).toBe(false);
    expect(isDraftTemplate({ id: 1, name: "t", archetype: null, mainCount: 0, extraCount: 0, setNames: [], customCardIds: [] })).toBe(false);
  });
  it("picks the next free New cube name", () => {
    expect(nextCubeName([])).toBe("New cube");
    expect(nextCubeName(["New cube", "New cube 2"])).toBe("New cube 3");
  });
  it("reads the add tab", () => {
    expect(parseAddTab("archetype")).toBe("archetype");
    expect(parseAddTab("nope")).toBe("card");
    expect(parseAddTab(null)).toBe("card");
  });
});

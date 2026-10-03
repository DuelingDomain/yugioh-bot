import { describe, expect, it } from "vitest";
import {
  CUBE_DRAFT_TYPES,
  CUBE_TYPE_LABELS,
  cubeDraftSettingsOf,
  cubeDraftTypeOf,
  parseCubeDraftType,
} from "@/lib/cube-type";

describe("cube type helpers", () => {
  it("lists the three types with sentence-case labels", () => {
    expect(CUBE_DRAFT_TYPES).toEqual(["theme", "booster", "any"]);
    expect(CUBE_TYPE_LABELS).toEqual({ theme: "Theme cube", booster: "Cube draft", any: "Any" });
  });

  it("parses only known values", () => {
    expect(parseCubeDraftType("booster")).toBe("booster");
    expect(parseCubeDraftType("Theme")).toBeNull();
    expect(parseCubeDraftType(3)).toBeNull();
    expect(parseCubeDraftType(undefined)).toBeNull();
  });

  it("reads the type from config_json and defaults to any", () => {
    expect(cubeDraftTypeOf(JSON.stringify({ draftType: "theme" }))).toBe("theme");
    expect(cubeDraftTypeOf("{}")).toBe("any");
    expect(cubeDraftTypeOf(null)).toBe("any");
    expect(cubeDraftTypeOf("not json")).toBe("any");
    expect(cubeDraftTypeOf(JSON.stringify({ draftType: "weird" }))).toBe("any");
  });

  it("reads the pack settings and ignores bad values", () => {
    expect(cubeDraftSettingsOf(JSON.stringify({ cardsPerPlayer: 45, packSize: 9, packsPerPlayer: 5 }))).toEqual({
      cardsPerPlayer: 45,
      packSize: 9,
      packsPerPlayer: 5,
    });
    expect(cubeDraftSettingsOf(JSON.stringify({ cardsPerPlayer: "x", packSize: -1 }))).toEqual({});
    expect(cubeDraftSettingsOf(null)).toEqual({});
  });
});

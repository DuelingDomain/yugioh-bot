import { expect, it, vi } from "vitest";
import { firstTurnDrawFor, savedFirstTurnDraw } from "../src/first-turn-draw.js";
import { savedFuzzFirstTurnDraw } from "../scripts/lib/fuzz-draw-rule.js";

it.each([1, 2, 3, 4, 5] as const)("1v1 Domain MR%s skips the turn-1 draw", (masterRule) => {
  expect(firstTurnDrawFor("domain", masterRule, "1v1")).toBe(false);
});

it.each([1, 2, 3, 4, 5] as const)("1v1 Standard MR%s keeps the stock rule", (masterRule) => {
  expect(firstTurnDrawFor("normal", masterRule, "1v1")).toBe(masterRule <= 2);
});

it.each(["tag", "ffa3", "ffa4"] as const)("%s keeps its Domain and Standard first-draw rules", (format) => {
  expect(firstTurnDrawFor("domain", 5, format)).toBe(true);
  expect(firstTurnDrawFor("normal", 5, format)).toBe(false);
});

it("defaults to 1v1 Domain when the format is omitted", () => {
  expect(firstTurnDrawFor("domain")).toBe(false);
});

it.each([1, 2, 3, 4, 5] as const)("old Domain MR%s records without a flag keep their historical stock draw rule", (masterRule) => {
  expect(savedFirstTurnDraw(undefined, "domain", masterRule, "1v1")).toBe(masterRule <= 2);
});

it.each([false, true])("a saved Domain draw flag of %s survives the new default", (stored) => {
  expect(savedFirstTurnDraw(stored, "domain", 1, "1v1")).toBe(stored);
  expect(savedFirstTurnDraw(stored, "domain", 5, "1v1")).toBe(stored);
});

it.each(["1v1", "tag", "ffa3", "ffa4"] as const)("a local %s Domain failure without a saved flag uses its format's current rule", (format) => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    expect(savedFuzzFirstTurnDraw(undefined, "domain", 5, format)).toBe(format !== "1v1");
    expect(warn).toHaveBeenCalledTimes(1);
  } finally { warn.mockRestore(); }
});

import { describe, expect, it } from "vitest";
import { readManifest } from "../../scripts/generate-multi-scripts.js";
import type { NFailure } from "./driver.js";
import { KNOWN_ISSUES, LUA_1_TP_CARDS, knownIssueFor } from "./known-issues.js";

const luaFailure = (code: number): NFailure =>
  ({ invariant: "engine-throw", message: `Lua error: [string "c${code}.lua"]:38: attempt to compare number with nil` }) as unknown as NFailure;

describe("lua-1-tp-nil known issue", () => {
  it("covers only the listed cards, in a format with more than two duelists", () => {
    for (const code of LUA_1_TP_CARDS) expect(knownIssueFor(luaFailure(code), { format: "ffa3", coreTag: "P59" })?.sig, `${code}`).toBe("lua-1-tp-nil");
    expect(knownIssueFor(luaFailure(27204311), { format: "1v1", coreTag: "P59" })).toBeNull();
  });

  it("treats a Lua nil error of any other card as a new failure", () => {
    expect(knownIssueFor(luaFailure(83957459), { format: "ffa4", coreTag: "P59" })).toBeNull();
    expect(knownIssueFor(luaFailure(55144522), { format: "tag", coreTag: "P59" })).toBeNull();
  });

  it("lists no card that the overlay covers (the overlay fixed it, so a failure of it is a regression)", () => {
    const overlay = new Set(readManifest().cards.map((card) => card.code));
    for (const code of LUA_1_TP_CARDS) expect(overlay.has(code), `${code} is in the overlay manifest`).toBe(false);
  });

  it("keeps a unique sig for each known issue", () => {
    expect(new Set(KNOWN_ISSUES.map((issue) => issue.sig)).size).toBe(KNOWN_ISSUES.length);
  });
});

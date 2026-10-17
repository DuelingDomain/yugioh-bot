import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { caseFamilies, loadAllScenarios, scenariosDirectory } from "../support/registry.js";
import { scenarioCodes } from "../support/select.js";

describe("scenario registry", async () => {
  const all = await loadAllScenarios();

  it("has a <family>.test.ts shim for every cases/<family>.ts file", () => {
    for (const family of caseFamilies()) {
      expect(existsSync(join(scenariosDirectory, `${family}.test.ts`)), `missing ${family}.test.ts`).toBe(true);
    }
  });

  it("uses unique scenario ids", () => {
    const ids = all.map(({ scenario }) => scenario.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });

  it("gives every scenario a source, tags and steps", () => {
    for (const { scenario } of all) {
      expect(scenario.source.trim(), `${scenario.id} source`).not.toBe("");
      expect(scenario.tags.length, `${scenario.id} tags`).toBeGreaterThan(0);
      expect(scenario.steps.length, `${scenario.id} steps`).toBeGreaterThan(0);
    }
  });

  it("names only cards that exist (no unknown or ambiguous names)", () => {
    for (const { scenario } of all) expect(() => scenarioCodes(scenario), scenario.id).not.toThrow();
  });
});

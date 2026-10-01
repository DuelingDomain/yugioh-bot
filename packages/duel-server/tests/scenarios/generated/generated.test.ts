import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Scenario } from "../../support/dsl.js";
import { runScenarios } from "../../support/runner.js";

/**
 * Runs every scenario file in this directory (written by scripts/failure-to-scenario.ts).
 * A file exports `scenarios: Scenario[]`, like the files in ../cases. See README.md.
 */
const directory = fileURLToPath(new URL("./", import.meta.url));
const files = readdirSync(directory).filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts")).sort();

const all: Scenario[] = [];
for (const file of files) {
  const module = (await import(join(directory, file))) as { scenarios: Scenario[] };
  all.push(...module.scenarios);
}

describe("generated scenarios", () => {
  it("has unique ids", () => {
    const ids = all.map((scenario) => scenario.id);
    expect(ids.filter((id, index) => ids.indexOf(id) !== index)).toEqual([]);
  });
});

if (all.length > 0) runScenarios("generated", all);

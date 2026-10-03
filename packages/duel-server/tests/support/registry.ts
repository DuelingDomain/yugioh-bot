import { readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import type { Scenario } from "./dsl.js";

export const casesDirectory = fileURLToPath(new URL("../scenarios/cases/", import.meta.url));
export const scenariosDirectory = fileURLToPath(new URL("../scenarios/", import.meta.url));

export function caseFamilies(): string[] {
  return readdirSync(casesDirectory).filter((file) => file.endsWith(".ts")).map((file) => file.slice(0, -3)).sort();
}

/** Load every scenario of every cases/<family>.ts file. */
export async function loadAllScenarios(): Promise<Array<{ family: string; scenario: Scenario }>> {
  const all: Array<{ family: string; scenario: Scenario }> = [];
  for (const family of caseFamilies()) {
    const module = (await import(join(casesDirectory, `${family}.ts`))) as { scenarios: Scenario[] };
    for (const scenario of module.scenarios) all.push({ family, scenario });
  }
  return all;
}

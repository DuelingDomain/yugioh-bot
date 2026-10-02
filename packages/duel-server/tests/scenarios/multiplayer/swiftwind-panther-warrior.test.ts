import { afterAll, vi } from "vitest";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import Database from "better-sqlite3";
import { domainVariant } from "./domain-variants.js";
import { SWIFTWIND_PANTHER_WARRIOR_SCENARIOS } from "./swiftwind-panther-warrior.js";

// The installed database has no entries for these new cards. Use exact Project Ignis rows in a private copy.
// The fixture records its primary source commit and database hash. Scripts and cores stay the installed ones.
const originalData = process.env.DUEL_DATA_DIR;
const installedData = resolve(originalData ?? new URL("../../../../../data/duel-engine-next/", import.meta.url).pathname);
const testData = mkdtempSync(join(tmpdir(), "swiftwind-panther-warrior-data-"));
copyFileSync(join(installedData, "cards.cdb"), join(testData, "cards.cdb"));
for (const name of ["card-scripts", "strings.conf", "ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
  const source = join(installedData, name);
  if (existsSync(source)) symlinkSync(source, join(testData, name));
}
const rows = JSON.parse(readFileSync(new URL("../../support/fixtures/swiftwind-panther-warrior-cards.json", import.meta.url), "utf8")) as { datas: unknown[][]; texts: unknown[][] };
const db = new Database(join(testData, "cards.cdb"));
try {
  for (const table of ["datas", "texts"] as const) {
    const insert = db.prepare(`INSERT OR REPLACE INTO ${table} VALUES (${rows[table][0].map(() => "?").join(",")})`);
    for (const row of rows[table]) insert.run(...row);
  }
} finally {
  db.close();
}
process.env.DUEL_DATA_DIR = testData;
vi.resetModules(); // The session reads its data directory when its module loads.
const { describeWithCores, needs } = await import("../../support/cores.js");
const { liveNseat } = await import("../../support/live-nseat.js");
const { runScenarios } = await import("../../support/runner.js");
afterAll(() => {
  if (originalData === undefined) delete process.env.DUEL_DATA_DIR;
  else process.env.DUEL_DATA_DIR = originalData;
  rmSync(testData, { recursive: true, force: true });
});

describeWithCores("Standard Swiftwind Panther Warrior", liveNseat, () => {
  runScenarios("multiplayer/swiftwind-panther-warrior", SWIFTWIND_PANTHER_WARRIOR_SCENARIOS);
});

describeWithCores("Domain Swiftwind Panther Warrior", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/swiftwind-panther-warrior-domain", SWIFTWIND_PANTHER_WARRIOR_SCENARIOS.map(domainVariant));
});

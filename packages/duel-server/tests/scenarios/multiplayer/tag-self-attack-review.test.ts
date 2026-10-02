import { afterAll, describe, expect, it, vi } from "vitest";
import { rmSync } from "node:fs";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_SELF_ATTACK_REVIEW_SCENARIOS } from "./tag-self-attack-review.js";

// Create the fixture in private data before the scenario helpers load the catalog.
// The installed engine data and the overlay are read only.
const fixture = await vi.hoisted(async () => {
  const { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { default: Database } = await import("better-sqlite3");
  const source = process.env.DUEL_DATA_DIR;
  if (!source || !existsSync(join(source, "cards.cdb"))) return { directory: "", source };
  const directory = mkdtempSync(join(tmpdir(), "tag-self-attack-data-"));
  for (const name of ["cards.cdb", "strings.conf", "card-scripts", "domain.lua", "ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
    if (existsSync(join(source, name))) cpSync(join(source, name), join(directory, name), { recursive: true });
  }
  const db = new Database(join(directory, "cards.cdb"));
  try {
    db.prepare("INSERT OR REPLACE INTO datas VALUES (95200104,3,0,0,131074,0,0,0,0,0,0)").run();
    db.prepare(`INSERT OR REPLACE INTO texts VALUES (${Array(19).fill("?").join(",")})`)
      .run(95200104, "Review Self Attack", "Test fixture: permit attacks on own team monsters.", ...Array(16).fill(""));
  } finally {
    db.close();
  }
  writeFileSync(join(directory, "card-scripts/official/c95200104.lua"),
    readFileSync(new URL("./fixtures/review-self-attack.lua", import.meta.url)));
  process.env.DUEL_DATA_DIR = directory;
  return { directory, source };
});
vi.mock("../../engine-data-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engine-data-dir.js")>();
  return fixture.directory ? { ...actual, engineDataDirectory: fixture.directory } : actual;
});
afterAll(() => {
  if (fixture.source === undefined) delete process.env.DUEL_DATA_DIR;
  else process.env.DUEL_DATA_DIR = fixture.source;
  if (fixture.directory) rmSync(fixture.directory, { recursive: true, force: true });
});
describeWithCores("live Tag self attack review", liveNseat, () => {
  runScenarios("multiplayer/tag-self-attack-review", TAG_SELF_ATTACK_REVIEW_SCENARIOS);
});
describeWithCores("live Domain Tag self attack review", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-self-attack-review-domain", TAG_SELF_ATTACK_REVIEW_SCENARIOS.map(domainVariant));
});
describe("self attack review proofs", () => {
  it("checks every seat after real battle and distinguishes effect and no-effect target lists", () => {
    expect(new Set(TAG_SELF_ATTACK_REVIEW_SCENARIOS.map((s) => s.id)).size).toBe(TAG_SELF_ATTACK_REVIEW_SCENARIOS.length);
    for (const scenario of TAG_SELF_ATTACK_REVIEW_SCENARIOS) {
      expect(scenario.steps.some((s) => s.op === "expectPickOptions"), scenario.id).toBe(true);
      expect(scenario.steps.some((s) => s.op === "select"), scenario.id).toBe(true);
      const last = scenario.steps.at(-1);
      expect(last?.op, scenario.id).toBe("expectBoard");
      if (last?.op === "expectBoard") expect(Object.keys(last.board), scenario.id).toHaveLength(scenario.setup.format === "ffa3" ? 3 : 4);
    }
  });
});

import { afterAll, describe, expect, it, vi } from "vitest";
import { existsSync, lstatSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describeWithCores, needs } from "../../support/cores.js";
import { liveNseat } from "../../support/live-nseat.js";
import { runScenarios } from "../../support/runner.js";
import { domainVariant } from "./domain-variants.js";
import { TAG_SELF_ATTACK_REVIEW_SCENARIOS } from "./tag-self-attack-review.js";

// Create the fixture in private data before the scenario helpers load the catalog.
// The installed engine data and the overlay are read only.
const fixture = await vi.hoisted(async () => {
  const source = process.env.DUEL_DATA_DIR;
  const unused = { directory: "", source, cleanup: () => {} };
  if (process.env.NSEAT_LIVE !== "1") return unused;
  const { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } = await import("node:fs");
  const { join, resolve } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { default: Database } = await import("better-sqlite3");
  if (!source || !existsSync(join(source, "cards.cdb"))) return unused;
  const directory = mkdtempSync(join(tmpdir(), "tag-self-attack-data-"));
  const cleanup = () => rmSync(directory, { recursive: true, force: true });
  process.once("exit", cleanup);
  try {
    copyFileSync(join(source, "cards.cdb"), join(directory, "cards.cdb"));
    for (const name of ["strings.conf", "domain.lua", "ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
      if (existsSync(join(source, name))) symlinkSync(resolve(source, name), join(directory, name));
    }
    const scripts = join(directory, "card-scripts");
    const official = join(scripts, "official");
    // The script index visits real directories. Link the files in each directory.
    const linkScripts = (from: string, to: string) => {
      mkdirSync(to, { recursive: true });
      for (const entry of readdirSync(from, { withFileTypes: true })) {
        const target = join(to, entry.name);
        if (target === join(official, "c95200104.lua")) continue;
        if (entry.isDirectory()) linkScripts(join(from, entry.name), target);
        else symlinkSync(resolve(from, entry.name), target);
      }
    };
    linkScripts(join(source, "card-scripts"), scripts);
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
    return { directory, source, cleanup };
  } catch (error) {
    cleanup();
    process.removeListener("exit", cleanup);
    throw error;
  }
});
vi.mock("../../engine-data-dir.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../engine-data-dir.js")>();
  return fixture.directory ? { ...actual, engineDataDirectory: fixture.directory } : actual;
});
afterAll(() => {
  if (fixture.source === undefined) delete process.env.DUEL_DATA_DIR;
  else process.env.DUEL_DATA_DIR = fixture.source;
  fixture.cleanup();
  process.removeListener("exit", fixture.cleanup);
});
describeWithCores("live Tag self attack review", liveNseat, () => {
  runScenarios("multiplayer/tag-self-attack-review", TAG_SELF_ATTACK_REVIEW_SCENARIOS);
});
describeWithCores("live Domain Tag self attack review", [liveNseat, ...needs.domainMulti()], () => {
  runScenarios("multiplayer/tag-self-attack-review-domain", TAG_SELF_ATTACK_REVIEW_SCENARIOS.map(domainVariant));
});
describe("self attack review proofs", () => {
  it("creates private data only for live tests and links the unchanged engine files", () => {
    if (process.env.NSEAT_LIVE !== "1") {
      expect(fixture.directory).toBe("");
      return;
    }
    expect(fixture.directory).not.toBe("");
    expect(lstatSync(join(fixture.directory, "cards.cdb")).isSymbolicLink()).toBe(false);
    for (const name of ["strings.conf", "domain.lua", "ocgcore.standard.wasm", "ocgcore.domain.wasm", "ocgcore.multi.wasm", "ocgcore.multi-domain.wasm"]) {
      if (fixture.source && existsSync(join(fixture.source, name))) {
        expect(lstatSync(join(fixture.directory, name)).isSymbolicLink(), name).toBe(true);
      }
    }
    const scripts = join(fixture.directory, "card-scripts");
    const checkLinks = (directory: string) => {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const file = join(directory, entry.name);
        if (entry.isDirectory()) checkLinks(file);
        else if (file !== join(scripts, "official/c95200104.lua")) {
          expect(lstatSync(file).isSymbolicLink(), file).toBe(true);
        }
      }
    };
    checkLinks(scripts);
    const official = join(scripts, "official");
    for (const name of readdirSync(official).filter((name) => name !== "c95200104.lua")) {
      expect(lstatSync(join(official, name)).isSymbolicLink(), name).toBe(true);
    }
    expect(lstatSync(join(official, "c95200104.lua")).isSymbolicLink()).toBe(false);
  });

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

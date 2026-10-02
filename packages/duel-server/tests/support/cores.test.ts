import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { DEFAULT_TEST_DATA_DIRECTORY, currentEngineDataDirectory } from "../engine-data-dir.js";
import { coresReady, currentDomainMultiWasm, currentMultiWasm, failIfRequired, missingCoreMessage, missingNeeds, needs, requireCores } from "./cores.js";

const packageDirectory = fileURLToPath(new URL("../..", import.meta.url));
const fixtureConfig = join(packageDirectory, "tests/support/fixtures/vitest.config.ts");

const saved = { require: process.env.DUEL_REQUIRE_CORES, data: process.env.DUEL_DATA_DIR, multi: process.env.MULTI_WASM, domainMulti: process.env.DOMAIN_MULTI_WASM };
afterEach(() => {
  for (const [name, value] of [["DUEL_REQUIRE_CORES", saved.require], ["DUEL_DATA_DIR", saved.data], ["MULTI_WASM", saved.multi], ["DOMAIN_MULTI_WASM", saved.domainMulti]] as const) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

describe("shared engine data directory", () => {
  it("defaults to data/duel-engine-next, and DUEL_DATA_DIR overrides it", () => {
    expect(DEFAULT_TEST_DATA_DIRECTORY).toMatch(/data[\\/]duel-engine-next[\\/]?$/);
    delete process.env.DUEL_DATA_DIR;
    expect(currentEngineDataDirectory()).toBe(resolve(DEFAULT_TEST_DATA_DIRECTORY));
    process.env.DUEL_DATA_DIR = "/tmp/some-engine-data";
    expect(currentEngineDataDirectory()).toBe("/tmp/some-engine-data");
  });

  it("is the value that the Vitest setup file gives to every test file", () => {
    // tests/support/setup.ts runs before this file: the variable is never empty.
    expect(saved.data).toBeTruthy();
  });
});

describe("core needs", () => {
  const empty = mkdtempSync(join(tmpdir(), "cores-empty-"));
  afterAll(() => rmSync(empty, { recursive: true, force: true }));

  it("names every missing file", () => {
    const list = [needs.standard(empty), needs.domain(empty), needs.installedMulti(empty), needs.cards(empty), needs.multi(join(empty, "x.wasm"))];
    expect(coresReady(list)).toBe(false);
    expect(missingNeeds(list)).toHaveLength(5);
    expect(missingNeeds(list).map((need) => need.kind)).toEqual(["standard", "domain", "multi", "data", "multi"]);
  });

  it("is ready when the list is empty", () => {
    expect(coresReady([])).toBe(true);
  });

  it("builds a message that has the test name, the file and the variable", () => {
    const message = missingCoreMessage("my suite", missingNeeds([needs.standard(empty)]));
    expect(message).toContain("DUEL_REQUIRE_CORES=1");
    expect(message).toContain('"my suite"');
    expect(message).toContain(join(empty, "ocgcore.standard.wasm"));
  });

  it("failIfRequired throws only when DUEL_REQUIRE_CORES=1", () => {
    delete process.env.DUEL_REQUIRE_CORES;
    expect(requireCores()).toBe(false);
    expect(() => failIfRequired("a part", needs.standard(empty))).not.toThrow();
    process.env.DUEL_REQUIRE_CORES = "1";
    expect(requireCores()).toBe(true);
    expect(() => failIfRequired("a part", needs.standard(empty))).toThrow(/ocgcore\.standard\.wasm/);
    expect(() => failIfRequired("a part", [])).not.toThrow();
  });

  it("never fails for a missing local file that is not a core, also with DUEL_REQUIRE_CORES=1", () => {
    process.env.DUEL_REQUIRE_CORES = "1";
    const local = needs.localFile("a failure record", join(empty, "none.json"), "Record it.");
    expect(local.ok).toBe(false);
    expect(() => failIfRequired("a part", local)).not.toThrow();
    expect(() => failIfRequired("a part", needs.file("a build", join(empty, "none.wasm")))).toThrow(/none\.wasm/);
  });

  it("names the probed file in the Debug.SetupDuelists need", () => {
    const need = needs.setupDuelists(false, join(empty, "probed.wasm"));
    expect(need.where).toBe(join(empty, "probed.wasm"));
    expect(need.ok).toBe(false);
  });

  it("fails a core feature that a probe did not find in require mode (no silent skip)", () => {
    const missing = needs.coreFeature("multi core with seats", false, "Use a newer build.", join(empty, "probed.wasm"));
    expect(missing.ok).toBe(false);
    expect(missing.where).toBe(join(empty, "probed.wasm"));
    process.env.DUEL_REQUIRE_CORES = "1";
    expect(() => failIfRequired("a part", missing)).toThrow(/multi core with seats at .*probed\.wasm/);
    expect(needs.coreFeature("multi core with seats", true, "x", import.meta.filename).ok).toBe(true);
  });

  it("picks the multi cores: the variable, else a file that the documented build makes or a local tagged build", () => {
    delete process.env.MULTI_WASM;
    delete process.env.DOMAIN_MULTI_WASM;
    expect(currentMultiWasm()).toMatch(/ocgcore\.multi(-[A-Za-z0-9]+)?\.sync\.wasm$/);
    expect(currentDomainMultiWasm()).toMatch(/ocgcore\.multi-domain(-[A-Za-z0-9]+)?\.sync\.wasm$/);
    process.env.MULTI_WASM = "/x/own-build.wasm";
    process.env.DOMAIN_MULTI_WASM = "/x/own-domain-build.wasm";
    expect(currentMultiWasm()).toBe("/x/own-build.wasm");
    expect(currentDomainMultiWasm()).toBe("/x/own-domain-build.wasm");
  });

  it("keeps the live N-seat gate closed without NSEAT_LIVE, and names it", () => {
    const savedLive = process.env.NSEAT_LIVE;
    delete process.env.NSEAT_LIVE;
    try {
      const gate = needs.liveNseat(true);
      expect(gate.ok).toBe(false);
      expect(gate.label).toContain("NSEAT_LIVE=1");
    } finally {
      if (savedLive !== undefined) process.env.NSEAT_LIVE = savedLive;
    }
  });
});

interface JsonReport {
  testResults: Array<{ assertionResults: Array<{ fullName: string; status: string; failureMessages: string[] }> }>;
}

function runFixture(requireFlag: "1" | undefined): JsonReport {
  const empty = mkdtempSync(join(tmpdir(), "cores-fixture-"));
  try {
    const env: NodeJS.ProcessEnv = { ...process.env, DUEL_DATA_DIR: empty };
    delete env.DUEL_REQUIRE_CORES;
    if (requireFlag) env.DUEL_REQUIRE_CORES = requireFlag;
    const run = spawnSync("npx", ["vitest", "run", "--config", fixtureConfig, "--reporter=json"], { cwd: packageDirectory, env, encoding: "utf8", timeout: 55_000 });
    const text = run.stdout.slice(run.stdout.indexOf("{"));
    return JSON.parse(text) as JsonReport;
  } finally {
    rmSync(empty, { recursive: true, force: true });
  }
}

describe("a test that needs a missing core (child Vitest run)", () => {
  const byName = (report: JsonReport) => new Map(report.testResults.flatMap((file) => file.assertionResults).map((test) => [test.fullName, test]));

  it("is skipped without DUEL_REQUIRE_CORES", () => {
    const tests = byName(runFixture(undefined));
    expect(tests.get("fixture suite never runs")?.status).toBe("skipped");
    expect(tests.get("fixture single test")?.status).toBe("skipped");
    expect(tests.get("fixture each 1")?.status).toBe("skipped");
    expect(tests.get("fixture suite with cores present runs")?.status).toBe("passed");
    expect(tests.get("fixture each present 1")?.status).toBe("passed");
  }, 60_000);

  it("FAILS with the missing file named when DUEL_REQUIRE_CORES=1", () => {
    const tests = byName(runFixture("1"));
    const failed = [...tests.values()].filter((test) => test.status === "failed");
    expect(failed.map((test) => test.fullName).sort()).toEqual(["fixture each %s", "fixture single test", "fixture suite has the cores it needs"]);
    for (const test of failed) expect(test.failureMessages.join("\n")).toContain("DUEL_REQUIRE_CORES=1");
    expect(failed.find((test) => test.fullName === "fixture single test")?.failureMessages.join("\n")).toContain("/nonexistent/ocgcore.multi.wasm");
    expect(tests.get("fixture suite with cores present runs")?.status).toBe("passed");
    expect(tests.get("fixture each present 2")?.status).toBe("passed");
  }, 60_000);
});

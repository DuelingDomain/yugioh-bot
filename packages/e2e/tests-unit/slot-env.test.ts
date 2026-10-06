import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

function config(overrides: Record<string, string> = {}, manual = false) {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("E2E_")) delete env[key];
  const script = `
    ${manual ? "const { applyManualDefaults } = await import('./stack/manual-env.mjs'); applyManualDefaults();" : ""}
    const config = await import('./stack/env.mjs');
    console.log(JSON.stringify(config));
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../", import.meta.url), env: { ...env, ...overrides }, encoding: "utf8",
  });
}

function readConfig(overrides: Record<string, string> = {}, manual = false) {
  const result = config(overrides, manual);
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("unset slot preserves all existing ports and output paths", () => {
  const c = readConfig();
  assert.deepEqual(c.ports, { web: 3300, ws: 3302, wsInternal: 4302, duel: 4303 });
  assert.equal(c.stackDir, resolve(c.e2eRoot, ".stack"));
  assert.equal(c.authDir, resolve(c.e2eRoot, ".auth"));
  assert.equal(c.resultsDir, resolve(c.e2eRoot, "test-results"));
  assert.equal(c.htmlReportDir, resolve(c.e2eRoot, "playwright-report"));
  assert.equal(c.jsonReportFile, resolve(c.repoRoot, ".status/e2e-results.json"));
  assert.equal(c.multiStatusDir, resolve(c.repoRoot, ".status/e2e-multi"));
  assert.equal(c.nextDistDir, ".next");
  assert.equal(c.standaloneBuildDir, resolve(c.repoRoot, "packages/web/.next/standalone/packages/web"));
});

test("empty dist-dir overrides use the same defaults as an unset override", () => {
  const cases: Record<string, string>[] = [{}, { E2E_SLOT: "2" }];
  for (const overrides of cases) {
    const defaultConfig = readConfig(overrides);
    const emptyConfig = readConfig({ ...overrides, E2E_NEXT_DIST_DIR: "" });
    assert.equal(emptyConfig.nextDistDir, defaultConfig.nextDistDir);
    assert.equal(emptyConfig.standaloneBuildDir, defaultConfig.standaloneBuildDir);
    assert.equal(emptyConfig.buildStampFile, defaultConfig.buildStampFile);
  }
});

test("nonempty dist-dir overrides apply to both ordinary and slot builds", () => {
  const cases: Record<string, string>[] = [{}, { E2E_SLOT: "2" }];
  for (const overrides of cases) {
    const c = readConfig({ ...overrides, E2E_NEXT_DIST_DIR: ".next-custom" });
    assert.equal(c.nextDistDir, ".next-custom");
    assert.equal(c.standaloneBuildDir, resolve(c.repoRoot, "packages/web/.next-custom/standalone/packages/web"));
  }
});

test("all ten slots have disjoint ports and private output directories", () => {
  const reserved = new Set([3000, 3001, 3002, 3100, 3110, 4001, 4002, 4003, 4010, 3300, 3302, 4302, 4303, 3400, 3402, 4402, 4403]);
  const seen = new Set<number>();
  for (let slot = 0; slot <= 9; slot++) {
    const c = readConfig({ E2E_SLOT: String(slot) });
    assert.deepEqual(c.ports, { web: 3301 + slot * 10, ws: 3303 + slot * 10, wsInternal: 4304 + slot * 10, duel: 4305 + slot * 10 });
    for (const port of Object.values(c.ports) as number[]) {
      assert.ok(!reserved.has(port), `slot ${slot}: reserved port ${port}`);
      assert.ok(!seen.has(port), `slot ${slot}: duplicate port ${port}`);
      seen.add(port);
    }
    assert.equal(c.stackDir, resolve(c.e2eRoot, `.stack-${slot}`));
    for (const path of [c.dbPath, c.workerHealthPath, c.stackLogFile, c.cardImageDir, c.manualInfoFile, c.authDir, c.resultsDir, c.htmlReportDir, c.jsonReportFile, c.multiStatusDir]) {
      assert.ok(path.startsWith(c.stackDir + "/"), `slot ${slot}: ${path}`);
    }
    assert.equal(c.nextDistDir, `.next-e2e-${slot}`);
    assert.equal(c.standaloneBuildDir, resolve(c.repoRoot, `packages/web/.next-e2e-${slot}/standalone/packages/web`));
    assert.equal(c.buildStampFile, resolve(c.standaloneBuildDir, ".e2e-build.json"));
  }
});

test("invalid slots fail before consuming overrides", () => {
  for (const value of ["", "-1", "10", "1.5", "foo", "01", " 1", "1 "]) {
    const result = config({ E2E_SLOT: value, E2E_WEB_PORT: "3510" });
    assert.notEqual(result.status, 0, `E2E_SLOT=${JSON.stringify(value)}`);
    assert.match(result.stderr, /E2E_SLOT.*0.*9/);
  }
});

test("explicit ports win over slot defaults in ordinary and manual mode", () => {
  const overrides = { E2E_SLOT: "2", E2E_WEB_PORT: "3511", E2E_WS_PORT: "3513", E2E_WS_INTERNAL_PORT: "4514", E2E_DUEL_PORT: "4515" };
  for (const manual of [false, true]) {
    const c = readConfig(overrides, manual);
    assert.deepEqual(c.ports, { web: 3511, ws: 3513, wsInternal: 4514, duel: 4515 });
    assert.equal(c.webUrl, "http://localhost:3511");
    assert.equal(c.wsUrl, "http://localhost:3513");
  }
});

test("manual mode shares the chosen slot's ports and keeps its own image/data defaults", () => {
  const c = readConfig({ E2E_SLOT: "3" }, true);
  assert.deepEqual(c.ports, { web: 3331, ws: 3333, wsInternal: 4334, duel: 4335 });
  assert.equal(c.cardImageDir, resolve(c.stackDir, "manual-card-images"));
  assert.equal(c.duelDataDir, resolve(c.repoRoot, "data/duel-engine-snap"));
  assert.equal(c.manualMode, true);
});

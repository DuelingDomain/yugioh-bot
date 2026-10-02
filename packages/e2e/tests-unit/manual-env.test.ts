import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { livePorts } from "../stack/env.mjs";

test("the isolated stack refuses live services and preview ports", () => {
  for (const port of [3000, 3001, 3002, 3100, 3110, 4001, 4002, 4003, 4010]) {
    assert.ok(livePorts.includes(port), `port ${port} must be refused`);
  }
});

function defaults(overrides: Record<string, string> = {}) {
  const script = `
    const { applyManualDefaults } = await import('./stack/manual-env.mjs');
    applyManualDefaults();
    const { ports, duelDataDir, repoRoot } = await import('./stack/env.mjs');
    console.log(JSON.stringify({ ports, duelDataDir, repoRoot, manual: process.env.E2E_MANUAL, botMs: process.env.E2E_BOT_STEP_MS }));
  `;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("E2E_")) delete env[key];
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: new URL("../", import.meta.url), env: { ...env, ...overrides }, encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test("manual mode defaults to the 3400 family and the local core snapshot", () => {
  const config = defaults();
  assert.deepEqual(config.ports, { web: 3400, ws: 3402, wsInternal: 4402, duel: 4403 });
  assert.equal(config.duelDataDir, `${config.repoRoot}/data/duel-engine-snap`);
  assert.equal(config.manual, "1");
  assert.equal(config.botMs, "900");
});

test("manual mode honors explicit isolated ports, core data, and bot speed", () => {
  const config = defaults({ E2E_WEB_PORT: "3500", E2E_WS_PORT: "3502", E2E_WS_INTERNAL_PORT: "4502", E2E_DUEL_PORT: "4503", E2E_DUEL_DATA_DIR: "/tmp/test-core", E2E_BOT_STEP_MS: "700" });
  assert.deepEqual(config.ports, { web: 3500, ws: 3502, wsInternal: 4502, duel: 4503 });
  assert.equal(config.duelDataDir, "/tmp/test-core");
  assert.equal(config.botMs, "700");
});

test("ordinary e2e mode keeps its ports and engine data default", () => {
  const script = `const { ports, duelDataDir, repoRoot } = await import('./stack/env.mjs'); console.log(JSON.stringify({ ports, duelDataDir, repoRoot }));`;
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith("E2E_")) delete env[key];
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], { cwd: new URL("../", import.meta.url), env, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const config = JSON.parse(result.stdout);
  assert.deepEqual(config.ports, { web: 3300, ws: 3302, wsInternal: 4302, duel: 4303 });
  assert.equal(config.duelDataDir, `${config.repoRoot}/data/duel-engine-next`);
});

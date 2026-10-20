import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const { jobs } = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
const runGate = (job, env) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", jobs[job].steps[0].run], { env }).status;

for (const job of ["engine", "engine-legacy"]) {
  test(`${job} gate accepts intentional skips and rejects missing required shards or failed detection`, () => {
    for (const [changes, required, result, pass] of [
      ["success", "false", "skipped", true],
      ["success", "true", "success", true],
      ["success", "true", "skipped", false],
      ["success", "true", "failure", false],
      ["success", "true", "cancelled", false],
      ["failure", "", "skipped", false],
      ["cancelled", "", "skipped", false],
    ]) {
      const env = { CHANGES: changes, REQUIRED: required, RESULT: result, SMOKE_REPORT: "skipped" };
      assert.equal(runGate(job, env) === 0, pass, JSON.stringify(env));
    }
  });
}

test("the engine gate rejects a failed or cancelled card smoke report", () => {
  for (const smoke of ["failure", "cancelled"]) {
    assert.notEqual(runGate("engine", { CHANGES: "success", REQUIRED: "true", RESULT: "success", SMOKE_REPORT: smoke }), 0);
  }
});

test("the unit gate still requires both unit suites to succeed", () => {
  assert.equal(runGate("unit", { PACKAGES: "success", WEB: "success" }), 0);
  for (const result of ["failure", "cancelled", "skipped"]) {
    assert.notEqual(runGate("unit", { PACKAGES: result, WEB: "success" }), 0);
    assert.notEqual(runGate("unit", { PACKAGES: "success", WEB: result }), 0);
  }
});

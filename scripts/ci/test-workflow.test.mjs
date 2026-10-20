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

const packageGroups = ['unit-typecheck', 'unit-web-build', 'unit-shared', 'unit-services', 'unit-duel'];
test('package gate rejects every failed, cancelled or skipped required group', () => {
  assert.deepEqual(jobs['unit-packages'].needs, packageGroups);
  const statuses = Object.fromEntries(packageGroups.map((_, i) => [`GROUP_${i}`, 'success']));
  assert.equal(runGate('unit-packages', statuses), 0);
  for (const key of Object.keys(statuses)) {
    for (const result of ['failure', 'cancelled', 'skipped', '']) {
      assert.notEqual(runGate('unit-packages', { ...statuses, [key]: result }), 0, `${key}: ${result}`);
    }
  }
});

test('unit groups start without engine or change-detection dependencies', () => {
  for (const name of [...packageGroups, 'unit-web']) {
    assert.equal(jobs[name].needs, undefined, name);
    assert.equal(jobs[name].if, "github.event_name != 'schedule'");
  }
});

test('production builds only run on main pushes and cannot deploy', () => {
  for (const name of ['production-bundle', 'production-images']) {
    const job = jobs[name];
    assert.equal(job.if, "github.event_name == 'push' && github.ref == 'refs/heads/main'");
    assert.doesNotMatch(JSON.stringify(job), /VM_|ssh|deploy-production/);
  }
  assert.equal(jobs['production-bundle'].steps.find(step => step.name === 'Upload production image bundle').with.overwrite, true);
  assert.equal(jobs['production-images'].permissions.packages, 'write');
  assert.equal(jobs['production-images'].strategy.matrix.include.length, 5);
});

test('automatic releases consume bundle and digests from the exact triggering Test run', () => {
  const deploy = parse(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  const bundle = deploy.jobs.prepare.steps.find(step => step.name === 'Download tested production bundle');
  const digests = deploy.jobs.deploy.steps.find(step => step.name === 'Download tested runtime image digests');
  for (const step of [bundle, digests]) {
    assert.match(step.if, /github.event_name == 'workflow_run'/);
    assert.equal(step.with['run-id'], '${{ github.event.workflow_run.id }}');
    assert.equal(step.with['github-token'], '${{ github.token }}');
  }
  assert.equal(bundle.with['artifact-ids'], '${{ steps.tested-artifacts.outputs.bundle_id }}');
  assert.equal(digests.with['artifact-ids'], '${{ needs.prepare.outputs.image_artifact_ids }}');
  const resolve = deploy.jobs.prepare.steps.find(step => step.id === 'tested-artifacts');
  assert.equal(resolve.env.TEST_RUN_ATTEMPT, '${{ github.event.workflow_run.run_attempt }}');
  assert.match(deploy.jobs.build.if, /github.event_name == 'workflow_dispatch'/);
  assert.match(deploy.jobs.deploy.if, /needs.build.result == 'skipped'/);
  assert.match(deploy.jobs.deploy.if, /github.event.workflow_run.conclusion == 'success'/);
});


test('manual releases load build actions from the workflow revision for older refs', () => {
  const deploy = parse(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  for (const name of ['prepare', 'build']) {
    const steps = deploy.jobs[name].steps;
    const controls = steps.findIndex(step => step.name === 'Checkout release build controls');
    const action = steps.findIndex(step => step.uses?.startsWith('./.release-controls/.github/actions/'));
    assert.ok(controls >= 0 && controls < action);
    assert.equal(steps[controls].with.ref, '${{ github.workflow_sha }}');
    assert.equal(steps[controls].with['persist-credentials'], false);
  }
});

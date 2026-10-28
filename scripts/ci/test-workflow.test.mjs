import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parse } from "yaml";

const { jobs } = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
const runGate = (job, env) => spawnSync("bash", ["-e", "-o", "pipefail", "-c", jobs[job].steps[0].run], { env: { ...process.env, ...env } }).status;

const areaJobs = {
  web: ['unit-web', 'unit-web-build'], shared: ['unit-shared'], bot: ['unit-bot'],
  ws: ['unit-ws'], worker: ['unit-worker'], duel_unit: ['unit-duel'], e2e: ['unit-e2e'],
  ci_scripts: ['ci-scripts'], engine: ['core-cache', 'cores', 'engine-shards', 'engine-legacy-shards', 'native', 'rule-coverage'],
};
const gateJobs = () => Object.fromEntries(jobs['ci-result'].needs.map(name => [name, {
  result: name === 'changes' ? 'success' : 'skipped', outputs: {},
}]));
const gate = (results, event = 'workflow_dispatch', nightly = event === 'schedule') => runGate('ci-result', { RESULTS: JSON.stringify(results), EVENT: event, NIGHTLY: String(nightly) });

test('CI result accepts intentional skips and rejects failed or cancelled jobs and detection', () => {
  assert.deepEqual([...jobs['ci-result'].needs].sort(), Object.keys(jobs).filter(name => name !== 'ci-result').sort());
  assert.equal(jobs['ci-result'].if, 'always()');
  assert.equal(gate(gateJobs()), 0);
  for (const name of jobs['ci-result'].needs) {
    for (const result of ['failure', 'cancelled', '']) {
      const results = gateJobs();
      results[name].result = result;
      assert.notEqual(gate(results), 0, `${name}: ${result}`);
    }
  }
  const results = gateJobs();
  results.changes.result = 'skipped';
  assert.notEqual(gate(results), 0);
});

test('CI result requires every selected group, including all engine suites', () => {
  for (const [area, names] of Object.entries(areaJobs)) {
    const results = gateJobs();
    results.changes.outputs[area] = 'true';
    for (const name of names) results[name].result = 'success';
    assert.equal(gate(results), 0, area);
    for (const name of names) {
      results[name].result = 'skipped';
      assert.notEqual(gate(results), 0, name);
      results[name].result = 'success';
    }
  }
});

test('pure known data changes require consumer integration tests and skip web build', () => {
  const results = gateJobs();
  results.changes.outputs = { data_only: 'true', web: 'true', shared: 'true', duel_unit: 'true' };
  for (const name of ['unit-web', 'unit-shared', 'unit-duel']) results[name].result = 'success';
  assert.equal(gate(results, 'pull_request'), 0);
  results['unit-web'].result = 'skipped';
  assert.notEqual(gate(results, 'pull_request'), 0);
  assert.match(jobs['unit-web-build'].if, /data_only != 'true'/);
  for (const name of ['unit-web', 'unit-shared']) {
    const step = jobs[name].steps.find(step => step.name.includes('staple data consumers'));
    assert.match(step.run, /integration.test/);
    assert.equal(step.if, "needs.changes.outputs.data_only == 'true'");
  }
});

test('slow jobs are required only for their selected inputs; main uses real production builds', () => {
  const docs = gateJobs();
  docs.changes.outputs.docs_only = 'true';
  assert.equal(gate(docs, 'pull_request'), 0);
  for (const [flag, job] of [['effects', 'effect-protocol'], ['prod_build', 'production-dry-run']]) {
    const results = gateJobs();
    results.changes.outputs[flag] = 'true';
    assert.notEqual(gate(results, 'pull_request'), 0, flag);
    results[job].result = 'success';
    assert.equal(gate(results, 'pull_request'), 0, flag);
    assert.equal(jobs[job].needs, 'changes');
    assert.match(jobs[job].if, new RegExp(`needs\\.changes\\.outputs\\.${flag} == 'true'`));
  }
  const main = gateJobs();
  main.changes.outputs.prod_build = 'true';
  main['production-bundle'].result = main['production-images'].result = 'success';
  assert.equal(gate(main, 'push'), 0);
  for (const job of ['production-bundle', 'production-images']) {
    main[job].result = 'skipped';
    assert.notEqual(gate(main, 'push'), 0, job);
    main[job].result = 'success';
  }
});

test('app groups run only when their area is selected', () => {
  for (const [area, names] of Object.entries(areaJobs).filter(([area]) => area !== 'engine')) {
    for (const name of names) {
      assert.equal(jobs[name].needs, 'changes', name);
      assert.match(jobs[name].if, new RegExp(`needs\\.changes\\.outputs\\.${area} == 'true'`));
    }
  }
  const protocol = jobs['effect-protocol'].steps;
  assert.equal(protocol.some(step => step.run?.includes('npm run typecheck -- --force')), false);
});

test('nightly runs every selected suite and requires fuzz; scheduled/manual Test cannot deploy', () => {
  for (const names of Object.values(areaJobs)) for (const name of names) assert.doesNotMatch(jobs[name].if, /!= 'schedule'/);
  const results = gateJobs();
  assert.notEqual(gate(results, 'schedule'), 0);
  results['nduel-nightly'].result = 'success';
  assert.equal(gate(results, 'schedule'), 0);
  assert.notEqual(gate(gateJobs(), 'workflow_dispatch', true), 0);
  const report = jobs['ci-result'].steps.find(step => step.name === 'Report nightly failure');
  assert.equal(report.if, "failure() && github.event_name == 'schedule'");
  assert.equal(jobs['production-images'].needs, 'production-bundle');
  assert.equal(jobs['production-images'].strategy['max-parallel'], undefined);
});

test('production builds only run on main pushes and cannot deploy', () => {
  for (const name of ['production-bundle', 'production-images']) {
    const job = jobs[name];
    assert.match(job.if, /github.event_name == 'push'/);
    assert.match(job.if, /github.ref == 'refs\/heads\/main'/);
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

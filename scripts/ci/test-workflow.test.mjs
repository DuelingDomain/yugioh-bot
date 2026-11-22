import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { parse } from "yaml";
import { engineMatrix, PINNED_SHARDS, SURRENDER_FILES } from "./engine-test-plan.mjs";

const { jobs } = parse(readFileSync(new URL("../../.github/workflows/test.yml", import.meta.url), "utf8"));
const runGate = (job, env) => {
  const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", jobs[job].steps[0].run], {
    env: { ...process.env, ...env, GITHUB_STEP_SUMMARY: '/dev/null' }, stdio: 'ignore',
  });
  assert.ifError(result.error);
  return result.status;
};

const areaJobs = {
  web: ['unit-web'], web_build: ['unit-web-build'], vision: ['small-checks'], shared: ['unit-shared'], bot: ['small-checks'],
  ws: ['small-checks'], worker: ['small-checks'], duel_unit: ['unit-duel'], e2e: ['small-checks'],
  ci_scripts: ['ci-scripts'], engine: ['cores', 'engine-shards', 'engine-legacy-shards', 'small-checks'],
  core: ['native', 'engine-differential'],
};
const gateJobs = () => Object.fromEntries(jobs['ci-result'].needs.map(name => [name, {
  result: name === 'changes' ? 'success' : 'skipped', outputs: {},
}]));
const gate = (results, event = 'workflow_dispatch', nightly = event === 'schedule') => runGate('ci-result', { RESULTS: JSON.stringify(results), EVENT: event, NIGHTLY: String(nightly) });

test('CI result accepts intentional skips and rejects failed or cancelled jobs and detection', () => {
  assert.deepEqual([...jobs['ci-result'].needs].sort(), Object.keys(jobs).filter(name => !['ci-result', 'image-prebuild', 'duel-prebuild-inputs', 'duel-image-prebuild'].includes(name)).sort());
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
    const outputs = results.changes.outputs;
    outputs[area] = 'true';
    for (const name of names) results[name].result = 'success';
    if (area === 'engine') {
      assert.notEqual(gate(results), 0, `${area} requires a cache lookup`);
      outputs.core_status = 'failure';
      assert.notEqual(gate(results), 0, `${area} rejects a failed cache lookup`);
      outputs.core_status = 'success';
    }
    assert.equal(gate(results), 0, area);
    for (const name of names) {
      results[name].result = 'skipped';
      assert.notEqual(gate(results), 0, name);
      results[name].result = 'success';
    }
  }
});

test('TS engine changes allow skipped core checks; core selection requires both jobs', () => {
  const results = gateJobs();
  results.changes.outputs = { engine: 'true', core: 'false', core_status: 'success' };
  for (const name of areaJobs.engine) results[name].result = 'success';
  assert.equal(gate(results, 'pull_request'), 0);
  results.changes.outputs.core = 'true';
  assert.notEqual(gate(results, 'pull_request'), 0);
  for (const name of areaJobs.core) {
    assert.deepEqual(jobs[name].needs, ['cores', 'changes']);
    assert.match(jobs[name].if, /needs\.changes\.outputs\.core == 'true'/);
    assert.match(jobs[name].if, /needs\.cores\.result == 'success'/);
    results[name].result = 'success';
  }
  assert.equal(gate(results, 'pull_request'), 0);
  assert.equal(jobs.changes.outputs.core, '${{ steps.selection.outputs.core || steps.diff.outputs.core }}');
  assert.deepEqual(engineMatrix(false), [
    ...Array.from({ length: PINNED_SHARDS }, (_, i) => ({ suite: 'pinned', shard: i + 1, count: PINNED_SHARDS })),
    ...SURRENDER_FILES.map((_, i) => ({ suite: 'surrender', shard: i + 1, count: SURRENDER_FILES.length })),
  ]);
  assert.deepEqual(jobs['engine-differential'].strategy.matrix.shard, [1, 2]);
  assert.equal(jobs['engine-differential'].strategy['fail-fast'], false);
  assert.match(jobs['engine-differential'].steps.at(-1).run, /run-engine-tests\.mjs differential .*matrix\.shard.*\/2/);
});

test('pure known data changes require consumer integration tests and skip web build', () => {
  const results = gateJobs();
  results.changes.outputs = { web_build: 'false', web: 'true', shared: 'true', duel_unit: 'true' };
  for (const name of ['unit-web', 'unit-shared', 'unit-duel']) results[name].result = 'success';
  assert.equal(gate(results, 'pull_request'), 0);
  results['unit-web'].result = 'skipped';
  assert.notEqual(gate(results, 'pull_request'), 0);
  assert.equal(jobs['unit-web-build'].if, "needs.changes.outputs.web_build == 'true'");
  for (const [name, area] of [['unit-web', 'web'], ['unit-shared', 'shared'], ['unit-duel', 'duel_unit']]) {
    const step = jobs[name].steps.find(step => step.env?.CI_TEST_FILES);
    assert.equal(step.env.CI_TEST_FILES, '${{ needs.changes.outputs.' + area + '_files }}');
  }
});

test('slow jobs are required only for their selected inputs; main uses real production builds', () => {
  const docs = gateJobs();
  docs.changes.outputs.docs_only = 'true';
  assert.equal(gate(docs, 'pull_request'), 0);
  // The dry run also waits for the pinned voice inputs, so a PR proves the voice image stage before main builds it.
  for (const [flag, job, needs] of [['effects', 'effect-protocol', 'changes'], ['prod_build', 'production-dry-run', ['changes', 'production-voice-assets']]]) {
    const results = gateJobs();
    results.changes.outputs[flag] = 'true';
    assert.notEqual(gate(results, 'pull_request'), 0, flag);
    results[job].result = 'success';
    assert.equal(gate(results, 'pull_request'), 0, flag);
    assert.deepEqual(jobs[job].needs, needs);
    assert.match(jobs[job].if, new RegExp(`needs\\.changes\\.outputs\\.${flag} == 'true'`));
  }
  const main = gateJobs();
  main.changes.outputs.prod_build = 'true';
  main['production-bundle'].result = main['production-images'].result = 'success';
  assert.notEqual(gate(main, 'push'), 0, 'a main push without prepared voice assets must not pass');
  main['production-voice-assets'].result = 'success';
  assert.equal(gate(main, 'push'), 0);
  const voice = jobs['production-voice-assets'];
  assert.equal(voice.needs, 'changes');
  assert.equal(voice.if, "(github.event_name == 'push' && github.ref == 'refs/heads/main') || (github.event_name != 'push' && (needs.changes.outputs.prod_build == 'true' || (github.event_name == 'pull_request' && github.event.pull_request.head.repo.full_name == github.repository && needs.changes.outputs.docs_only != 'true' && needs.changes.outputs.tests_only != 'true' && needs.changes.outputs.checks_only != 'true')))");
  assert.equal(voice.with['save-cache'], "${{ github.event_name == 'push' && github.ref == 'refs/heads/main' }}");
  for (const job of ['production-bundle', 'production-images']) {
    main[job].result = 'skipped';
    assert.notEqual(gate(main, 'push'), 0, job);
    main[job].result = 'success';
  }
});

test('app groups run only when their area is selected', () => {
  const foldedChecks = { bot: 'BOT', ws: 'WS', worker: 'WORKER', e2e: 'E2E', engine: 'RULE_COVERAGE', vision: 'VISION' };
  const small = jobs['small-checks'];
  assert.equal(small.needs, 'changes');
  assert.deepEqual(small.if.split(/\s+\|\|\s+/), [...Object.keys(foldedChecks).map(area => `needs.changes.outputs.${area} == 'true'`), "needs.changes.outputs.typecheck != ''"]);
  const step = small.steps.find(step => step.run === 'bash scripts/ci/run-small-checks.sh');
  assert.equal(step.if, '${{ !cancelled() }}');
  for (const [area, check] of Object.entries(foldedChecks)) {
    assert.equal(step.env[`CHECK_${check}`], '${{ needs.changes.outputs.' + area + ' }}');
  }
  for (const [area, names] of Object.entries(areaJobs).filter(([area]) => !['engine', 'engine_app', 'core'].includes(area))) {
    for (const name of names) {
      if (name === 'small-checks') continue;
      assert.equal(jobs[name].needs, 'changes', name);
      assert.match(jobs[name].if, new RegExp(`needs\\.changes\\.outputs\\.${area} == 'true'`));
    }
  }
  const protocol = jobs['effect-protocol'].steps;
  assert.equal(protocol.some(step => step.run?.includes('npm run typecheck -- --force')), false);
});

test('the CI helper step runs all suites and fails if any suite fails', t => {
  const dir = mkdtempSync(join(tmpdir(), 'ci-helper-step-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  const calls = join(dir, 'calls');
  const stub = `#!/bin/sh
case "$*" in
  "--test "*) suite=node ;;
  "-B scripts/ci/parallel_emxx_test.py"*) suite=parallel-emxx ;;
  "-B -m unittest discover "*test_deploy_safety.py*) suite=deploy-safety ;;
  *) exit 2 ;;
esac
printf '%s\\n' "$suite" >> "$CALLS"
[ "$FAIL_SUITE" != "$suite" ] || exit 7
`;
  for (const tool of ['node', 'python3']) writeFileSync(join(bin, tool), stub, { mode: 0o755 });
  const step = jobs['ci-scripts'].steps.find(step => step.name === 'Test CI helpers');
  const suites = ['deploy-safety', 'node', 'parallel-emxx'];
  for (const failedSuite of ['', ...suites]) {
    writeFileSync(calls, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', step.run], {
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls, FAIL_SUITE: failedSuite },
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.ifError(result.error);
    assert.deepEqual(readFileSync(calls, 'utf8').trim().split('\n').sort(), suites, failedSuite);
    assert.equal(result.status, failedSuite ? 1 : 0, result.stderr || failedSuite);
  }
});

test('unselected engine matrices do not gate a PR, and selected files reach the existing runners', () => {
  const results = gateJobs();
  results.changes.outputs = { engine: 'false', core: 'false', typecheck: '["shared","web"]' };
  assert.notEqual(gate(results, 'pull_request'), 0);
  results['small-checks'].result = 'success';
  assert.equal(gate(results, 'pull_request'), 0);
  assert.equal(jobs['engine-app'], undefined);
  const steps = jobs.changes.steps;
  assert.ok(steps.findIndex(step => step.id === 'selection') < steps.findIndex(step => step.id === 'wrapper'));
  assert.match(steps.find(step => step.id === 'wrapper').if, /steps\.selection\.outputs\.engine/);
  for (const [name, run] of [['engine-shards', 'matrix.suite'], ['engine-legacy-shards', 'legacy']]) {
    const job = jobs[name];
    const step = job.steps.find(step => step.run?.includes('run-engine-tests.mjs') && step.run.includes(run));
    assert.equal(step.env.CI_TEST_FILES, '${{ needs.changes.outputs.engine_files }}');
    assert.equal(job.env.DUEL_REQUIRE_CORES, '1');
  }
  assert.equal(jobs['engine-shards'].steps.find(step => step.run?.includes('run-engine-tests.mjs web')).env.CI_TEST_FILES,
    '${{ needs.changes.outputs.engine_web_files }}');
});

test('nightly runs every selected suite and requires fuzz; scheduled/manual Test cannot deploy', () => {
  for (const names of Object.values(areaJobs)) for (const name of names) assert.doesNotMatch(jobs[name].if, /!= 'schedule'/);
  for (const id of ['wrapper', 'key', 'emsdk', 'bundle']) {
    assert.doesNotMatch(jobs.changes.steps.find(step => step.id === id).if, /!= 'schedule'/);
  }
  const results = gateJobs();
  assert.notEqual(gate(results, 'schedule'), 0);
  results['nduel-nightly'].result = 'success';
  assert.equal(gate(results, 'schedule'), 0);
  assert.notEqual(gate(gateJobs(), 'workflow_dispatch', true), 0);
  const report = jobs['ci-result'].steps.find(step => step.name === 'Report nightly failure');
  assert.equal(report.if, "failure() && github.event_name == 'schedule'");
  assert.deepEqual(jobs['production-images'].needs, ['production-bundle', 'production-voice-assets']);
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

test('PR image prebuild is non-blocking, same-repo only and skipped for docs and test-only changes', () => {
  const job = jobs['image-prebuild'];
  assert.equal(job['continue-on-error'], true);
  assert.deepEqual(job.needs, ['changes', 'production-voice-assets']);
  assert.match(job.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(job.if, /docs_only != 'true'/);
  assert.deepEqual(job.strategy.matrix.include.map(entry => entry.service), ['web', 'bot', 'ws', 'worker']);
  const build = job.steps.find(step => step.name === 'Build production image');
  assert.equal(build.with['publish-artifacts'], 'false');
  // PR builds never touch the shared main caches, and always overwrite their own inputs tag.
  assert.equal(build.with['write-caches'], 'false');
  assert.equal(build.if, undefined);
  assert.equal(job.steps.some(step => step.id === 'existing'), false);
  for (const name of ['production-images', 'image-prebuild']) {
    const hashStep = jobs[name].steps.find(step => step.id === 'inputs');
    assert.equal(hashStep.env.IMAGE_SALT_EXTRA, 'target:${{ matrix.target }}');
  }
  assert.doesNotMatch(JSON.stringify(job), /VM_|ssh|deploy-production/);
  // Main reuses the prebuilt image only through the checked reuse action, and every build step is gated on it.
  const main = jobs['production-images'].steps;
  assert.equal(main.find(step => step.id === 'reuse').uses, './.github/actions/reuse-production-image');
  assert.equal(main.find(step => step.name === 'Build production image').if, "steps.reuse.outputs.reused != 'true'");
});

test('duel prebuild uses the production bundle and hash path outside CI result', () => {
  const main = jobs['production-images'];
  const [duel] = main.strategy.matrix.include.filter(entry => entry.service === 'duel');
  const inputs = jobs['duel-prebuild-inputs'];
  const prebuild = jobs['duel-image-prebuild'];
  for (const job of [inputs, prebuild]) {
    assert.equal(job['continue-on-error'], true);
    assert.doesNotMatch(JSON.stringify(job), /VM_|ssh|deploy-production/);
  }
  assert.match(inputs.if, /github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.equal(inputs['runs-on'], jobs['production-bundle']['runs-on']);
  const prepare = inputs.steps.find(step => step.uses === './.github/actions/prepare-production-bundle');
  assert.equal(prepare.with['save-cache'], 'false');
  const hash = inputs.steps.find(step => step.id === 'inputs');
  const mainHash = main.steps.find(step => step.id === 'inputs');
  assert.equal(hash.run, mainHash.run);
  assert.equal(hash.env.IMAGE_SALT_EXTRA, `target:${duel.target}`);
  assert.equal(hash.env.IMAGE_BUNDLE, inputs.steps.find(step => step.id === 'upload').with.path);
  assert.deepEqual(prebuild.needs, ['duel-prebuild-inputs']);
  assert.equal(prebuild.if, "needs.duel-prebuild-inputs.outputs.artifact != ''");
  assert.equal(prebuild['runs-on'], main['runs-on']);
  const build = prebuild.steps.find(step => step.uses === './.github/actions/build-production-image');
  assert.deepEqual(build.with, {
    ...duel,
    'bundle-artifact': '${{ needs.duel-prebuild-inputs.outputs.artifact }}',
    'inputs-hash': '${{ needs.duel-prebuild-inputs.outputs.hash }}',
    'publish-artifacts': 'false',
    'write-caches': 'false',
  });
});

test('duel prebuild skips the ARM64 runner only for matching main image inputs', t => {
  const dir = mkdtempSync(join(tmpdir(), 'duel-prebuild-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const output = join(dir, 'output');
  const commit = 'a'.repeat(40);
  const hash = 'b'.repeat(64);
  const inputs = jobs['duel-prebuild-inputs'];
  const compare = inputs.steps.find(step => step.id === 'compare');
  assert.equal(inputs.steps.find(step => step.id === 'upload').if, "steps.compare.outputs.build == 'true'");
  writeFileSync(join(dir, 'gh'), '#!/bin/sh\nprintf "%s\\n" "$MAIN_COMMIT"\n', { mode: 0o755 });
  writeFileSync(join(dir, 'docker'), '#!/bin/sh\ntest "${6##*:}" = "$MAIN_COMMIT" && test -n "$MAIN_IMAGE" && printf "%s\\n" "$MAIN_IMAGE"\n', { mode: 0o755 });
  const image = (inputsHash, revision = commit, architecture = 'arm64') => JSON.stringify({
    os: 'linux', architecture, config: { Labels: { 'org.opencontainers.image.revision': revision, 'dev.duelingdomain.inputs': inputsHash } },
  });
  for (const [mainImage, mainCommit, expected] of [
    [image(hash), commit, ''],
    [image('c'.repeat(64)), commit, 'build=true\n'],
    [image(hash, 'd'.repeat(40)), commit, 'build=true\n'],
    [image(hash, commit, 'amd64'), commit, 'build=true\n'],
    ['', commit, 'build=true\n'],
    [image(hash), '', 'build=true\n'],
  ]) {
    writeFileSync(output, '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', compare.run], {
      env: {
        ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_OUTPUT: output, GITHUB_REPOSITORY: 'DuelingDomain/yugioh-bot',
        IMAGE: 'ghcr.io/duelingdomain/yugioh-bot-duel', INPUTS_HASH: hash, MAIN_COMMIT: mainCommit, MAIN_IMAGE: mainImage,
      },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(output, 'utf8'), expected, mainImage);
  }
});

test('automatic releases consume bundle and digests from the exact triggering Test run', () => {
  const deploy = parse(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
  const artifacts = deploy.jobs.deploy.steps.find(step => step.name === 'Download tested production artifacts');
  assert.match(artifacts.if, /github.event_name == 'workflow_run'/);
  assert.equal(artifacts.with['run-id'], '${{ github.event.workflow_run.id }}');
  assert.equal(artifacts.with['github-token'], '${{ github.token }}');
  assert.equal(artifacts.with['artifact-ids'], '${{ needs.prepare.outputs.bundle_artifact_id }},${{ needs.prepare.outputs.image_artifact_ids }}');
  assert.equal(deploy.jobs.prepare.outputs.bundle_artifact_id, '${{ steps.tested-artifacts.outputs.bundle_id }}');
  assert.ok(!deploy.jobs.prepare.steps.some(step => step.with?.['run-id']));
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

test('engine bundle cache ignores unrelated dependencies but retains the actual npm wrapper pin', t => {
  const steps = jobs.changes.steps;
  const key = steps.find(step => step.name === 'Compute bundle cache key').run;
  for (const file of ['package-lock.json', 'packages/shared/package.json', 'packages/shared/tsconfig*.json', 'tsconfig.json']) assert.ok(!key.includes(`'${file}'`), file);
  for (const file of ['packages/duel-server/domain-core/pins.json', 'packages/duel-server/domain-core/expected-sha256.txt', 'patches/ocgcore-wasm+0.1.2.patch', 'packages/duel-server/src/card-script-source.ts']) assert.ok(key.includes(`'${file}'`), file);
  assert.match(key, /steps.wrapper.outputs.hash/);
  const dir = mkdtempSync(join(tmpdir(), 'engine-wrapper-key-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (integrity, other = 'unrelated-v1') => {
    writeFileSync(join(dir, 'package-lock.json'), JSON.stringify({ packages: {
      'node_modules/ocgcore-wasm': { integrity }, 'node_modules/next': { integrity: other },
    } }));
    writeFileSync(join(dir, 'output'), '');
    const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', steps.find(step => step.id === 'wrapper').run], {
      cwd: dir, env: { ...process.env, GITHUB_OUTPUT: join(dir, 'output') }, stdio: 'ignore',
    });
    assert.ifError(result.error);
    return { status: result.status, key: readFileSync(join(dir, 'output'), 'utf8') };
  };
  assert.deepEqual(run('sha512-wrapper-v1'), run('sha512-wrapper-v1', 'unrelated-v2'));
  assert.notEqual(run('sha512-wrapper-v1').key, run('sha512-wrapper-v2').key);
  assert.equal(run(undefined).status, 1);
});

test('a focused engine PR retains all Table row partitions while a push runs the full plan', async () => {
  const { pinnedPlan, TABLE_FILE } = await import('./engine-test-plan.mjs');
  const files = ['tests/host.test.ts', TABLE_FILE];
  const shardPlan = pinnedPlan(files);
  assert.equal(shardPlan.length, PINNED_SHARDS);
  assert.ok(shardPlan.every(shard => shard.files.includes(TABLE_FILE)));
  assert.equal(shardPlan.flatMap(shard => shard.files).filter(file => file === 'tests/host.test.ts').length, 1);
  assert.equal(jobs['engine-shards'].strategy.matrix.include, '${{ fromJSON(needs.changes.outputs.engine_matrix) }}');
  assert.equal(jobs.changes.outputs.engine_files, '${{ steps.selection.outputs.engine_files }}');
  assert.equal(jobs.changes.steps.find(step => step.id === 'selection').if, "${{ steps.diff.outputs.scan == 'true' }}");
});

test("every docker run/exec in the stdin deploy script reads /dev/null", () => {
  // The VM script arrives on stdin (sh -s). A docker run or exec that keeps stdin eats the rest of the script.
  const text = readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8');
  const script = text.slice(text.indexOf("sh -s\" <<'REMOTE'"), text.indexOf("\n          REMOTE\n"));
  assert.ok(script.length > 1000);
  const lines = script.split('\n');
  lines.forEach((line, i) => {
    if (!/docker (compose\b[^#]*\b(run|exec)\b|run |exec )/.test(line) || /^\s*#/.test(line)) return;
    let end = i;
    if (/ -e '\s*$/.test(line)) { end = i + 1; while (!/^\s*'/.test(lines[end])) end++; }
    assert.match(lines[end], /<\s*\/dev\/null/, `stdin not closed for: ${line.trim()}`);
  });
});

test('PR runs keep the merge ref parent for type-only edits, and a reused web image finds its maps', () => {
  // A depth-1 PR checkout has no HEAD^1 for comparing runtime statements.
  const checkout = jobs.changes.steps.find(step => step.name === 'Checkout');
  assert.match(checkout.with['fetch-depth'], /'pull_request' && '2'/);
  // A download by artifact id lands in a subfolder unless merged; the relabel step reads the maps at the top level.
  const action = parse(readFileSync(new URL('../../.github/actions/reuse-production-image/action.yml', import.meta.url), 'utf8'));
  const maps = action.runs.steps.find(step => step.id === 'maps-download');
  assert.equal(maps.with['merge-multiple'], true);
});

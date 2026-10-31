import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { testedMainBase } from './tested-main-base.mjs';
import { changedLayers } from './changed-layers.mjs';

const old = 'a'.repeat(40), engine = 'b'.repeat(40), web = 'c'.repeat(40);
const run = (sha, overrides = {}) => ({ head_sha: sha, head_branch: 'main', event: 'push', conclusion: 'success', ...overrides });
test('a web push after a cancelled engine push diffs from the fully tested ancestor', () => {
  const runs = [run(engine, { conclusion: 'cancelled' }), run(old)];
  const base = testedMainBase(runs, web, sha => [old, engine].includes(sha));
  assert.equal(base, old);
  const changed = base === old ? ['packages/duel-server/src/host.ts', 'packages/web/app/page.tsx'] : ['packages/web/app/page.tsx'];
  assert.equal(changedLayers(changed, 'push').engine, true);
});
test('only successful main push ancestors can become the baseline', () => {
  const runs = [run(web), run(engine, { event: 'pull_request' }), run(engine, { head_branch: 'feature' }), run(engine), run(old)];
  assert.equal(testedMainBase(runs, web, sha => sha === old), old);
  assert.equal(testedMainBase([], web, () => true), '');
  assert.equal(testedMainBase([run('bad')], web, () => true), '');
});
test('an absent baseline fails closed to all engine layers', () => {
  const layers = changedLayers(null, 'push');
  for (const flag of ['engine', 'golden', 'web', 'shared', 'ci_scripts']) assert.equal(layers[flag], true, flag);
  for (const [flag, value] of Object.entries(layers)) assert.equal(value, !['docs_only', 'data_only', 'tests_only'].includes(flag), flag);
});

for (const [name, engineChanged, metadataBytes] of [
  ['CLI uses the tested ancestor across an engine commit and a later web commit', true, 0],
  ['CLI resolves a large workflow response and skips engine checks for a web-only push', false, 2 * 1024 * 1024],
]) test(name, t => {
  const dir = mkdtempSync(join(tmpdir(), 'tested-main-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'ci@example.test');
  writeFileSync(join(dir, 'initial'), 'base');
  git('add', '.'); git('commit', '-m', 'tested base');
  const base = git('rev-parse', 'HEAD');
  if (engineChanged) {
    mkdirSync(join(dir, 'packages/duel-server/src'), { recursive: true });
    writeFileSync(join(dir, 'packages/duel-server/src/host.ts'), 'engine change');
    git('add', '.'); git('commit', '-m', 'untested engine');
  }
  const engineHead = git('rev-parse', 'HEAD');
  mkdirSync(join(dir, 'packages/web/app'), { recursive: true });
  writeFileSync(join(dir, 'packages/web/app/page.tsx'), 'web change');
  git('add', '.'); git('commit', '-m', 'later web change');
  const head = git('rev-parse', 'HEAD');
  const gh = join(dir, 'gh');
  writeFileSync(gh, `#!/usr/bin/env node
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
let data = JSON.parse(readFileSync(process.env.RUNS_FILE, 'utf8'));
const jq = process.argv.indexOf('--jq');
if (jq !== -1) {
  assert.equal(process.argv[jq + 1], '[.workflow_runs[] | {head_sha, event, head_branch, conclusion}]');
  data = data.workflow_runs.map(({ head_sha, event, head_branch, conclusion }) => ({ head_sha, event, head_branch, conclusion }));
}
process.stdout.write(JSON.stringify(data));
`);
  chmodSync(gh, 0o755);
  const runsFile = join(dir, 'runs.json');
  writeFileSync(runsFile, JSON.stringify({ workflow_runs: [
    run(engineHead, { conclusion: 'cancelled', repository: { description: 'x'.repeat(metadataBytes) } }), run(base),
  ] }));
  const output = join(dir, 'outputs');
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'fixture/repo',
    GITHUB_SHA: head, GITHUB_OUTPUT: output, RUNS_FILE: runsFile };
  const baseline = spawnSync(process.execPath, [new URL('./tested-main-base.mjs', import.meta.url).pathname], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(baseline.status, 0, baseline.stderr);
  const baselineOutput = readFileSync(output, 'utf8');
  assert.equal(baselineOutput, `base=${base}\n`, baseline.stderr);
  const testedBase = baselineOutput.trim().slice('base='.length);
  const layers = spawnSync(process.execPath, [new URL('./changed-layers.mjs', import.meta.url).pathname], {
    cwd: dir, env: { ...env, EVENT: 'push', PUSH_BEFORE: testedBase, PUSH_AFTER: head }, encoding: 'utf8',
  });
  assert.equal(layers.status, 0, layers.stderr);
  const selected = Object.fromEntries(readFileSync(output, 'utf8').trim().split('\n').map(line => line.split('=')));
  assert.equal(selected.web, 'true');
  assert.equal(selected.engine, String(engineChanged));
  assert.equal(selected.core, 'false');
  assert.equal(selected.golden, 'false');
});

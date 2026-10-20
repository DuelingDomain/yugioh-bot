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
  assert.deepEqual(changedLayers(null, 'push'), { engine: true, golden: true, tests_only: false });
});

test('CLI uses the tested ancestor across an engine commit and a later web commit', t => {
  const dir = mkdtempSync(join(tmpdir(), 'tested-main-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init');
  git('config', 'user.name', 'CI fixture');
  git('config', 'user.email', 'ci@example.test');
  writeFileSync(join(dir, 'initial'), 'base');
  git('add', '.'); git('commit', '-m', 'tested base');
  const base = git('rev-parse', 'HEAD');
  mkdirSync(join(dir, 'packages/duel-server/src'), { recursive: true });
  writeFileSync(join(dir, 'packages/duel-server/src/host.ts'), 'engine change');
  git('add', '.'); git('commit', '-m', 'untested engine');
  const engineHead = git('rev-parse', 'HEAD');
  mkdirSync(join(dir, 'packages/web/app'), { recursive: true });
  writeFileSync(join(dir, 'packages/web/app/page.tsx'), 'web change');
  git('add', '.'); git('commit', '-m', 'later web change');
  const head = git('rev-parse', 'HEAD');
  const gh = join(dir, 'gh');
  writeFileSync(gh, '#!/bin/sh\nprintf "%s\\n" "$RUNS"\n');
  chmodSync(gh, 0o755);
  const output = join(dir, 'outputs');
  const env = { ...process.env, PATH: `${dir}:${process.env.PATH}`, GITHUB_REPOSITORY: 'fixture/repo',
    GITHUB_SHA: head, GITHUB_OUTPUT: output, RUNS: JSON.stringify({ workflow_runs: [run(engineHead, { conclusion: 'cancelled' }), run(base)] }) };
  const baseline = spawnSync(process.execPath, [new URL('./tested-main-base.mjs', import.meta.url).pathname], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(baseline.status, 0, baseline.stderr);
  assert.equal(readFileSync(output, 'utf8'), `base=${base}\n`);
  const layers = spawnSync(process.execPath, [new URL('./changed-layers.mjs', import.meta.url).pathname], {
    cwd: dir, env: { ...env, EVENT: 'push', PUSH_BEFORE: base, PUSH_AFTER: head }, encoding: 'utf8',
  });
  assert.equal(layers.status, 0, layers.stderr);
  assert.match(readFileSync(output, 'utf8'), /engine=true/);
});

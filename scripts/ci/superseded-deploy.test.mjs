import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const load = () => parse(readFileSync(new URL('../../.github/workflows/deploy.yml', import.meta.url), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const target = 'a'.repeat(40);
const newer = 'b'.repeat(40);
const main = 'c'.repeat(40);
const old = 'd'.repeat(40);
const evaluate = (expression, values) => Function(...Object.keys(values), `return (${expression.replace(/^\$\{\{\s*|\s*\}\}$/g, '')});`)(...Object.values(values));

async function run({ eventName = 'workflow_run', status = 'ahead', tests = [], deploys = [], pages = [[newer, main]] } = {}) {
  const outputs = {};
  const messages = [];
  const requests = [];
  const github = {
    request: async (route, options) => {
      requests.push([route, options]);
      if (route.includes('/branches/')) return { data: { commit: { sha: main } } };
      assert.match(route, /\/compare\//);
      assert.equal(options.basehead, `${target}...${main}`);
      assert.equal(options.per_page, 100);
      return { data: { status, total_commits: pages.flat().length,
        commits: (pages[options.page - 1] || []).map(sha => ({ sha })) } };
    },
    paginate: async (route, options) => {
      requests.push([route, options]);
      assert.match(route, /\/actions\/workflows\/\{workflow_id\}\/runs$/);
      assert.equal(options.branch, 'main');
      assert.equal(options.per_page, 100);
      if (options.workflow_id === 'test.yml') {
        assert.equal(options.event, 'push');
        assert.equal(options.status, 'success');
        return tests;
      }
      assert.equal(options.workflow_id, 'deploy.yml');
      assert.equal(options.event, 'workflow_run');
      return deploys;
    },
  };
  const step = load().jobs.prepare.steps.find(step => step.id === 'superseded');
  assert.ok(step, 'check superseded runs before any release preparation');
  await new AsyncFunction('github', 'context', 'core', step.with.script)(github,
    { repo: { owner: 'DuelingDomain', repo: 'yugioh-bot' }, eventName, runId: 100,
      payload: { workflow_run: { head_sha: target } } },
    { setOutput: (key, value) => { outputs[key] = String(value); }, info: message => messages.push(message) });
  return { outputs, messages, requests };
}

test('a newer main commit with a successful push Test supersedes an automatic deploy', async () => {
  const result = await run({ tests: [{ head_sha: newer }] });
  assert.equal(result.outputs.skip, 'true');
  assert.ok(result.messages.some(message => /superseded/i.test(message) && message.includes(newer)));
});

test('the queue guard uses the actual trigger SHA and successful Test conclusion in the run title', async () => {
  const prod = load();
  assert.match(prod['run-name'], /github.event.workflow_run.head_sha/);
  assert.match(prod['run-name'], /github.event.workflow_run.conclusion/);
  for (const status of ['queued', 'pending', 'waiting', 'requested']) {
    const result = await run({ deploys: [{ id: 101, status, head_sha: main, display_title: `Deploy ${newer} (Test success)` }] });
    assert.equal(result.outputs.skip, 'true', status);
    assert.ok(result.messages.some(message => /superseded.*queued/i.test(message)));
  }
});

test('a newer main head alone, failed tests, or an old queued deploy never supersede the target', async () => {
  for (const deploys of [[],
    [{ id: 101, status: 'queued', head_sha: main, display_title: `Deploy ${target} (Test success)` }],
    [{ id: 101, status: 'queued', display_title: `Deploy ${newer} (Test failure)` }],
    [{ id: 101, status: 'completed', display_title: `Deploy ${newer} (Test success)` }],
    [{ id: 101, status: 'queued', display_title: `Deploy ${old} (Test success)` }],
  ]) {
    assert.equal((await run({ tests: [{ head_sha: target }, { head_sha: old }], deploys })).outputs.skip, 'false');
  }
});

test('manual dispatch never calls the superseded-run APIs', async () => {
  const result = await run({ eventName: 'workflow_dispatch', tests: [{ head_sha: newer }] });
  assert.equal(result.outputs.skip, 'false');
  assert.equal(result.requests.length, 0);
});

test('an unchanged, older or diverged main head does not supersede the target', async () => {
  for (const status of ['identical', 'behind', 'diverged']) {
    const result = await run({ status, tests: [{ head_sha: newer }] });
    assert.equal(result.outputs.skip, 'false');
    assert.equal(result.requests.length, 2);
  }
});

test('newer commits beyond the first comparison page can supersede the target', async () => {
  const commits = Array.from({ length: 100 }, (_, i) => i.toString(16).padStart(40, '0'));
  const result = await run({ pages: [commits, [newer, main]], tests: [{ head_sha: newer }] });
  assert.equal(result.outputs.skip, 'true');
  assert.equal(result.requests.filter(([route]) => route.includes('/compare/')).length, 2);
});

test('a superseded automatic release skips preparation, build, deploy and registry retention', () => {
  const prod = load();
  const prepare = prod.jobs.prepare;
  assert.equal(prepare.steps[0].id, 'superseded');
  const github = { event_name: 'workflow_run', ref: 'refs/heads/main', event: {
    workflow_run: { conclusion: 'success', event: 'push', head_branch: 'main' } } };
  const steps = { superseded: { outputs: { skip: 'true' } }, bundle: { outputs: { 'cache-hit': 'false' } }, multi: { outputs: { 'cache-hit': 'false' } } };
  for (const enabled of ['true', 'false']) for (const step of prepare.steps.slice(1)) {
    assert.ok(step.if, `${step.name} needs the superseded guard`);
    assert.equal(evaluate(step.if, { github, env: { VM_DEPLOY_ENABLED: enabled }, steps }), false, step.name);
  }
  assert.equal(prepare.outputs.superseded, '${{ steps.superseded.outputs.skip }}');
  const needs = { prepare: { result: 'success', outputs: { superseded: 'true', rollback: 'false' } }, build: { result: 'skipped' } };
  assert.equal(evaluate(prod.jobs.build.if, { needs }), false);
  assert.equal(evaluate(prod.jobs.deploy.if, { needs, github, cancelled: () => false }), false);
  assert.equal(evaluate(prod.jobs.retain.if, { needs: { deploy: { result: 'skipped' } }, cancelled: () => false }), false);
});

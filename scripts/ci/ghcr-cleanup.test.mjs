import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const file = new URL('../../.github/workflows/ghcr-cleanup.yml', import.meta.url);
const load = () => parse(readFileSync(file, 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const age = days => new Date(Date.now() - days * 86400000).toISOString();
const version = (id, tags, days = 20) => ({ id, name: `sha256:${String(id).padStart(64, '0')}`, created_at: age(days), metadata: { container: { tags } } });

async function run(versions, manifests = {}, fail = false) {
  const deleted = [];
  const github = {
    paginate: async (route, options) => {
      assert.equal(options.per_page, 100);
      return versions;
    },
    request: async (route, options) => {
      assert.match(route, /^DELETE /);
      deleted.push([options.package_name, options.package_version_id]);
    },
  };
  const fetch = async url => {
    if (url.startsWith('https://ghcr.io/token?')) return { ok: true, json: async () => ({ token: 'fixture' }) };
    return { ok: !fail, json: async () => manifests[url.split('/').at(-1)] || {} };
  };
  const workflow = load();
  const script = Object.values(workflow.jobs)[0].steps[0].with.script;
  await new AsyncFunction('github', 'context', 'core', 'fetch', script)(github, { repo: { owner: 'DuelingDomain' } }, { info() {} }, fetch);
  return deleted;
}

test('weekly cleanup has only package write permission and uses a pinned action', () => {
  const workflow = load();
  assert.equal(workflow.on.schedule.length, 1);
  assert.deepEqual(workflow.permissions, { packages: 'write' });
  assert.equal(workflow.concurrency.group, 'deploy-production');
  const job = Object.values(workflow.jobs)[0];
  assert.match(job.steps[0].uses, /@[0-9a-f]{40}$/);
});

test('cleanup keeps ten SHA versions, cache and owner tags, recent untagged and referenced children', async () => {
  const versions = Array.from({ length: 12 }, (_, i) => version(i + 1, [(i + 1).toString(16).padStart(40, '0')]));
  versions.push(version(20, ['buildcache']), version(21, ['nextcache']), version(22, ['owner-safety']),
    version(23, []), version(24, [], 1), version(25, []), version(26, ['latest', 'a'.repeat(40)]));
  const child = versions.find(item => item.id === 25);
  const manifests = { [versions.find(item => item.id === 20).name]: { manifests: [{ digest: child.name }] } };
  const deleted = await run(versions, manifests);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.deepEqual(deleted.filter(([name]) => name === `yugioh-bot-${service}`).map(([, id]) => id).sort((a,b) => a-b), [1, 2, 3, 23]);
  }
});

test('an unreadable retained manifest stops cleanup before it deletes any versions', async () => {
  await assert.rejects(run([version(1, ['buildcache']), version(2, [])], {}, true), /retained GHCR manifest/);
});

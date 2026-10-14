import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parse } from 'yaml';

const file = new URL('../../.github/workflows/ghcr-cleanup.yml', import.meta.url);
const load = () => parse(readFileSync(file, 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const age = days => new Date(Date.now() - days * 86400000).toISOString();
const version = (id, tags, days = 20) => ({ id, name: `sha256:${String(id).padStart(64, '0')}`, created_at: age(days), metadata: { container: { tags } } });

async function run(versions, manifests = {}, fail = false, messages = [], fetches = [], failures = []) {
  const deleted = [];
  const attempted = [];
  const github = {
    paginate: async (route, options) => {
      assert.equal(options.per_page, 100);
      attempted.push(options.package_name);
      return typeof versions === 'function' ? versions(options.package_name) : versions;
    },
    request: async (route, options) => {
      assert.match(route, /^DELETE /);
      deleted.push([options.package_name, options.package_version_id]);
    },
  };
  const fetch = async url => {
    fetches.push(url);
    if (url.startsWith('https://ghcr.io/token?')) return { ok: true, json: async () => ({ token: 'fixture' }) };
    return { ok: !(typeof fail === 'function' ? fail(url) : fail), json: async () => manifests[url.split('/').at(-1)] || {} };
  };
  const workflow = load();
  const script = Object.values(workflow.jobs)[0].steps[0].with.script;
  await new AsyncFunction('github', 'context', 'core', 'fetch', script)(github, { repo: { owner: 'DuelingDomain' } }, {
    info: message => messages.push(message), warning: message => messages.push(message),
    setFailed: message => {
      assert.deepEqual(attempted, ['duel', 'web', 'worker', 'ws'].map(service => `yugioh-bot-${service}`));
      failures.push(message);
    },
  }, fetch);
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

test('cleanup does not send random registry data through job outputs', () => {
  for (const job of Object.values(load().jobs)) assert.equal(job.outputs, undefined);
});

test('cleanup keeps ten SHA versions, cache and owner tags, recent untagged and referenced children', async () => {
  const versions = Array.from({ length: 12 }, (_, i) => version(i + 1, [(i + 1).toString(16).padStart(40, '0')]));
  versions.push(version(20, ['buildcache']), version(21, ['nextcache']), version(22, ['owner-safety']),
    version(23, []), version(24, [], 1), version(25, []), version(26, ['latest', 'a'.repeat(40)]));
  const child = versions.find(item => item.id === 25);
  const manifests = { [versions.find(item => item.id === 20).name]: { manifests: [{ digest: child.name, mediaType: 'application/vnd.oci.image.manifest.v1+json' }] } };
  const deleted = await run(versions, manifests);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.deepEqual(deleted.filter(([name]) => name === `yugioh-bot-${service}`).map(([, id]) => id).sort((a,b) => a-b), [1, 2, 3, 23]);
  }
});

test('cache blobs are not read as manifests, while nested image manifests stay protected', async () => {
  const versions = [version(1, ['buildcache']), version(2, []), version(3, []), version(4, []), version(5, []), version(6, [])];
  const types = ['application/vnd.oci.image.index.v1+json', 'application/vnd.docker.distribution.manifest.list.v2+json',
    'application/vnd.oci.image.manifest.v1+json', 'application/vnd.docker.distribution.manifest.v2+json'];
  const layer = `sha256:${'e'.repeat(64)}`;
  const config = `sha256:${'f'.repeat(64)}`;
  const manifests = Object.fromEntries(versions.slice(0, 4).map((item, i) => [item.name, {
    manifests: [{ digest: versions[i + 1].name, mediaType: types[i] },
      { digest: layer, mediaType: 'application/vnd.oci.image.layer.v1.tar+gzip' },
      { digest: config, mediaType: 'application/vnd.buildkit.cacheconfig.v0' }],
  }]));
  const fetches = [];
  const deleted = await run(versions, manifests, url => url.endsWith(layer) || url.endsWith(config), [], fetches);
  assert.equal(deleted.length, 4);
  assert.ok(deleted.every(([, id]) => id === 6));
  assert.ok(fetches.every(url => !url.endsWith(layer) && !url.endsWith(config)));
  for (const item of versions.slice(1, 5)) assert.ok(fetches.some(url => url.endsWith(item.name)));
});

test('an unreadable retained manifest stops only its package before deletion', async () => {
  const messages = [];
  const deleted = await run([version(1, ['buildcache']), version(2, [])], {}, url => url.includes('/yugioh-bot-duel/'), messages);
  assert.deepEqual(deleted.map(([name]) => name), ['yugioh-bot-web', 'yugioh-bot-worker', 'yugioh-bot-ws']);
  assert.ok(messages.some(message => /yugioh-bot-duel:.*retained GHCR manifest/.test(message)));
});

test('a package API error does not stop cleanup of other packages', async () => {
  const messages = [];
  const deleted = await run(name => {
    if (name === 'yugioh-bot-duel') throw new Error('package API failed');
    return [version(2, [])];
  }, {}, false, messages);
  assert.deepEqual(deleted.map(([name]) => name), ['yugioh-bot-web', 'yugioh-bot-worker', 'yugioh-bot-ws']);
  assert.ok(messages.some(message => /yugioh-bot-duel:.*package API failed/.test(message)));
});

test('cleanup fails once with the error count after it tries all packages', async () => {
  const failures = [];
  const deleted = await run(name => {
    if (['yugioh-bot-duel', 'yugioh-bot-worker'].includes(name)) throw new Error('package API failed');
    return [version(2, [])];
  }, {}, false, [], [], failures);
  assert.deepEqual(deleted.map(([name]) => name), ['yugioh-bot-web', 'yugioh-bot-ws']);
  assert.equal(failures.length, 1);
  assert.match(failures[0], /2 package/);
});

test('packages not created yet do not fail cleanup', async () => {
  const failures = [];
  const messages = [];
  const deleted = await run(name => {
    if (name === 'yugioh-bot-duel') throw Object.assign(new Error('not found'), { status: 404 });
    return [version(2, [])];
  }, {}, false, messages, [], failures);
  assert.deepEqual(deleted.map(([name]) => name), ['yugioh-bot-web', 'yugioh-bot-worker', 'yugioh-bot-ws']);
  assert.deepEqual(failures, []);
  assert.ok(messages.includes('yugioh-bot-duel: package not created yet'));
});

test('cleanup reports packages with no candidates', async () => {
  const messages = [];
  const failures = [];
  await run([version(1, ['buildcache'])], {}, false, messages, [], failures);
  assert.deepEqual(failures, []);
  for (const service of ['duel', 'web', 'worker', 'ws']) {
    assert.ok(messages.includes(`yugioh-bot-${service}: no candidates`));
  }
});

test('production and production-prev protect old or untagged deployed digests beyond the ten SHA limit', async () => {
  const versions = Array.from({ length: 12 }, (_, i) => version(i + 1, [(i + 1).toString(16).padStart(40, '0')], 1));
  versions.push(version(20, ['production'], 30), version(21, ['production-prev', 'a'.repeat(40)], 40), version(22, [], 30));
  const deleted = await run(versions);
  assert.ok(deleted.every(([, id]) => ![20, 21].includes(id)));
  assert.equal(deleted.filter(([, id]) => id === 22).length, 4);
});

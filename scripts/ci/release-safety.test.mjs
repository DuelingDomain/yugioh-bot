import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { parse } from 'yaml';

const workflow = name => parse(readFileSync(new URL(`../../.github/workflows/${name}.yml`, import.meta.url), 'utf8'));
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const sha = n => n.toString(16).padStart(40, '0');
const cleanupNow = Date.parse('2026-11-08T05:17:00Z');
const version = (id, tags, days = 30) => ({ id, name: `sha256:${sha(id)}`, created_at: new Date(cleanupNow - days * 86400000).toISOString(), metadata: { container: { tags } } });

async function cleanup(versions, now = cleanupNow) {
  const deleted = [];
  const packages = [];
  const script = workflow('ghcr-cleanup').jobs.cleanup.steps[0].with.script;
  await new AsyncFunction('github', 'context', 'core', 'fetch', 'Date', script)({
    paginate: async (_, { package_name }) => { packages.push(package_name); return structuredClone(versions); },
    request: async (_, { package_name, package_version_id }) => deleted.push([package_name, package_version_id]),
  }, { repo: { owner: 'example' } }, { info() {}, warning() {}, setFailed(message) { throw new Error(message); } },
  async url => ({ ok: true, json: async () => url.includes('/token?') ? { token: 'fixture' } : {} }),
  { now: () => now, parse: Date.parse });
  return { deleted: deleted.filter(([name]) => name === 'yugioh-bot-web').map(([, id]) => id), deletedByPackage: deleted, packages };
}

test('first weekly cleanup deletes zero pre-cutover healthy rollback versions in every service', async () => {
  const firstRun = Date.parse('2026-10-25T05:17:00Z');
  const legacy = Array.from({ length: 12 }, (_, i) => ({
    ...version(i + 1, [sha(i + 1), ...(i === 10 ? ['production-prev'] : i === 11 ? ['production'] : [])]),
    created_at: new Date(firstRun - (20 - i) * 86400000).toISOString(),
  }));
  const healthy = new Set(legacy.slice(-10).map(v => v.id));
  const unused = Array.from({ length: 20 }, (_, i) => ({
    ...version(100 + i, [sha(100 + i)]),
    created_at: new Date(firstRun - (i % 4) * 86400000).toISOString(),
  }));
  const result = await cleanup([...legacy, ...unused], firstRun);
  assert.deepEqual(result.packages.sort(), ['bot', 'duel', 'web', 'worker', 'ws'].map(service => `yugioh-bot-${service}`));
  assert.equal(result.deletedByPackage.filter(([, id]) => healthy.has(id)).length, 0);
  for (const service of result.packages) {
    assert.deepEqual(result.deletedByPackage.filter(([name]) => name === service).map(([, id]) => id).sort((a, b) => a - b), [1, 2]);
  }
});

test('cutover keeps ten legacy SHA versions while newer unused SHA versions age out after seven days', async () => {
  const cutover = Date.parse('2026-10-21T00:00:00Z');
  const legacy = Array.from({ length: 11 }, (_, i) => ({
    ...version(i + 1, [sha(i + 1)]), created_at: new Date(cutover - (11 - i) * 1000).toISOString(),
  }));
  const result = await cleanup([...legacy, version(100, [sha(100)], 10),
    { ...version(101, [sha(101)]), created_at: new Date(cutover).toISOString() },
    version(102, [sha(102)], 7),
    { ...version(103, [sha(103)]), created_at: new Date(cleanupNow - 7 * 86400000 - 1).toISOString() },
    version(104, [], 8), version(105, [], 7)]);
  assert.deepEqual(result.deleted.sort((a, b) => a - b), [1, 100, 101, 103, 104]);
});

test('unused SHA builds cannot evict the ten healthy release rollback targets', async () => {
  const releases = Array.from({ length: 11 }, (_, i) => version(i + 1, [sha(i + 1), `release-${sha(i + 1)}`], 50 - i));
  const unused = Array.from({ length: 20 }, (_, i) => version(100 + i, [sha(100 + i)], 10));
  const result = await cleanup([...releases, ...unused, version(200, [sha(200)], 1), version(201, [], 1), version(202, []),
    version(203, ['production', `release-${sha(203)}`]), version(204, ['owner-backup']), version(205, ['nextcache']), version(206, ['buildcache'])]);
  assert.deepEqual(result.deleted.sort((a, b) => a - b), [1, 2, ...unused.map(v => v.id), 202]);
  assert.ok(result.packages.includes('yugioh-bot-bot'));
});

test('image publication waits for unit success and limits engine overlap', () => {
  const job = workflow('test').jobs['production-images'];
  assert.ok(job.needs.includes('unit-web'));
  assert.equal(job.strategy['max-parallel'], 3);
  assert.equal(job.environment, undefined);
  assert.doesNotMatch(JSON.stringify(job), /SENTRY_AUTH_TOKEN/);
});

test('PR composite dry run has read-only permissions and no registry publication', () => {
  const job = workflow('test').jobs['production-dry-run'];
  assert.equal(job.if, "github.event_name == 'pull_request'");
  assert.deepEqual(job.permissions, { contents: 'read' });
  assert.ok(job.steps.some(step => step.uses === './.github/actions/prepare-production-bundle'));
  const image = job.steps.find(step => step.uses === './.github/actions/build-production-image');
  assert.equal(image.with.push, 'false');
  assert.equal(image.with.service, 'bot');
});


test('rollback resolves healthy release tags and refuses missing tags for new releases', t => {
  const dir = mkdtempSync(join(tmpdir(), 'release-rollback-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'image-digests'));
  const script = workflow('deploy').jobs.deploy.steps.find(step => step.name === 'Resolve retained rollback digests').run;
  const output = JSON.stringify({ Descriptor: { digest: `sha256:${'a'.repeat(64)}`, platform: { os: 'linux', architecture: 'arm64' } } });
  const prefix = `
    docker() {
      if [[ "$*" == *:release-* ]]; then
        if [[ "$MISS_RELEASE" == 1 ]]; then return 1; fi
      else
        echo legacy-sha-used >> "$RUNNER_TEMP/legacy-calls"
      fi
      printf '%s' '${output}'
    }
    git() {
      if [[ "$*" == *:Dockerfile ]]; then
        if [[ "$OLD_REF" != 1 ]]; then echo 'FROM scratch AS web-sourcemaps'; fi
      else echo '  bot:'; fi
    }
  `;
  const run = extra => spawnSync('bash', ['-e', '-o', 'pipefail', '-c', prefix + script], {
    encoding: 'utf8', env: { ...process.env, RUNNER_TEMP: dir, DEPLOY_COMMIT: sha(42), MISS_RELEASE: '0', OLD_REF: '0', ...extra },
  });
  const healthy = run({});
  assert.equal(healthy.status, 0, healthy.stderr);
  assert.equal(run({ MISS_RELEASE: '1' }).status, 1);
  assert.equal(run({ MISS_RELEASE: '1', OLD_REF: '1' }).status, 0);
  assert.equal(readFileSync(join(dir, 'legacy-calls'), 'utf8').trim().split('\n').length, 5);
});

test('retain tags all healthy manifests with the release SHA after fresh health evidence', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'release-retain-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const release = join(dir, 'deployed-release');
  mkdirSync(release);
  const body = '{"schemaVersion":2}';
  const digest = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  const services = ['duel', 'web', 'worker', 'ws', 'bot'];
  writeFileSync(join(release, 'confirmed-attempt'), '2');
  writeFileSync(join(release, 'image-digests'), services.map(service => `${service} ${digest}`).join('\n'));
  const calls = [];
  const script = workflow('deploy').jobs.retain.steps.find(step => step.with?.script).with.script;
  await new AsyncFunction('context', 'core', 'fetch', 'process', script)(
    { repo: { owner: 'Example' }, actor: 'fixture' }, { info() {} }, async (url, options = {}) => {
      if (url.includes('/token?')) return { ok: true, json: async () => ({ token: 'fixture' }) };
      if (options.method === 'PUT') calls.push(url);
      return { ok: true, headers: new Map([['content-type', 'application/vnd.oci.image.manifest.v1+json']]), text: async () => body };
    }, { env: { RUNNER_TEMP: dir, RUN_ATTEMPT: '2', DEPLOY_COMMIT: sha(42), GHCR_TOKEN: 'fixture' } });
  assert.equal(calls.filter(url => url.endsWith(`/release-${sha(42)}`)).length, 5);
  assert.equal(calls.filter(url => url.endsWith('/production')).length, 5);
  assert.equal(calls.filter(url => url.endsWith('/production-prev')).length, 0);
});

test('Docker build exports exact private maps and strips maps plus inherited and new Turbopack cache', t => {
  const dir = mkdtempSync(join(tmpdir(), 'release-cache-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const app = join(dir, 'app');
  const cache = join(dir, 'cache');
  const bin = join(dir, 'bin');
  for (const path of [app, bin, join(cache, 'turbopack')]) mkdirSync(path, { recursive: true });
  writeFileSync(join(cache, 'turbopack', 'compressed-source'), 'private inherited sources');
  writeFileSync(join(cache, 'old.map'), 'inherited source map');
  writeFileSync(join(bin, 'npm'), `#!/bin/sh
    test "$NEXT_BUILD_FS_CACHE" = 0 || exit 2
    mkdir -p packages/web/.next/server packages/web/.next/static packages/web/.next/cache/turbopack
    printf js > packages/web/.next/static/app.js
    printf map > packages/web/.next/static/app.js.map
    printf secret > packages/web/.next/cache/turbopack/private
  `);
  chmodSync(join(bin, 'npm'), 0o755);
  const dockerfile = readFileSync(new URL('../../Dockerfile', import.meta.url), 'utf8');
  const run = dockerfile.slice(dockerfile.indexOf('RUN --mount=type=bind,from=nextcache'), dockerfile.indexOf('# Only the builder-local'))
    .replace(/^RUN /, '').replace(/--mount=\S+\s*/g, '').replaceAll('/tmp/nextcache', cache).replaceAll('/app', app).replaceAll('/sentry', join(dir, 'sentry'));
  const result = spawnSync('bash', ['-e', '-o', 'pipefail', '-c', run], {
    cwd: app, encoding: 'utf8', env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SENTRY_GENERATE_SOURCEMAPS: '1' },
  });
  assert.equal(result.status, 0, result.stderr);
  const files = spawnSync('find', [app, '-name', '*.map', '-o', '-name', 'turbopack'], { encoding: 'utf8' });
  assert.equal(files.stdout, '');
  const archive = spawnSync('tar', ['-tzf', join(dir, 'sentry', 'web-sourcemaps.tar.gz')], { encoding: 'utf8' });
  assert.equal(archive.status, 0, archive.stderr);
  assert.match(archive.stdout, /static\/app.js.map/);
});

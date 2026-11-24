import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { imageInputsHash, included, isoWeek, SERVICES } from './image-inputs.mjs';

const packages_test_dir = 'packages/shared/test/a.ts';
const entry = (path, oid = 'a'.repeat(40)) => ({ mode: '100644', oid, path });
const base = [
  entry('Dockerfile'), entry('package-lock.json'), entry('packages/shared/src/a.ts'), entry('packages/web/src/page.tsx'),
  entry('packages/ws/src/server.ts'), entry('packages/bot/src/bot.ts'), entry('packages/web/package.json'),
];
const withEntry = (path, oid) => [...base.filter(item => item.path !== path), entry(path, oid)];

test('a web-only source change leaves the other service hashes alone', () => {
  const changed = withEntry('packages/web/src/page.tsx', 'b'.repeat(40));
  assert.notEqual(imageInputsHash(changed, 'web'), imageInputsHash(base, 'web'));
  for (const service of ['bot', 'ws', 'worker', 'duel']) assert.equal(imageInputsHash(changed, service), imageInputsHash(base, service));
});

test('a new vision index pin invalidates only the web image', () => {
  const path = 'packages/vision/index-manifest.json';
  const before = withEntry(path, 'a'.repeat(40));
  const after = withEntry(path, 'b'.repeat(40));
  assert.notEqual(imageInputsHash(after, 'web'), imageInputsHash(before, 'web'));
  for (const service of ['bot', 'ws', 'worker', 'duel']) {
    assert.equal(imageInputsHash(after, service), imageInputsHash(before, service));
  }
});

test('shared code, lockfile, Dockerfile and any package manifest change every service', () => {
  for (const path of ['packages/shared/src/a.ts', 'package-lock.json', 'Dockerfile', 'packages/web/package.json']) {
    const changed = withEntry(path, 'c'.repeat(40));
    for (const service of SERVICES) assert.notEqual(imageInputsHash(changed, service), imageInputsHash(base, service), `${path} ${service}`);
  }
});

test('docs, tests, workflows and deploy tooling are not inputs; the build action is', () => {
  for (const path of ['docs/a.md', 'README.md', 'packages/web/tests/a.test.ts', packages_test_dir, '.github/workflows/deploy.yml', 'scripts/deployment/production-images.sh', 'scripts/ci/reuse-pr-result.mjs', 'packages/e2e/src/a.ts']) {
    assert.equal(included(path, 'web'), false, path);
  }
  for (const path of ['.github/actions/build-production-image/action.yml', 'scripts/ci/image-inputs.mjs', 'scripts/voice/pins.json', 'patches/x.patch', 'tsconfig.json']) {
    assert.equal(included(path, 'web'), true, path);
  }
});

test('the hash follows .dockerignore: nested test dirs and package markdown that reach an image are inputs', () => {
  for (const path of ['packages/web/app/api/duels/test/route.ts', 'packages/vision/src/licenses/X.THIRD_PARTY_NOTICES.md', 'packages/shared/data/effects/NOTICE.md']) {
    assert.equal(included(path, 'web'), true, path);
  }
  const changed = withEntry('packages/web/app/api/duels/test/route.ts', 'd'.repeat(40));
  assert.notEqual(imageInputsHash(changed, 'web'), imageInputsHash(base, 'web'));
  assert.equal(included('NOTICE.md', 'web'), false);
});

test('workflow build inputs (test matrix, voice-asset build, emscripten pin) are hashed', () => {
  for (const path of ['.github/workflows/test.yml', '.github/workflows/prepare-voice-assets.yml', 'packages/duel-server/domain-core/pins.json']) {
    assert.equal(included(path, 'web'), true, path);
  }
  assert.equal(included('.github/actions/prepare-production-bundle/action.yml', 'duel'), true);
  assert.equal(included('.github/actions/prepare-production-bundle/action.yml', 'web'), false);
});

test('salt (build settings, week, bundle digest) changes the hash', () => {
  assert.notEqual(imageInputsHash(base, 'web', ['k=1']), imageInputsHash(base, 'web', ['k=2']));
  assert.equal(isoWeek(new Date('2026-11-19T12:00:00Z')), '2026-W47');
});

test('duel hashing requires the prepared bundle', () => {
  const result = duelHash();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /duel.*bundle/i);
});

test('duel hashes match across checkout provenance and differ for changed engine files', t => {
  const dir = mkdtempSync(join(tmpdir(), 'duel-image-inputs-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bundle = join(dir, 'bundle');
  const tarball = join(dir, 'deploy-bundle.tar.gz');
  const output = join(dir, 'output');
  mkdirSync(join(bundle, 'card-scripts'), { recursive: true });
  const wasm = join(bundle, 'ocgcore.multi.wasm');
  writeFileSync(wasm, 'wasm');
  writeFileSync(join(bundle, 'card-scripts', 'domain.lua'), 'script');
  const originalBuilder = 'c'.repeat(40);
  const writeSource = (commit, capabilities = 'tag-facing-extra-zones', builtBy = originalBuilder) => {
    writeFileSync(join(bundle, 'ocgcore.multi.SOURCE'), [
      `tag=deploy-${commit.slice(0, 12)}`, `builtBy=${builtBy}`, `deployedBy=${commit}`, `capabilities=${capabilities}`, '',
    ].join('\n'));
  };
  const hash = () => {
    execFileSync('tar', ['-czf', tarball, '-C', bundle, '.'], { stdio: ['ignore', 'ignore', 'pipe'] });
    writeFileSync(output, '');
    const result = duelHash(tarball, output);
    assert.equal(result.status, 0, result.stderr);
    const inputs = readFileSync(output, 'utf8');
    assert.match(inputs, /^hash=[0-9a-f]{64}\n$/);
    return inputs;
  };
  writeSource('a'.repeat(40));
  const pr = hash();
  writeSource('b'.repeat(40));
  assert.equal(hash(), pr);
  writeSource('b'.repeat(40), 'ffa3-facing-extra-zones');
  assert.notEqual(hash(), pr);
  writeSource('b'.repeat(40), 'tag-facing-extra-zones', 'd'.repeat(40));
  assert.notEqual(hash(), pr);
  writeSource('b'.repeat(40));
  writeFileSync(wasm, 'different wasm');
  assert.notEqual(hash(), pr);
});

function duelHash(bundle = '', output = '') {
  return spawnSync(process.execPath, [fileURLToPath(new URL('./image-inputs.mjs', import.meta.url))], {
    env: { ...process.env, IMAGE_SERVICE: 'duel', IMAGE_BUNDLE: bundle, IMAGE_SALT_EXTRA: 'target:duel-bundled', GITHUB_OUTPUT: output },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

test('a tree without a Dockerfile is refused', () => {
  assert.throws(() => imageInputsHash([entry('package.json')], 'web'), /Dockerfile/);
});

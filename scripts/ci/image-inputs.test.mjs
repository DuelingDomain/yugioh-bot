import assert from 'node:assert/strict';
import { test } from 'node:test';
import { imageInputsHash, included, isoWeek, SERVICES } from './image-inputs.mjs';

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

test('shared code, lockfile, Dockerfile and any package manifest change every service', () => {
  for (const path of ['packages/shared/src/a.ts', 'package-lock.json', 'Dockerfile', 'packages/web/package.json']) {
    const changed = withEntry(path, 'c'.repeat(40));
    for (const service of SERVICES) assert.notEqual(imageInputsHash(changed, service), imageInputsHash(base, service), `${path} ${service}`);
  }
});

test('docs, tests, workflows and deploy tooling are not inputs; the build action is', () => {
  for (const path of ['docs/a.md', 'README.md', 'packages/web/tests/a.test.ts', '.github/workflows/test.yml', 'scripts/deployment/production-images.sh', 'scripts/ci/reuse-pr-result.mjs', 'packages/e2e/src/a.ts']) {
    assert.equal(included(path, 'web'), false, path);
  }
  for (const path of ['.github/actions/build-production-image/action.yml', 'scripts/ci/image-inputs.mjs', 'scripts/voice/pins.json', 'patches/x.patch', 'tsconfig.json']) {
    assert.equal(included(path, 'web'), true, path);
  }
});

test('salt (build settings, week, bundle digest) changes the hash', () => {
  assert.notEqual(imageInputsHash(base, 'web', ['k=1']), imageInputsHash(base, 'web', ['k=2']));
  assert.equal(isoWeek(new Date('2026-11-19T12:00:00Z')), '2026-W47');
});

test('a tree without a Dockerfile is refused', () => {
  assert.throws(() => imageInputsHash([entry('package.json')], 'web'), /Dockerfile/);
});

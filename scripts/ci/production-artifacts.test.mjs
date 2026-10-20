import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectProductionArtifacts } from './production-artifacts.mjs';
const commit = 'a'.repeat(40);
const names = ['production-bundle', ...['duel', 'web', 'bot', 'worker', 'ws'].map(service => `production-image-${service}`)];
const artifacts = (attempt, offset = 0) => names.map((name, i) => ({ id: offset + i + 1, name: `${name}-${commit}-${attempt}`, expired: false }));

test('a queued successful attempt cannot consume images or bundle from a newer attempt', () => {
  const result = selectProductionArtifacts([...artifacts(1), ...artifacts(2, 10)], commit, 1);
  assert.equal(result.bundle, 1);
  assert.deepEqual(result.images, [2, 3, 4, 5, 6]);
});
test('partial reruns can reuse completed jobs but prefer artifacts rebuilt in the successful attempt', () => {
  const result = selectProductionArtifacts([...artifacts(1), artifacts(2, 10)[2]], commit, 2);
  assert.equal(result.bundle, 1);
  assert.deepEqual(result.images, [2, 13, 4, 5, 6]);
});
test('missing, expired, other-commit and newer-only artifacts fail closed', () => {
  for (const values of [[], artifacts(1).slice(1), artifacts(2), artifacts(1).map(a => ({ ...a, expired: true })), artifacts(1).map(a => ({ ...a, name: a.name.replace(commit, 'b'.repeat(40)) }))]) {
    assert.throws(() => selectProductionArtifacts(values, commit, 1), /Missing/);
  }
  for (const attempt of [0, -1, NaN, 'bad']) assert.throws(() => selectProductionArtifacts(artifacts(1), commit, attempt), /Invalid/);
  assert.throws(() => selectProductionArtifacts(artifacts(1), 'bad', 1), /Invalid/);
});

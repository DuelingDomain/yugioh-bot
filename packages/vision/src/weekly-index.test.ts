import assert from 'node:assert/strict';
import { test } from 'node:test';
import { yugioh } from './games/yugioh';
import { encodeIndex } from './index-format';
import { layoutKey } from './profile';
import type { IndexMeta } from './types';
import { inspectCandidate } from '../../../scripts/vision/weekly-index';

function candidate() {
  const entries = [
    { cardId: '1', passcode: 1, name: 'Card', imageId: 1, frameClass: 'Effect' },
    { cardId: '1', passcode: 1, name: 'Card', imageId: 2, frameClass: 'Effect' },
    { cardId: '3', passcode: 3, name: 'Demo (Skill Card)', imageId: 3 },
    { cardId: yugioh.cardBack.cardId, passcode: 0, name: 'Card back', imageId: -1 },
  ];
  const meta: IndexMeta = { version: 1, gameId: yugioh.id, entries, count: entries.length,
    dim: yugioh.embedding.dim, modelId: yugioh.embedding.id, modelSha256: yugioh.embedding.sha256,
    layoutKey: layoutKey(yugioh), dtype: 'int8', generatedAt: '2026-11-23T00:00:00Z' };
  const binary = encodeIndex(new Int8Array(meta.count * meta.dim), meta);
  return { meta, binary };
}

test('coverage counts physical identities once and allows at most ten missing identities', () => {
  const { meta, binary } = candidate();
  assert.equal(inspectCandidate(meta, binary, 11).cards, 1);
  assert.throws(() => inspectCandidate(meta, binary, 12), /coverage/);
});

test('rejects wrong model, dimension and malformed binary', () => {
  const { meta, binary } = candidate();
  assert.throws(() => inspectCandidate({ ...meta, modelId: 'other' }, binary, 1), /profile/);
  assert.throws(() => inspectCandidate({ ...meta, dim: 256 }, binary, 1), /profile/);
  assert.throws(() => inspectCandidate(meta, binary.slice(0, -1), 1), /size mismatch/);
});

test('catalog fingerprint ignores dates and input order but detects changes to published entries', () => {
  const { meta, binary } = candidate();
  const { entriesHash } = inspectCandidate(meta, binary, 1);
  assert.equal(inspectCandidate({ ...meta, generatedAt: 'later', entries: [...meta.entries].reverse() }, binary, 1).entriesHash, entriesHash);
  const entries = meta.entries.map(entry => entry.imageId === 1 ? { ...entry, name: 'Renamed' } : entry);
  assert.notEqual(inspectCandidate({ ...meta, entries }, binary, 1).entriesHash, entriesHash);
});

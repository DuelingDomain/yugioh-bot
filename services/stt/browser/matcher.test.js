import test from 'node:test';
import assert from 'node:assert/strict';
import { CardMatcher } from './matcher.js';

test('Python-compatible card correction preserves commands and Unicode spans', () => {
  const matcher = new CardMatcher([
    ['Blue-Eyes White Dragon', 89631139], ['Dark Magician', 46986414],
    ['Dark Magician Girl', 38033121], ['Ash Blossom & Joyous Spring', 14558127],
    ['Battle', 1], ['Imran', 2], ['Set Rotation', 73468603], ['Raigeki', 12580477],
  ].map(([name, passcode]) => ({ name, passcode })));
  const result = matcher.match('🐉 Blue eyes white dragoon attacks dark magician', ['Blue-Eyes White Dragon', 'Dark Magician']);
  assert.equal(result.normalizedText, '🐉 Blue-Eyes White Dragon attacks Dark Magician');
  assert.deepEqual(result.cardMatches.map(m => m.passcode), [89631139, 46986414]);
  assert.deepEqual(result.cardMatches[0].span, [2, 25]);
  assert.equal(result.cardMatches[0].score, 0.9818);
  for (const text of ['I activate ash blossom and joyous spring', 'I activate ash', 'I activate ashe']) {
    assert.equal(matcher.match(text, ['Ash Blossom & Joyous Spring']).cardMatches[0].passcode, 14558127);
  }
  assert.equal(matcher.match('I activate Set Rotation').cardMatches[0].passcode, 73468603);
  assert.equal(matcher.match('Raigeki').cardMatches[0].passcode, 12580477);
  assert.equal(matcher.match('I summon Dark Magician Girl', ['Dark Magician']).cardMatches[0].passcode, 38033121);
  for (const text of ['moving to standby phase', 'battle phase', 'take 2400 damage', 'Imran attack directly', 'I summon something incomprehensible']) {
    assert.deepEqual(matcher.match(text).cardMatches, [], text);
  }
});

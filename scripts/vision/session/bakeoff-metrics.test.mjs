import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import test from 'node:test';

test('calibration cannot peek at test; alternate artworks/decks and negative sure errors count', async () => {
  assert.ok(existsSync(new URL('./bakeoff-metrics.mjs', import.meta.url)), 'scoring is not implemented');
  const {rank, calibrate, score} = await import('./bakeoff-metrics.mjs');
  assert.deepEqual(rank([.9,.8,.7,.99], ['a','a','b','-1'], null).map(v=>v.cardId), ['a','b']);
  assert.equal(rank([.9,.8,.7], ['a','a','b'], ['b'])[0].cardId, 'b');
  const right = {truth:'a', ranking:[{cardId:'a',score:.9},{cardId:'b',score:.3}]};
  const wrong = {truth:null, ranking:[{cardId:'a',score:.8},{cardId:'b',score:.3}]};
  const threshold = calibrate([right,wrong]);
  const result = score([right,wrong,{...wrong,ranking:[{cardId:'a',score:.95},{cardId:'b',score:.1}]}], threshold);
  assert.equal(result.top1, 1);
  assert.equal(result.wrongSure, 1);
  assert.equal(result.zeroWrong, false);
  assert.equal(result.sureRateAtZeroWrong, null);
  assert.equal(result.sure / result.n, 2/3);
  assert.equal(score([right], calibrate([wrong])).sure, 0);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeIndex, decodeIndex } from './index-format';
import { topK, normalize } from './search';
import { sharpness } from './quality';
const meta = { version: 1 as const, modelId: 'x', modelSha256: 'a', dim: 2, count: 2, dtype: 'float32' as const,
  entries: [{ cardId: 'a', passcode: 1, name: 'A' }, { cardId: 'b', passcode: 2, name: 'B' }] };
test('index roundtrip validates dimensions and ranks with bounded priors', () => {
  const index = decodeIndex(encodeIndex(new Float32Array([1, 0, 0.98, 0.2]), meta), meta);
  assert.equal(topK(normalize(new Float32Array([1, 0])), index, 2)[0].cardId, 'a');
  assert.equal(topK(new Float32Array([1, 0]), index, 2, { voiceMentioned: ['b'] })[0].cardId, 'b');
  assert.throws(() => decodeIndex(new ArrayBuffer(3), meta));
  assert.throws(() => topK(new Float32Array(3), index, 2));
});
test('Laplacian variance distinguishes flat and detailed frames', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4).fill(128);
  const flat = sharpness({ width: 16, height: 16, data });
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) for (let c = 0; c < 3; c++) data[(y * 16 + x) * 4 + c] = (x + y) % 2 ? 255 : 0;
  assert.equal(flat, 0); assert.ok(sharpness({ width: 16, height: 16, data }) > 10000);
});
import { chooseCard } from './detector/run';
import { warpQuad } from './geometry';
import { validateOptions } from './options';
test('click selection never picks a distant card, and degenerate warps fail', () => {
  const img = { width: 16, height: 16, data: new Uint8ClampedArray(1024) };
  const card = { cx: 4, cy: 4, w: 4, h: 6, angle: 0, conf: 1, kind: 'face-up' as const, scores: { 'face-up': 1, 'face-down': 0 }, pts: [[2,1],[6,1],[6,7],[2,7]] as [number,number][], box: [] };
  assert.equal(chooseCard([card], img, { x: .25, y: .25 }), card);
  assert.equal(chooseCard([card], img, { x: .9, y: .9 }), undefined);
  assert.equal(warpQuad(img, [{x:0,y:0},{x:0,y:0},{x:0,y:0},{x:0,y:0}], 4, 6), null);
  assert.throws(() => validateOptions({ clickPoint: { x: NaN, y: 0 } }));
});

// A deck/voice prior or a fallback must never manufacture a "sure" visual match.
import { tierFor } from './search';
import { duelLensModel } from './models';
test('upstream confidence tiers preserve the margin, floor and fallback guards', () => {
  const t = duelLensModel.thresholds;
  const candidates = (a: number, b: number) => [{ cardId: 'a', score: a }, { cardId: 'b', score: b }];
  assert.equal(tierFor(candidates(.9, .7), t), 'sure');
  assert.equal(tierFor(candidates(.81, .8), t), 'not sure');
  assert.equal(tierFor(candidates(.72, .5), t), 'low match');
  assert.equal(tierFor(candidates(.9, .7), t, true), 'not sure');
  assert.equal(tierFor([], t), 'low match');
  assert.equal(tierFor(candidates(.9, .7), t, false, undefined, false), 'not sure');
  assert.equal(tierFor([{cardId:'back',score:.9},{cardId:'a',score:.85}], t, false, 'back'), 'not sure');
});

import { dropPlaceholders } from './placeholder-art';
import { buildHypotheses } from './hypotheses';
import { yugioh } from './games/yugioh';
test('back placeholders are excluded and artwork cropping follows the supplied game data', () => {
  const entries = [{cardId:'back'}, {cardId:'placeholder'}, {cardId:'real'}];
  const result = dropPlaceholders(entries, [new Float32Array([1,0]),new Float32Array([.99,.01]),new Float32Array([0,1])], 'back');
  assert.deepEqual(result.entries.map(e=>e.cardId), ['back','real']);
  const image={width:10,height:10,data:new Uint8ClampedArray(400)};
  const crops=buildHypotheses(image,image,null,{userBoxWithCard:false},{...yugioh,artWindow:{x:.2,y:.3,w:.4,h:.5}});
  assert.equal(crops[0].image.width,4); assert.equal(crops[0].image.height,5);
});

import { catalogCards } from '../../../scripts/vision/catalog';
test('full catalog retains Tokens, Skills and alternate artwork', () => {
  const rows = ['Effect Monster', 'Token', 'Skill Card'].map((type, i) => ({
    id: i + 1, name: type, type, card_images: [{id: i + 1, image_url: 'https://images.ygoprodeck.com/card.jpg'},
      {id: i + 101, image_url: 'https://images.ygoprodeck.com/alt.jpg'}],
  }));
  const cards = catalogCards({data: rows});
  assert.equal(cards.length, 3); assert.equal(cards.flatMap(c => c.images).length, 6);
});

import { createRecognizer } from './client';
import { webRuntime, type WebOrt } from './web-runtime';
test('game shorthand validates before allocating a worker and disposal rejects recognition', async () => {
  assert.throws(() => createRecognizer({game: 'unknown' as 'yugioh'}), /Unsupported game/);
  const reader = createRecognizer({game: 'yugioh'}); reader.dispose();
  await assert.rejects(reader.recognize([]), /disposed/);
});
test('isolated WASM enables four threads and SIMD; other pages keep one thread', () => {
  const ort = {env: {wasm: {}}} as WebOrt;
  const deps = {ort, getURL: (path: string) => path, hardwareConcurrency: 16};
  webRuntime({...deps, crossOriginIsolated: true});
  assert.equal(ort!.env.wasm.numThreads, 4); assert.equal(ort!.env.wasm.simd, true);
  webRuntime({...deps, crossOriginIsolated: false});
  assert.equal(ort!.env.wasm.numThreads, 1);
});

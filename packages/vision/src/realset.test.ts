import assert from 'node:assert/strict';
import test from 'node:test';
import { makeManifest, type FrameLabels } from '../../../scripts/vision/realset-schema';
import { scoreFrame, summarize, type Prediction } from '../../../scripts/vision/realset-metrics';
import type { Quad } from './geometry';

const box = (x: number): Quad => [{ x, y: .2 }, { x: x + .1, y: .2 }, { x: x + .1, y: .4 }, { x, y: .4 }];
const card = (x: number, cardId: string, name: string) => ({
  quad: box(x), face: 'up' as const, position: 'upright' as const,
  cardId, name, status: 'verified' as const, provenance: 'hand-labeled' as const,
});
const labels: FrameLabels = {
  clip: 'a', atMs: 2000, file: 'frames/a-2s.png', ignore: [box(.8)],
  cards: [
    card(.02, '100', 'One'),
    card(.16, '200', 'Two'),
    card(.3, '300', 'Three'),
    { quad: box(.44), face: 'up', position: 'sideways', cardId: null, status: 'uncertain', provenance: 'hand-labeled' },
    { quad: box(.58), face: 'down', position: 'sideways', cardId: null, status: 'verified', provenance: 'hand-labeled' },
  ],
};
const predict = (x: number, name?: string, tier: Prediction['tier'] = 'sure'): Prediction => ({
  quad: box(x), faceDown: false, cardId: name ? '999' : undefined, name, tier,
});

test('matches physical cards once and counts name accuracy, wrong sure reads, abstentions and phantoms', () => {
  const result = scoreFrame(labels, [
    predict(.02, 'One', 'not sure'), predict(.16, 'Other'), predict(.16, 'Other'),
    predict(.44, 'Unverified'), { ...predict(.58), tier: 'not sure', faceDown: true },
    predict(.72, 'Phantom'), predict(.8, 'Excluded'),
  ], 20);
  const summary = summarize([result]);
  assert.deepEqual(summary.top1, { count: 1, total: 3, rate: 1 / 3 });
  assert.deepEqual(summary.sureWrong, { count: 1, total: 3, rate: 1 / 3 });
  assert.deepEqual(summary.notSure, { count: 2, total: 3, rate: 2 / 3 });
  assert.equal(summary.missed, 1);
  assert.equal(summary.phantoms, 2);
  assert.equal(summary.sureNamedPhantoms, 2);
  assert.deepEqual(summary.phantomFrames, { count: 1, total: 1, rate: 1 });
  assert.deepEqual(summary.faceDown, { count: 1, total: 1, rate: 1 });
  assert.equal(summary.uncertainCards, 1);
  assert.equal(summary.faceDownSureNames, 0);
});

test('a negative frame has a measured phantom rate and no identity rate', () => {
  const result = scoreFrame({ ...labels, cards: [] }, [predict(.3), predict(.8)], 10);
  const summary = summarize([result]);
  assert.deepEqual(summary.sureWrong, { count: 0, total: 0, rate: null });
  assert.deepEqual(summary.phantomFrames, { count: 1, total: 1, rate: 1 });
  assert.equal(summary.phantoms, 1);
});

test('freezes clips and frames in stable order and rejects ambiguous labels or duplicate frames', () => {
  const sig = 'ab'.repeat(32);
  const clips = [{ id: 'b', file: 'clips/b.webm', source: 'camera' }, { id: 'a', file: 'clips/a.webm', source: 'camera' }];
  const frames = [{ ...labels, clip: 'b', atMs: 3000, file: 'frames/b.png' }, labels];
  const digest = new Map([...clips, ...frames].map(x => [x.file, sig]));
  const input = { version: 'v1', clips, frames };
  const manifest = makeManifest(input, digest);
  assert.deepEqual(manifest.frames.map(f => [f.clip, f.atMs, f.sha256]), [['a', 2000, sig], ['b', 3000, sig]]);
  assert.deepEqual(makeManifest({ ...input, clips: [...clips].reverse(), frames: [...frames].reverse() }, digest), manifest);
  assert.throws(() => makeManifest({ ...input, frames: [labels, { ...labels, file: 'frames/other.png' }] }, digest), /duplicate/i);
  assert.throws(() => makeManifest({
    ...input, frames: [{ ...labels, cards: [{ ...labels.cards[0], cardId: null }] }],
  }, digest), /verified face-up/i);
});

test('matches both cards when overlapping outlines offer more than one pairing', () => {
  const frame = { ...labels, cards: [card(.2, '100', 'One'), card(.255, '200', 'Two')] };
  const summary = summarize([scoreFrame(frame, [predict(.226, 'Two'), predict(.169, 'One')], 10)]);
  assert.equal(summary.missed, 0);
  assert.equal(summary.phantoms, 0);
  assert.equal(summary.top1.count, 2);
});

test('reports a sure name on a verified face-down card', () => {
  const frame = { ...labels, cards: [labels.cards[4]] };
  const summary = summarize([scoreFrame(frame, [predict(.58, 'One')], 10)]);
  assert.equal(summary.faceDown.count, 0);
  assert.equal(summary.faceDownSureNames, 1);
  assert.equal(summary.sureWrong.total, 0);
});

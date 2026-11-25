import assert from 'node:assert/strict';
import test from 'node:test';
import { createTapPreread } from './tap-preread';
import { createFieldCalibration, DEFAULT_FIELD_ORIENTATION, fieldMatPoint, fieldZoneCells } from './field-zones';
import type { DetectedQuad } from './types';

test('Tap prereads only settled public fronts and drops a cached name when the card changes', () => {
  const corners = [{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}];
  const calibration = createFieldCalibration(corners, DEFAULT_FIELD_ORIENTATION);
  const cells = fieldZoneCells();
  const outline = (zone: string): DetectedQuad => {
    const {x,y,w,h} = cells.find(cell => cell.zone === zone)!;
    const quad = [{x:x+.125*w,y:y+.125*h},{x:x+.875*w,y:y+.125*h},{x:x+.875*w,y:y+.875*h},{x:x+.125*w,y:y+.875*h}];
    return {quad:quad.map(point => fieldMatPoint(point, calibration)), kind:'face-up', confidence:.95, partial:false};
  };
  const card = outline('M3'), deck = outline('DECK');
  const look = Array.from({length:288}, (_, i) => i % 2 ? .7 : .2);
  const clean = {appearance:() => look, motion:() => 0, sharpness:() => 50};
  const coveredPixels = {...clean, appearance:() => look.map(() => .4)};
  const covered = {...coveredPixels, touched:() => .1};
  const tracker = createTapPreread(calibration, 'normal');
  const point = {x:(card.quad[0].x+card.quad[2].x)/2,y:(card.quad[0].y+card.quad[2].y)/2};

  tracker.sample(covered, 0, [card, deck]);
  tracker.sample(covered, 180);
  assert.equal(tracker.next(), undefined);
  tracker.sample(coveredPixels, 260, [card, deck]);
  assert.equal(tracker.next(), undefined);
  tracker.sample(clean, 300, [card, deck]);
  assert.equal(tracker.next(), undefined);
  tracker.sample(clean, 480);
  const front = tracker.next()!;
  assert.deepEqual(front.card, card);
  tracker.finish(front, {cardId:42,name:'Card'});
  tracker.sample(clean, 500, [{...card}, deck]);
  assert.equal(tracker.next(), undefined);
  assert.equal(tracker.hit(point, clean)?.identity?.cardId, 42);
  assert.equal(tracker.hit(point, covered), undefined);
  assert.equal(tracker.hit(point, coveredPixels), undefined);

  tracker.sample(clean, 600, [{...card,kind:'face-down'}, deck]);
  assert.equal(tracker.hit(point, clean), undefined);
  assert.equal(tracker.next(), undefined);
  tracker.sample(clean, 720, [card, deck]);
  tracker.sample(clean, 900);
  assert.equal(tracker.next()?.identity, undefined);
  assert.notEqual(tracker.next(), front);

  const discovery = createTapPreread(calibration, 'normal');
  const scene = (moving: number, sinceMark: number) => ({ ...clean, scene: { moving, sinceMark, mark() {} } });
  assert.equal(discovery.sample(scene(20, 20), 0), false);
  assert.equal(discovery.sample(scene(1, 20), 350), false);
  assert.equal(discovery.sample(scene(0, 20), 700), true);
  assert.equal(discovery.sample(scene(0, 0), 3000), false);
  assert.equal(discovery.sample(scene(15, 15), 3350), false);
  assert.equal(discovery.sample(scene(10, 16), 3700), false);
  assert.equal(discovery.sample(scene(0, 16), 4050), false);
  assert.equal(discovery.sample(scene(0, 16), 4400), true);
});

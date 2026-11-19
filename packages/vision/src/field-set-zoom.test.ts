import assert from 'node:assert/strict';
import test from 'node:test';
import { canZoomCell, detectFieldCellOutlines, detectZoomedCell } from './field-set-zoom';
import { fieldCenter } from './field-zones';
import type { TensorCtor } from './embed';
import type { ModelSession } from './runtime';
import type { DetectedQuad } from './types';

test('the cell crop projects both card faces back into camera coordinates', async () => {
  const frame = {
    width: 480, height: 320, colorSpace: 'srgb',
    data: new Uint8ClampedArray(480 * 320 * 4),
  } as ImageData;
  const cell: DetectedQuad = {
    quad: [{x:.25,y:.25},{x:.75,y:.25},{x:.75,y:.75},{x:.25,y:.75}],
    kind: 'face-up', confidence: 1, partial: false,
  };
  assert.equal(canZoomCell(frame, cell), true);
  assert.equal(canZoomCell({...frame,width:160}, cell), false);

  class Tensor {
    constructor(public type:unknown, public data:unknown, public dims:number[]) {}
  }
  let passes = 0;
  const detector = {
    async run({image}:Record<string,Tensor>) {
      passes++;
      const [,,height,width] = image.dims;
      assert.equal(width,448);
      const gw = width / 4, gh = height / 4, pixels = gw * gh;
      const heat = new Float32Array(pixels * 2), box = new Float32Array(pixels * 6);
      for (const [kind, column, confidence] of [[0,35,.9],[1,77,.8]]) {
        const center = 37 * gw + column;
        heat[kind * pixels + center] = confidence;
        box[2 * pixels + center] = Math.log(16);
        box[3 * pixels + center] = Math.log(24);
        box[5 * pixels + center] = 1;
      }
      return {heat:{dims:[1,2,gh,gw],data:heat},box:{dims:[1,6,gh,gw],data:box}};
    },
  } as unknown as ModelSession;
  const cards = await detectZoomedCell(frame, cell, {
    async detectCards(crop, options) {
      assert.equal(options?.zoom, true);
      assert.deepEqual([crop.width, crop.height], [384, 256]);
      assert.ok('data' in crop);
      return detectFieldCellOutlines(crop, detector, Tensor as unknown as TensorCtor);
    },
  });
  assert.equal(passes, 1);
  assert.deepEqual(cards.map(card => card.kind), ['face-up', 'face-down']);
  for (const [index, card] of cards.entries()) {
    const center = fieldCenter(card);
    assert.ok(Math.abs(center.x - [.35,.65][index]) < .005, JSON.stringify(center));
    assert.ok(Math.abs(center.y - .5) < .01);
  }
});

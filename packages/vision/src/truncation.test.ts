import test from 'node:test';
import assert from 'node:assert/strict';
import { fillUnseen, frameSides, padSides, sidesReached, warpQuadMasked } from './truncation';
import { warpQuad, type Quad } from './geometry';
import type { RGBAImage } from './pixels';

function image(width: number, height: number): RGBAImage {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([20 + i * 13, 60 + i * 7, 100 + i * 3, 255], i * 4);
  return { width, height, data };
}
const rgb = (img: RGBAImage, x: number, y: number) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

test('a clipped whole-card warp preserves geometry and marks the missing half', () => {
  const source = image(2, 2);
  const quad: Quad = [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: -2, y: 2 }];
  const warped = warpQuadMasked(source, quad, 4, 2)!;
  assert.deepEqual([...warped.seen], [0, 0, 1, 1, 0, 0, 1, 1]);
  assert.equal(warped.seenShare, .5);
  assert.deepEqual(rgb(warped.image, 0, 0), [0, 0, 0, 255]);
  assert.deepEqual(rgb(warped.image, 2, 0), rgb(source, 0, 0));
  assert.deepEqual(rgb(warped.image, 3, 1), rgb(source, 1, 1));
});

test('masked bilinear warp matches the standard warp for visible perspective samples', () => {
  const source = image(6, 5);
  const quad: Quad = [{ x: .5, y: .2 }, { x: 5.8, y: .5 }, { x: 5, y: 4.8 }, { x: .8, y: 4 }];
  const masked = warpQuadMasked(source, quad, 7, 9)!;
  const standard = warpQuad(source, quad, 7, 9)!;
  assert.equal(masked.seenShare, 1);
  assert.deepEqual(masked.image.data, standard.data);
});

test('edge fill does not mark repeated border pixels as observed', () => {
  const source = image(2, 2);
  const quad: Quad = [{ x: -2, y: 0 }, { x: 2, y: 0 }, { x: 2, y: 2 }, { x: -2, y: 2 }];
  const warped = warpQuadMasked(source, quad, 4, 2, 'edge')!;
  assert.equal(warped.seenShare, .5);
  assert.equal(warped.seen[0], 0);
  assert.deepEqual(rgb(warped.image, 0, 1), rgb(source, 0, 1));
});

test('neutral fill uses the caller artwork window and leaves observed pixels untouched', () => {
  const source = image(4, 1);
  const original = source.data.slice();
  const warped = { image: source, seen: new Uint8Array([1, 1, 0, 0]), seenShare: .5 };
  const filled = fillUnseen(warped, 'art-mean', { x: 0, y: 0, w: .25, h: 1 });
  assert.deepEqual(rgb(filled, 3, 0), rgb(source, 0, 0));
  assert.deepEqual(rgb(filled, 1, 0), rgb(source, 1, 0));
  assert.deepEqual(source.data, original);
  assert.throws(() => fillUnseen(warped, 'art-mean'), /art.*window/i);
});

test('unseen artwork uses neutral grey rather than unrelated seen border pixels', () => {
  const source = image(4, 1);
  const warped = { image: source, seen: new Uint8Array([1, 0, 0, 0]), seenShare: .25 };
  const filled = fillUnseen(warped, 'art-mean', { x: .5, y: 0, w: .5, h: 1 });
  assert.deepEqual(rgb(filled, 2, 0), [128, 128, 128, 255]);
  assert.deepEqual(rgb(fillUnseen(warped, 'mean'), 2, 0), rgb(source, 0, 0));
});

test('true frame sides need a clipped selection margin and a quad reaching that edge', () => {
  assert.deepEqual(frameSides(108, 208, { x: 4, y: 4, w: 100, h: 200 }), ['top', 'bottom']);
  assert.deepEqual(frameSides(108, 216, { x: 4, y: 8, w: 100, h: 200 }), []);
  assert.deepEqual(frameSides(108, 216, null), []);
  assert.deepEqual(sidesReached([{ x: 20, y: -.1 }, { x: 90, y: 10 }], 100, 100, ['top', 'right'], 2), ['top']);
});

test('selective detector padding preserves source bytes and reports coordinate offsets', () => {
  const source = image(2, 2);
  const padded = padSides(source, ['left', 'bottom'], 2, 114);
  assert.deepEqual([padded.image.width, padded.image.height, padded.dx, padded.dy], [4, 4, 2, 0]);
  assert.deepEqual(rgb(padded.image, 0, 0), [114, 114, 114, 255]);
  assert.deepEqual(rgb(padded.image, 3, 1), rgb(source, 1, 1));
  assert.deepEqual(rgb(padded.image, 3, 3), [114, 114, 114, 255]);
});

test('degenerate whole-card geometry is rejected', () => {
  const p = { x: 0, y: 0 };
  assert.equal(warpQuadMasked(image(2, 2), [p, p, p, p], 2, 2), null);
});

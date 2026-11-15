import { expect, it } from 'vitest';
import { fieldCardShape } from '../src/field-card-shape';
import { createFieldCalibration, fieldMatPoint, FIELD_ROW, FIELD_ZONE_PITCH } from '../src/field-zones';
import type { DetectedQuad } from '../src/types';

function oblique(compression: number, ratio = 59 / 86, kind: DetectedQuad['kind'] = 'face-up') {
  const height = .8 * FIELD_ZONE_PITCH / FIELD_ROW * 86 / 59 * compression;
  const calibration = createFieldCalibration([
    { x: .1, y: .2 }, { x: .9, y: .2 },
    { x: .9, y: .2 + height }, { x: .1, y: .2 + height },
  ], { playerSide: 'bottom', mirrored: false });
  const w = FIELD_ZONE_PITCH * .65 * ratio / (59 / 86), h = FIELD_ROW * .65;
  const card: DetectedQuad = { kind, confidence: .65, partial: false, quad: [
    { x: .5 - w / 2, y: .5 - h / 2 }, { x: .5 + w / 2, y: .5 - h / 2 },
    { x: .5 + w / 2, y: .5 + h / 2 }, { x: .5 - w / 2, y: .5 + h / 2 },
  ].map(p => fieldMatPoint(p, calibration)) };
  return { card, calibration };
}

it('recognizes a foreshortened front in physical card units', () => {
  const { card, calibration } = oblique(.55);
  expect(fieldCardShape(card, 1000, 1000)).toBe(false);
  expect(fieldCardShape(card, 1000, 1000, calibration)).toBe(true);
});

it('does not grant a new Set admission from the calibrated aspect', () => {
  const { card, calibration } = oblique(.55, 59 / 86, 'face-down');
  expect(fieldCardShape(card, 1000, 1000, calibration)).toBe(false);
});

it('rejects a square on the mat even when the camera makes it narrow', () => {
  const { card, calibration } = oblique(.4, 1);
  expect(fieldCardShape(card, 1000, 1000, calibration)).toBe(false);
});

it('retains a real pixel-shaped card when a manually drawn grid has the wrong aspect', () => {
  const { card } = oblique(1);
  const calibration = createFieldCalibration([{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }]);
  expect(fieldCardShape(card, 1000, 1000, calibration)).toBe(true);
});

import { expect, it } from 'vitest';
import { createFieldCalibration, fieldMatPoint, matRestGeometry, FIELD_ROW, FIELD_ZONE_PITCH } from '../src/field-zones';

it('measures opposite-edge angles in physical units while keeping size in cells', () => {
  const calibration = createFieldCalibration([
    { x: .1, y: .1 }, { x: .9, y: .16 }, { x: .8, y: .9 }, { x: .2, y: .8 },
  ], { playerSide: 'bottom', mirrored: false });
  const offset = Math.tan(12 * Math.PI / 180) * 86;
  const card = { quad: [{ x: 0, y: 0 }, { x: 59, y: 0 }, { x: 59, y: 86 }, { x: -offset, y: 86 }]
    .map(p => fieldMatPoint({ x: .4 + p.x / 59 * FIELD_ZONE_PITCH * .6, y: .4 + p.y / 86 * FIELD_ROW * .6 }, calibration)) };
  const geometry = matRestGeometry(card, calibration);
  expect(geometry?.tilt).toBeCloseTo(12, 7);
  expect(geometry?.size).toBeCloseTo(.6 * Math.sqrt(1 + offset / (2 * 59)), 7);
  expect(geometry?.sides).toBeCloseTo(59 / (59 + offset), 7);
});

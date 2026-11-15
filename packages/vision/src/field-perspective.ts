import { FIELD_ROW, FIELD_ZONE_PITCH, fieldMatPoint, fieldZoneCells, normalizeZoneSpacing } from './field-zones';
import type { FieldCalibration, FieldFormat } from './field-zones';

export interface FieldCameraView {
  /** Smallest / largest local pixel scale, assuming equal slots for 59:86 cards. */
  compression: number;
  /** Advisory only: the inverse projection stretches one direction more than four times the other. */
  tooFlat: boolean;
}

/**
 * Conditioning of the calibrated plane at the playable cell centres. This is a
 * sampling warning, not a camera pose estimate or evidence that a box is a card.
 * An inaccurate grid can also produce a low ratio. Never use it to admit cards.
 */
export function fieldCameraView(
  calibration: FieldCalibration | undefined,
  width: number,
  height: number,
  format: FieldFormat = 'normal',
): FieldCameraView | undefined {
  if (!calibration?.orientation || !Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return;
  const dx = FIELD_ZONE_PITCH * normalizeZoneSpacing(calibration.zoneSpacing) / 59;
  const dy = FIELD_ROW / 86;
  const epsilon = 1e-4;
  let compression = 1;
  for (const cell of fieldZoneCells(format, calibration.zoneSpacing, calibration.zones)) {
    if (['GY', 'BANISHED', 'DECK', 'EXTRA'].includes(cell.zone)) continue;
    const x = cell.x + cell.w / 2, y = cell.y + cell.h / 2;
    const left = fieldMatPoint({ x: x - epsilon, y }, calibration);
    const right = fieldMatPoint({ x: x + epsilon, y }, calibration);
    const top = fieldMatPoint({ x, y: y - epsilon }, calibration);
    const bottom = fieldMatPoint({ x, y: y + epsilon }, calibration);
    // Columns of the pixel Jacobian in the same physical units. Its singular
    // values keep rotation, reflection and overall image scale out of the ratio.
    const a = (right.x - left.x) * width * dx / (2 * epsilon);
    const b = (bottom.x - top.x) * width * dy / (2 * epsilon);
    const c = (right.y - left.y) * height * dx / (2 * epsilon);
    const d = (bottom.y - top.y) * height * dy / (2 * epsilon);
    const trace = a * a + b * b + c * c + d * d, determinant = a * d - b * c;
    const largest = (trace + Math.sqrt(Math.max(0, trace * trace - 4 * determinant * determinant))) / 2;
    if (!Number.isFinite(largest) || largest <= 0 || !Number.isFinite(determinant)) return;
    compression = Math.min(compression, Math.abs(determinant) / largest);
  }
  // Ignore finite-difference roundoff at the fourfold boundary.
  return { compression, tooFlat: compression < .25 - 1e-9 };
}

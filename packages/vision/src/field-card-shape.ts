import { FIELD_ROW, FIELD_ZONE_PITCH, fieldQuarterTurn, normalizeZoneSpacing, onMat, type FieldCalibration } from './field-zones';
import type { DetectedQuad, Point } from './types';

const fits = (quad: Point[]) => {
  if (quad.length !== 4) return false;
  const edge = (a: number, b: number) => Math.hypot(quad[a].x - quad[b].x, quad[a].y - quad[b].y);
  const w = (edge(0, 1) + edge(2, 3)) / 2, h = (edge(1, 2) + edge(3, 0)) / 2;
  const ratio = Math.min(w, h) / Math.max(w, h);
  return ratio >= 59 / 86 * .88 && ratio <= 59 / 86 * 1.12;
};

/** Card outline shape only; identity, face evidence and resting checks still apply. */
export function fieldCardShape(card: DetectedQuad, width: number, height: number, calibration?: FieldCalibration): boolean {
  if (fits(card.quad.map(p => ({ x: p.x * width, y: p.y * height })))) return true;
  const turn = fieldQuarterTurn(calibration, width / height);
  const mat = card.quad.map(p => onMat(p, calibration));
  if (fits(mat.map(p => ({ x: p.x * (turn ? height : width), y: p.y * (turn ? width : height) })))) return true;
  // The inverse projection is in mat fractions, not camera pixels. One slot
  // spans 59 by 86 physical units, independently of the capture dimensions.
  // Keep Set admission unchanged: a grid alone is no evidence of a card back.
  return card.kind === 'face-up' && !!calibration?.orientation && fits(mat.map(p => ({
    x: p.x / (FIELD_ZONE_PITCH * normalizeZoneSpacing(calibration.zoneSpacing)) * 59,
    y: p.y / FIELD_ROW * 86,
  })));
}

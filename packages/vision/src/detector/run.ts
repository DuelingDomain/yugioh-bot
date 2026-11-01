// Ported from mathulbrich/duel-lens f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified: profile geometry and application-neutral contracts. See licenses/duel-lens.LICENSE.
import type { SessionLike, TensorCtor } from '../embed';
import type { RGBAImage } from '../pixels';
import { createCardDetector, type DetectedCard } from './detector';
import { refineCard } from './refine';
import { CARD_DETECTOR } from './spec';
import type { Point } from '../types';
import { clipToConvex, polygonArea } from '../geometry';
export async function detect(session: SessionLike, Tensor: TensorCtor, image: RGBAImage, longSide: number, minScore: number = CARD_DETECTOR.minConfidence): Promise<DetectedCard[]> {
  return createCardDetector({ session, Tensor }).findCards(image, { longSide, minScore });
}

function contains(pts: Point[], p: Point): boolean {
  let sign = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
    if (cross && sign && Math.sign(cross) !== sign) return false;
    if (cross) sign = Math.sign(cross);
  }
  return true;
}
export function chooseCard(cards: DetectedCard[], image: RGBAImage, click?: Point): DetectedCard | undefined {
  const p = { x: (click?.x ?? .5) * image.width, y: (click?.y ?? .5) * image.height };
  const found = cards.filter(b => contains(b.pts.map(([x, y]) => ({ x, y })), p));
  if (found.length) return found.sort((a, b) => (a.w * a.h) - (b.w * b.h))[0];
  // Do not select a different card elsewhere on the table when the click misses.
  return click ? undefined : cards.filter(b => b.kind === 'face-up').sort((a, b) => Math.hypot(a.cx - p.x, a.cy - p.y) - Math.hypot(b.cx - p.x, b.cy - p.y))[0];
}
export function refinedCorners(card: DetectedCard, image: RGBAImage): Point[] {
  const refined = refineCard(image, card);
  // Preserve upstream edge-fit tilt as well as full side/corner refinement.
  const pts = refined.refined !== 'none' ? refined.pts : card.pts;
  const quad = pts.map(([x, y]) => ({ x, y }));
  const area = polygonArea(quad);
  if (!Number.isFinite(area) || area < 16 || area > image.width * image.height * 1.2 || clipToConvex(quad, [{x:0,y:0},{x:image.width,y:0},{x:image.width,y:image.height},{x:0,y:image.height}]).length < 3) return [];
  return quad;
}

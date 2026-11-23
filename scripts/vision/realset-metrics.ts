import { polygonIou, type Point, type Quad } from '../../packages/vision/src/geometry';
import type { RecognitionTier } from '../../packages/vision/src/types';
import { stats } from './recording-lib';
import type { FrameLabels } from './realset-schema';

export const MATCH_IOU = .5;
export interface Prediction {
  quad: Point[];
  faceDown: boolean;
  tier: RecognitionTier;
  cardId?: string;
  name?: string;
  stage?: 'first' | 'second';
}

const nameKey = (name?: string) => name?.normalize('NFC').trim().toLowerCase().replace(/\s+/g, ' ');
function contains(quad: Quad, p: Point) {
  return quad.every((a, i) => {
    const b = quad[(i + 1) % 4];
    return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) >= 0;
  });
}

export function scoreFrame(frame: FrameLabels, predictions: Prediction[], ms: number) {
  const verified = frame.cards.filter(card => card.status === 'verified');
  const uncertain = frame.cards.filter(card => card.status === 'uncertain');
  const overlaps = verified.flatMap((card, label) => predictions.map((p, detection) => ({
    label, detection, iou: polygonIou(card.quad, p.quad),
  }))).filter(pair => pair.iou >= MATCH_IOU).sort((a, b) => b.iou - a.iou);
  const assigned = new Map<number, number>(), owner = new Map<number, number>();
  for (const pair of overlaps) {
    if (assigned.has(pair.label) || owner.has(pair.detection)) continue;
    assigned.set(pair.label, pair.detection);
    owner.set(pair.detection, pair.label);
  }
  // Preserve the best-overlap pairs unless reassigning them can match an extra card.
  const augment = (label: number, seen: Set<number>): boolean => {
    for (const pair of overlaps) {
      if (pair.label !== label || seen.has(pair.detection)) continue;
      seen.add(pair.detection);
      const previous = owner.get(pair.detection);
      if (previous !== undefined && !augment(previous, seen)) continue;
      assigned.set(label, pair.detection);
      owner.set(pair.detection, label);
      return true;
    }
    return false;
  };
  for (const [label] of verified.entries()) {
    if (!assigned.has(label)) augment(label, new Set());
  }
  const matches = verified.map((label, i) => {
    const index = assigned.get(i), prediction = index === undefined ? null : predictions[index];
    const rightName = label.face === 'up' && !!prediction && !prediction.faceDown &&
      (label.cardId === prediction.cardId || (!!prediction.name && nameKey(label.name) === nameKey(prediction.name)));
    const sure = !!prediction && !prediction.faceDown && !!prediction.cardId && prediction.tier === 'sure';
    return { label, prediction, rightName, sure };
  });
  const unpaired = predictions.flatMap((prediction, index) => {
    if (owner.has(index)) return [];
    const center = prediction.quad.reduce((p, q) => ({ x: p.x + q.x / 4, y: p.y + q.y / 4 }), { x: 0, y: 0 });
    const duplicate = overlaps.some(pair => pair.detection === index);
    const ignored = !duplicate && (frame.ignore.some(region => contains(region, center)) ||
      uncertain.some(card => polygonIou(card.quad, prediction.quad) >= MATCH_IOU));
    return [{ prediction, ignored }];
  });
  return { clip: frame.clip, atMs: frame.atMs, file: frame.file, ms, uncertainCards: uncertain.length, matches, unpaired };
}

export function summarize(frames: ReturnType<typeof scoreFrame>[]) {
  const matches = frames.flatMap(frame => frame.matches);
  const fronts = matches.filter(m => m.label.face === 'up'), backs = matches.filter(m => m.label.face === 'down');
  const counted = (count: number, total: number) => ({ count, total, rate: total ? count / total : null });
  const phantoms = frames.map(frame => frame.unpaired.filter(row => !row.ignored).length);
  return {
    frames: frames.length,
    top1: counted(fronts.filter(m => m.rightName).length, fronts.length),
    sureWrong: counted(fronts.filter(m => m.sure && !m.rightName).length, fronts.length),
    notSure: counted(fronts.filter(m => !m.sure).length, fronts.length),
    missed: fronts.filter(m => !m.prediction).length,
    phantoms: phantoms.reduce((sum, n) => sum + n, 0),
    sureNamedPhantoms: frames.reduce((sum, f) => sum + f.unpaired.filter(row =>
      !row.ignored && !row.prediction.faceDown && !!row.prediction.cardId && row.prediction.tier === 'sure').length, 0),
    phantomFrames: counted(phantoms.filter(n => n > 0).length, frames.length),
    faceDown: counted(backs.filter(m => m.prediction?.faceDown).length, backs.length),
    faceDownSureNames: backs.filter(m => m.sure).length,
    uncertainCards: frames.reduce((sum, f) => sum + f.uncertainCards, 0),
    frameMs: stats(frames.map(f => f.ms), 2),
  };
}

import { isCovered } from './board';
import { fieldAppearanceDistance, type FieldAnalysis } from './field-motion';
import { matRestGeometry, quadIou, type FieldCalibration, type FieldFormat } from './field-zones';
import { hitTestQuad } from './scene';
import type { DetectedQuad, Point } from './types';

const REST_MS = 120;
const sameLook = (a?: number[], b?: number[]) => fieldAppearanceDistance(a, b) < .006;
const handFree = (frame: FieldAnalysis, card: DetectedQuad) =>
  (frame.touched?.(card) ?? 0) <= .035 && frame.edgeGrip?.(card) !== 'grip';

type Identity = { cardId: number; name: string };
type Track = {
  card: DetectedQuad;
  look: number[];
  blockedLook?: number[];
  stillSince?: number;
  ready: boolean;
  attempted: boolean;
  identity?: Identity;
};

/** Browser-local names for current face-up field tracks. Each new front gets one speculative read. */
export function createTapPreread(calibration: FieldCalibration, format: FieldFormat) {
  let tracks: Track[] = [];
  const currentFront = (track: Track, frame: FieldAnalysis) => {
    if (!track.ready || frame.motion(track.card) > .025 || !handFree(frame, track.card)) return false;
    const look = frame.appearance?.(track.card);
    return sameLook(track.look, look) && !sameLook(track.blockedLook, look);
  };

  const publicFront = (card: DetectedQuad, outlines: DetectedQuad[]) => {
    if (!calibration.orientation || card.kind !== 'face-up' || card.confidence < .7 || card.partial || card.covered || card.kept) return false;
    const rest = matRestGeometry(card, calibration, format);
    return !!rest && /^(?:[MS][1-5]|EMZ[12]|FIELD)$/.test(rest.zone) && rest.size <= 1.2 &&
      rest.cellShare >= .5 && rest.tilt <= 14 && rest.sides >= .78 &&
      !isCovered(card, outlines);
  };

  return {
    sample(frame: FieldAnalysis, at: number, outlines?: DetectedQuad[]) {
      if (outlines) {
        const unmatched = new Set(tracks);
        tracks = outlines.flatMap(card => {
          if (!publicFront(card, outlines)) return [];
          const look = frame.appearance?.(card);
          if (!look?.length) return [];
          const previous = [...unmatched].find(track => quadIou(track.card, card) >= .65 && sameLook(track.look, look));
          if (!previous) return [{ card, look, ready:false, attempted:false }];
          unmatched.delete(previous);
          previous.card = card;
          return [previous];
        });
      }
      let changed = false;
      for (const track of tracks) {
        const look = frame.appearance?.(track.card);
        const clear = handFree(frame, track.card);
        // A motionless hand can become part of the analyzer's background. Wait for its pixels to leave.
        if (!clear) track.blockedLook = look;
        const resting = clear && frame.motion(track.card) <= .025 && !sameLook(track.blockedLook, look);
        const same = resting && sameLook(track.look, look);
        if (resting && !same) changed = true;
        track.stillSince = same ? track.stillSince ?? at : undefined;
        track.ready = track.stillSince !== undefined && at - track.stillSince >= REST_MS;
      }
      return changed;
    },
    next: (tracked = (_card: DetectedQuad) => false) => tracks.find(track => track.ready && !track.attempted && !tracked(track.card)),
    currentFront,
    finish(track: Track, identity?: Identity) {
      track.attempted = true;
      track.identity = identity;
    },
    hit(point: Point, frame: FieldAnalysis) {
      const track = tracks[hitTestQuad(tracks.map(track => track.card), point)];
      if (track?.identity && currentFront(track, frame)) return track;
    },
  };
}

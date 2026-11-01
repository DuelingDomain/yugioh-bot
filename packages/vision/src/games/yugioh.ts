// Geometry adapted from Duel Lens src/shared/card-layout.ts (Apache-2.0).
// Modified: expressed as a data-only game profile. See ../licenses/duel-lens.LICENSE.
import { duelLensModel } from '../models';
import type { GameProfile } from '../types';
export const yugioh: GameProfile = {
  id: 'yugioh', card: { width: 59, height: 86, warpWidth: 295, warpHeight: 430 },
  artWindow: { x: 0.118, y: 0.181, w: 0.765, h: 0.525 },
  cardBack: { cardId: '__card_back__', imageUrl: '/duel/card-back-main-hd.webp' },
  frameClasses: [
    { id: 'Fusion', rgb: [139, 91, 165] }, { id: 'Synchro', rgb: [215, 213, 206] },
    { id: 'Xyz', rgb: [48, 47, 47] }, { id: 'Link', rgb: [32, 101, 171] },
    { id: 'Ritual', rgb: [100, 152, 196] }, { id: 'Pendulum', rgb: [89, 155, 134] },
    { id: 'Normal', rgb: [199, 163, 94] }, { id: 'Effect', rgb: [182, 121, 74] },
    { id: 'Spell', rgb: [36, 147, 125] }, { id: 'Trap', rgb: [177, 73, 132] },
  ],
  borderSamples: [{ x: 0.08, y: 0.07, w: 0.84, h: 0.055 }, { x: 0.025, y: 0.23, w: 0.04, h: 0.37 }, { x: 0.935, y: 0.23, w: 0.04, h: 0.37 }],
  textBoxColor: [226, 214, 186],
  embedding: duelLensModel,
  detector: { url: '/dev/vision-assets/models/card-detector.onnx', sha256: '542a03b523cb1398a1b5437dae665908b3bdf61be9b30a2a52e7bcea25dce03c', longSide: 960 },
  indexUrl: '/dev/vision-assets/yugioh-index.bin', metaUrl: '/dev/vision-assets/yugioh-index.meta.json',
  fullArtIndex: { indexUrl: '/dev/vision-assets/yugioh-full-art.bin', metaUrl: '/dev/vision-assets/yugioh-full-art.meta.json' },
  fallbackHeight: 0.65,
};

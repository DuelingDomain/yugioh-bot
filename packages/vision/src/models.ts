// Ported from mathulbrich/duel-lens at f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified for game profiles and a browser worker. See licenses/duel-lens.LICENSE.
import type { EmbeddingModelSpec } from './types';
export const duelLensModel: EmbeddingModelSpec = {
  thresholds: { score: .8, margin: .02, floor: .74, second: { score: .73, margin: .1 }, cardBackMargin: .1 },
  maxBatch: 1,
  id: 'dinov2-small-duel', url: '/dev/vision-assets/models/dinov2-small-duel.q8.onnx',
  sha256: '02d9720530ff488397ad7db66423199dbd7a406b264b866eb695cdc59c638bee',
  inputSize: 224, dim: 384, inputName: 'pixel_values', outputName: 'embedding', pooling: 'none',
  mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
};

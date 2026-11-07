// Ported from mathulbrich/duel-lens at f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified for game profiles and a browser worker. See licenses/duel-lens.LICENSE.
import type { EmbeddingModelSpec } from './types';
import { dinov2SmallDuelCheck } from './gpu-check-reference';
export const duelLensModel: EmbeddingModelSpec = {
  thresholds: { score: .8, margin: .02, floor: .74, second: { score: .73, margin: .1 }, cardBackMargin: .1 },
  maxBatch: 1,
  webgpu: {url:'/dev/vision-assets/models/dinov2-small-duel.fp16.onnx',sha256:'5408cd4d51e03e57a247f9718ea73ad850af672bd27332d6fd88e6a765c80471',fp32:{url:'/dev/vision-assets/models/dinov2-small-duel.fp32.onnx',sha256:'b7cbd523407bca057a5e305f3a40750c6bf0fb58829361c43e9a51255211e2bb'}},
  // A correct fp16 run is about 0.999+ of the float32 vector, a wrong one far below (scripts/vision/gpu-check-reference.ts prints both).
  gpuCheck: { reference: dinov2SmallDuelCheck.values, minCosine: .99 },
  id: 'dinov2-small-duel', url: '/dev/vision-assets/models/dinov2-small-duel.q8.onnx',
  sha256: '02d9720530ff488397ad7db66423199dbd7a406b264b866eb695cdc59c638bee',
  inputSize: 224, dim: 384, inputName: 'pixel_values', outputName: 'embedding', pooling: 'none',
  mean: [0.485, 0.456, 0.406], std: [0.229, 0.224, 0.225],
};

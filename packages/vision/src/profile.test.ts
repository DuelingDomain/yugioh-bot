import test from 'node:test';
import assert from 'node:assert/strict';
import { yugioh } from './games/yugioh';
import { layoutKey } from './profile';

// Exact identity stored in the production index built on 2026-11-01.
const productionLayoutKey = '{"version":"triangle-rgb-chw-v1","card":{"width":59,"height":86,"warpWidth":295,"warpHeight":430},"artWindow":{"x":0.118,"y":0.181,"w":0.765,"h":0.525},"embedding":{"id":"dinov2-small-duel","url":"/dev/vision-assets/models/dinov2-small-duel.q8.onnx","sha256":"02d9720530ff488397ad7db66423199dbd7a406b264b866eb695cdc59c638bee","inputSize":224,"dim":384,"inputName":"pixel_values","outputName":"embedding","pooling":"none","mean":[0.485,0.456,0.406],"std":[0.229,0.224,0.225]}}';

test('Yu-Gi-Oh layout key matches the published production index byte for byte', () => {
  assert.equal(layoutKey(yugioh), productionLayoutKey);
});

test('runtime embedding options do not change the layout key', () => {
  const embedding = {
    ...yugioh.embedding,
    gpuCheck: { reference: [0.6, 0.8], minCosine: 0.95 },
    webgpu: { url: '/runtime-model.onnx', sha256: 'runtime-model-sha256' },
    thresholds: { score: 0.9, margin: 0.04, floor: 0.8 },
    maxBatch: 4,
    futureRuntimeOption: true,
  };
  assert.equal(layoutKey({ ...yugioh, embedding }), layoutKey(yugioh));
});

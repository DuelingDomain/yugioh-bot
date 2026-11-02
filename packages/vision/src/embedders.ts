import { yugioh } from './games/yugioh';
import type { EmbeddingModelSpec, GameProfile } from './types';

export type IdentityEmbedder = 'dinov2-small-duel' | 'dinov3-small';
export const DINO_V3_MANIFEST = '/dev/vision-assets/models/dinov3-small.json';

/** The generated manifest pins the actual acquired graph, including its output contract. */
export function yugiohDinoV3(model: EmbeddingModelSpec): GameProfile {
  if (model.id !== 'dinov3-small' || !/^[a-f0-9]{64}$/.test(model.sha256) ||
      model.url !== '/dev/vision-assets/models/dinov3-small.q8.onnx' ||
      model.dim !== 384 || model.inputSize !== 224 || model.inputName !== 'pixel_values' ||
      !['none', 'cls'].includes(model.pooling) || !['embedding', 'pooler_output', 'last_hidden_state'].includes(model.outputName) ||
      JSON.stringify(model.mean) !== JSON.stringify(yugioh.embedding.mean) ||
      JSON.stringify(model.std) !== JSON.stringify(yugioh.embedding.std)) {
    throw new Error('Invalid DINOv3 manifest. Run scripts/vision/prepare-dinov3.py.');
  }
  return {
    ...yugioh, embedding: { ...model, maxBatch: 1, thresholds: { ...yugioh.embedding.thresholds } },
    indexUrl: '/dev/vision-assets/yugioh-index-v3.bin',
    metaUrl: '/dev/vision-assets/yugioh-index-v3.meta.json',
    // DINOv2 calibration and whole-card vectors belong to its own embedding space.
    thresholdsUrl: undefined, fullArtIndex: undefined,
  };
}

export async function loadYugiohProfile(embedder: IdentityEmbedder, fetchFile: typeof fetch = fetch, signal?: AbortSignal): Promise<GameProfile> {
  if (embedder === 'dinov2-small-duel') return yugioh;
  if (embedder !== 'dinov3-small') throw new Error(`Unsupported embedder: ${embedder}`);
  const response = await fetchFile(DINO_V3_MANIFEST, { cache: 'no-store', signal });
  if (!response.ok) throw new Error('DINOv3 is not prepared. Accept the Hugging Face licence, set HF_TOKEN in ~/.config/yugioh-vision/bakeoff.env, then run prepare-dinov3.py and build-index-v3.ts.');
  return yugiohDinoV3(await response.json());
}

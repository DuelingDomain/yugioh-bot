import { duelLensModel } from './models';
import { fullArtProfile } from './full-art';
import type { EmbeddingModelSpec, GameProfile } from './types';

export const DUELSIGHT_RULE = { score:.68, margin:.06 } as const;
export const duelSightModel:EmbeddingModelSpec = {
  id:'duelsight-862aec0f937da326', referenceTag:'duelsight-862aec0f937da326',
  url:'/dev/vision-assets/hybrid/recognizer.onnx',
  sha256:'0722ca4a2b9e76b37f3e0d32b78bb1d9afd5d040d219de3560a322c98a966d79',
  inputSize:128,dim:128,inputName:'crops',outputName:'embeddings',pooling:'none',maxBatch:1,
  mean:[.5,.5,.5],std:[.5,.5,.5],preprocessing:'full128',
  thresholds:{...DUELSIGHT_RULE,floor:.68},
};
export const lightModel:EmbeddingModelSpec = {
  ...duelLensModel, id:'dinov2-small-duel-v3b-light',referenceTag:'dinov2-small-duel-v3b-light',
  url:'/dev/vision-assets/hybrid/light.onnx',
  sha256:'b82ad6b73f4965f5fbe5aa850de7a5e78f8819348b15b02402d2cdbc112e497c',
  webgpu:undefined,gpuCheck:undefined,
  cropSizeRounding:true,
};
export const HYBRID_ASSETS = {
  bank:{url:'/dev/vision-assets/hybrid/bank.bin',sha256:'cc3e74968039c687a65e4fc7b0ddfc291dcc8e879973010f2da114b5cd3949ab'},
  index:{url:'/dev/vision-assets/hybrid/light.bin',sha256:'c4dcfa1503f6e26b98b960f1d3c6d10df2e8b55812a4181be1842d20097ba923'},
  // Deterministically prepared from the pinned catalogs and v3b metadata (prepare-hybrid.ts).
  catalog:{url:'/dev/vision-assets/hybrid/catalog.json',sha256:'5b2e6781d2337bbe8233f76532f76990f22ec7f63d9c6e9e0aeb78501d555578'},
  meta:{url:'/dev/vision-assets/hybrid/light.meta.json',sha256:'5d4ba62c8af9a024fae492801d9aa59287ddcf68bd0d54b0f617ebdbefb3a6b2'},
} as const;
export function hybridProfiles(profile:GameProfile) {
  const common={...profile,thresholdsUrl:undefined,fullArtIndex:undefined};
  return {
    first:{...fullArtProfile(common),embedding:duelSightModel},
    second:{...common,embedding:{...lightModel,thresholds:profile.embedding.thresholds}},
  };
}

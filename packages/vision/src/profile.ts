import type { GameProfile, IndexMeta } from './types';
/** Change when pixel preprocessing changes. Embedded in metadata to reject incompatible indexes. */
export function layoutKey(profile: GameProfile): string {
  // Allowlist vector identity/preprocessing fields so runtime options cannot invalidate indexes.
  // Keep this order stable: published metadata compares the serialized key byte for byte.
  const { id, url, sha256, inputSize, dim, inputName, outputName, pooling, mean, std } = profile.embedding;
  const embedding = { id, url, sha256, inputSize, dim, inputName, outputName, pooling, mean, std,...(profile.embedding.preprocessing?{preprocessing:profile.embedding.preprocessing}:{}),...(profile.embedding.cropSizeRounding?{cropSizeRounding:true}:{}) };
  return JSON.stringify({ version: 'triangle-rgb-chw-v1', card: profile.card, artWindow: profile.artWindow, alternate: profile.alternateArtWindows, embedding });
}
export function validateIndexProfile(meta: IndexMeta, profile: GameProfile): void {
  if (meta.gameId !== profile.id || meta.modelId !== profile.embedding.id || meta.modelSha256 !== profile.embedding.sha256 || meta.dim !== profile.embedding.dim || meta.layoutKey !== layoutKey(profile)) throw new Error('Index and game/model/preprocessing profile do not match; rebuild the index');
}

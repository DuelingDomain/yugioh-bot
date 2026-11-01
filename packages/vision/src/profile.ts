import type { GameProfile, IndexMeta } from './types';
/** Change when pixel preprocessing changes. Embedded in metadata to reject incompatible indexes. */
export function layoutKey(profile: GameProfile): string {
  const { thresholds: _thresholds, maxBatch: _maxBatch, ...embedding } = profile.embedding;
  return JSON.stringify({ version: 'triangle-rgb-chw-v1', card: profile.card, artWindow: profile.artWindow, alternate: profile.alternateArtWindows, embedding });
}
export function validateIndexProfile(meta: IndexMeta, profile: GameProfile): void {
  if (meta.gameId !== profile.id || meta.modelId !== profile.embedding.id || meta.modelSha256 !== profile.embedding.sha256 || meta.dim !== profile.embedding.dim || meta.layoutKey !== layoutKey(profile)) throw new Error('Index and game/model/preprocessing profile do not match; rebuild the index');
}

// Ported from mathulbrich/duel-lens at f6968f3682d53a79c4a9fef591300615eda61c11 (Apache-2.0).
// Modified for game profiles and a browser worker. See licenses/duel-lens.LICENSE.
import { encodeIndex } from './index-format';
import type { IndexEntry, IndexMeta } from './types';
/** int8-quantise L2-normalised vectors; entries[i] describes vectors[i]. */
export function buildIndexArtefacts(
  entries: IndexEntry[],
  vectors: Float32Array[],
  info: Omit<IndexMeta, 'dim' | 'count' | 'dtype' | 'entries'>,
): { bin: Uint8Array; metaJson: string } {
  if (vectors.length === 0) throw new Error('Cannot build an empty index');
  if (entries.length !== vectors.length) {
    throw new Error(`Got ${entries.length} entries for ${vectors.length} vectors`);
  }
  const dim = vectors[0].length;
  const count = vectors.length;
  const all = new Int8Array(dim * count);
  vectors.forEach((v, i) => {
    if (v.length !== dim) throw new Error(`Vector ${i} has dim ${v.length}, expected ${dim}`);
    all.set(Int8Array.from(v, x => Math.round(Math.max(-1, Math.min(1, x)) * 127)), i * dim);
  });
  const meta: IndexMeta = { ...info, dim, count, dtype: 'int8', quant: 'int8', builtAt: info.generatedAt, entries };
  return { bin: new Uint8Array(encodeIndex(all, meta)), metaJson: JSON.stringify(meta) };
}

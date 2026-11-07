// Binary header adapted from Duel Lens src/shared/index-format.ts (Apache-2.0).
// Modified: game-neutral metadata, strict validation. See licenses/duel-lens.LICENSE.
import type { IndexMeta, LoadedIndex } from './types';
const HEADER = 20;
export function encodeIndex(vectors: Float32Array | Int8Array, meta: IndexMeta): ArrayBuffer {
  if (vectors.length !== meta.count * meta.dim || (vectors instanceof Int8Array) !== (meta.dtype === 'int8')) throw new Error('Index shape/type mismatch');
  const bytes = new Uint8Array(HEADER + vectors.byteLength);
  bytes.set([89, 71, 73, 88]);
  const view = new DataView(bytes.buffer);
  [1, meta.dim, meta.count, meta.dtype === 'int8' ? 1 : 0].forEach((n, i) => view.setUint32(4 + 4 * i, n, true));
  if (vectors instanceof Int8Array) bytes.set(new Uint8Array(vectors.buffer, vectors.byteOffset, vectors.byteLength), HEADER);
  else for (let i = 0; i < vectors.length; i++) view.setFloat32(HEADER + i * 4, vectors[i], true);
  return bytes.buffer;
}
export function decodeIndex(bin: ArrayBuffer, meta: IndexMeta): LoadedIndex {
  const view = new DataView(bin);
  if (bin.byteLength < HEADER || view.getUint32(0, true) !== 0x58494759 || view.getUint32(4, true) !== 1) throw new Error('Invalid vision index');
  const dim = view.getUint32(8, true), count = view.getUint32(12, true), quant = view.getUint32(16, true);
  if (meta.version !== 1 || !dim || !count || dim !== meta.dim || count !== meta.count || count !== meta.entries.length || quant > 1 || (quant === 1) !== (meta.dtype === 'int8') || bin.byteLength !== HEADER + count * dim * (quant ? 1 : 4)) throw new Error('Index metadata/size mismatch');
  const vectors = quant ? new Int8Array(bin, HEADER) : Float32Array.from({ length: dim * count }, (_, i) => view.getFloat32(HEADER + i * 4, true));
  if (vectors.some(v => !Number.isFinite(v))) throw new Error('Non-finite index vector');
  return { meta, vectors };
}

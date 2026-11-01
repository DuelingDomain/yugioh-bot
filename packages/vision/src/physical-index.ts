import type { IndexEntry, LoadedIndex } from './types';

export const PHYSICAL_INDEX_POLICY = 'physical-v1';
const physicalFrames = new Set(['Normal','Effect','Ritual','Fusion','Synchro','Xyz','Link','Pendulum','Spell','Trap']);
export function catalogCardId(entry?: IndexEntry): number | undefined {
  if (!entry || !/^\d+$/.test(entry.cardId)) return;
  const id=Number(entry.cardId);
  return Number.isSafeInteger(id) && id>0 && id<=0xffffffff ? id : undefined;
}
export function isPhysicalEntry(entry: IndexEntry): boolean {
  if(entry.cardId==='__card_back__')return true;
  if(!catalogCardId(entry) || /\bskill(?: card)?\b/i.test(entry.name))return false;
  // Field Tokens have catalog IDs even when no printed passcode exists.
  if(/\btoken\b/i.test(entry.name) && !entry.frameClass)return true;
  return entry.passcode>0 && physicalFrames.has(entry.frameClass??'');
}
/** Filter locally: never mutate a shared/hardlinked on-disk index or re-embed art.
 * Duplicate image IDs cannot compete as different cards. Alternate art is kept.
 */
export function filterPhysicalIndex(index: LoadedIndex): LoadedIndex {
  const rows:number[]=[], images=new Set<number>();
  index.meta.entries.forEach((entry,row)=>{
    if(!isPhysicalEntry(entry) || (entry.imageId!==undefined && images.has(entry.imageId)))return;
    if(entry.imageId!==undefined)images.add(entry.imageId);
    rows.push(row);
  });
  if(rows.length===index.meta.count)return index;
  const vectors=index.vectors instanceof Int8Array?new Int8Array(rows.length*index.meta.dim):new Float32Array(rows.length*index.meta.dim);
  rows.forEach((row,i)=>vectors.set(index.vectors.subarray(row*index.meta.dim,(row+1)*index.meta.dim),i*index.meta.dim));
  return {meta:{...index.meta,count:rows.length,entries:rows.map(row=>index.meta.entries[row])},vectors};
}

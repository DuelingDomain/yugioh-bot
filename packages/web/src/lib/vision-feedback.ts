import { readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createVisionFeedbackService, type VisionFeedbackInput } from '@yugidraft/shared/services';
import { indexVersion } from '../../../vision/src/learning';
import type { IndexMeta } from '@yugidraft/vision';
import { getDb } from './db';
import { webOrigin } from './existing-player';
export const feedbackService=()=>createVisionFeedbackService(getDb());
export const feedbackJson=(value:unknown,status=200)=>Response.json(value,{status,headers:{'cache-control':'private, no-store'}});
export function feedbackOrigin(request:Request):boolean {
  try{return request.headers.get('origin')===webOrigin();}catch{return false;}
}
/** Validate IDs and model/index identity against server assets, never a caller's claimed catalog. */
export async function validFeedbackIndex(value:unknown):Promise<boolean> {
  if(!value||typeof value!=='object')return false;
  const s=value as VisionFeedbackInput;
  if(!['art-box','whole-card'].includes(s.space))return false;
  const root=resolve(process.env.VISION_DATA_DIR??join(process.cwd(),'../../data/vision'));
  try {
    const meta:IndexMeta=JSON.parse(await readFile(join(root,s.space==='whole-card'?'yugioh-full-art.meta.json':'yugioh-index.meta.json'),'utf8'));
    const ids=new Set(meta.entries.map(e=>e.cardId));
    // Results merge both indexes. The vector must match its own space, while
    // labels/alternatives may belong to either catalog.
    try {const other:IndexMeta=JSON.parse(await readFile(join(root,s.space==='whole-card'?'yugioh-index.meta.json':'yugioh-full-art.meta.json'),'utf8'));if(other.gameId===meta.gameId&&other.modelSha256===meta.modelSha256)for(const e of other.entries)ids.add(e.cardId);}catch{}
    return s.gameId===meta.gameId&&s.modelId===meta.modelId&&s.modelSha256===meta.modelSha256&&s.layoutKey===meta.layoutKey&&s.indexVersion===indexVersion(meta)&&Array.isArray(s.embedding)&&s.embedding.length===meta.dim&&ids.has(s.chosenCardId)&&Array.isArray(s.top5)&&s.top5.every(c=>ids.has(c.cardId));
  }catch{return false;}
}

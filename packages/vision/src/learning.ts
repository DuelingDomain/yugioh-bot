import type { Candidate, IndexMeta, LoadedIndex, RecognitionPriors, IndexEntry } from './types';
import { topK } from './search';
export type EmbeddingSpace = 'art-box' | 'whole-card';
export interface LearningSnapshot {
  version:string;
  references:{cardId:string;embedding:number[];space:EmbeddingSpace}[];
  confusions:{a:string;b:string}[];
}
export const emptyLearning = ():LearningSnapshot=>({version:'empty',references:[],confusions:[]});
/** Binds feedback to the exact published index generation as well as its weights. */
export function indexVersion(meta:IndexMeta):string {
  return `${meta.modelSha256}:${meta.builtAt??meta.generatedAt??meta.catalog??'unversioned'}:${meta.count}`;
}
export function learnedTopK(query:Float32Array,index:LoadedIndex,learning:LearningSnapshot,space:EmbeddingSpace,k=5,priors?:RecognitionPriors,frameClass?:string,catalog?:Map<string,IndexEntry>):Candidate[] {
  if(!learning.references.length)return topK(query,index,k,priors,frameClass);
  // References may only rerank identities supported by the clean top ten.
  const clean=topK(query,index,Math.max(10,k));
  const allowed=new Set(clean.slice(0,10).map(c=>c.cardId)), counts=new Map<string,number>();
  const refs=learning.references.filter(r=>{
    const count=counts.get(r.cardId)??0;
    if(r.space!==space || !allowed.has(r.cardId) || r.embedding.length!==index.meta.dim || !r.embedding.every(Number.isFinite) || count>=8 || learning.confusions.some(p=>p.a===r.cardId||p.b===r.cardId))return false;
    counts.set(r.cardId,count+1);return true;
  });
  const ranked=topK(query,index,Math.max(10,k),priors,frameClass);
  if(!refs.length)return ranked.slice(0,k);
  const byId=catalog??new Map(index.meta.entries.map(e=>[e.cardId,e]));
  const valid=refs.filter(r=>byId.has(r.cardId));
  const delta:LoadedIndex={meta:{...index.meta,dtype:'float32',count:valid.length,entries:valid.map(r=>byId.get(r.cardId)!)},vectors:Float32Array.from(valid.flatMap(r=>r.embedding))};
  const learned=new Map(topK(query,delta,10).filter(c=>c.score>=.9).map(c=>[c.cardId,c.score]));
  return ranked.map(c=>({...c,score:Math.max(c.score,learned.get(c.cardId)??-Infinity)})).sort((a,b)=>b.score-a.score).slice(0,k);
}

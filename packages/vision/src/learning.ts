import type { Candidate, IndexMeta, LoadedIndex, RecognitionPriors } from './types';
import { mergeCandidates, topK } from './search';
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
export function learnedTopK(query:Float32Array,index:LoadedIndex,learning:LearningSnapshot,space:EmbeddingSpace,k=5,priors?:RecognitionPriors,frameClass?:string):Candidate[] {
  const refs=learning.references.filter(r=>r.space===space&&r.embedding.length===index.meta.dim);
  if(!refs.length)return topK(query,index,k,priors,frameClass);
  const entries=refs.map(r=>index.meta.entries.find(e=>e.cardId===r.cardId)).filter(e=>e!==undefined);
  const valid=refs.filter(r=>entries.some(e=>e.cardId===r.cardId));
  const delta:LoadedIndex={meta:{...index.meta,dtype:'float32',count:valid.length,entries:valid.map(r=>entries.find(e=>e.cardId===r.cardId)!)},vectors:Float32Array.from(valid.flatMap(r=>r.embedding))};
  return mergeCandidates([topK(query,index,k,priors,frameClass),topK(query,delta,k,priors,frameClass)],k);
}

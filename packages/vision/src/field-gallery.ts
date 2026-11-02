import type {RecognitionResult} from './types';
import {fieldEmbeddingSimilarity} from './field-motion';

type Embedding=NonNullable<RecognitionResult['identityEmbedding']>;
export interface FieldIdentityEntry {embedding:Embedding;cardId?:string}
export type FieldIdentityMatch={kind:'match';cardId?:string}|{kind:'hold'}|{kind:'new'};
/** Duel-local visual identities. Entries deliberately contain no physical refs or zones. */
export function createFieldIdentityGallery(saved:unknown=[],changed?:()=>void) {
  const valid=(v:any):v is FieldIdentityEntry=>v&&['art-box','whole-card'].includes(v.embedding?.space)&&Array.isArray(v.embedding?.values)&&v.embedding.values.length>0&&v.embedding.values.length<=4096&&v.embedding.values.every(Number.isFinite)&&(v.cardId===undefined||typeof v.cardId==='string');
  const entries:FieldIdentityEntry[]=Array.isArray(saved)?saved.filter(valid).map(v=>structuredClone(v)):[];
  return {
    entries:()=>structuredClone(entries),
    resolve(embedding?:Embedding):FieldIdentityMatch {
      if(!embedding)return {kind:'new'};
      const scores=entries.map(entry=>({entry,score:fieldEmbeddingSimilarity(entry.embedding,embedding)??-1}));
      const matches=scores.filter(v=>v.score>=.84),identities=new Set(matches.map(v=>v.entry.cardId));
      if(identities.size===1)return {kind:'match',cardId:matches[0].entry.cardId};
      return matches.length||scores.some(v=>v.score>.68)?{kind:'hold'}:{kind:'new'};
    },
    remember(embedding:Embedding|undefined,cardId?:string) {
      if(!embedding||!valid({embedding,cardId}))return;
      // A deliberate correction replaces conflicting answers for the same appearance.
      for(let i=entries.length-1;i>=0;i--)if((fieldEmbeddingSimilarity(entries[i].embedding,embedding)??-1)>=.84)entries.splice(i,1);
      entries.push({embedding:structuredClone(embedding),...(cardId?{cardId}:{})});changed?.();
    },
  };
}
export type FieldIdentityGallery=ReturnType<typeof createFieldIdentityGallery>;

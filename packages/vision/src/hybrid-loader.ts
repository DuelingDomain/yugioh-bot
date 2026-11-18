import { fetchModelChecked } from './model-cache';
import { createModelSession, Tensor, type ModelSession } from './runtime';
import { RecognitionPipeline } from './pipeline';
import { HybridPipeline } from './hybrid';
import { HYBRID_ASSETS, hybridProfiles } from './hybrid-models';
import { parseBankBinary } from './duelsight/bank';
import { decodeIndex } from './index-format';
import { validateIndexProfile, layoutKey } from './profile';
import type { IndexEntry, IndexMeta, LoadedIndex } from './types';

export async function openHybrid(args:ConstructorParameters<typeof RecognitionPipeline>,current:RecognitionPipeline,runtimeBase:string,threads:number|undefined,notify:(note:string)=>void,onSessions:(sessions:ModelSession[])=>void) {
  const [profile,,detector]=args,profiles=hybridProfiles(profile),sessions:ModelSession[]=[];
  const checked=async(asset:{url:string;sha256:string})=>{
    const reply=await fetchModelChecked(asset.url,asset.sha256,{signal:AbortSignal.timeout(120_000)});
    if(!reply.ok)throw new Error(`Hybrid asset HTTP ${reply.status}`);return reply;
  };
  try {
    const catalog=await (await checked(HYBRID_ASSETS.catalog)).json() as {entries:IndexEntry[];bankEntries:Record<string,IndexEntry>};
    const meta=await (await checked(HYBRID_ASSETS.meta)).json() as IndexMeta;
    validateIndexProfile(meta,profiles.second);
    const light=decodeIndex(await (await checked(HYBRID_ASSETS.index)).arrayBuffer(),meta);
    const bank=parseBankBinary(await (await checked(HYBRID_ASSETS.bank)).arrayBuffer());
    if(!bank||bank.dim!==profiles.first.embedding.dim)throw new Error('Invalid DuelSight bank');
    const entries=bank.ids.map(id=>{const entry=catalog.bankEntries[id];if(!entry)throw new Error('Unknown DuelSight bank name');return entry;});
    const firstIndex:LoadedIndex={meta:{version:1,gameId:profile.id,layoutKey:layoutKey(profiles.first),modelId:profiles.first.embedding.id,modelSha256:profiles.first.embedding.sha256,dim:bank.dim,count:entries.length,dtype:'float32',entries},vectors:bank.matrix};
    // New graphs have no checked WebGPU output reference yet. The detector keeps its existing provider and fallback.
    for(const spec of [profiles.first.embedding,profiles.second.embedding])sessions.push(await createModelSession(spec.url,spec.sha256,'wasm',runtimeBase,undefined,{threads}));
    const first=new RecognitionPipeline(profiles.first,firstIndex,detector,sessions[0],Tensor);
    const second=new RecognitionPipeline(profiles.second,light,detector,sessions[1],Tensor);
    const pipeline=new HybridPipeline(args,current,first,second,catalog.entries,notify);
    onSessions(sessions);return pipeline;
  }catch(error){await Promise.all(sessions.map(s=>s.release().catch(()=>{})));throw error;}
}

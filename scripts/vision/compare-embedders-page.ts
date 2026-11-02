/** Short crop-only WASM comparison. Browser pixels, preprocessing, model and search are shared with live reads. */
import {loadYugiohProfile,type IdentityEmbedder} from '../../packages/vision/src/embedders';
import {embedImages} from '../../packages/vision/src/embed';
import {createModelSession,Tensor,runtimeDiagnostics} from '../../packages/vision/src/runtime';
import {decodeIndex} from '../../packages/vision/src/index-format';
import {validateIndexProfile} from '../../packages/vision/src/profile';
import {filterPhysicalIndex} from '../../packages/vision/src/physical-index';
import {topK} from '../../packages/vision/src/search';
import type {Candidate} from '../../packages/vision/src/types';

type Sample={file:string;cardId:string;group:string};
type Row=Sample & {ms:number;withoutDeck:Candidate[];withDeck:Candidate[]};
async function json(url:string){const r=await fetch(url);if(!r.ok)throw new Error(`${url}: HTTP ${r.status}`);return r.json();}
async function pixels(url:string){const r=await fetch(url);if(!r.ok)throw new Error('Cannot load crop');const im=await createImageBitmap(await r.blob());try{const canvas=new OffscreenCanvas(im.width,im.height),ctx=canvas.getContext('2d')!;ctx.drawImage(im,0,0);return ctx.getImageData(0,0,im.width,im.height);}finally{im.close();}}
export async function compare(){
  const input=await json('/input.json') as {samples:Sample[];deck:string[]};
  const images=await Promise.all(input.samples.map(s=>pixels(s.file)));
  const runs=[];
  for(const embedder of ['dinov2-small-duel','dinov3-small'] as IdentityEmbedder[]){
    let session:Awaited<ReturnType<typeof createModelSession>>|undefined;
    try{
      const profile=await loadYugiohProfile(embedder),meta=await json(profile.metaUrl);
      validateIndexProfile(meta,profile);
      const reply=await fetch(profile.indexUrl);if(!reply.ok)throw new Error('Index unavailable');
      const index=filterPhysicalIndex(decodeIndex(await reply.arrayBuffer(),meta));
      session=await createModelSession(profile.embedding.url,profile.embedding.sha256,'wasm');
      for(let i=0;i<3;i++)await embedImages(session,Tensor,profile.embedding,[images[0]]);
      const rows:Row[]=[];
      for(let i=0;i<images.length;i++){
        const start=performance.now();
        const [v]=await embedImages(session,Tensor,profile.embedding,[images[i]]);
        const ms=performance.now()-start;
        const catalog=topK(v,index,5),deck=topK(v,index,5,undefined,undefined,new Set(input.deck));
        rows.push({...input.samples[i],ms,withoutDeck:catalog,withDeck:deck});
      }
      const groups=[...new Set(rows.map(r=>r.group))].map(group=>{
        const samples=rows.filter(r=>r.group===group),sorted=samples.map(r=>r.ms).sort((a,b)=>a-b);
        return {group,n:samples.length,withoutTop1:samples.filter(r=>r.withoutDeck[0]?.cardId===r.cardId).length,withoutTop5:samples.filter(r=>r.withoutDeck.some(c=>c.cardId===r.cardId)).length,withTop1:samples.filter(r=>r.withDeck[0]?.cardId===r.cardId).length,withTop5:samples.filter(r=>r.withDeck.some(c=>c.cardId===r.cardId)).length,meanMs:sorted.reduce((a,b)=>a+b,0)/sorted.length,p50Ms:sorted[Math.ceil(sorted.length*.5)-1],p95Ms:sorted[Math.ceil(sorted.length*.95)-1]};
      });
      runs.push({embedder,modelSha256:profile.embedding.sha256,indexCount:index.meta.count,runtime:runtimeDiagnostics(),groups,rows});
    }catch(e){runs.push({embedder,error:e instanceof Error?e.message:String(e)});}
    finally{await session?.release();}
  }
  return {browser:navigator.userAgent,deck:input.deck,runs};
}
Object.assign(window,{compareEmbedders:compare});

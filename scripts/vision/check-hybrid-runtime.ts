/** Optional real-asset regression, no browser/network. Requires the retained eval collection and prepared product Hybrid data.
 * VISION_HYBRID_EVAL_DATA=/path/to/data/vision-eval npx tsx scripts/vision/check-hybrid-runtime.ts --threads 1|2
 * Run each thread setting in its own process: ORT initializes its thread pool once.
 */
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import type {IndexMeta, Point} from '../../packages/vision/src/types';
import type {ModelSession} from '../../packages/vision/src/runtime';
import {RecognitionPipeline} from '../../packages/vision/src/pipeline';
import {openHybrid} from '../../packages/vision/src/hybrid-loader';
import {yugioh} from '../../packages/vision/src/games/yugioh';
import {decodeIndex} from '../../packages/vision/src/index-format';
import * as ort from 'onnxruntime-web/wasm';


async function main(){
const {values}=parseArgs({options:{threads:{type:'string'}}});
const threads=Number(values.threads??1);
if(![1,2].includes(threads))throw new Error('--threads must be 1 or 2');
const evalRoot=process.env.VISION_HYBRID_EVAL_DATA;
if(!evalRoot)throw new Error('Set VISION_HYBRID_EVAL_DATA to the retained data/vision-eval directory. No files are downloaded.');
const data=path.resolve(process.env.VISION_DATA_DIR??'data/vision');
// A local origin resolves product asset URLs.
Object.defineProperty(globalThis,'location',{configurable:true,value:{href:'http://localhost:3000/'}});
Object.defineProperty(globalThis,'crossOriginIsolated',{configurable:true,value:true});
const originalFetch=globalThis.fetch,sessions:ModelSession[]=[];
// The browser build preloads a cross-origin pthread module as a Blob URL. Node's ESM loader
// cannot import blob:, so this local harness imports the identical prepared file from disk.
const originalObjectUrl=URL.createObjectURL;
if(threads>1)URL.createObjectURL=()=>pathToFileURL(data+'/ort/ort-wasm-simd-threaded.mjs').href;
// Local file transport only. The production loader still performs all six real SHA-256 checks.
const localFetch:typeof fetch=async input=>{
  const url=new URL(String(input),location.href);
  const name=url.protocol==='file:'?path.relative(data,fileURLToPath(url)):url.pathname.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//,'');
  if(name.startsWith('..')||path.isAbsolute(name))return new Response(null,{status:404});
  try{return new Response(await readFile(path.join(data,name)));}catch{return new Response(null,{status:404});}
};
globalThis.fetch=localFetch;
try {
  const meta=JSON.parse(await readFile(path.join(data,'hybrid/light.meta.json'),'utf8')) as IndexMeta;
  const index=decodeIndex(Uint8Array.from(await readFile(path.join(data,'hybrid/light.bin'))).buffer,meta);
  const unavailable:ModelSession={backend:'wasm',release:async()=>{},run:async()=>{throw new Error('Fixture must not call the current compatibility reader or detector');}};
  const args:ConstructorParameters<typeof RecognitionPipeline>=[yugioh,index,unavailable,unavailable,ort.Tensor];
  const reader=await openHybrid(args,new RecognitionPipeline(...args),pathToFileURL(data+'/ort/').href,threads,note=>{throw new Error(note);},s=>sessions.push(...s));
  const manifest=JSON.parse(await readFile(path.join(evalRoot,'frames.json'),'utf8')) as {file:string;cards:{id:string;cardId:string;quad:[Point,Point,Point,Point]}[]}[];
  // Independent agent labels from the retained collection, never generated from these predictions.
  const fixtures=[
    ['aps-2002-duel-0025000-p0','66672569','first'],['aps-2002-duel-0045000-p2','24611934','first'],
    ['aps-2002-duel-0085000-p5','19523799','second'],['aps-2002-duel-0135000-p6','80604092','first'],
  ] as const;
  for(const [id,expected,stage] of fixtures) {
    const frame=manifest.find(f=>f.cards.some(c=>c.id===id));assert.ok(frame);
    const truth=frame.cards.find(c=>c.id===id);assert.ok(truth);assert.equal(truth.cardId,expected);
    const {data:pixels,info}=await sharp(path.join(evalRoot,frame.file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const q=truth.quad,d=(i:number,j:number)=>Math.hypot(q[i].x-q[j].x,q[i].y-q[j].y);
    const portrait=d(0,1)>d(1,2)?[q[1],q[2],q[3],q[0]]:q;
    const result=await reader.recognize([{width:info.width,height:info.height,data:new Uint8ClampedArray(pixels)}],{
      card:{quad:portrait.map(p=>({x:p.x/info.width,y:p.y/info.height})),kind:'face-up',confidence:1,partial:false},
      preclean:false,includeRaw:true,includeIdentityEmbedding:true,
    });
    assert.equal(result.candidates[0]?.cardId,expected,id);assert.equal(result.reader?.stage,stage,id);
    assert.equal(result.backend,'wasm');assert.equal(ort.env.wasm.numThreads,threads);
    console.log(JSON.stringify({id,winner:expected,stage,tier:result.tier,threads}));
  }
  console.log(`Hybrid real-asset WASM regression: ${fixtures.length}/${fixtures.length} passed, ${threads} thread(s). Not a browser or latency benchmark.`);
}finally{globalThis.fetch=originalFetch;URL.createObjectURL=originalObjectUrl;await Promise.all(sessions.map(s=>s.release()));}

}
void main().catch(error=>{console.error(error);process.exitCode=1;});

/**
 * Light/glare pre-clean A/B on real fixtures: benchmark photos, synthetic lighting faults
 * (blue/purple/white cast, specular blob, flat contrast) and owner webcam screenshots.
 * Reports top-1 and confidence raw vs clean, detector recall raw vs cast-corrected, and cost.
 *   VISION_DATA_DIR=... ORT_NODE_FROM=<dir with node_modules/onnxruntime-node> npx tsx scripts/vision/benchmark-preclean.ts [owner.png:x,y,w,h:expectedName ...]
 */
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { resolve, join } from 'node:path';
import sharp from 'sharp';
import { RecognitionPipeline } from '../../packages/vision/src/pipeline';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { decodeIndex } from '../../packages/vision/src/index-format';
import { degradeLighting, precleanCrop, frameCastGains, applyGains } from '../../packages/vision/src/preclean';
import type { ModelSession } from '../../packages/vision/src/runtime';
import type { TensorCtor } from '../../packages/vision/src/embed';
import type { IndexMeta, RecognitionResult } from '../../packages/vision/src/types';
import type { RGBAImage } from '../../packages/vision/src/pixels';

const require=createRequire(join(resolve(process.env.ORT_NODE_FROM??resolve(import.meta.dirname,'../..')),'package.json'));
const ort=require('onnxruntime-node') as typeof import('onnxruntime-node');
const root=resolve(import.meta.dirname,'../..'),data=resolve(process.env.VISION_DATA_DIR??join(root,'data/vision'));
const meta=JSON.parse(await readFile(join(data,'yugioh-index.meta.json'),'utf8')) as IndexMeta;
const binary=await readFile(join(data,'yugioh-index.bin'));
const opts={intraOpNumThreads:4,interOpNumThreads:1};
const detector=await ort.InferenceSession.create(join(data,'models/card-detector.onnx'),opts);
const embedder=await ort.InferenceSession.create(join(data,'models/dinov2-small-duel.q8.onnx'),opts);
const adapt=(session:InstanceType<typeof ort.InferenceSession>)=>({backend:'wasm',run:session.run.bind(session)}) as unknown as ModelSession;
const pipeline=new RecognitionPipeline(yugioh,decodeIndex(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),meta),adapt(detector),adapt(embedder),ort.Tensor as unknown as TensorCtor);
const names=new Map(meta.entries.map(e=>[e.cardId,e.name]));
const rgba=async(input:string|Buffer,crop?:number[]):Promise<RGBAImage>=>{
  let s=sharp(input);if(crop)s=s.extract({left:crop[0],top:crop[1],width:crop[2],height:crop[3]});
  const {data,info}=await s.ensureAlpha().raw().toBuffer({resolveWithObject:true});
  return {data:new Uint8ClampedArray(data.buffer,data.byteOffset,data.byteLength),width:info.width,height:info.height};
};
type Row={set:string;id:string;expected?:string;raw:RecognitionResult;ab:RecognitionResult;rawDet:number;castDet:number};
const rows:Row[]=[];
async function run(set:string,id:string,frame:RGBAImage,expected?:string) {
  const raw=await pipeline.recognize([frame],{preclean:false,k:3});
  const ab=await pipeline.recognize([frame],{k:3});
  const rawDet=(await pipeline.detectCards(frame)).length,castDet=(await pipeline.detectCards(applyGains(frame,frameCastGains(frame)))).length;
  rows.push({set,id,expected,raw,ab,rawDet,castDet});
}
const manifest=JSON.parse(await readFile(join(data,'benchmark/photos.json'),'utf8')) as {file:string;cardId:string;condition:string}[];
for(const photo of manifest) {
  const frame=await rgba(join(data,'benchmark',photo.file));
  await run(`photo:${photo.condition}`,photo.file,frame,photo.cardId);
  if(photo.condition==='clean'||photo.condition==='sleeve') for(const kind of ['blue','purple','white','blob','flat'] as const)
    await run(`synthetic:${kind}`,`${photo.file}`,degradeLighting(frame,kind),photo.cardId);
}
for(const arg of process.argv.slice(2)) {
  const [file,box,name]=arg.split(':');
  const expected=name&&name!=='scene'?meta.entries.find(e=>e.name===name)?.cardId:undefined;
  await run(name==='scene'?'owner-scene':'owner',`${file.split('/').pop()!.slice(11,24)}@${box}`,await rgba(file,box.split(',').map(Number)),expected);
}
// Crop cost alone (295x430 warp).
const sample=await rgba(join(data,'benchmark',manifest[0].file));
const warp=await rgba(await sharp(sample.data as Uint8Array,{raw:{width:sample.width,height:sample.height,channels:4}}).resize(295,430,{fit:'fill'}).png().toBuffer());
for(let i=0;i<5;i++)precleanCrop(warp);
let ms=0;for(let i=0;i<20;i++){const t=performance.now();precleanCrop(warp);ms+=performance.now()-t;}
let fms=0;for(let i=0;i<20;i++){const t=performance.now();frameCastGains(sample);fms+=performance.now()-t;}
const sets=[...new Set(rows.map(r=>r.set))];
const top=(r:RecognitionResult)=>r.candidates[0]?.cardId;
console.log('set | n | top1 raw | top1 A/B | sure raw | sure A/B | mean score raw | mean score A/B | used clean | det raw | det cast');
for(const set of sets) {
  const g=rows.filter(r=>r.set===set),labelled=g.filter(r=>r.expected);
  const mean=(f:(r:Row)=>number)=>(g.reduce((s,r)=>s+f(r),0)/g.length).toFixed(3);
  const ok=(f:(r:Row)=>RecognitionResult)=>labelled.length?`${labelled.filter(r=>top(f(r))===r.expected).length}/${labelled.length}`:'-';
  console.log([set,g.length,ok(r=>r.raw),ok(r=>r.ab),g.filter(r=>r.raw.tier==='sure').length,g.filter(r=>r.ab.tier==='sure').length,mean(r=>r.raw.candidates[0]?.score??0),mean(r=>r.ab.candidates[0]?.score??0),g.filter(r=>r.ab.preclean?.used==='clean').length,g.reduce((s,r)=>s+r.rawDet,0),g.reduce((s,r)=>s+r.castDet,0)].join(' | '));
}
for(const r of rows.filter(r=>r.set.startsWith('owner')||top(r.raw)!==top(r.ab)))
  console.log(`${r.set} ${r.id}: raw ${names.get(top(r.raw)!)??top(r.raw)} ${r.raw.tier} ${r.raw.candidates[0]?.score.toFixed(3)} | A/B ${names.get(top(r.ab)!)??top(r.ab)} ${r.ab.tier} ${r.ab.candidates[0]?.score.toFixed(3)} used=${r.ab.preclean?.used} glare=${((r.ab.preclean?.glare??0)*100).toFixed(1)}% gains=${r.ab.preclean?.gains?.map(v=>v.toFixed(2)).join(',')} expected=${r.expected?names.get(r.expected):'?'}`);
const abExtra=rows.filter(r=>r.ab.preclean?.gains).map(r=>r.ab.timingsMs.total-r.raw.timingsMs.total);
console.log(`preclean crop ${(ms/20).toFixed(2)} ms; frame cast estimate ${(fms/20).toFixed(2)} ms (${sample.width}x${sample.height}); A/B second pass mean +${(abExtra.reduce((a,b)=>a+b,0)/Math.max(1,abExtra.length)).toFixed(0)} ms on ${abExtra.length}/${rows.length} reads`);
await detector.release();await embedder.release();

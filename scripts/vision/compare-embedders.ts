/** No training or long benchmark: existing crops only, sequential browser WASM inference. */
import {chromium} from '@playwright/test';
import {build} from 'esbuild';
import {readFile,writeFile,mkdir,mkdtemp,rm} from 'node:fs/promises';
import {tmpdir,cpus,availableParallelism} from 'node:os';
import {resolve,join,dirname} from 'node:path';
import {parseArgs} from 'node:util';
import sharp from 'sharp';
import * as ort from 'onnxruntime-node';
import {sessionServer} from './session/server';
import {yugioh} from '../../packages/vision/src/games/yugioh';
import {detectScene} from '../../packages/vision/src/detect-scene';
import {buildHypotheses} from '../../packages/vision/src/hypotheses';
import {warpQuad,type Quad} from '../../packages/vision/src/geometry';
import type {ModelSession} from '../../packages/vision/src/runtime';
import type {TensorCtor} from '../../packages/vision/src/embed';
import type {IndexMeta} from '../../packages/vision/src/types';
import {createHash} from 'node:crypto';
const {values}=parseArgs({options:{data:{type:'string',default:process.env.VISION_DATA_DIR??'data/vision'},photos:{type:'string'},feedback:{type:'string'},'feedback-kind':{type:'string',default:'real'},crops:{type:'string'}}});
if(!['real','synthetic'].includes(values['feedback-kind']!))throw new Error('feedback-kind must be real or synthetic');
const data=resolve(values.data!),out=join(data,'compare-embedders');await mkdir(out,{recursive:true});
const temp=await mkdtemp(join(tmpdir(),'vision-quick-'));
const samples:{file:string;cardId:string;group:string;sourceSha256:string}[]=[],assets:Record<string,string>={};
let server:Awaited<ReturnType<typeof sessionServer>>|undefined,browser:Awaited<ReturnType<typeof chromium.launch>>|undefined;
try{
  async function add(file:string,cardId:string,group:string,wholeCard:boolean,scene=false){
    const raw=await readFile(file),{data:pixels,info}=await sharp(raw).rotate().ensureAlpha().raw().toBuffer({resolveWithObject:true});
    let image={data:pixels as Uint8Array|Uint8ClampedArray,width:info.width,height:info.height};
    if(scene){
      const cards=await detectScene(image,yugioh,detector as unknown as ModelSession,ort.Tensor as unknown as TensorCtor);
      const card=cards.filter(c=>c.kind==='face-up').sort((a,b)=>b.confidence-a.confidence)[0];
      if(!card)throw new Error(`No card detected in existing fixture ${file}; refusing to silently drop it`);
      const warp=warpQuad(image,card.quad.map(p=>({x:p.x*image.width,y:p.y*image.height})) as Quad,295,430);
      if(!warp)throw new Error('Cannot straighten fixture');image=warp;
    }
    if(wholeCard)image=buildHypotheses(image,image,null,{userBoxWithCard:false,artOfCardShapedBox:false},yugioh).find(h=>h.rotation===0)!.image;
    const name=`/crop-${samples.length}.png`,dest=join(temp,`crop-${samples.length}.png`);
    await sharp(image.data,{raw:{width:image.width,height:image.height,channels:4}}).png().toFile(dest);
    assets[name]=dest;samples.push({file:name,cardId,group,sourceSha256:createHash('sha256').update(raw).digest('hex')});
  }
  const photosFile=resolve(values.photos??join(data,'benchmark/photos.json'));
  const photos=JSON.parse(await readFile(photosFile,'utf8')) as {file:string;cardId:string}[];
  const detector=await ort.InferenceSession.create(join(data,'models/card-detector.onnx'),{executionProviders:['cpu'],intraOpNumThreads:availableParallelism(),interOpNumThreads:1});
  try{for(const p of photos)await add(resolve(dirname(photosFile),p.file),p.cardId,'Synthetic scenes',true,true);}finally{await detector.release();}
  if(values.feedback){
    const manifest=resolve(values.feedback),rows=JSON.parse(await readFile(manifest,'utf8')) as {file:string;cardId:string;gameId?:string}[];
    for(const r of rows){if(r.gameId&&r.gameId!=='yugioh')continue;await add(resolve(dirname(manifest),r.file),r.cardId,values['feedback-kind']==='real'?'Real feedback':'Synthetic feedback fixtures',true);}
  }
  if(values.crops){
    const manifest=resolve(values.crops),rows=JSON.parse(await readFile(manifest,'utf8')) as {file:string;cardId:string;space:'art-box'|'whole-card';kind:'real'|'synthetic'}[];
    for(const r of rows)await add(resolve(dirname(manifest),r.file),r.cardId,r.kind==='real'?'Real feedback':'Synthetic crop fixtures',r.space==='whole-card');
  }
  if(!samples.length)throw new Error('No labelled crops');
  const meta=JSON.parse(await readFile(join(data,'yugioh-index.meta.json'),'utf8')) as IndexMeta;
  const deck=[...new Set(samples.map(s=>s.cardId))];
  if(deck.length>40)throw new Error('Quick comparison supports at most 40 unique truth cards; provide an explicit smaller crop set');
  for(const entry of meta.entries){if(deck.length===40)break;if(entry.passcode>0&&!deck.includes(entry.cardId))deck.push(entry.cardId);}
  await writeFile(join(temp,'input.json'),JSON.stringify({samples,deck}));assets['/input.json']=join(temp,'input.json');
  await build({entryPoints:[resolve('scripts/vision/compare-embedders-page.ts')],outfile:join(temp,'compare.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,logLevel:'silent'});assets['/compare.js']=join(temp,'compare.js');
  server=await sessionServer(data,assets);browser=await chromium.launch({channel:'chromium',headless:true,args:['--no-sandbox','--disable-gpu']});
  const page=await browser.newPage();await page.goto(server.origin);await page.addScriptTag({type:'module',url:'/compare.js'});
  await page.waitForFunction(()=>typeof (window as any).compareEmbedders==='function');
  const result=await page.evaluate(()=> (window as any).compareEmbedders());
  const report={generatedAt:new Date().toISOString(),cpu:cpus()[0]?.model,...result,physicalCrops:samples.filter(s=>s.group==='Real feedback').length,notes:['Existing source scenes detected and straightened once with the unchanged detector; same resulting crop for each model.','Three warmups, one measured inference per crop. ms includes shared preprocessing and WASM inference, excludes detector, decoding and search.','Deck is a fixed 40-card closed set containing every truth plus catalog decoys. No learned feedback or fine-tuning.','Synthetic and synthetic feedback rows are not physical-camera accuracy. DINOv3 confidence is uncalibrated.']};
  await writeFile(join(out,'results.json'),JSON.stringify(report,null,2)+'\n');
  const lines=['| Embedder | Crops | n | No deck top-1 / top-5 | Deck top-1 / top-5 | WASM ms/crop mean (p50 / p95) |','| --- | --- | ---: | --- | --- | --- |'];
  for(const run of report.runs){if(run.error){lines.push(`| ${run.embedder} | Blocked: ${String(run.error).replaceAll('|','/')} | — | — | — | — |`);continue;}for(const g of run.groups){const pct=(n:number)=>`${(100*n/g.n).toFixed(1)}%`;lines.push(`| ${run.embedder} | ${g.group} | ${g.n} | ${pct(g.withoutTop1)} / ${pct(g.withoutTop5)} | ${pct(g.withTop1)} / ${pct(g.withTop5)} | ${g.meanMs.toFixed(1)} (${g.p50Ms.toFixed(1)} / ${g.p95Ms.toFixed(1)}) |`);}}
  await writeFile(join(out,'results.md'),lines.join('\n')+'\n');console.log(lines.join('\n'));
  if(report.runs[0].error)throw new Error(report.runs[0].error);
}finally{await browser?.close();await server?.close();await rm(temp,{recursive:true,force:true});}

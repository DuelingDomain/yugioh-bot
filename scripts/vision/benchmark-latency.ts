/** Offline desktop latency gates: real Chromium worker, resident full catalog, native camera frames. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import { cpus } from 'node:os';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const root=resolve(import.meta.dirname,'../..'),data=resolve(process.env.VISION_DATA_DIR??join(root,'data/vision'));
const directory=join(data,'benchmark/latency');await mkdir(directory,{recursive:true});
const label=process.env.LATENCY_LABEL??'results';if(!/^[a-z0-9-]+$/.test(label))throw new Error('Invalid LATENCY_LABEL');
// Reuse the pinned local fixture; no model, index, image or network downloads.
await stat(join(data,'benchmark/field-watcher/card.png'));
const baseline='e3f02194a';
await writeFile(join(directory,'search-before.ts'),execFileSync('git',['show',`${baseline}:packages/vision/src/search.ts`],{cwd:root}));
await build({entryPoints:[join(root,'packages/vision/src/index.ts')],outfile:join(directory,'api.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
await build({entryPoints:[join(root,'packages/vision/src/worker.ts')],outfile:join(directory,'worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'eof'});
await build({stdin:{contents:`
import {topK,normalize,prepareSearch} from '${join(root,'packages/vision/src/search.ts')}';
import {topK as before} from './search-before';
import {decodeIndex} from '${join(root,'packages/vision/src/index-format.ts')}';
import {filterPhysicalIndex} from '${join(root,'packages/vision/src/physical-index.ts')}';
self.onmessage=async()=>{
  try {
    const meta=await(await fetch('/dev/vision-assets/yugioh-index.meta.json')).json();
    const index=filterPhysicalIndex(decodeIndex(await(await fetch('/dev/vision-assets/yugioh-index.bin')).arrayBuffer(),meta));
    const started=performance.now();prepareSearch(index);const prepareMs=performance.now()-started;
    const samples={before:[],catalog:[],deck:[]};let mismatches=0,maxScoreDelta=0;
    const deck=new Set(index.meta.entries.slice(0,60).map(e=>e.cardId));
    for(let n=0;n<150;n++) {
      const row=(n*97)%index.meta.count,query=normalize(Float32Array.from(index.vectors.subarray(row*meta.dim,(row+1)*meta.dim)));
      const results={};
      for(const key of (n%2?['before','catalog','deck']:['catalog','before','deck'])) {
        const start=performance.now();results[key]=(key==='before'?before:topK)(query,index,10,undefined,undefined,key==='deck'?deck:undefined);
        if(n>=30)samples[key].push(performance.now()-start);
      }
      if(results.before.some((c,i)=>c.cardId!==results.catalog[i]?.cardId))mismatches++;
      for(let i=0;i<results.before.length;i++)maxScoreDelta=Math.max(maxScoreDelta,Math.abs(results.before[i].score-results.catalog[i].score));
    }
    self.postMessage({rows:index.meta.count,cards:new Set(index.meta.entries.map(e=>e.cardId)).size,dim:meta.dim,dtype:meta.dtype,prepareMs,samples,mismatches,maxScoreDelta});
  }catch(error){self.postMessage({error:String(error)});}
};`,resolveDir:directory,sourcefile:'search-benchmark.ts',loader:'ts'},outfile:join(directory,'search-benchmark.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
const mime:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.png':'image/png','.mp4':'video/mp4'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(req.url==='/dev/vision-lab'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Remote recognition latency</title>');return;}
  if(req.url?.startsWith('/api/remote-vision/learning')){res.setHeader('Content-Type','application/json');res.end('{"version":"offline-empty","references":[],"confusions":[]}');return;}
  try {
    const file=resolve(data,decodeURIComponent(new URL(req.url!,'http://localhost').pathname.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//,'')));
    if(!file.startsWith(data+'/')||!(await stat(file)).isFile())throw new Error('missing');
    res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end('missing');}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--disable-gpu','--no-sandbox']});
const percentile=(values:number[],p:number)=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.max(0,Math.ceil(sorted.length*p)-1)]??null;};
const distribution=(values:number[])=>({n:values.length,p50Ms:percentile(values,.5),p95Ms:percentile(values,.95),maxMs:values.length?Math.max(...values):null});
try {
  const page=await browser.newPage(),errors:string[]=[],requests:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>requests.push(r.url()));page.on('console',m=>console.log('browser:',m.type(),m.text()));
  await page.addInitScript('window.__name = (value) => value;');
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await page.goto(origin+'/dev/vision-lab');
  const search=await page.evaluate(()=>new Promise<any>((resolve,reject)=>{
    const worker=new Worker('/dev/vision-assets/benchmark/latency/search-benchmark.js',{type:'module'});
    worker.onmessage=e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data);};worker.onerror=e=>reject(new Error(e.message));worker.postMessage(null);
  }));
  console.log('Catalog search:',JSON.stringify({before:distribution(search.samples.before),after:distribution(search.samples.catalog),deck:distribution(search.samples.deck),mismatches:search.mismatches}));
  requests.length=0;
  const ready=await page.evaluate(async()=>{
    const api=await import(/* webpackIgnore: true */ String('/dev/vision-assets/benchmark/latency/api.js'));
    const reader=api.createRecognizer({backend:'wasm',workerUrl:'/dev/vision-lab/assets/benchmark/latency/worker.js'});(window as any).api=api;(window as any).reader=reader;
    const start=performance.now();await reader.prepare();return {ms:performance.now()-start,isolated:crossOriginIsolated,hardwareConcurrency:navigator.hardwareConcurrency};
  });
  console.log('Reader ready:',JSON.stringify(ready));
  const trials=Number(process.env.LATENCY_TRIALS??20);
  if(!Number.isInteger(trials)||trials<1||trials>100)throw new Error('LATENCY_TRIALS must be 1–100 per condition');
  const measurements=await page.evaluate(async trials=>{
    const {api,reader}=window as any,bitmap=await createImageBitmap(await(await fetch('/dev/vision-assets/benchmark/field-watcher/card.png')).blob());
    const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;document.body.append(canvas);const ctx=canvas.getContext('2d')!;
    let show=false,x=460;const paint=()=>{ctx.fillStyle='#26392f';ctx.fillRect(0,0,1280,720);if(show)ctx.drawImage(bitmap,x,170,180,262);};paint();const painter=setInterval(paint,65);
    const video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=canvas.captureStream(15);document.body.append(video);await Promise.race([video.play(),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error('Camera play timed out')),10000))]);console.info('native camera playing');
    const buffer=api.createOwnFeedBuffer(video),placements:any[]=[],clicks:any[]=[];
    const delay=(ms:number)=>new Promise(r=>setTimeout(r,ms));
    try {
      for(let n=0;n<trials*2;n++) {
        const deck=n%2===0,priors=deck?{decklist:['45725480']}:undefined;
        show=false;paint();await delay(270);
        const events:any[]=[],watcher=api.createFieldWatcher({recognizer:reader,buffer,profile:api.yugioh,getPriors:()=>priors});
        watcher.subscribe((event:any)=>events.push({...event,wallAt:performance.now()}));watcher.start();await delay(350+(n%4)*45);
        x=340+(n%5)*50;show=true;paint();const appeared=performance.now(),deadline=appeared+10000;
        while(!events.some(e=>e.type==='placed'||e.type==='prompt')&&performance.now()<deadline)await delay(10);
        const result=events.find(e=>e.type==='placed'||e.type==='prompt');console.info('trial',n,'event',result?.type??'timeout');
        placements.push({deck,wallMs:result?result.wallAt-appeared:null,event:result,snapshot:watcher.getSnapshot()});watcher.dispose();
        // Let any canceled worker inference drain before using the same reader.
        await delay(100);
        // A desktop live click uses one held native frame and returns the full result/crop.
        // Includes frame clone, detector, warp, embedding, full catalog and worker reply.
        const start=performance.now();
        const read=await reader.recognize([await createImageBitmap(video)],{clickPoint:{x:(x+90)/1280,y:301/720},maxFrames:1,includeCrop:true,priors});
        clicks.push({deck,wallMs:performance.now()-start,result:read});
        if(n%10===9)console.info('completed',n+1,'placements and clicks');
      }
      return {placements,clicks};
    }finally{buffer.stop();clearInterval(painter);(video.srcObject as MediaStream).getTracks().forEach(t=>t.stop());video.remove();canvas.remove();bitmap.close();reader.dispose();}
  },trials);
  const summarize=(deck:boolean)=>({
    placement:distribution(measurements.placements.filter((t:any)=>t.deck===deck&&t.event?.type==='placed').map((t:any)=>t.wallMs)),
    click:distribution(measurements.clicks.filter((t:any)=>t.deck===deck).map((t:any)=>t.wallMs)),
    correctPlacements:measurements.placements.filter((t:any)=>t.deck===deck&&t.event?.type==='placed'&&t.event.result?.tier==='sure'&&t.event.track.cardId==='45725480').length,
    correctClicks:measurements.clicks.filter((t:any)=>t.deck===deck&&t.result.tier==='sure'&&t.result.candidates[0]?.cardId==='45725480').length,
  });
  const assetRequests={index:requests.filter(r=>r.endsWith('/yugioh-index.bin')).length,meta:requests.filter(r=>r.endsWith('/yugioh-index.meta.json')).length,embedder:requests.filter(r=>r.endsWith('/dinov2-small-duel.q8.onnx')).length,detector:requests.filter(r=>r.endsWith('/card-detector.onnx')).length};
  const report={at:new Date().toISOString(),baseline,node:process.version,browser:browser.version(),cpu:cpus()[0]?.model,logicalCores:cpus().length,backend:'wasm',runtime:measurements.clicks[0]?.result.runtime,ready,search:{...search,before:distribution(search.samples.before),catalog:distribution(search.samples.catalog),deck:distribution(search.samples.deck)},withDeck:summarize(true),withoutDeck:summarize(false),assetRequests,browserErrors:errors,notes:'Synthetic indexed standard card on plain mat, canvas captureStream, 1280x720 native ring. Actual CPU worker. Warm-ready desktop measurements; cold-ready reported separately. Balanced alternating deck/no-deck trials; p95 uses nearest rank. Placement ends at identified event; remote action/network rendering is covered by e2e, not this API timing. No webcam accuracy or WebGPU hardware latency claim.',measurements};
  await writeFile(join(directory,`${label}.json`),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({ready:report.ready,search:{before:report.search.before,catalog:report.search.catalog,deck:report.search.deck},withDeck:report.withDeck,withoutDeck:report.withoutDeck,assetRequests,browserErrors:errors},null,2));
  if(errors.length||search.mismatches||assetRequests.index!==1||assetRequests.embedder!==1||[report.withDeck,report.withoutDeck].some(r=>r.correctPlacements!==trials||r.correctClicks!==trials||r.placement.p95Ms===null||r.placement.p95Ms>2000||r.click.p95Ms===null||r.click.p95Ms>=300)||report.search.catalog.p95Ms===null||report.search.catalog.p95Ms>6)process.exitCode=1;
}finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}

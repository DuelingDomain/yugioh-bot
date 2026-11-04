/** Paired, offline full-worker reads of the existing 30 synthetic photos. No downloads. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import { execFileSync } from 'node:child_process';
import { cpus } from 'node:os';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import type { RecognitionResult } from '../../packages/vision/src/types';

const root=resolve(import.meta.dirname,'../..'),data=resolve(process.env.VISION_DATA_DIR??join(root,'data/vision'));
const output=join(data,'benchmark/prior');await mkdir(output,{recursive:true});
const reference=process.env.PRIOR_BASE??'b7adf67ed';
const trials=Number(process.env.PRIOR_TRIALS??2);
if(!Number.isInteger(trials)||trials<1||trials>20)throw new Error('PRIOR_TRIALS must be 1–20');
// Bundle the base in a disposable source tree, preserving its own imports.
const baseline=join(root,'data/prior-base');await mkdir(baseline,{recursive:true});
const archive=execFileSync('git',['archive',reference,'packages/vision','scripts/vision/package.json','tsconfig.json'],{cwd:root,maxBuffer:16*1024*1024});
execFileSync('tar',['-xf','-','-C',baseline],{input:archive});
const {symlink}=await import('node:fs/promises');
await symlink(join(root,'node_modules'),join(baseline,'node_modules')).catch(e=>{if(e.code!=='EEXIST')throw e;});
await build({entryPoints:[join(baseline,'packages/vision/src/worker.ts')],outfile:join(output,'before-worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await build({entryPoints:[join(root,'packages/vision/src/worker.ts')],outfile:join(output,'after-worker.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',minify:true});
await build({stdin:{contents:`export * from '${join(root,'packages/vision/src/index.ts')}';export {topK,normalize,prepareSearch} from '${join(root,'packages/vision/src/search.ts')}';export {decodeIndex} from '${join(root,'packages/vision/src/index-format.ts')}';`,resolveDir:root},outfile:join(output,'api.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
const photos=JSON.parse(await readFile(join(data,'benchmark/photos.json'),'utf8')) as {file:string;cardId:string;condition:string;clickPoint:{x:number;y:number}}[];
const meta=JSON.parse(await readFile(join(data,'yugioh-index.meta.json'),'utf8'));
const relations=JSON.parse(await readFile(join(data,'related-cards.json'),'utf8'));
const targets=[...new Set(photos.map(p=>p.cardId))];
const other=[...new Set<string>(meta.entries.map((e:any)=>e.cardId))].filter(id=>!targets.includes(id)&&!id.startsWith('__'));
const preferred=['89631139','46986414','74677422'].filter(id=>other.includes(id));
const deck=[...targets,...preferred,...other.filter(id=>!preferred.includes(id)).slice(0,60-targets.length-preferred.length)],wrongDeck=other.filter(id=>!deck.includes(id)).slice(60,120);
const mime:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.jpg':'image/jpeg','.png':'image/png'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(req.url==='/dev/vision-lab'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Recognition prior fixture benchmark</title>');return;}
  if(req.url?.startsWith('/api/remote-vision/learning')){res.setHeader('Content-Type','application/json');res.end('{"version":"offline","references":[],"confusions":[]}');return;}
  try {
    const file=resolve(data,decodeURIComponent(new URL(req.url!,'http://local').pathname.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//,'')));
    if(!file.startsWith(data+'/')||!(await stat(file)).isFile())throw new Error('missing');
    res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end('missing');}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--disable-gpu','--no-sandbox']});
const quantile=(values:number[],q:number)=>[...values].sort((a,b)=>a-b)[Math.max(0,Math.ceil(values.length*q)-1)];
const distribution=(values:number[])=>({mean:values.reduce((a,b)=>a+b,0)/values.length,p50:quantile(values,.5),p95:quantile(values,.95)});
try {
  const page=await browser.newPage(),errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());
  await page.addInitScript('window.__name = value => value;');
  await page.goto(origin+'/dev/vision-lab');
  await page.evaluate(async()=>{
    const api=await import(/* webpackIgnore: true */ String('/dev/vision-assets/benchmark/prior/api.js'));
    const profile=structuredClone(api.yugioh);delete profile.embedding.webgpu;delete profile.detector.webgpu;
    const make=(version:string)=>api.createRecognizer({profile:structuredClone(profile),backend:'wasm',workers:'single',workerUrl:`/dev/vision-lab/assets/benchmark/prior/${version}-worker.js`});
    const before=make('before'),after=make('after');(window as any).bench={api,before,after};
    await before.prepare();await after.prepare();
  });
  // Search-only comparison uses the full resident index, all alternate arts and 60 cards.
  const search=await page.evaluate(async({deck})=>{
    const {api}= (window as any).bench;
    const meta=await(await fetch('/dev/vision-assets/yugioh-index.meta.json')).json();
    const index=api.filterPhysicalIndex(api.decodeIndex(await(await fetch('/dev/vision-assets/yugioh-index.bin')).arrayBuffer(),meta));
    api.prepareSearch(index);const samples={catalog:[] as number[],deck:[] as number[]};
    for(let i=0;i<130;i++) {
      const row=(i*97)%index.meta.count,query=api.normalize(Float32Array.from(index.vectors.subarray(row*meta.dim,(row+1)*meta.dim)));
      for(const mode of i%2?['catalog','deck']:['deck','catalog']) {
        const start=performance.now();api.topK(query,index,10,undefined,undefined,mode==='deck'?new Set(deck):undefined);
        if(i>=10)samples[mode as keyof typeof samples].push(performance.now()-start);
      }
    }
    return {rows:index.meta.count,deckRows:index.meta.entries.filter((e:any)=>deck.includes(e.cardId)).length,samples};
  },{deck});
  const records:{mode:string;file:string;expected:string;condition:string;wallMs:number;result:RecognitionResult}[]=[];
  const modes=['before-no-deck','before-deck','after-no-deck','after-deck','after-wrong-context','after-wrong-deck'];
  for(let trial=-1;trial<trials;trial++) for(let i=0;i<(trial<0?1:photos.length);i++) {
    const photo=photos[i];
    // Context is prior confirmed plays in fixture order, never this read's label.
    const context=photos.slice(Math.max(0,i-5),i).map(p=>Number(p.cardId));
    const seen=photos.slice(Math.max(0,i-20),i).map(p=>p.cardId);
    for(const mode of (i+trial)%2?[...modes].reverse():modes) {
      const record=await page.evaluate(async({photo,mode,context,seen,deck,wrongDeck,relations})=>{
        const {api,before,after}=(window as any).bench;
        const priors:any={seen};
        if(mode.endsWith('-deck')&&!mode.endsWith('no-deck'))priors.decklist=mode==='after-wrong-deck'?wrongDeck:deck;
        if(mode.startsWith('after'))priors.related=api.relatedPriors(relations,mode==='after-wrong-context'?[Number(wrongDeck[0])]:context);
        const bitmap=await createImageBitmap(await(await fetch(`/dev/vision-assets/benchmark/${photo.file}`)).blob());
        const start=performance.now();
        const result=await(mode.startsWith('before')?before:after).recognize([bitmap],{clickPoint:photo.clickPoint,maxFrames:1,k:5,priors,includeCrop:true,deferAICrop:true});
        return {wallMs:performance.now()-start,result};
      },{photo,mode,context,seen,deck,wrongDeck,relations});
      if(trial>=0)records.push({mode,file:photo.file,expected:photo.cardId,condition:photo.condition,...record});
    }
    if(i%5===4||i===photos.length-1)console.log(`Trial ${trial+1}/${trials}: ${i+1}/${photos.length} photos`);
  }
  await page.evaluate(()=>{const {before,after}=(window as any).bench;before.dispose();after.dispose();});
  const summary=Object.fromEntries(modes.map(mode=>{
    const rows=records.filter(r=>r.mode===mode);
    return [mode,{n:rows.length,top1:rows.filter(r=>r.result.candidates[0]?.cardId===r.expected).length/rows.length,
      sure:rows.filter(r=>r.result.tier==='sure').length/rows.length,wrongSure:rows.filter(r=>r.result.tier==='sure'&&r.result.candidates[0]?.cardId!==r.expected).length,
      totalMs:distribution(rows.map(r=>r.result.timingsMs.total)),wallMs:distribution(rows.map(r=>r.wallMs)),searchMs:distribution(rows.map(r=>r.result.timingsMs.search)),
      deckExits:rows.filter(r=>r.result.quality.searchSource==='deck').length,priorReads:rows.filter(r=>r.result.prior).length}];
  }));
  const report={reference,node:process.version,browser:browser.version(),cpu:cpus()[0].model,trials,photos:photos.length,summary,
    indexRows:search.rows,deckCards:deck.length,deckArtRows:search.deckRows,search:Object.fromEntries(Object.entries(search.samples).map(([k,v])=>[k,distribution(v)])),
    caveat:'30 existing synthetic photos, repeated paired WASM worker reads. Deck is a fixed 60-card fixture list including all fixture identities. Context is up to five previous confirmed fixture plays, never the current target. Wrong-context and disjoint-deck controls included. No real webcam or hardware GPU accuracy claim.',errors,records};
  await writeFile(join(output,'results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({...report,records:undefined},null,2));
  if(errors.length)throw new Error(errors.join('\n'));
}finally{await browser.close();await new Promise<void>(done=>server.close(()=>done()));}

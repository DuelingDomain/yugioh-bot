/** Offline synthetic multi-card benchmark of the actual browser Worker/WASM client API. */
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { resolve, join, extname } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import * as ort from 'onnxruntime-node';
import { RecognitionPipeline } from '../../packages/vision/src/pipeline';
import { warpQuad, type Quad } from '../../packages/vision/src/geometry';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import { decodeIndex } from '../../packages/vision/src/index-format';
import type { ModelSession } from '../../packages/vision/src/runtime';
import type { TensorCtor } from '../../packages/vision/src/embed';
import type { BoardResult, DetectedQuad, IndexMeta } from '../../packages/vision/src/types';

const root=resolve(import.meta.dirname,'../..'),data=resolve(process.env.VISION_DATA_DIR??join(root,'data/vision'));
const directory=join(data,'benchmark/board');await mkdir(directory,{recursive:true});
const meta=JSON.parse(await readFile(join(data,'yugioh-index.meta.json'),'utf8')) as IndexMeta;
const binary=await readFile(join(data,'yugioh-index.bin'));
const detector=await ort.InferenceSession.create(join(data,'models/card-detector.onnx'),{intraOpNumThreads:4,interOpNumThreads:1});
const embedder=await ort.InferenceSession.create(join(data,'models/dinov2-small-duel.q8.onnx'),{intraOpNumThreads:4,interOpNumThreads:1});
const adapt=(session:ort.InferenceSession)=>({backend:'wasm',run:session.run.bind(session)}) as unknown as ModelSession;
const native=new RecognitionPipeline(yugioh,decodeIndex(binary.buffer.slice(binary.byteOffset,binary.byteOffset+binary.byteLength),meta),adapt(detector),adapt(embedder),ort.Tensor as unknown as TensorCtor);
const manifest=JSON.parse(await readFile(join(data,'benchmark/photos.json'),'utf8')) as {file:string;cardId:string;name:string}[];
const rgba=async(file:string)=>{const {data,info}=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});return {data,width:info.width,height:info.height};};
const templates:Buffer[]=[];
try {
  for(let i=0;i<5;i++) {
    const frame=await rgba(join(data,'benchmark',manifest[i].file));
    const [card]=await native.detectCards(frame);if(!card) throw new Error('Source fixture detection missed');
    const image=warpQuad(frame,card.quad.map(p=>({x:p.x*frame.width,y:p.y*frame.height})) as Quad,236,344);
    if(!image) throw new Error('Fixture warp failed');
    templates.push(await sharp(image.data,{raw:{width:236,height:344,channels:4}}).png().toBuffer());
  }
} finally {await detector.release();await embedder.release();}
type Fixture={file:string;expected:{cardId:string;side:'near'|'far';cx:number;cy:number}[];cards:DetectedQuad[]};
const fixtures:Fixture[]=[];
const quad=(x:number,y:number,w:number,h:number):DetectedQuad=>({quad:[{x,y},{x:x+w,y},{x:x+w,y:y+h},{x,y:y+h}],kind:'face-up',confidence:1,partial:false});
for(const count of [2,4,6]) {
  const overlays:OverlayOptions[]=[],expected:Fixture['expected']=[],cards:DetectedQuad[]=[];
  for(let i=0;i<count;i++) {
    const far=i<count/2, column=i%(count/2),left=65+column*300,top=far?25:385;
    overlays.push({input:far?await sharp(templates[i%5]).rotate(180).toBuffer():templates[i%5],left,top});
    expected.push({cardId:manifest[i%5].cardId,side:far?'far':'near',cx:(left+118)/1000,cy:(top+172)/760});
    cards.push(quad(left/1000,top/760,236/1000,344/760));
  }
  const file=`board-${count}.jpg`;
  await sharp({create:{width:1000,height:760,channels:3,background:'#252b33'}}).composite(overlays).jpeg({quality:92}).toFile(join(directory,file));
  fixtures.push({file,expected,cards});
}
const overlapCards=[quad(.1,.15,.393333,.573333),quad(.35,.3,.393333,.573333)];
await sharp({create:{width:600,height:600,channels:3,background:'#252b33'}}).composite([{input:templates[0],left:60,top:90},{input:templates[1],left:210,top:180}]).jpeg({quality:92}).toFile(join(directory,'overlap.jpg'));
await build({entryPoints:[join(root,'packages/vision/src/client.ts')],outfile:join(directory,'client.js'),bundle:true,format:'esm',platform:'browser',target:'es2022'});
const mime:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm','.json':'application/json','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  if(req.url==='/dev/vision-lab'){res.setHeader('Content-Type','text/html');res.end('<!doctype html><title>Offline board benchmark</title>');return;}
  try {
    const file=resolve(data,decodeURIComponent(req.url!.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//,'')));
    if(!file.startsWith(data+'/') || !(await stat(file)).isFile()) throw new Error('missing');
    res.setHeader('Content-Type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  } catch {res.statusCode=404;res.end('missing');}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const origin=`http://127.0.0.1:${(server.address() as {port:number}).port}`;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--disable-gpu','--no-sandbox']});
try {
  const page=await browser.newPage(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  // tsx preserves function names with this helper when serializing evaluate callbacks.
  await page.addInitScript('window.__name = (value) => value;');
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/dev/vision-lab');
  const rows=await page.evaluate(async ({fixtures,overlapCards})=>{
    const {createRecognizer}=await import(/* webpackIgnore: true */ String('/dev/vision-assets/benchmark/board/client.js'));
    const reader=createRecognizer({backend:'wasm'});
    const frame=async(file:string)=>createImageBitmap(await(await fetch('/dev/vision-assets/benchmark/board/'+file)).blob());
    const records=[];
    try {
      for(const fixture of fixtures) for(let repeat=0;repeat<4;repeat++) {
        const image=await frame(fixture.file),start=performance.now();
        const result=await reader.readAll(image);
        records.push({file:fixture.file,repeat,wallMs:performance.now()-start,result});
      }
      const image=await frame('board-6.jpg'),outlines=await reader.detectCards(image);
      const start=performance.now(),peek=await reader.peek(await frame('board-6.jpg'),{card:outlines[0],cards:outlines});
      const peekMs=performance.now()-start;
      const overlap=await reader.readAll(await frame('overlap.jpg'),{cards:overlapCards});
      const controller=new AbortController();const canceled=reader.readAll(await frame('board-6.jpg'),{signal:controller.signal});
      controller.abort();let abortName='';try{await canceled;}catch(e){abortName=(e as Error).name;}
      const recovered=await reader.peek(await frame('board-6.jpg'),{card:outlines[0],cards:outlines});
      return {records,peek,peekMs,overlap,abortName,recovered,browserErrors:[],isolated:crossOriginIsolated};
    } finally {reader.dispose();}
  },{fixtures,overlapCards});
  const median=(values:number[])=>{const sorted=[...values].sort((a,b)=>a-b);return sorted[Math.floor(sorted.length/2)];};
  const summary=fixtures.map(fixture=>{
    const records=rows.records.filter((r:{file:string})=>r.file===fixture.file);
    const board=records[1].result as BoardResult,actual=[...board.near,...board.far];
    let assignment=0,top1=0;
    for(const expected of fixture.expected) {
      const found=actual.find(c=>Math.hypot(c.outline.quad.reduce((s,p)=>s+p.x,0)/4-expected.cx,c.outline.quad.reduce((s,p)=>s+p.y,0)/4-expected.cy)<.08);
      if(found?.side===expected.side)assignment++;
      if(found?.cardId===expected.cardId)top1++;
    }
    return {cards:fixture.expected.length,detected:actual.length,assignment,top1,firstWallMs:records[0].wallMs,warmWallMedianMs:median(records.slice(1).map((r:{wallMs:number})=>r.wallMs)),warmPipelineMedianMs:median(records.slice(1).map((r:{result:BoardResult})=>r.result.timingsMs.total))};
  });
  const report={synthetic:true,notes:'Locally warped clean card fixtures composited into 2/4/6-card boards. Actual Worker/ONNX WASM and full index. Three warm repeats each. No network outside ephemeral localhost. No physical camera or API accuracy claim.',browser:browser.version(),indexCards:new Set(meta.entries.map(e=>e.cardId)).size-1,summary,...rows,browserErrors:errors};
  await writeFile(join(directory,'results.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({summary,peek:rows.peek,peekMs:rows.peekMs,overlap:[...rows.overlap.near,...rows.overlap.far].map(c=>({name:c.name,tier:c.tier,covered:c.covered})),abortName:rows.abortName,recovered:rows.recovered,browserErrors:errors},null,2));
} finally {await browser.close();await new Promise<void>(done=>server.close(()=>done()));}

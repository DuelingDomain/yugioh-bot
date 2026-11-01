/** Isolated real lab component + real WASM worker smoke; ephemeral port, mocked APIs. */
import {build} from 'esbuild';
import {chromium,expect} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join,extname} from 'node:path';
import sharp from 'sharp';
import {replayTier} from '../../packages/vision/src/decision';
import type {RealsetExport} from '../../packages/vision/src/calibration';
const root=resolve('.'),data=resolve(process.env.VISION_DATA_DIR??'data/vision'),out=join(data,'realset-smoke');
await mkdir(out,{recursive:true});
await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {VisionLab} from './app/dev/vision-lab/vision-lab';createRoot(document.getElementById('app')).render(React.createElement(VisionLab));`,resolveDir:join(root,'packages/web'),loader:'tsx'},outfile:join(out,'lab.js'),bundle:true,format:'esm',platform:'browser',target:'es2022',jsx:'automatic',tsconfig:join(root,'packages/web/tsconfig.json'),loader:{'.css':'local-css'},external:['/duel/*'],plugins:[{name:'unrelated-sheet-button',setup(b){b.onResolve({filter:/^@\/components\/sheet$/},()=>({path:'sheet',namespace:'smoke-sheet'}));b.onLoad({filter:/.*/,namespace:'smoke-sheet'},()=>({contents:"import {createElement} from 'react';export const SvButton=({children,variant,...props})=>createElement('button',props,children);",resolveDir:root}));}}],define:{'process.env.NODE_ENV':'"production"'},logLevel:'silent'});
const photos=JSON.parse(await readFile(join(data,'benchmark/photos.json'),'utf8'));
let aiRequests=0,feedbackUploads=0,learningRequests=0,aiWidth=0,aiHeight=0,aiBytes=0,aiChoices=0;
const mime:Record<string,string>={'.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.wasm':'application/wasm','.jpg':'image/jpeg'};
const server=createServer(async(req,res)=>{
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');res.setHeader('Cross-Origin-Embedder-Policy','require-corp');
  const url=new URL(req.url!,'http://localhost');
  const json=(value:unknown)=>{res.setHeader('content-type','application/json');res.end(JSON.stringify(value));};
  try {
    if(url.pathname==='/dev/vision-lab'){res.setHeader('content-type','text/html');res.end('<!doctype html><link rel="stylesheet" href="/dev/vision-lab/assets/realset-smoke/lab.css"><div id="app"></div><script type="module" src="/dev/vision-lab/assets/realset-smoke/lab.js"></script>');return;}
    if(url.pathname==='/api/remote-vision/feedback'){if(req.method==='POST')feedbackUploads++;json({enabled:false,askedAt:1,collectionEnabled:false});return;}
    if(url.pathname==='/api/remote-vision/learning'){learningRequests++;json({version:'empty',references:[],confusions:[]});return;}
    if(url.pathname==='/api/remote-vision/ai') {
      aiRequests++;let text='';for await(const chunk of req)text+=chunk;
      const body=JSON.parse(text),bytes=Buffer.from(body.jpegBase64,'base64'),metadata=await sharp(bytes).metadata();
      aiWidth=metadata.width!;aiHeight=metadata.height!;aiBytes=bytes.length;aiChoices=body.candidateNames.length;
      if(aiWidth!==640 || aiHeight>1024 || aiBytes>256*1024 || !body.candidateNames.includes(photos[0].name))throw Error('Invalid AI crop/choices');
      json({name:photos[0].name,passcode:Number(photos[0].cardId),match:{name:photos[0].name,passcode:Number(photos[0].cardId)}});return;
    }
    if(url.pathname==='/api/cards/resolve'){json({cards:[]});return;}
    if(url.pathname.startsWith('/api/cards/') || url.pathname.startsWith('/duel/')){res.setHeader('content-type','image/jpeg');res.end(await readFile(join(data,'benchmark',photos[0].file)));return;}
    const file=resolve(data,decodeURIComponent(url.pathname.replace(/^\/dev\/(?:vision-assets|vision-lab\/assets)\//,'')));
    if(!file.startsWith(data+'/'))throw Error('Invalid path');
    res.setHeader('content-type',mime[extname(file)]??'application/octet-stream');res.end(await readFile(file));
  }catch{res.statusCode=404;res.end('not found');}
});
await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));
const port=(server.address() as {port:number}).port;
const browser=await chromium.launch({channel:'chromium',headless:true,args:['--disable-gpu','--no-sandbox']});
try {
  const page=await browser.newPage({viewport:{width:1280,height:1000}}),errors:string[]=[];
  page.on('pageerror',e=>{errors.push(e.message);console.error('Browser:',e.stack);});
  await page.addInitScript(()=>{(window as unknown as {__name:(v:unknown)=>unknown}).__name=v=>v;Object.defineProperty(navigator,'mediaDevices',{value:{getUserMedia:async()=>{
    const image=new Image();image.src='/dev/vision-assets/benchmark/photo-00.jpg';await image.decode();
    const canvas=document.createElement('canvas');canvas.width=1920;canvas.height=1080;const ctx=canvas.getContext('2d')!;ctx.drawImage(image,0,0,1920,1080);
    const stream=canvas.captureStream(10);const timer=setInterval(()=>ctx.drawImage(image,0,0,1920,1080),100);const track=stream.getVideoTracks()[0],stop=track.stop.bind(track);track.stop=()=>{clearInterval(timer);stop();};return stream;
  }}});});
  await page.goto(`http://127.0.0.1:${port}/dev/vision-lab`);
  await page.getByLabel('Compute').selectOption('wasm');
  await page.getByRole('checkbox',{name:'Real webcam test set capture mode'}).check();
  await page.getByLabel('Capture conditions').fill('synthetic smoke fixture, no physical webcam');
  await page.getByLabel('Upload a card photo').setInputFiles(join(data,'benchmark',photos[0].file));
  await page.getByRole('button',{name:'Freeze & outline cards'}).click();
  const outline=page.locator('polygon[role=button]').first();await expect(outline).toBeVisible({timeout:60000});await outline.focus();await page.keyboard.press('Enter');
  console.log('Reading frozen card');
  const dialog=page.getByRole('dialog',{name:'Card matches'});await expect(dialog).toHaveAttribute('aria-busy','false',{timeout:60000});
  await dialog.getByRole('button',{name:'Confirm',exact:true}).click();
  await page.getByRole('button',{name:'Label confirmed card'}).click();
  await page.getByRole('button',{name:'Ask AI',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm AI match'})).toBeVisible();
  const preview=page.getByRole('button',{name:/Recognize a card:/}),rect=(await preview.boundingBox())!;
  const scale=Math.min(rect.width/768,rect.height/576),w=768*scale,h=576*scale;
  await preview.click({position:{x:(rect.width-w)/2+w*.05,y:(rect.height-h)/2+h*.05}});
  await expect(dialog).toHaveAttribute('aria-busy','false',{timeout:60000});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Mark non-card object'}).click();
  const downloadPromise=page.waitForEvent('download');await page.getByRole('button',{name:'Export 2 test samples'}).click();await (await downloadPromise).saveAs(join(out,'export.json'));
  const exported=JSON.parse(await readFile(join(out,'export.json'),'utf8')) as RealsetExport;
  if(exported.samples[1]?.tier==='sure' || !exported.samples[1]?.raw.blocked.includes('fallback'))throw Error('Non-card click reused the previous selected quad');
  if(exported.samples.length!==2 || exported.samples[0].label!==photos[0].cardId || exported.samples[1].label!==null || exported.samples.some(s=>replayTier(s.raw,s.raw.thresholds)!==s.tier))throw Error('Invalid labelled/replay export');
  const learningAfterReads=learningRequests;
  if(learningAfterReads!==1)throw Error('Reads refetched learning');
  await page.getByRole('button',{name:'Resume',exact:true}).click();
  await page.getByRole('button',{name:'Start camera'}).click();await expect(page.getByText('1920 × 1080',{exact:true})).toBeVisible();
  await expect(page.getByText(/[2-6]\/6 buffered/)).toBeVisible();
  await preview.click();await expect(dialog).toHaveAttribute('aria-busy','false',{timeout:60000});await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Freeze & outline cards'}).click();
  await expect(page.getByRole('button',{name:'Mark non-card object'})).toBeDisabled();
  await expect(page.getByRole('button',{name:'Resume',exact:true})).toBeEnabled({timeout:60000});
  const native=await preview.locator('img').evaluate(im=>({width:(im as HTMLImageElement).naturalWidth,height:(im as HTMLImageElement).naturalHeight}));
  if(native.width!==1920 || native.height!==1080)throw Error('Own-feed buffer lost native resolution');
  await page.screenshot({path:join(out,'capture.png'),fullPage:true});
  await page.getByRole('button',{name:'Stop',exact:true}).click();
  if(errors.length || feedbackUploads || aiRequests!==1 || learningRequests!==2)throw Error(`Smoke failed: ${JSON.stringify({errors,feedbackUploads,aiRequests,learningRequests})}`);
  const report={samples:2,positiveLabels:1,negativeLabels:1,replayMatches:true,nativeBuffer:native,aiRequests,aiMocked:true,aiWidth,aiHeight,aiBytes,aiChoices,feedbackUploads,learningRequests,learningAfterReads,browserErrors:errors};
  await writeFile(join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
} finally {await browser.close();await new Promise<void>(done=>server.close(()=>done()));}

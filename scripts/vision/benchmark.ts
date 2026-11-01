/** Synthetic browser-WASM benchmark of the shipped worker. Outputs stay under data/vision. */
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import * as ort from 'onnxruntime-node';
import { embedImages, type SessionLike, type TensorCtor } from '../../packages/vision/src/embed';
import { createDegrader } from './degrade';
import { sharpness } from '../../packages/vision/src/quality';
import { yugioh } from '../../packages/vision/src/games/yugioh';
import type { IndexMeta, RecognitionResult } from '../../packages/vision/src/types';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const out = path.resolve(process.env.VISION_DATA_DIR ?? path.join(root, 'data/vision'));
const directory = path.join(out, 'benchmark');
const seed = 633;
let rng = seed;
const random = () => ((rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 2 ** 32);
const conditions = ['clean', 'blur', 'perspective', 'glare', 'sleeve', 'combined'];
type Photo = { file: string; cardId: string; name: string; condition: string; clickPoint: { x: number; y: number } };
async function download(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(30000), headers: { 'User-Agent': 'YugiDraft-vision-benchmark/1.0' } });
    if (res.ok) return Buffer.from(await res.arrayBuffer());
    if (res.status === 404) throw new Error(`Missing card image: ${url}`);
    const retry = Number(res.headers.get('retry-after') ?? 0);
    await new Promise(done => setTimeout(done, Math.max(retry * 1000, 1500 * 2 ** attempt)));
  }
  throw new Error(`Image download failed: ${url}`);
}
/** Inverse projective map: destination quad -> unit square; Gaussian elimination for 8 unknowns. */
function homography(quad: number[][]): number[] {
  const matrix: number[][] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = quad[i], u = i === 1 || i === 2 ? 1 : 0, v = i >= 2 ? 1 : 0;
    matrix.push([x, y, 1, 0, 0, 0, -u * x, -u * y, u]);
    matrix.push([0, 0, 0, x, y, 1, -v * x, -v * y, v]);
  }
  for (let col = 0; col < 8; col++) {
    let best = col;
    for (let row = col + 1; row < 8; row++) if (Math.abs(matrix[row][col]) > Math.abs(matrix[best][col])) best = row;
    [matrix[col], matrix[best]] = [matrix[best], matrix[col]];
    const pivot = matrix[col][col];
    for (let k = col; k < 9; k++) matrix[col][k] /= pivot;
    for (let row = 0; row < 8; row++) if (row !== col) {
      const f = matrix[row][col]; for (let k = col; k < 9; k++) matrix[row][k] -= f * matrix[col][k];
    }
  }
  return matrix.map(row => row[8]);
}
async function render(image: Buffer, condition: string, index: number): Promise<Buffer> {
  const source = await sharp(image).resize(236, 344).ensureAlpha().raw().toBuffer();
  const w = 768, h = 576, data = Buffer.alloc(w * h * 4);
  const cx = 350 + random() * 68, cy = 285 + random() * 12;
  const oblique = condition === 'perspective' || condition === 'combined';
  const angle = (oblique ? (index % 2 ? -17 : 14) : (index % 3 - 1) * 2) * Math.PI / 180;
  const card = oblique ? [[-104,-155],[101,-131],[119,148],[-113,171]] : [[-118,-172],[118,-172],[118,172],[-118,172]];
  const quad = card.map(([x,y]) => [cx + x * Math.cos(angle) - y * Math.sin(angle), cy + x * Math.sin(angle) + y * Math.cos(angle)]);
  const m = homography(quad);
  const sleeve = condition === 'sleeve' || condition === 'combined';
  const sleeveColor = index % 2 ? [94, 38, 151] : [30, 140, 105];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const o = (y * w + x) * 4;
    const noise = Math.round(random() * 6), base = 33 + noise;
    data[o] = base; data[o+1] = base + 5; data[o+2] = base + 9; data[o+3] = 255;
    const d = m[6] * x + m[7] * y + 1;
    const u = (m[0] * x + m[1] * y + m[2]) / d, v = (m[3] * x + m[4] * y + m[5]) / d;
    if (sleeve && u > -.025 && u < 1.025 && v > -.018 && v < 1.018) {
      data[o] = sleeveColor[0]; data[o+1] = sleeveColor[1]; data[o+2] = sleeveColor[2];
    }
    if (u < 0 || u >= 1 || v < 0 || v >= 1) continue;
    const fx = u * 235, fy = v * 343, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = fx - x0, ty = fy - y0;
    for (let c = 0; c < 3; c++) {
      let value = 0;
      for (let dy = 0; dy <= 1; dy++) for (let dx = 0; dx <= 1; dx++) value += source[(Math.min(343,y0+dy)*236+Math.min(235,x0+dx))*4+c] * (dx ? tx : 1-tx) * (dy ? ty : 1-ty);
      if (condition === 'glare' || condition === 'combined') {
        const glare = .72 * Math.exp(-(((u-.60)/.23)**2 + ((v-.39)/.17)**2));
        value = value * (1-glare) + 255 * glare;
      }
      data[o+c] = value;
    }
  }
  let output = sharp(data, { raw: { width: w, height: h, channels: 4 } });
  if (condition === 'blur' || condition === 'combined') output = output.blur(condition === 'blur' ? 1.8 : 1.2);
  return output.jpeg({ quality: 82 }).toBuffer();
}
async function main() {
  await mkdir(directory, { recursive: true });
  const meta = JSON.parse(await readFile(path.join(out, 'yugioh-index.meta.json'), 'utf8')) as IndexMeta;
  const manifestPath = path.join(directory, 'photos.json');
  let photos: Photo[];
  try { photos = JSON.parse(await readFile(manifestPath, 'utf8')); }
  catch {
    const entries = [...new Map(meta.entries.filter(e => e.passcode > 0).map(e => [e.cardId, e])).values()];
    for (let i = entries.length - 1; i > 0; i--) { const j = Math.floor(random() * (i+1)); [entries[i], entries[j]] = [entries[j], entries[i]]; }
    photos = [];
    for (const entry of entries) {
      const index = photos.length;
      const file = `photo-${String(index).padStart(2,'0')}.jpg`, condition = conditions[Math.floor(index / 5)];
      try {
        const full = await download(`https://images.ygoprodeck.com/images/cards/${entry.imageId ?? entry.passcode}.jpg`);
        await writeFile(path.join(directory, file), await render(full, condition, index));
        photos.push({ file, cardId: entry.cardId, name: entry.name, condition, clickPoint: { x: .5, y: .5 } });
        // >=255ms between image requests, on top of processing time.
        await new Promise(done => setTimeout(done, 255));
      } catch (error) { console.warn(String(error)); }
      if (photos.length === 30) break;
    }
    if (photos.length !== 30) throw new Error('Could not prepare 30 photos');
    await writeFile(manifestPath, JSON.stringify(photos, null, 2));
  }
  if (photos.some(p => !meta.entries.some(e => e.cardId === p.cardId))) throw new Error('Photos do not match this catalog; delete benchmark/photos.json to regenerate');
  // A real varying-quality ring, using Duel Lens's seeded camera degradation plus defocus.
  const base = await sharp(path.join(directory, photos[0].file)).ensureAlpha().raw().toBuffer({resolveWithObject:true});
  const degraded = await createDegrader(yugioh).degrade({data:base.data,width:base.info.width,height:base.info.height}, 'mild', seed);
  const expectedSharpness: number[] = [];
  for (let i=0;i<6;i++) {
    const file=path.join(directory,`temporal-${i}.jpg`);
    await sharp(degraded.data,{raw:{width:degraded.width,height:degraded.height,channels:4}}).blur(.4+i*.9).jpeg({quality:85}).toFile(file);
    const image=await sharp(file).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    expectedSharpness.push(sharpness({data:image.data,width:image.info.width,height:image.info.height}, photos[0].clickPoint));
  }
  await build({ entryPoints: [path.join(root,'packages/vision/src/client.ts')], outfile: path.join(directory,'client.js'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  await build({ stdin: { contents: `import { createModelSession, Tensor } from ${JSON.stringify(path.join(root,'packages/vision/src/runtime.ts'))}; import {embedImages} from ${JSON.stringify(path.join(root,'packages/vision/src/embed.ts'))}; onmessage=async e=>{try{const {url,profile}=e.data;const bitmap=await createImageBitmap(await (await fetch(url)).blob());const canvas=new OffscreenCanvas(bitmap.width,bitmap.height),ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0);bitmap.close();const im=ctx.getImageData(0,0,canvas.width,canvas.height);const session=await createModelSession(profile.embedding.url,profile.embedding.sha256,'wasm');const vectors=await embedImages(session,Tensor,profile.embedding,[im]);await session.release();postMessage({vector:Array.from(vectors[0])});}catch(e){postMessage({error:String(e)})}};`, resolveDir: root }, outfile: path.join(directory,'parity-worker.js'), bundle:true, format:'esm', platform:'browser', target:'es2022', minify:true });
  const mime: Record<string,string> = { '.js':'text/javascript', '.mjs':'text/javascript', '.wasm':'application/wasm', '.json':'application/json', '.jpg':'image/jpeg' };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, 'http://localhost');
      if (url.pathname === '/') { response.setHeader('content-type','text/html'); response.end('<!doctype html><title>Vision WASM benchmark</title>'); return; }
      const file = path.resolve(out, decodeURIComponent(url.pathname.replace('/dev/vision-assets/','')));
      if (!file.startsWith(out + path.sep) || !(await stat(file)).isFile()) throw new Error('not found');
      response.setHeader('content-type',mime[path.extname(file)] ?? 'application/octet-stream'); response.end(await readFile(file));
    } catch { response.statusCode = 404; response.end('not found'); }
  });
  await new Promise<void>(done => server.listen(0,'127.0.0.1',done));
  const address = server.address() as {port:number};
  let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
  try {
    browser = await chromium.launch({ headless:true, args: ['--disable-gpu', '--no-sandbox'] });
    const page = await browser.newPage();
    page.on('pageerror', error => console.error('Browser:',error.message));
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => {
      const { createRecognizer } = await import(/* webpackIgnore: true */ String('/dev/vision-assets/benchmark/client.js'));
      const state = window as unknown as { recognizer: ReturnType<typeof createRecognizer> };
      state.recognizer = createRecognizer({ backend:'wasm' });
    });
    const recognize = async (photo: Photo, copies = 1, clickPoint = photo.clickPoint) => page.evaluate(async ({photo,copies,clickPoint}) => {
      const state = window as unknown as { recognizer: {recognize(frames:ImageBitmap[],opts:unknown):Promise<RecognitionResult>} };
      const frames = await Promise.all(Array.from({length:copies},async (_,i)=> {
        const blob = await (await fetch(`/dev/vision-assets/benchmark/${copies > 1 ? `temporal-${i}.jpg` : photo.file}`)).blob();
        return createImageBitmap(blob);
      }));
      const start = performance.now();
      const result = await state.recognizer.recognize(frames, {clickPoint,k:5});
      return {result,wallMs:performance.now()-start};
    }, {photo,copies,clickPoint});
    const cold = await recognize(photos[0]);
    const records: (Photo & { rank: number; wallMs: number; error?: string } & Partial<RecognitionResult>)[] = [];
    for (const photo of photos) {
      try {
        const {result,wallMs} = await recognize(photo);
        const rank = result.candidates.findIndex(c=>c.cardId === photo.cardId)+1;
        records.push({...photo,rank,wallMs,...result});
        console.log(`${photo.condition.padEnd(11)} ${photo.name}: rank ${rank || 'miss'} · ${result.timingsMs.total.toFixed(0)}ms · detected ${result.quality.detected}`);
      } catch (error) { records.push({...photo,rank:0,error:String(error),wallMs:0}); console.log(`FAIL ${photo.name}: ${error}`); }
    }
    const temporal = await recognize(photos[0],6);
    const expectedFrames = expectedSharpness.map((value,index)=>({value,index})).sort((a,b)=>b.value-a.value).slice(0,3).map(v=>v.index);
    if (JSON.stringify(temporal.result.quality.selectedFrameIndices)!==JSON.stringify(expectedFrames)) throw new Error('Sharpest-frame selection mismatch');
    const imageDataSmoke = await page.evaluate(async photo => {
      const bitmap=await createImageBitmap(await (await fetch(`/dev/vision-assets/benchmark/${photo.file}`)).blob());
      const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height;
      const context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0);bitmap.close();
      const state=window as unknown as {recognizer:{recognize(frames:ImageData[],opts:unknown):Promise<RecognitionResult>}};
      return state.recognizer.recognize([context.getImageData(0,0,canvas.width,canvas.height)],{clickPoint:photo.clickPoint,k:1});
    },photos[0]);
    const fallback = await recognize(photos[0],1,{x:.05,y:.05});
    await page.evaluate(()=> (window as unknown as {recognizer:{dispose():void}}).recognizer.dispose());
    // Compare the exact same cached JPEG art through native and browser WASM preprocessing.
    const report = JSON.parse(await readFile(path.join(out,'yugioh-index.build.json'),'utf8'));
    const first = meta.entries.find(e=>e.passcode>0)!;
    const artFile = path.join(out,'cache',report.cacheIdentity,'artwork',`${first.imageId ?? first.passcode}.jpg`);
    const art = await readFile(artFile);
    await writeFile(path.join(directory,'parity.jpg'),art);
    const native = await ort.InferenceSession.create(path.join(out,'models/dinov2-small-duel.q8.onnx'), { executionProviders:['cpu'], intraOpNumThreads:4 });
    const decoded = await sharp(art).ensureAlpha().raw().toBuffer({resolveWithObject:true});
    const [nv] = await embedImages(native as unknown as SessionLike,ort.Tensor as unknown as TensorCtor,yugioh.embedding,[{data:decoded.data,width:decoded.info.width,height:decoded.info.height}]);
    await native.release();
    const browserVector = await page.evaluate(profile => new Promise<number[]>((resolve,reject)=>{
      const worker = new Worker('/dev/vision-assets/benchmark/parity-worker.js',{type:'module'});
      worker.onmessage = e=>{worker.terminate();e.data.error?reject(new Error(e.data.error)):resolve(e.data.vector)};
      worker.onerror = e=>{worker.terminate();reject(new Error(e.message))};
      worker.postMessage({profile,url:'/dev/vision-assets/benchmark/parity.jpg'});
    }),yugioh);
    const cosine = browserVector.reduce((sum,v,i)=>sum+v*nv[i],0);
    const latencies = records.flatMap(r => r.timingsMs ? [r.timingsMs.total] : []).sort((a,b)=>a-b);
    const percentile = (array:number[],q:number)=>array[Math.min(array.length-1,Math.floor(array.length*q))];
    const results = {
      generatedAt:new Date().toISOString(),seed,photos:photos.length,indexCards:new Set(meta.entries.map(e=>e.cardId)).size,indexVectors:meta.count,modelSha256:meta.modelSha256,
      host:'Ryzen 7 9800X3D / WSL2 / CPU only',browser:browser.version(),wasmThreads:1,crossOriginIsolated:false,
      top1:records.filter(r=>r.rank===1).length/photos.length,top5:records.filter(r=>r.rank>0&&r.rank<=5).length/photos.length,
      detected:records.filter(r=>r.quality?.detected).length,cornersFound:records.filter(r=>r.quality?.cornersFound).length,
      latencyMs:{median:percentile(latencies,.5),p95:percentile(latencies,.95),mean:latencies.reduce((a,b)=>a+b,0)/latencies.length},coldWallMs:cold.wallMs,parityCosine:cosine,
      byCondition:conditions.map(condition=>{const rows=records.filter(r=>r.condition===condition);return {condition,count:rows.length,top1:rows.filter(r=>r.rank===1).length,top5:rows.filter(r=>r.rank>0&&r.rank<=5).length}}),
      temporal,expectedFrames,imageDataSmoke,offCardFallback:fallback,records,
      caveat:'Synthetic transforms of indexed artwork; this measures robustness and WASM execution, not real webcam/open-set accuracy. Detector misses and recognition errors remain in the denominator.',
    };
    await writeFile(path.join(directory,'results.json'),JSON.stringify(results,null,2));
    console.log(JSON.stringify({...results,records:undefined,temporal:undefined,imageDataSmoke:undefined,offCardFallback:undefined},null,2));
    if (cosine < .999) throw new Error(`Native/WASM embedding mismatch: ${cosine}`);
    if (!temporal.result.quality.framesUsed || temporal.result.quality.framesUsed !== 3 || !fallback.result.quality.fallback) throw new Error('Temporal/fallback smoke failed');
  } finally { await browser?.close(); await new Promise<void>(done=>server.close(()=>done())); }
}
main().catch(error=>{ console.error(error);process.exitCode=1; });

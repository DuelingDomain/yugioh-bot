/// <reference lib="webworker" />
import { createModelSession, runtimeDiagnostics, Tensor, type ModelSession } from './runtime';
import { fullArtProfile } from './full-art';
import { RecognitionPipeline, type DeferredAICrop } from './pipeline';
import { embedImages } from './embed';
import { embeddingGpuCheck } from './gpu-check';
import { detect, lastDetectTimings } from './detector/run';
import { prepareSearch } from './search';
import { CARD_DETECTOR } from './detector/spec';
import { detectScene, lastShadowPasses } from './detect-scene';
import { indexVersion, type LearningSnapshot } from './learning';
import { calibratedThresholds } from './threshold-config';
import { LearningCache } from './learning-cache';
import { filterPhysicalIndex } from './physical-index';
import { decodeIndex } from './index-format';
import { validateIndexProfile } from './profile';
import type { GameProfile, LoadedIndex, IndexMeta, RecognizeOptions, DetectOptions, PeekOptions, ReadAllOptions, PrepareOptions, BackendStatus } from './types';
import type { RGBAImage } from './pixels';
import {fitMat, type MatFitOptions} from './mat-fit';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let pipeline: RecognitionPipeline | undefined;
let detectorSession:ModelSession|undefined,detectorLoading:Promise<ModelSession>|undefined,embedderSession:ModelSession|undefined;
/**
 * 'both': one worker runs every request (phones, low memory, WASM by default).
 * 'scene': the detector only, for outline passes; 'read': the embedder and index, its own detector
 * created only when a read has no outline. A split recognizer runs one of each, so a detector pass
 * never waits behind a read (client.ts).
 */
type Role='both'|'scene'|'read';
let configuration:{profile:GameProfile;backend:'auto'|'wasm';runtimeBase:string;role:Role;threads?:number}|undefined;
const DETECTOR_GPU_OUTPUTS=[CARD_DETECTOR.outputs.heat,CARD_DETECTOR.outputs.box,CARD_DETECTOR.outputs.peak];
function ensureDetector():Promise<ModelSession> {
  const {profile,backend,runtimeBase,threads}=configuration!;
  detectorLoading??=createModelSession(profile.detector.url,profile.detector.sha256,backend,runtimeBase,profile.detector.webgpu,{threads,gpuOutputs:DETECTOR_GPU_OUTPUTS})
    .then(session=>detectorSession=session,error=>{detectorLoading=undefined;throw error;});
  return detectorLoading;
}
/** The read worker's detector, created on its first use (watcher reads pass their outline and never run it). */
const lazyDetector:ModelSession={
  get backend(){return detectorSession?.backend??embedderSession?.backend??'wasm';},
  get fallbackReason(){return detectorSession?.fallbackReason;},
  get gpuDiagnostics(){return detectorSession?.gpuDiagnostics;},
  get gpuDevice(){return detectorSession?.gpuDevice;},
  reportGpuFailure:async e=>{await detectorSession?.reportGpuFailure?.(e);},
  run:async feeds=>(await ensureDetector()).run(feeds),
  release:async()=>{await detectorSession?.release();},
};
async function initializeDetector(profile:GameProfile,backend:'auto'|'wasm',runtimeBase:string,role:Role,threads?:number) {
  configuration={profile,backend,runtimeBase,role,threads};
  if(role==='read')return;
  const detector=await ensureDetector();
  // The scene worker serves outlines straight away: compile its kernels outside placement latency.
  if(role==='scene')await detect(detector,Tensor,{width:448,height:448,data:new Uint8ClampedArray(448*448*4).fill(114)},448);
}
function backendStatus(): BackendStatus {
  const models = ([['detector',detectorSession],['embedder',embedderSession]] as const).flatMap(([model,session])=>session?[{
    model, backend: session.backend,
    fallbackReason: session.fallbackReason, gpu: session.gpuDiagnostics,
  }]:[]);
  const failed = models.filter(m => m.backend === 'wasm' && m.fallbackReason);
  const reasons = failed.length > 1 && new Set(failed.map(m => m.fallbackReason)).size === 1
    ? [failed[0].fallbackReason!] : failed.map(m => `${m.model}: ${m.fallbackReason}`);
  return { backend: models.length > 0 && models.every(m => m.backend === 'webgpu') ? 'webgpu' : 'wasm',
    fallbackReason: reasons.length ? reasons.join('; ') : undefined, models };
}
function reply(message: object) {
  scope.postMessage({ ...message, backendStatus: backendStatus(), detectorBackend: detectorSession?.backend, role: configuration?.role });
}
let preparedOptions:PrepareOptions={};
let learningCache:LearningCache|undefined;
let learningTimer:ReturnType<typeof setInterval>|undefined;
const aiCrops=new Map<string,DeferredAICrop>(),cropScope=crypto.randomUUID();let cropSerial=0,cropBytes=0;
function keepAICrop(source:DeferredAICrop):string {
  const token=`${cropScope}:${++cropSerial}`;aiCrops.set(token,source);cropBytes+=source.bytes;
  while(aiCrops.size>6 || cropBytes>64*1024*1024) {
    const oldest=aiCrops.keys().next().value!;cropBytes-=aiCrops.get(oldest)!.bytes;aiCrops.delete(oldest);
  }
  return token;
}
async function checkedJson(url: string): Promise<IndexMeta> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Cannot load ${url}: HTTP ${response.status}. Build the index first.`);
  return response.json();
}
async function initialize(profile: GameProfile, backend: 'auto' | 'wasm', runtimeBase: string) {
  try {
    const meta = await checkedJson(profile.metaUrl);
    validateIndexProfile(meta, profile);
    const response = await fetch(profile.indexUrl);
    if (!response.ok) throw new Error(`Cannot load index: HTTP ${response.status}`);
    const decoded=decodeIndex(await response.arrayBuffer(),meta);
    const index=profile.id==='yugioh'?filterPhysicalIndex(decoded):decoded;
    if(profile.thresholdsUrl) {
      // Eager initialization can hit a cold asset route. A 1.5s timeout repeatedly discarded
      // prewarm attempts before a read; preserve calibration validation while allowing startup.
      const response=await fetch(profile.thresholdsUrl,{cache:'no-store',signal:AbortSignal.timeout(10_000)});
      if(response.ok)profile={...profile,embedding:{...profile.embedding,thresholds:calibratedThresholds(await response.json(),profile,index)}};
      else if(response.status!==404)throw new Error('Cannot load webcam thresholds');
    }
    // Sequential session creation avoids simultaneous WASM runtime initialization.
    const role=configuration!.role;
    const detector = role==='read' ? lazyDetector : detectorSession!;
    const embedder = embedderSession ??= await createModelSession(profile.embedding.url, profile.embedding.sha256, backend, runtimeBase, profile.embedding.webgpu, {threads:configuration!.threads,gpuCheck:embeddingGpuCheck(profile.embedding)});
    let fullArtIndex:LoadedIndex|undefined;
    if(profile.fullArtIndex) {
      const reply=await fetch(profile.fullArtIndex.metaUrl);
      if(reply.ok) {
        const fullMeta=await reply.json() as IndexMeta;
        validateIndexProfile(fullMeta,fullArtProfile(profile));
        const binary=await fetch(profile.fullArtIndex.indexUrl);
        if(!binary.ok) throw new Error('Cannot load full-art index');
        const decoded=decodeIndex(await binary.arrayBuffer(),fullMeta);fullArtIndex=profile.id==='yugioh'?filterPhysicalIndex(decoded):decoded;
      } else if(reply.status!==404) throw new Error('Cannot load full-art metadata');
    }
    pipeline = new RecognitionPipeline(profile, index, detector, embedder, Tensor, fullArtIndex);
    // Compile kernels outside placement/click latency. Never use this warm-up as evidence.
    await embedImages(embedder,Tensor,profile.embedding,[{width:8,height:8,data:new Uint8ClampedArray(8*8*4).fill(128)}]);
    if(role!=='read')await detect(detector,Tensor,{width:448,height:448,data:new Uint8ClampedArray(448*448*4).fill(114)},448);
    prepareSearch(index);if(fullArtIndex)prepareSearch(fullArtIndex);
    clearInterval(learningTimer);
    learningCache=new LearningCache(async()=>{
      const response=await fetch('/api/remote-vision/learning',{cache:'no-store',signal:AbortSignal.timeout(1500)});
      if(!response.ok)throw new Error('Learning unavailable');
      const raw=await response.json();
      if(!raw || !Array.isArray(raw.references) || !Array.isArray(raw.confusions))throw new Error('Invalid learning snapshot');
      const compatible=(r:any)=>r && [index,fullArtIndex].some(i=>i && r.gameId===profile.id && r.modelId===profile.embedding.id && r.modelSha256===profile.embedding.sha256 && r.layoutKey===i.meta.layoutKey && r.indexVersion===indexVersion(i.meta) && r.space===(i===fullArtIndex?'whole-card':'art-box'));
      const value:LearningSnapshot={version:String(raw.version),references:raw.references.filter((r:any)=>compatible(r) && typeof r.chosenCardId==='string' && Array.isArray(r.embedding) && r.embedding.length===index.meta.dim && r.embedding.every(Number.isFinite)).slice(0,512).map((r:any)=>({cardId:r.chosenCardId,embedding:r.embedding,space:r.space})),confusions:raw.confusions.filter((r:any)=>compatible(r) && typeof r.a==='string' && typeof r.b==='string').slice(0,256)};
      return value;
    });
    void learningCache.refresh();
    learningTimer=setInterval(()=>{void learningCache?.refresh();},60_000);

  } catch (error) {
    await embedderSession?.release().catch(()=>{});
    embedderSession=undefined;pipeline=undefined;throw error;
  }
}
let pixelCanvas:OffscreenCanvas|undefined;
function pixels(frame: ImageBitmap | ImageData): RGBAImage {
  if ('close' in frame) {
    try {
      const canvas = pixelCanvas??=new OffscreenCanvas(frame.width, frame.height);
      if(canvas.width!==frame.width)canvas.width=frame.width;
      if(canvas.height!==frame.height)canvas.height=frame.height;
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('OffscreenCanvas 2D is unavailable');
      context.globalCompositeOperation='copy';
      context.drawImage(frame, 0, 0);
      return context.getImageData(0, 0, frame.width, frame.height);
    } finally { frame.close(); }
  }
  return frame;
}
async function jpeg(image:RGBAImage,width:number,maxBytes:number):Promise<string|undefined> {
  const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data.buffer as ArrayBuffer,image.data.byteOffset,image.data.byteLength),image.width,image.height),0,0);
  const output=new OffscreenCanvas(width,Math.round(width*image.height/image.width));
  output.getContext('2d')!.drawImage(canvas,0,0,output.width,output.height);
  for(const quality of [width>224?.88:.72,.6,.4,.2]) {
    const bytes=new Uint8Array(await (await output.convertToBlob({type:'image/jpeg',quality})).arrayBuffer());
    if(bytes.length>maxBytes)continue;
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary);
  }
}
type Request = {id:number;type:'fitToMat';frame:ImageData|ImageBitmap;opts?:MatFitOptions} | { id: number; type: 'checkWebGpu' } | { id: number; type: 'init'; profile: GameProfile; backend: 'auto' | 'wasm'; runtimeBase: string; role?: Role; threads?: number } | {id:number;type:'prepare';opts?:PrepareOptions} | {id:number;type:'aiCrop';token:string} | { id: number; type: 'detect'; frame: ImageBitmap | ImageData; opts?:DetectOptions } | { id: number; type: 'recognize'; frames: (ImageBitmap | ImageData)[]; opts?: RecognizeOptions } | {id:number;type:'peek';frame:ImageBitmap|ImageData;opts:PeekOptions} | {id:number;type:'readAll';frame:ImageBitmap|ImageData;opts:ReadAllOptions};
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data, receivedAt=performance.now();
  // The ONNX sessions are never run concurrently. Failed requests do not poison the queue.
  queue = queue.then(async () => {
    const queueMs=performance.now()-receivedAt;
    try {
      if (message.type === 'init') { await initializeDetector(message.profile, message.backend, message.runtimeBase, message.role??'both', message.threads); reply({ id: message.id, result: null }); }
      else if(message.type==='fitToMat'){reply({id:message.id,result:fitMat(pixels(message.frame),message.opts)});}
      else {
        if(!configuration)throw new Error('Recognizer has not initialized');
        if (message.type === 'checkWebGpu') {
          const { profile, backend, runtimeBase, threads } = configuration;
          const embedder = embedderSession ??= await createModelSession(profile.embedding.url, profile.embedding.sha256, backend, runtimeBase, profile.embedding.webgpu, {threads,gpuCheck:embeddingGpuCheck(profile.embedding)});
          const detectorSession = await ensureDetector();
          const timings: Record<string, number> = {};
          let start = performance.now();
          await embedImages(embedder, Tensor, profile.embedding, [{ width: 8, height: 8, data: new Uint8ClampedArray(8 * 8 * 4).fill(128) }]);
          timings.embedder = performance.now() - start;
          start = performance.now();
          await detect(detectorSession, Tensor, { width: 448, height: 448, data: new Uint8ClampedArray(448 * 448 * 4).fill(114) }, 448);
          timings.detector = performance.now() - start;
          reply({ id: message.id, result: { ...backendStatus(), timingsMs: timings, runtime: runtimeDiagnostics() } }); return;
        }
        if(message.type==='detect') {
          const detectorSession=await ensureDetector();
          const start=performance.now(),image=pixels(message.frame),pixelsMs=performance.now()-start;
          const result=await detectScene(image,configuration.profile,detectorSession,Tensor,message.opts);
          const detectMs=performance.now()-start-pixelsMs,last=lastDetectTimings;
          // Profile split: tensor preprocess, session run (incl. output readback), heatmap decode, then refine/covered/sort.
          const split=last?{shadowPasses:lastShadowPasses(),preprocess:last.preprocessMs,run:last.runMs,readback:last.readbackMs,decode:last.decodeMs,post:Math.max(0,detectMs-last.preprocessMs-last.runMs-last.readbackMs-last.decodeMs)}:{};
          reply({id:message.id,result,timingsMs:{queue:queueMs,pixels:pixelsMs,detect:detectMs,...split,worker:performance.now()-start}});return;
        }
        if(message.type==='aiCrop') {
          const source=aiCrops.get(message.token);if(!source)throw new Error('Card image expired. Read the card again before asking AI.');
          const warp=source.create();if(!warp)throw new Error('Could not straighten the card image');
          const encoded=await jpeg(warp,warp.width,256*1024);if(!encoded)throw new Error('Could not encode the card image');
          reply({id:message.id,result:encoded});return;
        }
        if(!pipeline)await initialize(configuration.profile,configuration.backend,configuration.runtimeBase);
        if(message.type==='prepare'){
          if(message.opts) {
            const gallery=message.opts.sessionGallery??[];
            if(gallery.length>512 || gallery.some(r=>typeof r.cardId!=='string'||!['art-box','whole-card'].includes(r.embedding?.space)||!Array.isArray(r.embedding?.values)||r.embedding.values.length!==configuration!.profile.embedding.dim||!r.embedding.values.every(Number.isFinite)))throw new Error('Invalid session gallery');
            preparedOptions={...message.opts,priors:message.opts.priors?{...message.opts.priors,voiceMentioned:undefined}:undefined};
          }
          reply({id:message.id,result:{backend:backendStatus().backend}});return;}
        if(learningCache) {
          const learning=learningCache.current();
          pipeline!.setLearning({...learning,references:[...learning.references,...(preparedOptions.sessionGallery??[]).map(r=>({cardId:r.cardId,embedding:r.embedding.values,space:r.embedding.space}))]});
        }
        if(message.type==='peek') {reply({id:message.id,result:await pipeline!.peek(pixels(message.frame),{priors:preparedOptions.priors,...message.opts})});return;}
        if(message.type==='readAll') {reply({id:message.id,result:await pipeline!.readAll(pixels(message.frame),{priors:preparedOptions.priors,...message.opts})});return;}
        const workerStart=performance.now();
        const images: RGBAImage[] = [];
        try { for (const frame of message.frames) images.push(pixels(frame)); }
        finally { for (const frame of message.frames) if ('close' in frame) frame.close(); }
        const pixelsMs=performance.now()-workerStart;
        const result = await pipeline!.recognize(images, {priors:preparedOptions.priors,...message.opts});
        const encodeStart=performance.now();
        const {warpedCard,aiWarpedCard,deferredAICrop,...publicResult}=result;
        if(warpedCard) publicResult.cropJpeg=await jpeg(warpedCard,224,32*1024);
        if(deferredAICrop)publicResult.aiCropToken=keepAICrop(deferredAICrop);
        if(aiWarpedCard)publicResult.aiCropJpeg=await jpeg(aiWarpedCard,aiWarpedCard.width,256*1024);
        publicResult.timingsMs.queue=queueMs;publicResult.timingsMs.pixels=pixelsMs;publicResult.timingsMs.encode=performance.now()-encodeStart;publicResult.timingsMs.worker=performance.now()-workerStart;
        reply({ id: message.id, result: { ...publicResult, runtime: runtimeDiagnostics() } });
      }
    } catch (error) { reply({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    finally {
      // Also release transferred pixels when lazy model/index loading fails before pixels().
      if('frame' in message && 'close' in message.frame)message.frame.close();
      if('frames' in message)for(const frame of message.frames)if('close' in frame)frame.close();
    }
  });
};

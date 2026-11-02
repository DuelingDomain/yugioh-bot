/// <reference lib="webworker" />
import { createModelSession, runtimeDiagnostics, Tensor, type ModelSession } from './runtime';
import { fullArtProfile } from './full-art';
import { RecognitionPipeline, type DeferredAICrop } from './pipeline';
import { embedImages } from './embed';
import { detectScene } from './detect-scene';
import { indexVersion, type LearningSnapshot } from './learning';
import { calibratedThresholds } from './threshold-config';
import { LearningCache } from './learning-cache';
import { filterPhysicalIndex } from './physical-index';
import { decodeIndex } from './index-format';
import { validateIndexProfile } from './profile';
import type { GameProfile, LoadedIndex, IndexMeta, RecognizeOptions, PeekOptions, ReadAllOptions } from './types';
import type { RGBAImage } from './pixels';
const scope = self as unknown as DedicatedWorkerGlobalScope;
let pipeline: RecognitionPipeline | undefined;
let detectorSession:ModelSession|undefined;
let configuration:{profile:GameProfile;backend:'auto'|'wasm';runtimeBase:string}|undefined;
async function initializeDetector(profile:GameProfile,backend:'auto'|'wasm',runtimeBase:string) {
  configuration={profile,backend,runtimeBase};
  detectorSession=await createModelSession(profile.detector.url,profile.detector.sha256,backend,runtimeBase);
  sessions.push(detectorSession);
}
let sessions: ModelSession[] = [];
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
    const detector = detectorSession!;
    const embedder = await createModelSession(profile.embedding.url, profile.embedding.sha256, backend, runtimeBase); sessions.push(embedder);
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
    await Promise.allSettled(sessions.filter(s=>s!==detectorSession).map(s => s.release()));
    sessions=detectorSession?[detectorSession]:[];pipeline=undefined;throw error;
  }
}
function pixels(frame: ImageBitmap | ImageData): RGBAImage {
  if ('close' in frame) {
    try {
      const canvas = new OffscreenCanvas(frame.width, frame.height);
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context) throw new Error('OffscreenCanvas 2D is unavailable');
      context.drawImage(frame, 0, 0);
      return context.getImageData(0, 0, frame.width, frame.height);
    } finally { frame.close(); }
  }
  return frame;
}
async function jpeg(image:RGBAImage,width:number,maxBytes:number):Promise<string|undefined> {
  const canvas=new OffscreenCanvas(image.width,image.height),ctx=canvas.getContext('2d')!;
  ctx.putImageData(new ImageData(new Uint8ClampedArray(image.data),image.width,image.height),0,0);
  const output=new OffscreenCanvas(width,Math.round(width*image.height/image.width));
  output.getContext('2d')!.drawImage(canvas,0,0,output.width,output.height);
  for(const quality of [width>224?.88:.72,.6,.4,.2]) {
    const bytes=new Uint8Array(await (await output.convertToBlob({type:'image/jpeg',quality})).arrayBuffer());
    if(bytes.length>maxBytes)continue;
    let binary='';for(const byte of bytes)binary+=String.fromCharCode(byte);
    return btoa(binary);
  }
}
type Request = { id: number; type: 'init'; profile: GameProfile; backend: 'auto' | 'wasm'; runtimeBase: string } | {id:number;type:'prepare'} | {id:number;type:'aiCrop';token:string} | { id: number; type: 'detect'; frame: ImageBitmap | ImageData } | { id: number; type: 'recognize'; frames: (ImageBitmap | ImageData)[]; opts?: RecognizeOptions } | {id:number;type:'peek';frame:ImageBitmap|ImageData;opts:PeekOptions} | {id:number;type:'readAll';frame:ImageBitmap|ImageData;opts:ReadAllOptions};
let queue = Promise.resolve();
scope.onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  // The ONNX sessions are never run concurrently. Failed requests do not poison the queue.
  queue = queue.then(async () => {
    try {
      if (message.type === 'init') { await initializeDetector(message.profile, message.backend, message.runtimeBase); scope.postMessage({ id: message.id, result: null }); }
      else {
        if(!configuration||!detectorSession)throw new Error('Recognizer has not initialized');
        if(message.type==='detect') {scope.postMessage({id:message.id,result:await detectScene(pixels(message.frame),configuration.profile,detectorSession,Tensor)});return;}
        if(message.type==='aiCrop') {
          const source=aiCrops.get(message.token);if(!source)throw new Error('Card image expired. Read the card again before asking AI.');
          const warp=source.create();if(!warp)throw new Error('Could not straighten the card image');
          const encoded=await jpeg(warp,warp.width,256*1024);if(!encoded)throw new Error('Could not encode the card image');
          scope.postMessage({id:message.id,result:encoded});return;
        }
        if(!pipeline)await initialize(configuration.profile,configuration.backend,configuration.runtimeBase);
        if(message.type==='prepare'){scope.postMessage({id:message.id,result:null});return;}
        if(learningCache)pipeline!.setLearning(learningCache.current());
        if(message.type==='peek') {scope.postMessage({id:message.id,result:await pipeline!.peek(pixels(message.frame),message.opts)});return;}
        if(message.type==='readAll') {scope.postMessage({id:message.id,result:await pipeline!.readAll(pixels(message.frame),message.opts)});return;}
        const images: RGBAImage[] = [];
        try { for (const frame of message.frames) images.push(pixels(frame)); }
        finally { for (const frame of message.frames) if ('close' in frame) frame.close(); }
        const result = await pipeline!.recognize(images, message.opts);
        const {warpedCard,aiWarpedCard,deferredAICrop,...publicResult}=result;
        if(warpedCard) publicResult.cropJpeg=await jpeg(warpedCard,224,32*1024);
        if(deferredAICrop)publicResult.aiCropToken=keepAICrop(deferredAICrop);
        if(aiWarpedCard)publicResult.aiCropJpeg=await jpeg(aiWarpedCard,aiWarpedCard.width,256*1024);
        scope.postMessage({ id: message.id, result: { ...publicResult, runtime: runtimeDiagnostics() } });
      }
    } catch (error) { scope.postMessage({ id: message.id, error: error instanceof Error ? error.message : String(error) }); }
    finally {
      // Also release transferred pixels when lazy model/index loading fails before pixels().
      if('frame' in message && 'close' in message.frame)message.frame.close();
      if('frames' in message)for(const frame of message.frames)if('close' in frame)frame.close();
    }
  });
};

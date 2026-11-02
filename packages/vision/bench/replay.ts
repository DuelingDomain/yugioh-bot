import {createRecognizer} from '../src/client';
import {yugioh} from '../src/games/yugioh';
import {createFieldWatcher} from '../src/field-watcher';
import {createOwnFeedBuffer} from '../src/frame-buffer';
import {boundsOf} from '../src/geometry';
import {efficientRecognizer} from './efficient';
import {createTrackedWatcher} from './tracked-watcher';
import type {LabelledSession,ReplayResult,Variant,PredictedEvent} from './session';
export interface ReplayOptions {variant?:Variant;backend?:'wasm'|'webgpu';deck?:boolean;signal?:AbortSignal;onProgress?:(atMs:number)=>void;workerUrl?:string;videoUrl?:string;onReady?:()=>Promise<void>}
export async function hardwareGPU():Promise<{available:boolean;reason?:string;info?:unknown}> {
  const gpu=(navigator as Navigator&{gpu?:{requestAdapter():Promise<{isFallbackAdapter?:boolean;info?:{vendor?:string;architecture?:string;description?:string}}|null>}}).gpu;
  if(!gpu)return {available:false,reason:'WebGPU API unavailable'};
  const adapter=await gpu.requestAdapter();if(!adapter)return {available:false,reason:'No adapter'};
  const description=JSON.stringify(adapter.info??{});if(adapter.isFallbackAdapter||/swiftshader|llvmpipe|software/i.test(description))return {available:false,reason:'Software/fallback adapter refused',info:adapter.info};
  return {available:true,info:adapter.info};
}
/** Shared by browser label prefill and CLI. Real-time playback, native ring,
 * unchanged production watcher baseline; truth identities never enter the reader. */
export async function replaySession(video:HTMLVideoElement,session:LabelledSession,options:ReplayOptions={}):Promise<ReplayResult> {
  const variant=options.variant??'baseline',backend=options.backend??'wasm',efficient=variant==='efficient'||variant==='combined';
  if(backend==='webgpu'&&!(await hardwareGPU()).available)throw Error('Hardware WebGPU unavailable');
  const result:ReplayResult={variant,requestedBackend:backend,events:[],detections:[],wallMs:0,warmMs:0,inferenceMs:0,errors:[],backends:[],runtime:[],stats:{}};
  const reader=createRecognizer({backend:backend==='wasm'?'wasm':'auto',profile:efficient?{...yugioh,detector:{...yugioh.detector,longSide:640}}:yugioh,workerUrl:options.workerUrl});
  const clock=()=>video.currentTime*1000;
  const impl=efficient?efficientRecognizer(reader,clock):reader;
  let frameAt=0;const candidates=new Map<string,{ids:string[];tier?:string}>(),positions=new Map<string,string>();
  const instrumented={prepare:()=>reader.prepare(),
    async detectCards(frame:ImageBitmap|ImageData){const start=performance.now(),at=clock();const cards=await impl.detectCards(frame);result.inferenceMs+=performance.now()-start;result.detections.push({atMs:at,cards:cards.map(c=>({box:boundsOf(c.quad),confidence:c.confidence}))});return cards;},
    async recognize(frames:ImageBitmap[]|ImageData[],opts:Parameters<typeof reader.recognize>[1]){const start=performance.now(),value=await impl.recognize(frames,opts);result.inferenceMs+=performance.now()-start;if(!result.backends.includes(value.backend))result.backends.push(value.backend);if(value.runtime&&!result.runtime.some(r=>JSON.stringify(r)===JSON.stringify(value.runtime)))result.runtime.push(value.runtime);return value;},
  };
  let watcher:ReturnType<typeof createFieldWatcher>|ReturnType<typeof createTrackedWatcher>|undefined,buffer:ReturnType<typeof createOwnFeedBuffer>|undefined;
  try {
    video.pause();video.playbackRate=1;video.muted=true;
    if(options.videoUrl)video.src=options.videoUrl;
    if(video.readyState<2)await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{cleanup();reject(Error('Video load timeout'));},15000),done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(Error('Video failed to decode'));},cleanup=()=>{clearTimeout(timer);video.removeEventListener('loadeddata',done);video.removeEventListener('error',failed);};video.addEventListener('loadeddata',done,{once:true});video.addEventListener('error',failed,{once:true});video.load();});
    if(video.currentTime!==0)await new Promise<void>(done=>{video.addEventListener('seeked',()=>done(),{once:true});video.currentTime=0;});
    const warm=performance.now();await reader.prepare();result.warmMs=performance.now()-warm;
    buffer=createOwnFeedBuffer(video);
    const watcherOptions={recognizer:instrumented,buffer:{async sample(){const s=await buffer!.sample();frameAt=clock();return s;}},profile:yugioh,calibration:session.calibration,format:session.format,getPriors:()=>options.deck!==false?{decklist:session.decklist}:undefined,hidden:()=>false};
    watcher=variant==='reid'||variant==='combined'?createTrackedWatcher(watcherOptions):createFieldWatcher(watcherOptions);
    watcher.subscribe(event=>{
      const t=event.track;if(event.result)candidates.set(t.id,{ids:event.result.candidates.map(c=>c.cardId),tier:event.result.tier});
      const previous=positions.get(t.id);positions.set(t.id,t.position);
      const kind:PredictedEvent['kind']=event.type==='moved'&&previous&&previous!==t.position?'defense':event.type;
      const rank=candidates.get(t.id);result.events.push({atMs:clock(),frameAtMs:frameAt,kind,trackId:t.id,cardId:t.cardId,zone:event.type==='removed'?'UNKNOWN':t.zone,box:boundsOf(t.card.quad),candidates:rank?.ids??(t.cardId?[t.cardId]:undefined),tier:rank?.tier,faceDown:t.faceDown,position:t.position});
    });
    await options.onReady?.();const start=performance.now();await video.play();watcher.start();
    await new Promise<void>((resolve,reject)=>{
      const interval=setInterval(()=>{options.onProgress?.(clock());if(options.signal?.aborted){cleanup();reject(new DOMException('Replay cancelled','AbortError'));return;}if(watcher?.getSnapshot().status==='error'){const message=watcher.getSnapshot().error??'Watcher failed';cleanup();reject(Error(message));return;}if(video.ended||clock()>=session.durationMs-25){cleanup();resolve();}},100);
      const timeout=setTimeout(()=>{cleanup();reject(Error('Replay exceeded video duration plus 30 seconds'));},session.durationMs+30000);
      function cleanup(){clearInterval(interval);clearTimeout(timeout);}
    });
    result.wallMs=performance.now()-start;
    if(efficient)result.stats={...(impl as ReturnType<typeof efficientRecognizer>).stats};
    result.stats.watcherErrors=watcher.getSnapshot().metrics.errors;
    if(result.stats.watcherErrors)result.errors.push(`${result.stats.watcherErrors} watcher errors`);
    return result;
  }finally{video.pause();watcher?.dispose();buffer?.stop();reader.dispose();}
}

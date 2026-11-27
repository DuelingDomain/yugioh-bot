import { yugioh } from './games/yugioh';
import { validateOptions } from './options';
import { validateBoard } from './board';
import type { CardReader, GameProfile, RecognitionResult, RecognizeOptions, DetectedQuad, DetectOptions, PeekOptions, PeekResult, ReadAllOptions, BoardResult, PrepareOptions, BackendStatus } from './types';
import type {MatFitOptions, MatFitResult} from './mat-fit';

/** Names for the app tray. Only an explicitly selected Hybrid reader calls this. */
export async function loadHybridCatalog():Promise<{entries:import('./types').IndexEntry[]}> {
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    return await Promise.race([
      (async()=>{
        const [{HYBRID_ASSETS},{fetchModelChecked}]=await Promise.all([import('./hybrid-models'),import('./model-cache')]);
        const asset=HYBRID_ASSETS.catalog,reply=await fetchModelChecked(asset.url,asset.sha256,{signal:controller.signal});
        if(!reply.ok)throw new Error(`Hybrid catalog HTTP ${reply.status}`);return reply.json();
      })(),
      new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Hybrid catalog timed out'));},8_000);}),
    ]);
  }finally{clearTimeout(timer);}
}

/** One CPU request in an isolated vision worker. No model/index warmup or per-frame inference. */
export function fitToMat(frame:ImageData|ImageBitmap, options:MatFitOptions&{signal?:AbortSignal;workerUrl?:string}={}):Promise<MatFitResult> {
  const {signal,workerUrl,...opts}=options;
  signal?.throwIfAborted();
  return new Promise((resolve,reject)=>{
    const worker=new Worker(workerUrl??'/dev/vision-lab/assets/worker.js?v=mat-fit-v1',{type:'module',name:'mat-fit'});
    const finish=(error?:Error,result?:MatFitResult)=>{
      clearTimeout(timeout);signal?.removeEventListener('abort',abort);worker.terminate();
      if(error)reject(error);else resolve(result!);
    };
    const abort=()=>finish(new DOMException('Mat fit cancelled','AbortError'));
    const timeout=setTimeout(()=>finish(new Error('Mat fit timed out')),10_000);
    signal?.addEventListener('abort',abort,{once:true});
    worker.onmessage=event=>{
      if(event.data.id!==1)return;
      finish(event.data.error?new Error(event.data.error):undefined,event.data.result);
    };
    worker.onerror=event=>finish(new Error(event.message||'Mat fit worker failed'));
    worker.onmessageerror=()=>finish(new Error('Mat fit response could not be read'));
    try{worker.postMessage({id:1,type:'fitToMat',frame,opts},typeof ImageBitmap!=='undefined'&&frame instanceof ImageBitmap?[frame]:[]);}
    catch(error){finish(error instanceof Error?error:new Error(String(error)));}
  });
}
export type FeedbackSource='pick'|'search'|'voice'|'ai';
export interface AIReading { name: string | null; setCode?: string; passcode?: number; match: {passcode: number; name: string} | null }
export interface RecognizerConfig {
  reader?: CardReader;
  game?: 'yugioh';
  /** Override the built-in game profile (including model/index URLs). */
  profile?: GameProfile;
  /** Reports actual providers and exact fallback reasons from the worker, including warmup/detection. */
  onBackendChange?: (status: BackendStatus) => void;
  /** A crashed or hung worker requires replacement. */
  onWorkerFailure?: (error: Error) => void;
  /** The worker's GPU device was lost. The caller can replace the worker. */
  onGpuDeviceLost?: (error: Error) => void;
  backend?: 'auto' | 'wasm'; workerUrl?: string; runtimeBase?: string;
  /** One worker, or a detector worker beside the read worker (default 'auto': see chooseWorkerLayout). */
  workers?: WorkerLayout;
  /** ONNX Runtime WASM threads per worker (default: see chooseWorkerLayout). */
  threads?: number;
}
type BackgroundFrameOptions = {
  /** Discard cancelled or late results at the job boundary while keeping the worker warm. */
  background?: boolean;
};
export interface Recognizer {
  /** Actual providers and fallback reasons from the last worker response. */
  readonly backendStatus?: BackendStatus;
  /** Runs both shipped models in the worker without loading the card index. Use a dedicated recognizer. */
  checkWebGpu(): Promise<BackendStatus & { timingsMs: Record<string, number> }>;
  /** Current detector provider, including fallback after a GPU failure. */
  readonly detectorBackend?: 'webgpu' | 'wasm';
  readonly detectorTimingsMs?:Record<string,number>;
  /** True once the layout is split: detectCards() may then run while a read runs (it no longer shares the read's in-progress guard). */
  readonly separateDetector?: boolean;
  /** Load the worker, index and model sessions before a person asks to read a card. Safe to call repeatedly. */
  warmup(): Promise<void>;
  /** Explicit camera startup: load the resident index/embedder and warm inference before placements. */
  prepare(opts?:PrepareOptions):Promise<{backend:'webgpu'|'wasm'}>;
  /** ImageBitmaps transfer to the worker and are consumed. ImageData is copied. Up to 12 frames. */
  recognize(frames: ImageBitmap[] | ImageData[], opts?: RecognizeOptions): Promise<RecognitionResult>;
  detectCards(frame: ImageBitmap | ImageData, opts?: DetectOptions & BackgroundFrameOptions, signal?: AbortSignal): Promise<DetectedQuad[]>;
  /** Local name/tier only, without a crop, AI request or correction history. Same-frame outlines only. */
  peek(frame: ImageBitmap | ImageData, opts: PeekOptions & BackgroundFrameOptions): Promise<PeekResult>;
  /** Reads at most 60 outlined cards sequentially. Abort terminates the active worker; next use reinitializes. */
  readAll(frame: ImageBitmap | ImageData, opts?: ReadAllOptions): Promise<BoardResult>;
  askAI(result: RecognitionResult, options?: { explicitRequest?: boolean; signal?: AbortSignal }): Promise<AIReading>;
  recordFeedback(result:RecognitionResult,chosenCardId:string,source:FeedbackSource):Promise<{id:string}>;
  dispose(): void;
}
/** Worker layout. 'auto': split on a desktop WebGPU adapter, one worker on phones, low memory and WASM. */
export type WorkerLayout = 'auto' | 'single' | 'split';
const WASM_THREADS = (cores: number) => Math.max(1, Math.min(4, Math.floor(cores / 2)));
/**
 * Two workers (a detector-only "scene" worker and a "read" worker with the embedder) let an outline pass
 * run while a card is being read. They cost a second ONNX Runtime instance and detector session.
 * Measured (2026-11-03): see packages/vision/REPORT.md, "Split workers".
 */
const oneCpuWorker = (cores: number) => ({ split: false, threads: Math.min(2,WASM_THREADS(cores)) });
export async function chooseWorkerLayout(layout: WorkerLayout, backend: 'auto' | 'wasm'): Promise<{ split: boolean; threads?: number; readThreads?: number }> {
  const nav = (globalThis as { navigator?: Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean }; gpu?: import('./web-runtime').GpuLike } }).navigator;
  const cores = nav?.hardwareConcurrency ?? 1;
  // Hardware GPU layouts retain half of the one-worker budget per lane.
  const half = Math.max(1, Math.floor(WASM_THREADS(cores) / 2));
  if (layout === 'single') return { split: false };
  if (layout === 'split') return backend==='wasm'?{split:true,threads:1,readThreads:WASM_THREADS(cores)}:{split:true,threads:half};
  const mobile = nav?.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent ?? '');
  const one = oneCpuWorker(cores);
  if (mobile || (nav?.deviceMemory !== undefined && nav.deviceMemory < 4) || cores < 4) return one;
  // CPU, 8+ cores: leave room for outgoing video. Detection uses one thread and reads keep the original budget.
  // Below 8 cores, on Safari and without SharedArrayBuffer, two runtimes are not worth their cost.
  const safari = /^((?!chrome|chromium|android|edg).)*safari/i.test(nav?.userAgent ?? '');
  const cpu = cores >= 8 && !safari && typeof SharedArrayBuffer !== 'undefined' ? { split: true, threads: 1, readThreads: WASM_THREADS(cores) } : one;
  if (backend === 'wasm' || !nav?.gpu) return cpu;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const adapter = await Promise.race([
      nav.gpu.requestAdapter({ powerPreference: 'high-performance' }),
      new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), 3000); }),
    ]);
    // A software adapter (SwiftShader) runs on the CPU like WASM.
    if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return cpu;
  } catch { return cpu; }
  finally { clearTimeout(timer); }
  return { split: true, threads: half };
}
interface Lane {
  role: 'both' | 'scene' | 'read';
  worker?: Worker; initial?: Promise<unknown>; inFlight: boolean; status?: BackendStatus;
  pending: Map<number, { resolve(value: unknown): void; reject(error: Error): void }>;
}
class HybridWorkerFailed extends Error {}
const HYBRID_WORKER_WAIT_MS = 15_000;
const BACKGROUND_INFERENCE_MS = 3_000;
const BACKGROUND_WORKER_HANG_MS = 60_000;
const FOREGROUND_WORKER_HANG_MS = 240_000;
// Cold setup can download and warm several models before the first read.
const SETUP_WORKER_HANG_MS = 900_000;
export function createRecognizer(config: RecognizerConfig = {}): Recognizer {
  if (config.game !== undefined && config.game !== 'yugioh') throw new Error(`Unsupported game: ${config.game}`);
  const profile = config.profile ?? yugioh;
  let disposed = false, serial = 0;
  let backendStatus: BackendStatus | undefined, detectorBackend: Recognizer['detectorBackend'];
  let detectorTimingsMs:Record<string,number>|undefined;
  let prepared:Promise<{backend:'webgpu'|'wasm'}>|undefined;
  let selectedReader=config.reader, readerNote:string|undefined, lastPrepare:PrepareOptions|undefined;
  let restorePrepare = false;
  let layout: Promise<{ split: boolean; threads?: number; readThreads?: number }> | undefined;
  const single: Lane = { role: 'both', inFlight: false, pending: new Map() };
  let scene = single, read = single;
  const lanes = () => scene === read ? [read] : [scene, read];
  const failAll = (lane: Lane, error: Error) => { for (const value of lane.pending.values()) value.reject(error); lane.pending.clear(); };
  /** Both lanes can run a detector; the read lane starts its detector lazily. */
  function mergeStatus() {
    const models = scene === read ? read.status?.models ?? [] : [
      ...(scene.status?.models ?? []),
      ...(read.status?.models.map(m => m.model === 'detector' ? { ...m, model: 'read detector' } : m) ?? []),
    ];
    if (!models.length) return;
    const failed = models.filter(m => m.backend === 'wasm' && m.fallbackReason);
    const reasons = failed.length > 1 && new Set(failed.map(m => m.fallbackReason)).size === 1 ? [failed[0].fallbackReason!] : failed.map(m => `${m.model}: ${m.fallbackReason}`);
    const note=readerNote??read.status?.readerNote;
    backendStatus = { backend: models.every(m => m.backend === 'webgpu') ? 'webgpu' : 'wasm', fallbackReason: reasons.length ? reasons.join('; ') : undefined, models, ...(note?{readerNote:note}:{}) };
    config.onBackendChange?.(backendStatus);
  }
  function fallbackReader(lane:Lane) {
    selectedReader='current';
    readerNote='Hybrid reader stopped responding. Using the current reader. Switch readers to retry.';
    reset(lane);lane.status=undefined;
    failAll(lane,new HybridWorkerFailed(readerNote));
    backendStatus={backend:backendStatus?.backend??'wasm',models:[],readerNote};
    config.onBackendChange?.(backendStatus);
  }
  function request(lane: Lane, message: {type: string} & Record<string, unknown>, transfers: Transferable[] = [], signal?: AbortSignal): Promise<unknown> {
    signal?.throwIfAborted();
    const id = ++serial;
    const worker = lane.worker!;
    const hybrid=selectedReader==='hybrid'&&lane.role!=='scene';
    const setup = message.type === 'init' || message.type === 'prepare';
    const hangMs = hybrid ? HYBRID_WORKER_WAIT_MS : setup ? SETUP_WORKER_HANG_MS : FOREGROUND_WORKER_HANG_MS;
    const timer = setTimeout(() => {
      if (lane.worker === worker) workerFailed(lane, new Error('Recognition worker stopped responding'));
    }, hangMs);
    const pending=new Promise((resolve, reject) => {
      lane.pending.set(id, { resolve, reject });
      // Keep the originals until Hybrid answers: a terminated worker cannot return transferred pixels.
      try { worker.postMessage({ ...message, id }, hybrid?[]:transfers); }
      catch (error) { lane.pending.delete(id); reject(error); }
    });
    if(!hybrid)return pending.finally(()=>clearTimeout(timer));
    return pending.catch(async error => {
      if(!(error instanceof HybridWorkerFailed)||disposed)throw error;
      clearTimeout(timer);
      const initialized=await startLane(lane,threadsOf(lane));
      if(message.type==='init')return initialized;
      if(lastPrepare&&message.type!=='prepare')await request(lane,{type:'prepare',opts:lastPrepare},[],signal);
      return await request(lane,message,transfers,signal);
    }).finally(()=>clearTimeout(timer));
  }
  function reset(lane: Lane) {
    lane.worker?.terminate(); lane.worker = undefined; lane.initial = undefined;
    if (lane === read) prepared = undefined;
  }
  function workerFailed(lane: Lane, error: Error) {
    if (selectedReader === 'hybrid' && lane.role !== 'scene') { fallbackReader(lane); return; }
    failAll(lane, error);
    reset(lane);
    useOneWorker(lane);
    config.onWorkerFailure?.(error);
  }
  function startLane(lane: Lane, threads?: number) {
    if (!lane.initial) {
      if (lane !== read) detectorBackend = undefined;
      const worker = lane.worker = new Worker(config.workerUrl ?? '/dev/vision-lab/assets/worker.js?v=gpu-recovery-v1', { type: 'module', name: lane.role === 'both' ? 'card-recognition' : `card-recognition-${lane.role}` });
      worker.onmessage = event => {
        if (lane.worker !== worker) return;
        const { id, result, error, detectorBackend: backend, timingsMs, backendStatus: status, type, reason } = event.data;
        if (type === 'gpu-device-lost' && typeof reason === 'string') {
          config.onGpuDeviceLost?.(new Error(reason));
          return;
        }
        const value = lane.pending.get(id); if (!value) return; lane.pending.delete(id);
        if (status) { lane.status = status; mergeStatus(); }
        if (lane !== read || read === scene) {
          if (backend === 'webgpu' || backend === 'wasm') detectorBackend = backend;
          if (timingsMs) detectorTimingsMs = timingsMs;
        }
        if (error) value.reject(new Error(error)); else value.resolve(result);
      };
      const crash = (error: Error) => { if (lane.worker === worker) workerFailed(lane, error); };
      worker.onerror = event => crash(new Error(event.message || 'Recognition worker failed'));
      worker.onmessageerror = () => crash(new Error('Recognition worker message failed'));
      lane.initial = request(lane, { type: 'init', profile, backend: config.backend ?? 'auto', runtimeBase: config.runtimeBase ?? '/dev/vision-lab/assets/ort/', role: lane.role, threads,
        ...(config.onGpuDeviceLost ? {reportGpuLoss: true} : {}),
        ...(selectedReader==='hybrid'&&lane.role!=='scene'?{reader:'hybrid'}:{}) }).catch(error => {
        if (lane.worker === worker) { reset(lane); useOneWorker(lane); }
        throw error;
      });
    }
    return lane.initial;
  }
  /** A split worker failed: the next request starts one worker instead of restarting this one on every tick. */
  function useOneWorker(failed: Lane) {
    if (scene === read || config.workers === 'split') return;
    const other = failed === scene ? read : scene;
    scene = read = single;prepared = undefined;
    layout = Promise.resolve(oneCpuWorker(globalThis.navigator?.hardwareConcurrency ?? 1));
    failAll(other, new Error('Recognition worker stopped; continuing with one worker'));reset(other);
  }
  /** The lane that serves `which`; the layout is chosen once, on first use. */
  async function laneFor(which: 'scene' | 'read'): Promise<Lane> {
    const chosen = await (layout ??= chooseWorkerLayout(config.workers ?? 'auto', config.backend ?? 'auto').catch(() => ({ split: false } as { split: boolean; threads?: number; readThreads?: number })));
    if (disposed) throw new Error('Recognizer is disposed');
    singleThreads = chosen.split ? undefined : chosen.threads;
    if (chosen.split && scene === single) {
      sceneThreads = chosen.threads;readThreads = chosen.readThreads ?? chosen.threads;
      scene = { role: 'scene', inFlight: false, pending: new Map() };
      read = { role: 'read', inFlight: false, pending: new Map() };
    }
    return which === 'scene' ? scene : read;
  }
  let sceneThreads: number | undefined, readThreads: number | undefined, singleThreads: number | undefined;
  const threadsOf = (lane: Lane) => config.threads ?? (lane.role === 'scene' ? sceneThreads : lane.role === 'read' ? readThreads : singleThreads);
  async function initialize(which: 'scene' | 'read') { const lane = await laneFor(which); return startLane(lane, threadsOf(lane)); }
  async function restoreReadOptions(lane: Lane, signal?: AbortSignal) {
    if (!restorePrepare || !lastPrepare) return;
    await request(lane, { type: 'prepare', opts: lastPrepare }, [], signal);
    signal?.throwIfAborted();
    restorePrepare = false;
  }
  async function frameRequest(lane: Lane, type: 'detect' | 'peek' | 'readAll', frame: ImageBitmap | ImageData, opts: object, signal?: AbortSignal, background = false) {
    signal?.throwIfAborted();
    if (lane.inFlight && (type !== 'detect' || lane === read)) throw new Error('Recognition is already in progress');
    const stopLane = (error: DOMException) => {
      if (lane === read && lastPrepare) restorePrepare = true;
      reset(lane);
      failAll(lane, error);
    };
    const abort = () => {
      stopLane(new DOMException('Recognition aborted', 'AbortError'));
      lane.inFlight = false;
    };
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const watchWorker = () => {
      clearTimeout(watchdog);
      const worker = lane.worker;
      watchdog = setTimeout(() => {
        if (!worker || lane.worker !== worker) return;
        const error = new DOMException('Recognition worker stopped responding', 'TimeoutError');
        stopLane(error);
        config.onWorkerFailure?.(error);
      }, BACKGROUND_WORKER_HANG_MS);
    };
    lane.inFlight = true;
    if (!background) signal?.addEventListener('abort', abort, { once: true });
    try {
      const initializing = startLane(lane, threadsOf(lane));
      if (background) watchWorker();
      await initializing;
      if (disposed) throw new Error('Recognizer is disposed');
      signal?.throwIfAborted();
      if (type !== 'detect') await restoreReadOptions(lane, signal);
      let inferenceSignal = signal;
      if (background) {
        // The detector is ready after init. A peek also needs the index and embedder before its budget starts.
        if (type === 'peek') await prepare();
        signal?.throwIfAborted();
        watchWorker();
        const limit = new AbortController();
        timeout = setTimeout(() => limit.abort(new DOMException('Background inference timed out', 'TimeoutError')), BACKGROUND_INFERENCE_MS);
        inferenceSignal = signal ? AbortSignal.any([signal, limit.signal]) : limit.signal;
      }
      const begin = performance.now();
      const result = await request(lane, { type, frame, opts }, typeof ImageBitmap !== 'undefined' && frame instanceof ImageBitmap ? [frame] : [], inferenceSignal).catch(error => {
        if (background) inferenceSignal?.throwIfAborted();
        throw error;
      });
      if (background) inferenceSignal?.throwIfAborted();
      if (type === 'detect' && detectorTimingsMs) {
        detectorTimingsMs.roundTrip = performance.now() - begin;
        detectorTimingsMs.transfer = Math.max(0, detectorTimingsMs.roundTrip - (detectorTimingsMs.worker ?? 0) - (detectorTimingsMs.queue ?? 0));
      }
      return result;
    } finally {
      if (background) { clearTimeout(timeout); clearTimeout(watchdog); }
      else signal?.removeEventListener('abort', abort);
      if (background || !signal?.aborted) lane.inFlight = false;
    }
  }
  async function boardRequest(type: 'peek' | 'readAll', frame: ImageBitmap | ImageData, opts: (PeekOptions | ReadAllOptions) & BackgroundFrameOptions) {
    if(disposed) throw new Error('Recognizer is disposed');
    opts.signal?.throwIfAborted();
    const lane = await laneFor('read');
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000) throw new Error('Invalid frame');
    if(opts.cards) validateBoard(opts.cards);
    if('card' in opts) validateOptions({card:opts.card});
    const {signal,background,...workerOptions}=opts;
    return await frameRequest(lane, type, frame, workerOptions, signal, background);
  }
  // Both table-open warmup and camera startup need the full recognition pipeline.
  // The worker's init now loads only the detector so outlines can survive index failures.
  function prepare(opts?:PrepareOptions): Promise<{backend:'webgpu'|'wasm'}> {
    if(disposed)return Promise.reject(new Error('Recognizer is disposed'));
    if(opts)lastPrepare=opts;
    // A split scene worker loads (and warms) its detector alongside the read worker.
    const warmScene=()=>{if(scene!==read)void initialize('scene').catch(()=>undefined);};
    if(opts)return initialize('read').then(async()=>{if(disposed)throw new Error('Recognizer is disposed');warmScene();const info=await request(read,{type:'prepare',opts}) as {backend:'webgpu'|'wasm'};restorePrepare=false;return info;});
    prepared??=initialize('read').then(async()=>{if(disposed)throw new Error('Recognizer is disposed');warmScene();return await request(read,{type:'prepare'}) as {backend:'webgpu'|'wasm'};}).catch(error=>{prepared=undefined;throw error;});
    // Readiness is cached, but an inference may since have moved either model to WASM.
    return prepared.then(info => ({ backend: backendStatus?.backend ?? info.backend }));
  }
  return {
    get backendStatus() { return backendStatus; },
    async checkWebGpu() {
      if (disposed) throw new Error('Recognizer is disposed');
      await initialize('read');
      return await request(read, { type: 'checkWebGpu' }) as BackendStatus & { timingsMs: Record<string, number> };
    },
    get detectorBackend() { return detectorBackend; },
    get detectorTimingsMs() { return detectorTimingsMs; },
    get separateDetector() { return scene !== read; },
    warmup: async()=>{await prepare();},
    prepare,
    async peek(frame, opts) { return await boardRequest('peek',frame,opts) as PeekResult; },
    async readAll(frame, opts={}) { return await boardRequest('readAll',frame,opts) as BoardResult; },
    async recognize(frames, opts = {}) {
      if (disposed) throw new Error('Recognizer is disposed');
      validateOptions(opts);
      if (!frames.length || frames.length > 12 || frames.some(f => f.width < 3 || f.height < 3 || f.width * f.height > 16_000_000)) throw new Error('Supply 1–12 frames, each 3 pixels to 16 MP');
      const lane = await laneFor('read');
      if (lane.inFlight) throw new Error('Recognition is already in progress');
      lane.inFlight = true;
      try {
        await startLane(lane, threadsOf(lane));
        if (disposed) throw new Error('Recognizer is disposed');
        await restoreReadOptions(lane);
        const transfers:Transferable[] = frames.flatMap(f => typeof ImageBitmap !== 'undefined' && f instanceof ImageBitmap ? [f] as Transferable[] : opts.transferFrames ? [(f as ImageData).data.buffer as ArrayBuffer] : []);
        const start=performance.now();
        const result=await request(lane, { type: 'recognize', frames, opts }, [...new Set(transfers)]) as RecognitionResult;
        if(config.reader==='hybrid'&&selectedReader==='current'&&readerNote&&!result.reader){
          const [a,b]=result.raw?.visual??result.candidates,score=a?.score??0,runnerUp=b?.score??0;
          result.reader={selected:'hybrid',stage:'fallback',model:'current',second:{score,runnerUp,margin:Math.max(0,score-runnerUp),ms:result.timingsMs.total},ms:performance.now()-start};
        }
        if(result.timingsMs){result.timingsMs.roundTrip=performance.now()-start;result.timingsMs.transfer=Math.max(0,result.timingsMs.roundTrip-(result.timingsMs.worker??0)-(result.timingsMs.queue??0));}return result;
      } finally { lane.inFlight = false; }
    },
    async detectCards(frame, opts = {}, signal) {
      signal?.throwIfAborted();
      validateOptions({region:opts.region});
      if(opts.keep!==undefined&&(!Array.isArray(opts.keep)||opts.keep.length>60||opts.keep.some(q=>!Array.isArray(q)||q.length!==4||q.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))))throw new Error('keep must be at most 60 four-point outlines');
      if(opts.piles!==undefined&&(!Array.isArray(opts.piles)||opts.piles.length>4||opts.piles.some(q=>!Array.isArray(q)||q.length!==4||q.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))))throw new Error('piles must be at most 4 four-point cells');
      if(opts.cells!==undefined&&(!Array.isArray(opts.cells)||opts.cells.length>20||opts.cells.some(q=>!Array.isArray(q)||q.length!==4||q.some(p=>!Number.isFinite(p?.x)||!Number.isFinite(p?.y)))))throw new Error('cells must be at most 20 four-point cells');
      if(disposed) throw new Error('Recognizer is disposed');
      if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000) throw new Error('Invalid frame');
      const lane = await laneFor('scene');
      const {background, ...workerOptions} = opts;
      return await frameRequest(lane, 'detect', frame, workerOptions, signal, background) as DetectedQuad[];
    },
    async askAI(result, options={}) {
      if(disposed) throw new Error('Recognizer is disposed');
      if(result.tier==='sure' && !options.explicitRequest) throw new Error('AI requires uncertainty or an explicit request');
      let jpeg=result.aiCropJpeg;
      if(!jpeg&&result.aiCropToken){await initialize('read');options.signal?.throwIfAborted();jpeg=await request(read,{type:'aiCrop',token:result.aiCropToken}) as string;}
      jpeg??=result.cropJpeg; // Compatible with pre-upgrade explicit crop callers.
      if(!jpeg) throw new Error('Recognize with includeCrop to ask AI');
      const response=await fetch('/api/remote-vision/ai',{method:'POST',signal:options.signal,headers:{'content-type':'application/json'},body:JSON.stringify({jpegBase64:jpeg,candidateNames:result.aiCandidateNames,localTier:result.tier,explicitRequest:options.explicitRequest??false})});
      if(!response.ok) throw new Error(response.status===404?'AI reading is disabled or requires owner access':response.status===429?'AI rate limit reached':response.status===504?'AI reading timed out':'AI reading unavailable');
      return response.json() as Promise<AIReading>;
    },
    async recordFeedback(result,chosenCardId,source) {
      if(disposed)throw new Error('Recognizer is disposed');
      if(!result.feedback || !result.cropJpeg)throw new Error('No eligible card crop; recognize with includeFeedback after opting in');
      const {deltaVersion:_,...evidence}=result.feedback;
      const response=await fetch('/api/remote-vision/feedback',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({...evidence,jpegBase64:result.cropJpeg,top5:result.candidates.slice(0,5),chosenCardId,source,tier:result.tier,frameClass:result.quality.frameClass,sharpness:result.quality.sharpness})});
      if(!response.ok)throw new Error(response.status===403?'Feedback needs your opt-in':response.status===429?'Feedback rate limit reached':'Feedback could not be saved');
      return response.json();
    },
    dispose() { disposed = true; for (const lane of lanes()) { lane.worker?.terminate(); lane.worker = undefined; failAll(lane, new Error('Recognizer disposed')); } },
  };
}

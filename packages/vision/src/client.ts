import { yugioh } from './games/yugioh';
import { validateOptions } from './options';
import { validateBoard } from './board';
import type { GameProfile, RecognitionResult, RecognizeOptions, DetectedQuad, PeekOptions, PeekResult, ReadAllOptions, BoardResult, PrepareOptions, BackendStatus } from './types';
export type FeedbackSource='pick'|'search'|'voice'|'ai';
export interface AIReading { name: string | null; setCode?: string; passcode?: number; match: {passcode: number; name: string} | null }
export interface RecognizerConfig {
  game?: 'yugioh';
  /** Override the built-in game profile (including model/index URLs). */
  profile?: GameProfile;
  /** Reports actual providers and exact fallback reasons from the worker, including warmup/detection. */
  onBackendChange?: (status: BackendStatus) => void;
  backend?: 'auto' | 'wasm'; workerUrl?: string; runtimeBase?: string;
  /** One worker, or a detector worker beside the read worker (default 'auto': see chooseWorkerLayout). */
  workers?: WorkerLayout;
}
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
  detectCards(frame: ImageBitmap | ImageData, opts?:Pick<RecognizeOptions,'region'>): Promise<DetectedQuad[]>;
  /** Local name/tier only, without a crop, AI request or correction history. Same-frame outlines only. */
  peek(frame: ImageBitmap | ImageData, opts: PeekOptions): Promise<PeekResult>;
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
export async function chooseWorkerLayout(layout: WorkerLayout, backend: 'auto' | 'wasm'): Promise<{ split: boolean; threads?: number }> {
  const nav = (globalThis as { navigator?: Navigator & { deviceMemory?: number; userAgentData?: { mobile?: boolean }; gpu?: { requestAdapter(): Promise<{ isFallbackAdapter?: boolean; info?: { isFallbackAdapter?: boolean } } | null> } } }).navigator;
  const cores = nav?.hardwareConcurrency ?? 1;
  // Each worker gets half of the one-worker thread budget: 2+2 on 8 cores, never more threads in total.
  const half = Math.max(1, Math.floor(WASM_THREADS(cores) / 2));
  if (layout === 'single') return { split: false };
  if (layout === 'split') return { split: true, threads: half };
  const mobile = nav?.userAgentData?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(nav?.userAgent ?? '');
  if (mobile || (nav?.deviceMemory !== undefined && nav.deviceMemory < 4) || cores < 4) return { split: false };
  if (backend === 'wasm' || !nav?.gpu) return { split: false };
  try {
    const adapter = await nav.gpu.requestAdapter();
    // A software adapter (SwiftShader) runs on the CPU like WASM: keep one worker.
    if (!adapter || adapter.isFallbackAdapter || adapter.info?.isFallbackAdapter) return { split: false };
  } catch { return { split: false }; }
  return { split: true, threads: half };
}
interface Lane {
  role: 'both' | 'scene' | 'read';
  worker?: Worker; initial?: Promise<unknown>; inFlight: boolean; status?: BackendStatus;
  pending: Map<number, { resolve(value: unknown): void; reject(error: Error): void }>;
}
export function createRecognizer(config: RecognizerConfig = {}): Recognizer {
  if (config.game !== undefined && config.game !== 'yugioh') throw new Error(`Unsupported game: ${config.game}`);
  const profile = config.profile ?? yugioh;
  let disposed = false, serial = 0;
  let backendStatus: BackendStatus | undefined, detectorBackend: Recognizer['detectorBackend'];
  let detectorTimingsMs:Record<string,number>|undefined;
  let prepared:Promise<{backend:'webgpu'|'wasm'}>|undefined;
  let layout: Promise<{ split: boolean; threads?: number }> | undefined;
  const single: Lane = { role: 'both', inFlight: false, pending: new Map() };
  let scene = single, read = single;
  const lanes = () => scene === read ? [read] : [scene, read];
  const failAll = (lane: Lane, error: Error) => { for (const value of lane.pending.values()) value.reject(error); lane.pending.clear(); };
  /** Detector from the worker that runs outline passes, embedder from the read worker. */
  function mergeStatus() {
    const models = [...(scene.status?.models.filter(m => m.model === 'detector') ?? []), ...(read.status?.models.filter(m => m.model === 'embedder') ?? [])];
    if (!models.length) return;
    const failed = models.filter(m => m.backend === 'wasm' && m.fallbackReason);
    const reasons = failed.length > 1 && new Set(failed.map(m => m.fallbackReason)).size === 1 ? [failed[0].fallbackReason!] : failed.map(m => `${m.model}: ${m.fallbackReason}`);
    backendStatus = { backend: models.every(m => m.backend === 'webgpu') ? 'webgpu' : 'wasm', fallbackReason: reasons.length ? reasons.join('; ') : undefined, models };
    config.onBackendChange?.(backendStatus);
  }
  function request(lane: Lane, message: object, transfers: Transferable[] = []): Promise<unknown> {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      lane.pending.set(id, { resolve, reject });
      try { lane.worker!.postMessage({ ...message, id }, transfers); }
      catch (error) { lane.pending.delete(id); reject(error); }
    });
  }
  function reset(lane: Lane) {
    lane.worker?.terminate(); lane.worker = undefined; lane.initial = undefined;
    if (lane === read) prepared = undefined;
  }
  function startLane(lane: Lane, threads?: number) {
    if (!lane.initial) {
      if (lane !== read) detectorBackend = undefined;
      const worker = lane.worker = new Worker(config.workerUrl ?? '/dev/vision-lab/assets/worker.js?v=gpu-split-v1', { type: 'module', name: lane.role === 'both' ? 'card-recognition' : `card-recognition-${lane.role}` });
      worker.onmessage = event => {
        const { id, result, error, detectorBackend: backend, timingsMs, backendStatus: status } = event.data;
        const value = lane.pending.get(id); if (!value) return; lane.pending.delete(id);
        if (status) { lane.status = status; mergeStatus(); }
        if (lane !== read || read === scene) {
          if (backend === 'webgpu' || backend === 'wasm') detectorBackend = backend;
          if (timingsMs) detectorTimingsMs = timingsMs;
        }
        if (error) value.reject(new Error(error)); else value.resolve(result);
      };
      worker.onerror = event => { failAll(lane, new Error(event.message || 'Recognition worker failed')); reset(lane); };
      worker.onmessageerror = () => failAll(lane, new Error('Recognition worker message failed'));
      lane.initial = request(lane, { type: 'init', profile, backend: config.backend ?? 'auto', runtimeBase: config.runtimeBase ?? '/dev/vision-lab/assets/ort/', role: lane.role, threads }).catch(error => { reset(lane); throw error; });
    }
    return lane.initial;
  }
  /** The lane that serves `which`; the layout is chosen once, on first use. */
  async function laneFor(which: 'scene' | 'read'): Promise<Lane> {
    const chosen = await (layout ??= chooseWorkerLayout(config.workers ?? 'auto', config.backend ?? 'auto').catch(() => ({ split: false } as { split: boolean; threads?: number })));
    if (disposed) throw new Error('Recognizer is disposed');
    if (chosen.split && scene === single) {
      threads = chosen.threads;
      scene = { role: 'scene', inFlight: false, pending: new Map() };
      read = { role: 'read', inFlight: false, pending: new Map() };
    }
    return which === 'scene' ? scene : read;
  }
  let threads: number | undefined;
  async function initialize(which: 'scene' | 'read') { return startLane(await laneFor(which), threads); }
  async function boardRequest(type: 'peek' | 'readAll', frame: ImageBitmap | ImageData, opts: PeekOptions | ReadAllOptions) {
    if(disposed) throw new Error('Recognizer is disposed');
    opts.signal?.throwIfAborted();
    const lane = await laneFor('read');
    if(lane.inFlight) throw new Error('Recognition is already in progress');
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000) throw new Error('Invalid frame');
    if(opts.cards) validateBoard(opts.cards);
    if('card' in opts) validateOptions({card:opts.card});
    const {signal,...workerOptions}=opts;
    // Abort ends only the read worker; a split scene worker keeps serving outlines.
    const abort=()=>{reset(lane);failAll(lane,new DOMException('Recognition aborted','AbortError'));};
    lane.inFlight=true;
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await startLane(lane, threads); signal?.throwIfAborted();
      if(disposed) throw new Error('Recognizer is disposed');
      return await request(lane,{type,frame,opts:workerOptions},typeof ImageBitmap!=='undefined' && frame instanceof ImageBitmap?[frame]:[]);
    } finally {signal?.removeEventListener('abort',abort);lane.inFlight=false;}
  }
  // Both table-open warmup and camera startup need the full recognition pipeline.
  // The worker's init now loads only the detector so outlines can survive index failures.
  function prepare(opts?:PrepareOptions): Promise<{backend:'webgpu'|'wasm'}> {
    if(disposed)return Promise.reject(new Error('Recognizer is disposed'));
    // A split scene worker loads (and warms) its detector alongside the read worker.
    const warmScene=()=>{if(scene!==read)void initialize('scene').catch(()=>undefined);};
    if(opts)return initialize('read').then(async()=>{if(disposed)throw new Error('Recognizer is disposed');warmScene();return await request(read,{type:'prepare',opts}) as {backend:'webgpu'|'wasm'};});
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
        await startLane(lane, threads);
        if (disposed) throw new Error('Recognizer is disposed');
        const transfers:Transferable[] = frames.flatMap(f => typeof ImageBitmap !== 'undefined' && f instanceof ImageBitmap ? [f] as Transferable[] : opts.transferFrames ? [(f as ImageData).data.buffer as ArrayBuffer] : []);
        const start=performance.now();
        const result=await request(lane, { type: 'recognize', frames, opts }, [...new Set(transfers)]) as RecognitionResult;
        if(result.timingsMs){result.timingsMs.roundTrip=performance.now()-start;result.timingsMs.transfer=Math.max(0,result.timingsMs.roundTrip-(result.timingsMs.worker??0)-(result.timingsMs.queue??0));}return result;
      } finally { lane.inFlight = false; }
    },
    async detectCards(frame, opts = {}) {
      validateOptions(opts);
      if(disposed) throw new Error('Recognizer is disposed');
      if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000) throw new Error('Invalid frame');
      const lane = await laneFor('scene');
      // A split detector worker queues its passes itself; one shared worker keeps the single-job guard.
      if(lane.inFlight && lane === read) throw new Error('Recognition is already in progress');
      lane.inFlight=true;
      try { await startLane(lane, threads); if(disposed) throw new Error('Recognizer is disposed');
        const begin=performance.now(),result=await request(lane,{type:'detect',frame,opts},typeof ImageBitmap!=='undefined' && frame instanceof ImageBitmap?[frame]:[]) as DetectedQuad[];
        if(detectorTimingsMs){detectorTimingsMs.roundTrip=performance.now()-begin;detectorTimingsMs.transfer=Math.max(0,detectorTimingsMs.roundTrip-(detectorTimingsMs.worker??0)-(detectorTimingsMs.queue??0));}
        return result; }
      finally {lane.inFlight=false;}
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

import { yugioh } from './games/yugioh';
import { validateOptions } from './options';
import { validateBoard } from './board';
import type { GameProfile, RecognitionResult, RecognizeOptions, DetectedQuad, PeekOptions, PeekResult, ReadAllOptions, BoardResult } from './types';
export type FeedbackSource='pick'|'search'|'voice'|'ai';
export interface AIReading { name: string | null; setCode?: string; passcode?: number; match: {passcode: number; name: string} | null }
export interface RecognizerConfig {
  game?: 'yugioh';
  /** Override the built-in game profile (including model/index URLs). */
  profile?: GameProfile;
  backend?: 'auto' | 'wasm'; workerUrl?: string; runtimeBase?: string;
}
export interface Recognizer {
  /** ImageBitmaps transfer to the worker and are consumed. ImageData is copied. Up to 12 frames. */
  recognize(frames: ImageBitmap[] | ImageData[], opts?: RecognizeOptions): Promise<RecognitionResult>;
  detectCards(frame: ImageBitmap | ImageData): Promise<DetectedQuad[]>;
  /** Local name/tier only, without a crop, AI request or correction history. Same-frame outlines only. */
  peek(frame: ImageBitmap | ImageData, opts: PeekOptions): Promise<PeekResult>;
  /** Reads at most 60 outlined cards sequentially. Abort terminates the active worker; next use reinitializes. */
  readAll(frame: ImageBitmap | ImageData, opts?: ReadAllOptions): Promise<BoardResult>;
  askAI(result: RecognitionResult, options?: { explicitRequest?: boolean; signal?: AbortSignal }): Promise<AIReading>;
  recordFeedback(result:RecognitionResult,chosenCardId:string,source:FeedbackSource):Promise<{id:string}>;
  dispose(): void;
}
export function createRecognizer(config: RecognizerConfig = {}): Recognizer {
  if (config.game !== undefined && config.game !== 'yugioh') throw new Error(`Unsupported game: ${config.game}`);
  const profile = config.profile ?? yugioh;
  let worker: Worker | undefined, disposed = false, serial = 0, initial: Promise<unknown> | undefined;
  let inFlight = false;
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const failAll = (error: Error) => { for (const value of pending.values()) value.reject(error); pending.clear(); };
  function request(message: object, transfers: Transferable[] = []): Promise<unknown> {
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { worker!.postMessage({ ...message, id }, transfers); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }
  function initialize() {
    if (!initial) {
      worker = new Worker(config.workerUrl ?? '/dev/vision-lab/assets/worker.js', { type: 'module', name: 'card-recognition' });
      worker.onmessage = event => {
        const { id, result, error } = event.data;
        const value = pending.get(id); if (!value) return; pending.delete(id);
        if (error) value.reject(new Error(error)); else value.resolve(result);
      };
      worker.onerror = event => { failAll(new Error(event.message || 'Recognition worker failed')); worker?.terminate(); worker = undefined; initial = undefined; };
      worker.onmessageerror = () => failAll(new Error('Recognition worker message failed'));
      initial = request({ type: 'init', profile, backend: config.backend ?? 'auto', runtimeBase: config.runtimeBase ?? '/dev/vision-lab/assets/ort/' }).catch(error => { worker?.terminate(); worker = undefined; initial = undefined; throw error; });
    }
    return initial;
  }
  async function boardRequest(type: 'peek' | 'readAll', frame: ImageBitmap | ImageData, opts: PeekOptions | ReadAllOptions) {
    if(disposed) throw new Error('Recognizer is disposed');
    opts.signal?.throwIfAborted();
    if(inFlight) throw new Error('Recognition is already in progress');
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000) throw new Error('Invalid frame');
    if(opts.cards) validateBoard(opts.cards);
    if('card' in opts) validateOptions({card:opts.card});
    const {signal,...workerOptions}=opts;
    const abort=()=>{worker?.terminate();worker=undefined;initial=undefined;failAll(new DOMException('Recognition aborted','AbortError'));};
    inFlight=true;
    signal?.addEventListener('abort',abort,{once:true});
    try {
      await initialize(); signal?.throwIfAborted();
      if(disposed) throw new Error('Recognizer is disposed');
      return await request({type,frame,opts:workerOptions},typeof ImageBitmap!=='undefined' && frame instanceof ImageBitmap?[frame]:[]);
    } finally {signal?.removeEventListener('abort',abort);inFlight=false;}
  }
  return {
    async peek(frame, opts) { return await boardRequest('peek',frame,opts) as PeekResult; },
    async readAll(frame, opts={}) { return await boardRequest('readAll',frame,opts) as BoardResult; },
    async recognize(frames, opts = {}) {
      if (disposed) throw new Error('Recognizer is disposed');
      validateOptions(opts);
      if (!frames.length || frames.length > 12 || frames.some(f => f.width < 3 || f.height < 3 || f.width * f.height > 16_000_000)) throw new Error('Supply 1–12 frames, each 3 pixels to 16 MP');
      if (inFlight) throw new Error('Recognition is already in progress');
      inFlight = true;
      try {
        await initialize();
        if (disposed) throw new Error('Recognizer is disposed');
        const bitmaps = frames.filter(f => typeof ImageBitmap !== 'undefined' && f instanceof ImageBitmap);
        return await request({ type: 'recognize', frames, opts }, bitmaps) as RecognitionResult;
      } finally { inFlight = false; }
    },
    async detectCards(frame) {
      if(disposed) throw new Error('Recognizer is disposed');
      if(inFlight) throw new Error('Recognition is already in progress');
      if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000) throw new Error('Invalid frame');
      inFlight=true;
      try { await initialize(); if(disposed) throw new Error('Recognizer is disposed'); return await request({type:'detect',frame},typeof ImageBitmap!=='undefined' && frame instanceof ImageBitmap?[frame]:[]) as DetectedQuad[]; }
      finally {inFlight=false;}
    },
    async askAI(result, options={}) {
      if(disposed) throw new Error('Recognizer is disposed');
      if(result.tier==='sure' && !options.explicitRequest) throw new Error('AI requires uncertainty or an explicit request');
      if(!result.aiCropJpeg) throw new Error('Recognize with includeCrop to ask AI');
      const response=await fetch('/api/remote-vision/ai',{method:'POST',signal:options.signal,headers:{'content-type':'application/json'},body:JSON.stringify({jpegBase64:result.aiCropJpeg,candidateNames:result.aiCandidateNames,localTier:result.tier,explicitRequest:options.explicitRequest??false})});
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
    dispose() { disposed = true; worker?.terminate(); worker = undefined; failAll(new Error('Recognizer disposed')); },
  };
}

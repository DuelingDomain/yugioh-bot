import { RecognitionPipeline } from './pipeline';
import { emptyLearning, type LearningSnapshot } from './learning';
import { DUELSIGHT_RULE, duelSightModel, lightModel } from './hybrid-models';
import { isCovered, validateBoard } from './board';
import { validateOptions } from './options';
import { mergeCandidates } from './search';
import { replayTier } from './decision';
import type { RGBAImage } from './pixels';
import type { Candidate, IndexEntry, PeekOptions, PeekResult, ReaderStageDiagnostics, RecognizeOptions, RecognitionResult } from './types';

/** Artwork rows and orientations of the same identity never supply the runner-up. */
export function distinctScores(candidates:Candidate[]):Candidate[] {
  const best=new Map<string,Candidate>();
  for(const c of candidates)if(Number.isFinite(c.score)&&c.score>(best.get(c.cardId)?.score??-Infinity))best.set(c.cardId,c);
  return [...best.values()].sort((a,b)=>b.score-a.score);
}
export function acceptsFirst(candidates:Candidate[]):boolean {
  const [a,b]=distinctScores(candidates);
  return Boolean(a&&b&&a.score>=DUELSIGHT_RULE.score&&a.score-b.score>=DUELSIGHT_RULE.margin);
}
const stats=(result:RecognitionResult,ms:number):ReaderStageDiagnostics=>{
  const [a,b]=distinctScores(result.raw?.visual??result.candidates);
  return {score:a?.score??0,runnerUp:b?.score??0,margin:a&&b?a.score-b.score:0,ms};
};

/** Asset failures leave the existing ready reader usable; the caller owns cleanup of partial sessions. */
export async function loadHybridOrCurrent(current:RecognitionPipeline,load:()=>Promise<RecognitionPipeline>,failed:(message:string)=>void):Promise<RecognitionPipeline> {
  try {return await load();}
  catch {failed('Hybrid reader could not load. Using the current reader. Switch readers to retry.');return current;}
}

/** Both stages reuse the product pipeline: geometry, temporal/quality gates, ranking, crops and prompts. */
export class HybridPipeline extends RecognitionPipeline {
  private learningState=emptyLearning();
  private failed=false;
  private names:Map<string,IndexEntry>;
  constructor(args:ConstructorParameters<typeof RecognitionPipeline>,private current:RecognitionPipeline,private first:RecognitionPipeline,private second:RecognitionPipeline,entries:IndexEntry[],private notify:(message:string)=>void) {
    super(...args);this.names=new Map([...entries,...args[1].meta.entries].map(e=>[e.cardId,e]));
    this.hasFullArt=Boolean(args[5]?.meta.count);
  }
  private hasFullArt:boolean;
  override setLearning(value:LearningSnapshot) {this.learningState=value;this.current.setLearning(value);}
  override async peek(frame:RGBAImage,opts:PeekOptions):Promise<PeekResult> {
    validateOptions({card:opts.card});if(opts.cards)validateBoard(opts.cards);opts.signal?.throwIfAborted();
    if(opts.card.kind==='face-down')return this.current.peek(frame,opts);
    const covered=Boolean(opts.card.covered||isCovered(opts.card,opts.cards??[]));
    const result=await this.recognize([frame],{card:{...opts.card,covered},priors:opts.priors,gallery:opts.gallery,k:1});
    const best=this.names.get(result.candidates[0]?.cardId);
    return {cardId:best?.cardId,name:best?.name??null,tier:result.tier,faceDown:Boolean(result.quality.faceDown),covered:Boolean(result.quality.covered)};
  }
  override async recognize(frames:RGBAImage[],opts:RecognizeOptions={}) {
    const start=performance.now();
    if(this.failed)return this.fallback(frames,opts,start);
    let first:Awaited<ReturnType<RecognitionPipeline['recognize']>>|undefined;
    let firstStats:ReaderStageDiagnostics|undefined;
    let firstReason='first read below released gate';
    // Untagged vectors and server learning are in the current model's space. Never compare them to Light or DuelSight.
    const compatibility=opts.includeFeedback?'feedback':this.hasFullArt?'whole-card references':
      this.learningState.references.length||this.learningState.confusions.length?'saved corrections':
      opts.gallery?.some(e=>!e.embedding.modelId)?'current session gallery':undefined;
    const needsLight=opts.gallery?.some(e=>e.embedding.modelId===lightModel.id);
    try {
      if(!compatibility&&!needsLight) {
        const t=performance.now();
        // Retain both orientations and clean full-bank evidence even if the caller requests just one candidate.
        first=await this.first.recognize(frames,{...opts,k:Math.max(5,opts.k??5),includeRaw:true,preferUpright:false,earlyExit:false});
        const raw=first.raw;
        if(raw) {
          // The released gate uses each identity's maximum over BOTH orientations, including the runner-up.
          for(const f of raw.frames)if(f.hypotheses?.length)f.clean=mergeCandidates(f.hypotheses,10);
          raw.visual=mergeCandidates(raw.frames.map(f=>f.clean),10);
          first.tier=replayTier(raw,raw.thresholds);
        }
        firstStats=stats(first,performance.now()-t);
        if(raw?.blocked.length)firstReason=`first read ineligible: ${raw.blocked.join(', ')}`;
        else if(first.tier!=='sure')firstReason='first read failed frame agreement or ranking gates';
        const agrees=raw&&raw.frames.length>0&&raw.winnerId===raw.visual[0]?.cardId&&!first.quality.faceDown&&
          raw.frames.every(f=>f.clean[0]?.cardId===raw.winnerId&&f.ranked[0]?.cardId===raw.winnerId&&acceptsFirst(f.clean));
        // The name can pass while placement is still unsafe (covered, partial, full-art, ...).
        // Keep the pipeline's uncertain tier and all of its quality evidence in that case.
        if(agrees&&acceptsFirst(raw.visual)) {
          first.candidates=first.candidates.slice(0,opts.k??5);
          if(!opts.includeRaw)delete first.raw;
          first.reader={selected:'hybrid',stage:'first',model:duelSightModel.id,first:firstStats,ms:performance.now()-start};
          first.timingsMs.total=first.reader.ms;
          return first;
        }
      }
      const t=performance.now();
      const next=compatibility?this.current:this.second;
      // A single frozen frame can reuse the first detector's quad. Temporal reads still redetect each source frame.
      const card=frames.length===1?first?.detectedCard??opts.card:opts.card;
      const result=await next.recognize(frames,{...opts,card,includeRaw:true,
        gallery:compatibility?opts.gallery?.filter(e=>!e.embedding.modelId):opts.gallery?.filter(e=>e.embedding.modelId===lightModel.id)});
      const second=stats(result,performance.now()-t);
      if(!opts.includeRaw)delete result.raw;
      result.reader={selected:'hybrid',stage:'second',model:compatibility?'current':lightModel.id,reason:compatibility??(needsLight?'Light session gallery':firstReason),first:firstStats,second,ms:performance.now()-start};
      result.timingsMs.total=result.reader.ms;
      return result;
    }catch {
      this.failed=true;this.notify('Hybrid reader failed. Using the current reader. Switch readers to retry.');
      return this.fallback(frames,opts,start);
    }
  }
  private async fallback(frames:RGBAImage[],opts:RecognizeOptions,start:number) {
    const t=performance.now(),result=await this.current.recognize(frames,{...opts,includeRaw:true});
    const second=stats(result,performance.now()-t);if(!opts.includeRaw)delete result.raw;
    result.reader={selected:'hybrid',stage:'fallback',model:'current',second,ms:performance.now()-start};
    result.timingsMs.total=result.reader.ms;return result;
  }
}

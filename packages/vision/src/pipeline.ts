import { detectScene } from './detect-scene';
// Ported from mathulbrich/duel-lens src/offscreen/engine.ts (Apache-2.0), f6968f3682d53a79c4a9fef591300615eda61c11.
// Modified: browser-frame API, game profile, sharpest-three temporal fusion and priors.
// Retains warp -> hypotheses -> staged embedding -> per-card search -> decide flow.
// Extension-only badge rescues are omitted. See licenses/duel-lens.LICENSE.
import { filterPhysicalIndex } from './physical-index';
import { replayTier } from './decision';
import { emptyLearning, indexVersion, learnedTopK, type LearningSnapshot } from './learning';
import { boardSide, isCovered, validateBoard } from './board';
import { CARD_DETECTOR } from './detector/spec';
import { detectFullArtLayout } from './full-art';
import type { DetectedQuad } from './types';
import { validateOptions } from './options';
import { embedImages, type TensorCtor } from './embed';
import type { ModelSession } from './runtime';
import { rotate180, type RGBAImage } from './pixels';
import { clipToConvex, polygonArea, type Quad } from './geometry';
import { warpQuadMasked, fillUnseen } from './truncation';
import { buildHypotheses } from './hypotheses';
import { detect, chooseCard, refinedCorners } from './detector/run';
import { sharpness, classifyBorder } from './quality';
import { normalize, topK, prepareSearch, mergeCandidates, decide, preferDeck } from './search';
import type { GameProfile, LoadedIndex, RecognizeOptions, RecognitionResult, Point, Candidate, IndexEntry, PeekOptions, PeekResult, ReadAllOptions, BoardResult, RecognitionEvidence } from './types';

/** Worker-only source ownership; never included in its public reply. */
export interface DeferredAICrop { bytes:number; create:()=>RGBAImage|undefined }

function fallbackQuad(img: RGBAImage, profile: GameProfile, click?: Point): Quad {
  const h = Math.min(img.height * profile.fallbackHeight, img.width * profile.card.height / profile.card.width);
  const w = h * profile.card.width / profile.card.height;
  const x = Math.max(0, Math.min(img.width - w, (click?.x ?? .5) * img.width - w / 2));
  const y = Math.max(0, Math.min(img.height - h, (click?.y ?? .5) * img.height - h / 2));
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

export class RecognitionPipeline {
  constructor(private profile: GameProfile, private index: LoadedIndex, private detector: ModelSession, private embedder: ModelSession, private Tensor: TensorCtor, private fullArtIndex?: LoadedIndex) {
    if(profile.id==='yugioh') { this.index=filterPhysicalIndex(index);this.fullArtIndex=fullArtIndex?filterPhysicalIndex(fullArtIndex):undefined; }
    this.catalog=new Map([...this.index.meta.entries,...(this.fullArtIndex?.meta.entries??[])].map(e=>[e.cardId,e]));
    prepareSearch(this.index);if(this.fullArtIndex)prepareSearch(this.fullArtIndex);
  }
  private catalog:Map<string,IndexEntry>;
  private learning:LearningSnapshot=emptyLearning();
  setLearning(value:LearningSnapshot) { this.learning=value; }
  private search(vector:Float32Array,index:LoadedIndex,k=5,priors?:RecognizeOptions['priors'],frameClass?:string,clean?:Candidate[]) {
    const deck=priors?.decklist?.length?topK(vector,index,Math.max(k,2),undefined,undefined,new Set(priors.decklist)):[];
    const catalog=learnedTopK(vector,index,this.learning,index===this.fullArtIndex?'whole-card':'art-box',Math.max(k,2),priors,frameClass,this.catalog,clean);
    return preferDeck(deck,catalog,this.profile.embedding.thresholds).slice(0,k);
  }
  private confused(list:Candidate[]) {return this.learning.confusions.some(p=>p.a===list[0]?.cardId||p.b===list[0]?.cardId);}
  async detectCards(frame: RGBAImage): Promise<DetectedQuad[]> {
    return detectScene(frame,this.profile,this.detector,this.Tensor);
  }

  async peek(frame: RGBAImage, opts: PeekOptions): Promise<PeekResult> {
    validateOptions({card:opts.card});
    if(opts.cards) validateBoard(opts.cards);
    opts.signal?.throwIfAborted();
    const covered=Boolean(opts.card.covered || isCovered(opts.card,opts.cards??[]));
    // Face-down outlines never leak a plausible face-up identity into a board twin.
    if(opts.card.kind==='face-down') return {name:null,tier:'not sure',faceDown:true,covered};
    const result=await this.recognize([frame],{card:{...opts.card,covered},priors:opts.priors,k:1});
    const best=result.candidates[0], faceDown=best?.cardId===this.profile.cardBack.cardId;
    const entry=faceDown?undefined:this.index.meta.entries.find(e=>e.cardId===best?.cardId)??this.fullArtIndex?.meta.entries.find(e=>e.cardId===best?.cardId);
    return {cardId:entry?.cardId,name:entry?.name??null,tier:result.tier,faceDown,covered:Boolean(result.quality.covered)};
  }
  async readAll(frame: RGBAImage, opts: ReadAllOptions = {}): Promise<BoardResult> {
    const start=performance.now();
    if(opts.cards) validateBoard(opts.cards);
    opts.signal?.throwIfAborted();
    const cards=opts.cards??(await this.detectCards(frame)).slice(0,60);
    const result:BoardResult={near:[],far:[],timingsMs:{detect:performance.now()-start,total:0}};
    for(const [index,outline] of cards.entries()) {
      opts.signal?.throwIfAborted();
      const side=boardSide(outline.quad.reduce((sum,p)=>sum+p.y,0)/4);
      try { result[side].push({...await this.peek(frame,{card:outline,cards,priors:opts.priors}),outline,index,side}); }
      catch(error) { result[side].push({outline,index,side,name:null,tier:'low match',faceDown:outline.kind==='face-down',covered:Boolean(outline.covered),error:error instanceof Error?error.message:String(error)}); }
    }
    result.timingsMs.total=performance.now()-start;
    return result;
  }
  async recognize(frames: RGBAImage[], opts: RecognizeOptions = {}): Promise<RecognitionResult & {deferredAICrop?:DeferredAICrop}> {
    validateOptions(opts);
    if (!frames.length || frames.length > 12 || frames.some(f => f.width < 3 || f.height < 3 || f.width * f.height > 16_000_000 || f.data.length !== f.width * f.height * 4)) throw new Error('Supply 1–12 valid frames, each at most 16 MP');
    const start = performance.now();
    const ranked = frames.map((frame, index) => ({ frame, index, sharpness: sharpness(frame, opts.clickPoint) })).sort((a, b) => b.sharpness - a.sharpness).slice(0, opts.maxFrames ?? 3);
    const timings = { sharpness: performance.now() - start, detect: 0, warp: 0, embed: 0, search: 0, total: 0 };
    const frameEvidence:RecognitionEvidence['frames']=[];
    const usedIndices:number[]=[];
    const views: { vector: Float32Array; detected: boolean; corners: boolean; unambiguous: boolean; confusionChecked:boolean; frameClass?: string; index: LoadedIndex; fullArt: boolean; partial: boolean; faceDown:boolean; clean:Candidate[]; ranked:Candidate[]; crop: RGBAImage; aiCrop?:RGBAImage; deferredAICrop?:DeferredAICrop; alternatives: {index:LoadedIndex;vector:Float32Array}[] }[] = [];
    const thresholds = this.profile.embedding.thresholds;
    // Reuse unboosted evidence for each hypothesis and the single-frame final
    // decision. This cache lasts one read, so mutable caller queries cannot go stale.
    const cleanCache=new WeakMap<Float32Array,Map<LoadedIndex,Candidate[]>>();
    const cleanSearch=(query:Float32Array,index:LoadedIndex)=>{
      let indexes=cleanCache.get(query);if(!indexes){indexes=new Map();cleanCache.set(query,indexes);}
      let candidates=indexes.get(index);if(!candidates){candidates=topK(query,index,Math.max(10,opts.k??5));indexes.set(index,candidates);}return candidates;
    };
    let covered=Boolean(opts.card?.covered);
    let detectedCard:DetectedQuad|undefined;
    let earlyExit=false;
    for (const { frame, index:frameIndex } of ranked) {
      // An explicit quad belongs only to a single frozen frame. Temporal reads redetect.
      const selected=frames.length===1?opts.card:undefined;
      const clickPoint=opts.clickPoint ?? (opts.card?{x:opts.card.quad.reduce((sum,p)=>sum+p.x,0)/4,y:opts.card.quad.reduce((sum,p)=>sum+p.y,0)/4}:undefined);
      let t = performance.now();
      const fastClick=frames.length===1 && !selected && Boolean(opts.clickPoint) && Math.min(this.profile.detector.longSide,Math.max(frame.width,frame.height))>640;
      let scene=selected?[]:await detect(this.detector,this.Tensor,frame,fastClick?640:this.profile.detector.longSide,CARD_DETECTOR.minScore);
      let card = selected ? undefined : chooseCard(scene.filter(c=>c.conf>=CARD_DETECTOR.minConfidence), frame, clickPoint);
      if(fastClick) {
        const quad=card?.pts.map(([x,y])=>({x,y}))??[];
        // Only a strong, wholly visible, isolated click target can skip the original scene pass.
        // Keep weak neighbouring outlines in the scene for overlap and covered-card checks.
        if(!card || card.conf<.9 || card.pts.some(([x,y])=>!(x>0 && y>0 && x<frame.width && y<frame.height)) ||
          scene.some(other=>other!==card && (
            Boolean(chooseCard([other],frame,clickPoint)) ||
            (polygonArea(clipToConvex(quad,other.pts.map(([x,y])=>({x,y}))))>0)
          ))) {
          scene=await detect(this.detector,this.Tensor,frame,this.profile.detector.longSide,CARD_DETECTOR.minScore);
          card=chooseCard(scene.filter(c=>c.conf>=CARD_DETECTOR.minConfidence),frame,clickPoint);
        }
      }
      // Upstream's crop-scale detection catches large close-ups outside its trained size range.
      if (!card && !selected && this.profile.detector.longSide > 448) {
        scene=await detect(this.detector,this.Tensor,frame,448,CARD_DETECTOR.minScore);
        card=chooseCard(scene.filter(c=>c.conf>=CARD_DETECTOR.minConfidence),frame,clickPoint);
      }
      if(card) {
        const quad=(c:typeof card):DetectedQuad=>({quad:c!.pts.map(([x,y])=>({x:x/frame.width,y:y/frame.height})),kind:c!.kind,confidence:c!.conf,partial:false});
        covered ||= isCovered(quad(card),scene.map(c=>quad(c)));
      }
      timings.detect += performance.now() - t;
      t = performance.now();
      const corners = selected ? selected.quad.map(p=>({x:p.x*frame.width,y:p.y*frame.height})) : card ? refinedCorners(card, frame) : [];
      const found = corners.length === 4;
      const mask = warpQuadMasked(frame, found ? corners as Quad : fallbackQuad(frame, this.profile, clickPoint), this.profile.card.warpWidth, this.profile.card.warpHeight);
      if (!mask) {frameEvidence.push({frameIndex,clean:[],ranked:[],deck:[],faceDown:(selected?.kind??card?.kind)==='face-down',eligible:false});continue;}
      const warped = mask.seenShare<1 ? fillUnseen(mask,'art-mean',this.profile.artWindow) : mask.image;
      const partial = found && (mask.seenShare<.995 || corners.some(p=>p.x<0 || p.y<0 || p.x>frame.width || p.y>frame.height));
      const fullArt = detectFullArtLayout(warped, this.profile);
      const frameClass = !fullArt && found && (selected?.kind ?? card?.kind) === 'face-up' ? classifyBorder(warped, this.profile) : undefined;
      const hypotheses = [this.profile.artWindow, ...(this.profile.alternateArtWindows ?? [])].flatMap(artWindow =>
        buildHypotheses(warped, warped, null, { userBoxWithCard: false, artOfCardShapedBox: false }, { ...this.profile, artWindow }));
      hypotheses.sort((a,b) => a.rotation - b.rotation);
      // A face-down prediction is only a hint: full-card pixels must match the indexed back.
      if ((selected?.kind ?? card?.kind) === 'face-down') hypotheses.push({ id: 'whole', rotation: 0, image: warped }, { id: 'whole', rotation: 180, image: rotate180(warped) });
      timings.warp += performance.now() - t;
      const faceDown=(selected?.kind ?? card?.kind)==='face-down';
      const vectors: Float32Array[] = [], lists: Candidate[][] = [], cleanLists:Candidate[][]=[];
      let merged: Candidate[] = [];
      // Duel Lens's views-in-turn: do not pay for more crops if the first view is sure.
      for (const hypothesis of hypotheses) {
        t = performance.now();
        const [vector] = await embedImages(this.embedder, this.Tensor, this.profile.embedding, [hypothesis.image]);
        if (vector.length !== this.index.meta.dim) throw new Error('Model embedding dimension mismatch');
        timings.embed += performance.now() - t;
        t = performance.now();
        const clean=cleanSearch(vector,this.index);
        vectors.push(vector); lists.push(this.search(vector, this.index, 10,opts.priors,undefined,clean));cleanLists.push(clean);
        merged = mergeCandidates(lists, 10);
        if(opts.priors?.decklist?.length)merged=preferDeck(merged.filter(c=>opts.priors!.decklist!.includes(c.cardId)),merged,thresholds);
        timings.search += performance.now() - t;
        if (!opts.includeRaw && (!faceDown || merged[0]?.cardId===this.profile.cardBack.cardId) && decide(mergeCandidates(cleanLists,10), thresholds, this.profile.cardBack.cardId).confident && !merged.some(c=>this.learning.confusions.some(p=>p.a===c.cardId||p.b===c.cardId))) break;
      }
      // Keep the vector of the hypothesis that actually supplied the winning visual match.
      let winner = 0;
      for (let i = 1; i < lists.length; i++) if ((lists[i][0]?.score ?? -Infinity) > (lists[winner][0]?.score ?? -Infinity)) winner = i;
      const alternatives=[{index:this.index,vector:vectors[winner]}];
      let fullBest:{vector:Float32Array;score:number}|undefined;
      const fullLists:Candidate[][]=[];
      let winningIndex=this.index, winningVector=vectors[winner], winningRotation=hypotheses[winner]?.rotation ?? 0;
      // Compare whole-card pixels only to whole-card references. Always run both
      // when references exist, even if the standard crop was confident.
      if(this.fullArtIndex?.meta.count) {
        for(const rotation of [0,180] as const) {
          t=performance.now();
          const [vector]=await embedImages(this.embedder,this.Tensor,this.profile.embedding,[rotation ? rotate180(warped) : warped]);
          timings.embed+=performance.now()-t; t=performance.now();
          const clean=cleanSearch(vector,this.fullArtIndex),list=this.search(vector,this.fullArtIndex,10,opts.priors,undefined,clean);fullLists.push(list);cleanLists.push(clean);
          if(!fullBest || (list[0]?.score ?? -Infinity)>fullBest.score) fullBest={vector,score:list[0]?.score ?? -Infinity};
          if((list[0]?.score ?? -Infinity)>(merged[0]?.score ?? -Infinity)) {winningIndex=this.fullArtIndex;winningVector=vector;winningRotation=rotation;}
          merged=mergeCandidates([merged,list],10);timings.search+=performance.now()-t;
        }
      }
      if(this.fullArtIndex && fullBest) alternatives.push({index:this.fullArtIndex,vector:fullBest.vector});
      if(opts.priors?.decklist?.length)merged=preferDeck(merged.filter(c=>opts.priors!.decklist!.includes(c.cardId)),merged,thresholds);
      const confusionChecked=this.confused(merged);
      const checks=winningIndex===this.fullArtIndex?fullLists:lists;
      const independentlyClear=!confusionChecked || (checks.length>=2 && checks.every(list=>list[0]?.cardId===merged[0]?.cardId && list[0].score-(list[1]?.score??0)>=.06));
      if(!views.length&&found)detectedCard=selected??{quad:corners.map(p=>({x:p.x/frame.width,y:p.y/frame.height})),kind:card!.kind,confidence:card!.conf,partial,covered};
      const clean=mergeCandidates(cleanLists,10);
      if(opts.priors?.decklist?.length)merged=preferDeck(merged.filter(c=>opts.priors!.decklist!.includes(c.cardId)),merged,thresholds,clean);
      const eligible=found && !partial && !covered && (!fullArt || Boolean(this.fullArtIndex?.meta.count)) && independentlyClear && (!faceDown || merged[0]?.cardId===this.profile.cardBack.cardId);
      const deck=opts.priors?.decklist?.length?topK(winningVector,winningIndex,10,undefined,undefined,new Set(opts.priors.decklist)):[];
      frameEvidence.push({frameIndex,hypotheses:cleanLists,clean,ranked:merged,deck,faceDown,eligible});
      usedIndices.push(frameIndex);
      // This source warp retains text detail; it never passes through the 295px embedding warp.
      let aiCrop:RGBAImage|undefined;
      let deferredAICrop:DeferredAICrop|undefined;
      if(opts.includeCrop && !views.length) {
        const quad=found?corners as Quad:fallbackQuad(frame,this.profile,clickPoint);
        const create=()=>{
          const large=warpQuadMasked(frame,quad,640,Math.round(640*this.profile.card.height/this.profile.card.width));
          if(!large)return;
          const pixels=large.seenShare<1?fillUnseen(large,'art-mean',this.profile.artWindow):large.image;
          return winningRotation===180?rotate180(pixels):pixels;
        };
        if(opts.deferAICrop)deferredAICrop={bytes:frame.data.byteLength,create};else aiCrop=create();
      }
      views.push({ aiCrop, deferredAICrop, faceDown, clean, ranked:merged, confusionChecked, alternatives, vector: winningVector, index:winningIndex,fullArt,partial,crop:winningRotation===180?rotate180(warped):warped, detected: Boolean(card || selected), corners: found, unambiguous: eligible && clean[0]?.cardId===merged[0]?.cardId && decide(clean, thresholds, this.profile.cardBack.cardId).confident, frameClass });
      if(views.length===1 && opts.earlyExit!==false && eligible && clean[0]?.cardId===merged[0]?.cardId && decide(clean,thresholds,this.profile.cardBack.cardId).confident && clean[0].score-(clean[1]?.score??0)>=.05) {earlyExit=ranked.length>1;break;}
    }
    const t = performance.now(), k = opts.k ?? 5;
    let candidates: Candidate[] = [], visual: Candidate[] = [];
    let frameClass: string | undefined;
    const fallback = !views.length || views.some(v => !v.corners);
    if (views.length) {
      frameClass = views.map(v => v.frameClass).find(c => c && views.filter(v => v.frameClass === c).length > views.length / 2);
      const visualLists: Candidate[][]=[], rankedLists: Candidate[][]=[];
      for(const index of [this.index,this.fullArtIndex].filter((i): i is LoadedIndex=>Boolean(i))) {
        const group=views.flatMap(view=>view.alternatives.filter(a=>a.index===index).map(a=>({...a,corners:view.corners}))); if(!group.length) continue;
        const average=new Float32Array(index.meta.dim);
        for(const view of group) for(let d=0;d<average.length;d++) average[d]+=view.vector[d]*(view.corners?1:.65);
        const query=group.length===1?group[0].vector:normalize(average),clean=cleanSearch(query,index);
        visualLists.push(clean);
        rankedLists.push(this.search(query,index,Math.max(k,10),opts.priors,index===this.index?frameClass:undefined,clean));
      }
      visual=mergeCandidates(visualLists,Math.max(k,10));
      candidates=mergeCandidates(rankedLists,Math.max(k,10));
      if(opts.priors?.decklist?.length)candidates=preferDeck(candidates.filter(c=>opts.priors!.decklist!.includes(c.cardId)),candidates,thresholds,visual);
      if (fallback) {
        visual = visual.map(c => ({ ...c, score: c.score * .85 }));
        candidates = candidates.map(c => ({ ...c, score: c.score * .85 }));
      }
    }
    const blocked:string[]=[];
    if(fallback || views.length!==frameEvidence.length)blocked.push('fallback');
    if(views.some(v=>v.partial))blocked.push('partial');
    if(covered)blocked.push('covered');
    if(views.some(v=>v.fullArt) && !this.fullArtIndex?.meta.count)blocked.push('full-art-without-references');
    if(views.some(v=>v.faceDown) && candidates[0]?.cardId!==this.profile.cardBack.cardId)blocked.push('face-down');
    if(this.confused(visual) && (visual[0].score-(visual[1]?.score??0)<.06 || !views.every(v=>v.confusionChecked)))blocked.push('confusion');
    const raw:RecognitionEvidence={visual,ranked:candidates,winnerId:candidates[0]?.cardId,cardBackId:this.profile.cardBack.cardId,blocked,frames:frameEvidence,
      thresholds,modelId:this.profile.embedding.id,modelSha256:this.profile.embedding.sha256,indexVersion:indexVersion(this.index.meta),layoutKey:this.index.meta.layoutKey??'',learningVersion:this.learning.version,priors:opts.priors,earlyExit};
    const tier=replayTier(raw,thresholds);
    timings.search += performance.now() - t; timings.total = performance.now() - start;
    const evidence=views[0];
    const safeEvidence=evidence?.corners && !fallback && !covered && !views.some(v=>v.partial) && !views.some(v=>v.faceDown) && candidates[0]?.cardId!==this.profile.cardBack.cardId;
    const collect=opts.includeFeedback && safeEvidence;
    const feedback=collect?{embedding:Array.from(evidence.vector),gameId:this.profile.id,modelId:this.profile.embedding.id,modelSha256:this.profile.embedding.sha256,indexVersion:indexVersion(evidence.index.meta),layoutKey:evidence.index.meta.layoutKey??'',space:evidence.index===this.fullArtIndex?'whole-card' as const:'art-box' as const,deltaVersion:this.learning.version}:undefined;
    const identityEmbedding=opts.includeIdentityEmbedding && safeEvidence && !opts.card?.partial && evidence.vector.every(Number.isFinite)?{values:Array.from(evidence.vector),space:evidence.index===this.fullArtIndex?'whole-card' as const:'art-box' as const}:undefined;
    return { ...(identityEmbedding?{identityEmbedding}:{}), ...(opts.includeRaw?{raw}:{}), ...(views[0]?.deferredAICrop?{deferredAICrop:views[0].deferredAICrop}:{}), ...(opts.includeCrop?{aiCandidateNames:visual.map(c=>this.catalog.get(c.cardId)?.name).filter((name):name is string=>Boolean(name)).slice(0,10)}:{}), ...(opts.includeCrop && views[0]?.aiCrop?{aiWarpedCard:views[0].aiCrop}:{}), candidates: candidates.slice(0, k), detectedCard, feedback, ...((opts.includeCrop || collect) && views[0] ? {warpedCard: views[0].crop} : {}), tier, quality: { faceDown:views.some(v=>v.faceDown) || candidates[0]?.cardId===this.profile.cardBack.cardId, framesAgree:frameEvidence.length>0 && frameEvidence.every(f=>f.clean[0]?.cardId===visual[0]?.cardId),notInDecklist:Boolean(opts.priors?.decklist?.length && candidates[0] && candidates[0].cardId!==this.profile.cardBack.cardId && !opts.priors.decklist.includes(candidates[0].cardId)), confusionChecked:views.some(v=>v.confusionChecked), sharpness: ranked[0]?.sharpness ?? 0, detected: views.some(v => v.detected), cornersFound: views.some(v => v.corners), framesUsed: views.length, selectedFrameIndices: usedIndices, fallback, frameClass, covered, fullArt:views.some(v=>v.fullArt), fullArtReferences:this.fullArtIndex?.meta.count ?? 0, partial:views.some(v=>v.partial), hypothesis:views[0]?.index===this.fullArtIndex?'whole-card':'art-box' }, timingsMs: timings, backend: this.detector.backend === 'webgpu' && this.embedder.backend === 'webgpu' ? 'webgpu' : 'wasm' };
  }
}

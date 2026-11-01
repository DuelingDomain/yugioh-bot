// Ported from mathulbrich/duel-lens src/offscreen/engine.ts (Apache-2.0), f6968f3682d53a79c4a9fef591300615eda61c11.
// Modified: browser-frame API, game profile, sharpest-three temporal fusion and priors.
// Retains warp -> hypotheses -> staged embedding -> per-card search -> decide flow.
// Extension-only badge rescues are omitted. See licenses/duel-lens.LICENSE.
import { emptyLearning, indexVersion, learnedTopK, type LearningSnapshot } from './learning';
import { boardSide, isCovered, validateBoard } from './board';
import { CARD_DETECTOR } from './detector/spec';
import { detectFullArtLayout } from './full-art';
import type { DetectedQuad } from './types';
import { validateOptions } from './options';
import { embedImages, type TensorCtor } from './embed';
import type { ModelSession } from './runtime';
import { rotate180, type RGBAImage } from './pixels';
import { type Quad } from './geometry';
import { warpQuadMasked, fillUnseen } from './truncation';
import { buildHypotheses } from './hypotheses';
import { detect, chooseCard, refinedCorners } from './detector/run';
import { sharpness, classifyBorder } from './quality';
import { normalize, topK, mergeCandidates, decide, tierFor } from './search';
import type { GameProfile, LoadedIndex, RecognizeOptions, RecognitionResult, Point, Candidate, PeekOptions, PeekResult, ReadAllOptions, BoardResult } from './types';

function fallbackQuad(img: RGBAImage, profile: GameProfile, click?: Point): Quad {
  const h = Math.min(img.height * profile.fallbackHeight, img.width * profile.card.height / profile.card.width);
  const w = h * profile.card.width / profile.card.height;
  const x = Math.max(0, Math.min(img.width - w, (click?.x ?? .5) * img.width - w / 2));
  const y = Math.max(0, Math.min(img.height - h, (click?.y ?? .5) * img.height - h / 2));
  return [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }];
}

export class RecognitionPipeline {
  constructor(private profile: GameProfile, private index: LoadedIndex, private detector: ModelSession, private embedder: ModelSession, private Tensor: TensorCtor, private fullArtIndex?: LoadedIndex) {}
  private learning:LearningSnapshot=emptyLearning();
  setLearning(value:LearningSnapshot) { this.learning=value; }
  private search(vector:Float32Array,index:LoadedIndex,k=5,priors?:RecognizeOptions['priors'],frameClass?:string) {
    return learnedTopK(vector,index,this.learning,index===this.fullArtIndex?'whole-card':'art-box',k,priors,frameClass);
  }
  private confused(list:Candidate[]) {return this.learning.confusions.some(p=>p.a===list[0]?.cardId||p.b===list[0]?.cardId);}
  async detectCards(frame: RGBAImage): Promise<DetectedQuad[]> {
    if(frame.width<3 || frame.height<3 || frame.width*frame.height>16_000_000 || frame.data.length!==frame.width*frame.height*4) throw new Error('Invalid frame');
    const cards=await detect(this.detector,this.Tensor,frame,this.profile.detector.longSide,CARD_DETECTOR.minScore);
    const quads=cards.map(card=>{const quad=refinedCorners(card,frame);return {quad:quad.map(p=>({x:p.x/frame.width,y:p.y/frame.height})),kind:card.kind,confidence:card.conf,partial:quad.some(p=>p.x<0 || p.y<0 || p.x>frame.width || p.y>frame.height)};}).filter(c=>c.quad.length===4);
    return quads.filter(c=>c.confidence>=CARD_DETECTOR.minConfidence).map(c=>({...c,covered:isCovered(c,quads)})).sort((a,b)=>{const ay=Math.min(...a.quad.map(p=>p.y)),by=Math.min(...b.quad.map(p=>p.y));return Math.abs(ay-by)>.04?ay-by:Math.min(...a.quad.map(p=>p.x))-Math.min(...b.quad.map(p=>p.x));});
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
  async recognize(frames: RGBAImage[], opts: RecognizeOptions = {}): Promise<RecognitionResult> {
    validateOptions(opts);
    if (!frames.length || frames.length > 12 || frames.some(f => f.width < 3 || f.height < 3 || f.width * f.height > 16_000_000 || f.data.length !== f.width * f.height * 4)) throw new Error('Supply 1–12 valid frames, each at most 16 MP');
    const start = performance.now();
    const ranked = frames.map((frame, index) => ({ frame, index, sharpness: sharpness(frame, opts.clickPoint) })).sort((a, b) => b.sharpness - a.sharpness).slice(0, 3);
    const timings = { sharpness: performance.now() - start, detect: 0, warp: 0, embed: 0, search: 0, total: 0 };
    const views: { vector: Float32Array; detected: boolean; corners: boolean; unambiguous: boolean; confusionChecked:boolean; frameClass?: string; index: LoadedIndex; fullArt: boolean; partial: boolean; crop: RGBAImage; alternatives: {index:LoadedIndex;vector:Float32Array}[] }[] = [];
    const thresholds = this.profile.embedding.thresholds;
    let covered=Boolean(opts.card?.covered);
    for (const { frame } of ranked) {
      let t = performance.now();
      let scene=opts.card?[]:await detect(this.detector,this.Tensor,frame,this.profile.detector.longSide,CARD_DETECTOR.minScore);
      let card = opts.card ? undefined : chooseCard(scene.filter(c=>c.conf>=CARD_DETECTOR.minConfidence), frame, opts.clickPoint);
      // Upstream's crop-scale detection catches large close-ups outside its trained size range.
      if (!card && !opts.card && this.profile.detector.longSide > 448) {
        scene=await detect(this.detector,this.Tensor,frame,448,CARD_DETECTOR.minScore);
        card=chooseCard(scene.filter(c=>c.conf>=CARD_DETECTOR.minConfidence),frame,opts.clickPoint);
      }
      if(card) {
        const quad=(c:typeof card):DetectedQuad=>({quad:c!.pts.map(([x,y])=>({x:x/frame.width,y:y/frame.height})),kind:c!.kind,confidence:c!.conf,partial:false});
        covered ||= isCovered(quad(card),scene.map(c=>quad(c)));
      }
      timings.detect += performance.now() - t;
      t = performance.now();
      const corners = opts.card ? opts.card.quad.map(p=>({x:p.x*frame.width,y:p.y*frame.height})) : card ? refinedCorners(card, frame) : [];
      const found = corners.length === 4;
      const mask = warpQuadMasked(frame, found ? corners as Quad : fallbackQuad(frame, this.profile, opts.clickPoint), this.profile.card.warpWidth, this.profile.card.warpHeight);
      if (!mask) continue;
      const warped = mask.seenShare<1 ? fillUnseen(mask,'art-mean',this.profile.artWindow) : mask.image;
      const partial = found && (mask.seenShare<.995 || corners.some(p=>p.x<0 || p.y<0 || p.x>frame.width || p.y>frame.height));
      const fullArt = detectFullArtLayout(warped, this.profile);
      const frameClass = !fullArt && found && (opts.card?.kind ?? card?.kind) === 'face-up' ? classifyBorder(warped, this.profile) : undefined;
      const hypotheses = [this.profile.artWindow, ...(this.profile.alternateArtWindows ?? [])].flatMap(artWindow =>
        buildHypotheses(warped, warped, null, { userBoxWithCard: false, artOfCardShapedBox: false }, { ...this.profile, artWindow }));
      hypotheses.sort((a,b) => a.rotation - b.rotation);
      // A face-down prediction is only a hint: full-card pixels must match the indexed back.
      if ((opts.card?.kind ?? card?.kind) === 'face-down') hypotheses.push({ id: 'whole', rotation: 0, image: warped }, { id: 'whole', rotation: 180, image: rotate180(warped) });
      timings.warp += performance.now() - t;
      const vectors: Float32Array[] = [], lists: Candidate[][] = [];
      let merged: Candidate[] = [];
      // Duel Lens's views-in-turn: do not pay for more crops if the first view is sure.
      for (const hypothesis of hypotheses) {
        t = performance.now();
        const [vector] = await embedImages(this.embedder, this.Tensor, this.profile.embedding, [hypothesis.image]);
        if (vector.length !== this.index.meta.dim) throw new Error('Model embedding dimension mismatch');
        timings.embed += performance.now() - t;
        t = performance.now();
        vectors.push(vector); lists.push(this.search(vector, this.index, 10));
        merged = mergeCandidates(lists, 10);
        timings.search += performance.now() - t;
        if (decide(merged, thresholds, this.profile.cardBack.cardId).confident && !this.confused(merged)) break;
      }
      // Keep the vector of the hypothesis that actually supplied the winning visual match.
      let winner = 0;
      for (let i = 1; i < lists.length; i++) if ((lists[i][0]?.score ?? -Infinity) > (lists[winner][0]?.score ?? -Infinity)) winner = i;
      const alternatives=[{index:this.index,vector:vectors[winner]}];
      let fullBest:{vector:Float32Array;score:number}|undefined;
      let winningIndex=this.index, winningVector=vectors[winner], winningRotation=hypotheses[winner]?.rotation ?? 0;
      // Compare whole-card pixels only to whole-card references. Always run both
      // when references exist, even if the standard crop was confident.
      if(this.fullArtIndex?.meta.count) {
        for(const rotation of [0,180] as const) {
          t=performance.now();
          const [vector]=await embedImages(this.embedder,this.Tensor,this.profile.embedding,[rotation ? rotate180(warped) : warped]);
          timings.embed+=performance.now()-t; t=performance.now();
          const list=this.search(vector,this.fullArtIndex,10);
          if(!fullBest || (list[0]?.score ?? -Infinity)>fullBest.score) fullBest={vector,score:list[0]?.score ?? -Infinity};
          if((list[0]?.score ?? -Infinity)>(merged[0]?.score ?? -Infinity)) {winningIndex=this.fullArtIndex;winningVector=vector;winningRotation=rotation;}
          merged=mergeCandidates([merged,list],10);timings.search+=performance.now()-t;
        }
      }
      if(this.fullArtIndex && fullBest) alternatives.push({index:this.fullArtIndex,vector:fullBest.vector});
      const confusionChecked=this.confused(merged);
      const independentlyClear=!confusionChecked || (lists.length>=2 && lists.every(list=>list[0]?.cardId===merged[0]?.cardId && list[0].score-(list[1]?.score??0)>=.06));
      views.push({ confusionChecked, alternatives, vector: winningVector, index:winningIndex,fullArt,partial,crop:winningRotation===180?rotate180(warped):warped, detected: Boolean(card || opts.card), corners: found, unambiguous: independentlyClear && decide(merged, thresholds, this.profile.cardBack.cardId).confident, frameClass });
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
        const query=normalize(average);
        visualLists.push(this.search(query,index,Math.max(k,2)));
        rankedLists.push(this.search(query,index,Math.max(k,2),opts.priors,index===this.index?frameClass:undefined));
      }
      visual=mergeCandidates(visualLists,Math.max(k,2));
      candidates=mergeCandidates(rankedLists,Math.max(k,2));
      if (fallback) {
        visual = visual.map(c => ({ ...c, score: c.score * .85 }));
        candidates = candidates.map(c => ({ ...c, score: c.score * .85 }));
      }
    }
    let tier = tierFor(candidates.length ? visual : [], thresholds, fallback, this.profile.cardBack.cardId, views.every(v => v.unambiguous));
    if(tier==='sure' && (views.some(v=>v.partial) || (views.some(v=>v.fullArt) && !this.fullArtIndex?.meta.count))) tier='not sure';
    if(tier==='sure' && covered) tier='not sure';
    // A prior may improve the suggestions but cannot promote an uncertain visual result.
    if (tier === 'sure' && candidates[0]?.cardId !== visual[0]?.cardId) tier = 'not sure';
    timings.search += performance.now() - t; timings.total = performance.now() - start;
    const evidence=views[0];
    const collect=opts.includeFeedback && evidence?.corners && !fallback && !covered && !views.some(v=>v.partial) && opts.card?.kind!=='face-down' && candidates[0]?.cardId!==this.profile.cardBack.cardId;
    const feedback=collect?{embedding:Array.from(evidence.vector),gameId:this.profile.id,modelId:this.profile.embedding.id,modelSha256:this.profile.embedding.sha256,indexVersion:indexVersion(evidence.index.meta),layoutKey:evidence.index.meta.layoutKey??'',space:evidence.index===this.fullArtIndex?'whole-card' as const:'art-box' as const,deltaVersion:this.learning.version}:undefined;
    return { candidates: candidates.slice(0, k), feedback, ...((opts.includeCrop || collect) && views[0] ? {warpedCard: views[0].crop} : {}), tier, quality: { confusionChecked:views.some(v=>v.confusionChecked), sharpness: ranked[0]?.sharpness ?? 0, detected: views.some(v => v.detected), cornersFound: views.some(v => v.corners), framesUsed: views.length, selectedFrameIndices: ranked.map(v => v.index), fallback, frameClass, covered, fullArt:views.some(v=>v.fullArt), fullArtReferences:this.fullArtIndex?.meta.count ?? 0, partial:views.some(v=>v.partial), hypothesis:views[0]?.index===this.fullArtIndex?'whole-card':'art-box' }, timingsMs: timings, backend: this.detector.backend === 'webgpu' && this.embedder.backend === 'webgpu' ? 'webgpu' : 'wasm' };
  }
}

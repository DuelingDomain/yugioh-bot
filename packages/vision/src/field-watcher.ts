import {createFieldIdentityGallery, type FieldIdentityGallery} from './field-gallery';
import type { Recognizer } from './client';
import type { DetectedQuad, GameProfile, RecognitionPriors, RecognitionResult } from './types';
import { boundsOf } from './geometry';
import { isCovered } from './board';
import { createFieldAnalyzer, cloneFieldFrame, closeFieldFrame, sameFieldAppearance, sameRotatedFieldAppearance, fieldAppearanceDistance, fieldEmbeddingSimilarity, clearFieldBackground, type FieldFrame, type FieldAnalysis } from './field-motion';
import { fieldCenter, onMat, fieldOrientation, mapFieldZone, quadIou, type FieldCalibration, type FieldZone, type FieldFormat } from './field-zones';

export interface FieldTrack {
  id:string; revision?:number; card:DetectedQuad; zone:FieldZone; position:'attack'|'defense'; faceDown:boolean; cardId?:string;
  state:'candidate'|'identified'|'prompt'|'dismissed'; bestMatch?:boolean; firstSeen:number; lastSeen:number; removed:boolean; visible?:boolean;
}
export type FieldEvent = { type:'placed'|'moved'|'flipped'|'removed'|'prompt'; track:FieldTrack; bindRef?:string; result?:RecognitionResult; latencyMs?:number; reason?:'uncertain'|'recognition-error'|'reappeared'|'changed'|'restart'|'pile'|'spread'|'suppressed'; source:'auto' };
export interface FieldMetrics { detectorMs:number; recognitionMs:number; dutyPercent:number; intervalMs:number; samples:number; skipped:number; placements:number; latencyMs:number; errors:number }
export interface FieldSnapshot { status:'stopped'|'starting'|'watching'|'hidden'|'busy'|'budget'|'error'; tracks:FieldTrack[]; metrics:FieldMetrics; error?:string }
export interface FieldBuffer { sample():Promise<{frame:FieldFrame;at:number}> }
export interface KnownFieldCard { id:string; card?:DetectedQuad; zone:FieldZone; cardId?:string; faceDown?:boolean; position?:FieldTrack['position'] }
export interface FieldWatcherOptions {
  recognizer:Pick<Recognizer,'detectCards'|'recognize'>&Partial<Pick<Recognizer,'prepare'>>; buffer:FieldBuffer; profile:GameProfile;
  getPriors?:()=>RecognitionPriors|undefined; getKnownCards?:()=>KnownFieldCard[]; calibration?:FieldCalibration; format?:FieldFormat;
  gallery?:FieldIdentityGallery; stableMs?:number; removalMs?:number; cpuBudget?:number; maxTracks?:number;
  now?:()=>number; hidden?:()=>boolean; cpuBusy?:()=>boolean;
  /** Dependency injection for replay/tests; production defaults sample browser pixels. */
  analyze?:(frame:FieldFrame)=>FieldAnalysis; clone?:(frame:FieldFrame)=>Promise<FieldFrame>;
}
interface PendingRead { at:number; appearance?:number[]; result?:RecognitionResult; error?:boolean }
interface IdentityCheck { state:FieldTrack['state']; cardId?:string; result?:RecognitionResult; reason?:FieldEvent['reason']; strongSamples:number }
interface InternalTrack { view:FieldTrack; anchor:DetectedQuad; announced?:DetectedQuad; announcedZone?:FieldZone; announcedPosition?:FieldTrack['position']; reappeared?:boolean; identityAppearance?:number[]; identityEmbedding?:RecognitionResult['identityEmbedding']; latestEmbedding?:RecognitionResult['identityEmbedding']; lastResult?:RecognitionResult; identityCheck?:IdentityCheck; resolvedAt?:number; prompted?:boolean; newOutline?:boolean; binding?:KnownFieldCard; promptOnly?:FieldEvent['reason']; missed:boolean; halo?:number[]; appearance?:number[]; stableSince:number; observations:number; moveAt?:number; restoredAt?:number; clearMissing:number; missingSamples:number; missingAt?:number; clearWindowAt?:number; best?:{frame:FieldFrame;card:DetectedQuad;score:number}; kind:DetectedQuad['kind']; position:FieldTrack['position']; needsRead:boolean; read?:PendingRead }
const distance=(a:DetectedQuad,b:DetectedQuad)=>{const x=fieldCenter(a),y=fieldCenter(b);return Math.hypot(x.x-y.x,x.y-y.y);};
const mat:DetectedQuad={kind:'face-up',confidence:1,partial:false,quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]};
const copy=(track:FieldTrack):FieldTrack=>({...track,card:structuredClone(track.card)});
/** Owner-only caller, native frame buffer. One detector/read at a time; no AI or uploads. */
export function createFieldWatcher(options:FieldWatcherOptions) {
  const now=options.now??(()=>performance.now()),analyze=options.analyze??createFieldAnalyzer(),clone=options.clone??cloneFieldFrame;
  const hidden=options.hidden??(()=>typeof document!=='undefined'&&document.hidden);
  const stableMs=Math.max(300,Math.min(600,options.stableMs??300)),removalMs=Math.max(2500,options.removalMs??2500);
  const budget=Math.max(.05,Math.min(.5,options.cpuBudget??.2)),maxTracks=Math.max(1,Math.min(60,options.maxTracks??20));
  const gallery=options.gallery??createFieldIdentityGallery();
  const tracks:InternalTrack[]=[],listeners=new Set<(event:FieldEvent)=>void>(),updates=new Set<()=>void>(),retained=new Set<FieldFrame>();
  const metrics:FieldMetrics={detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0};
  let status:FieldSnapshot['status']='stopped',error:string|undefined,active=false,disposed=false,inFlight=false,epoch=0,serial=0,previousAt=-Infinity,lastFrameAt=-Infinity,lastDetectionAt=-Infinity;
  let timer:ReturnType<typeof setTimeout>|undefined,ema=0,busyUntil=0,observer:PerformanceObserver|undefined,calibration=options.calibration,reading:Promise<void>|undefined;
  const suppressed:{card:DetectedQuad;appearance?:number[];halo?:number[];clearAt?:number;samples:number}[]=[];let guarded=false;
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  const notify=()=>{for(const listener of updates)listener();};
  // Once attached to a twin, only an explicit owner correction changes identity.
  const bound=(t:InternalTrack)=>t.view.state==='identified'&&t.resolvedAt!==undefined;
  const matchesLook=(t:InternalTrack,pixels?:number[])=>bound(t)||sameFieldAppearance(t.identityAppearance,pixels);
  const emit=(type:FieldEvent['type'],t:InternalTrack,extra:Partial<FieldEvent>={})=>{if(type==='prompt'){if(t.resolvedAt!==undefined){t.view.state='identified';return;}if(t.prompted)return;const answer=gallery.resolve(extra.result?.identityEmbedding);if(answer.kind!=='new'){t.prompted=true;t.view.state='dismissed';return;}t.prompted=true;t.identityEmbedding=extra.result?.identityEmbedding;t.latestEmbedding=t.identityEmbedding;}const event:FieldEvent={type,track:copy(t.view),...(type==='prompt'&&t.binding?{bindRef:t.binding.id}:{}),source:'auto',...extra};for(const listener of listeners)listener(event);};
  function pruneFrames() {
    const used=new Set(tracks.flatMap(t=>t.best?[t.best.frame]:[]));
    for(const frame of retained)if(!used.has(frame)){closeFieldFrame(frame);retained.delete(frame);}
    // At most six native originals, shared among all tracks rather than one clone per card.
    while(retained.size>6){const frame=retained.values().next().value!;for(const t of tracks)if(t.best?.frame===frame)t.best=undefined;closeFieldFrame(frame);retained.delete(frame);}
  }
  function invalidateRead(t:InternalTrack) {if(t.read){t.read=undefined;t.needsRead=t.view.state!=='dismissed';}}
  function restoreIdentity(t:InternalTrack,pixels?:number[]) {
    const saved=t.identityCheck!;t.identityCheck=undefined;t.read=undefined;t.needsRead=false;t.best=undefined;
    t.view.state=saved.state;t.view.cardId=saved.cardId;t.promptOnly=saved.reason;t.appearance=pixels;
    t.identityAppearance=pixels;t.lastResult=saved.result;t.view.visible=!t.missed&&(saved.state==='identified'||saved.state==='prompt');
    if(saved.state==='prompt')emit('prompt',t,{result:saved.result,reason:saved.reason??'uncertain'});
    else if(saved.state==='identified'&&t.resolvedAt===undefined&&saved.result)emit('placed',t,{result:saved.result});
  }
  function resetAbsence(t:InternalTrack,preserveWindow=false){t.clearMissing=0;t.missingSamples=0;t.missingAt=undefined;if(!preserveWindow)t.clearWindowAt=undefined;}
  function interruptWindow(preserveVisibility=false,preserveAbsenceWindow=false) {previousAt=-Infinity;for(const t of tracks){if(!preserveVisibility)t.view.visible=false;invalidateRead(t);t.stableSince=NaN;t.observations=0;resetAbsence(t,preserveAbsenceWindow);t.best=undefined;}pruneFrames();}
  async function read(t:InternalTrack,input:FieldFrame,card:DetectedQuad,pending:PendingRead,generation:number) {
    try {
      const start=now();
      const result=await options.recognizer.recognize([input] as ImageBitmap[]|ImageData[],{card,k:5,maxFrames:1,includeIdentityEmbedding:true,includeDiagnosticCrop:true,includeRaw:true,preferUpright:true,priors:options.getPriors?.()});
      if(generation===epoch&&!disposed&&t.read===pending){metrics.recognitionMs=now()-start;pending.result=result;}
    }catch{if(generation===epoch&&!disposed&&t.read===pending){metrics.errors++;pending.error=true;}}
    finally{closeFieldFrame(input);}
  }
  const idle=()=>{
    const nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{scheduling?:{isInputPending():boolean}};
    return (!reading&&options.cpuBusy?.()) || now()<busyUntil || nav?.scheduling?.isInputPending();
  };
  async function tick() {
    if(disposed||inFlight)return;
    if(hidden()){status='hidden';metrics.skipped++;interruptWindow();notify();return;}
    const busy=idle(),tracked=tracks.some(t=>t.view.state==='identified'&&!t.view.removed),empty=!tracks.some(t=>!t.view.removed);
    if(busy&&!tracked){status='busy';metrics.skipped++;interruptWindow();notify();return;}
    const light=busy||((tracked||empty)&&!reading&&!tracks.some(t=>t.needsRead||t.read||t.view.state==='candidate')&&now()-lastDetectionAt<metrics.intervalMs);
    const generation=epoch;inFlight=true;const start=now();const samplesBefore=metrics.samples;let current:FieldFrame|undefined,detectFrame:FieldFrame|undefined;
    try {
      const sample=await options.buffer.sample();current=sample.frame;
      if(generation!==epoch||disposed)return;
      if(sample.at<=lastFrameAt){metrics.skipped++;return;}
      lastFrameAt=sample.at;
      const maxGap=Math.max(1000,metrics.intervalMs*1.8),gap=sample.at-previousAt;
      if(gap>maxGap)interruptWindow(light,true);previousAt=sample.at;
      const evidence=analyze(current);
      const trackedMotion=!busy&&tracks.some(t=>t.view.state==='identified'&&!t.view.removed&&(evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&!matchesLook(t,evidence.appearance?.(t.view.card)))));
      if(light&&!trackedMotion&&(!empty||busy||evidence.motion(mat)<=.004)) {
        // Keep cached clicks fresh during input pressure and long detector gaps.
        // Pixel evidence can retain an outline, but only the detector restores one.
        if(busy)interruptWindow(true);status=busy?'busy':guarded?'budget':'watching';metrics.skipped++;
        for(const t of tracks){
          t.view.visible=!!t.view.visible&&t.view.state==='identified'&&!t.view.removed&&evidence.motion(t.view.card)<=.025&&matchesLook(t,evidence.appearance?.(t.view.card));
          if(!t.view.visible){t.missed=true;t.stableSince=NaN;t.observations=0;}
        }
        return;
      }
      if(reading) {
        for(const t of tracks)if(evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&t.view.card.kind==='face-up'&&!matchesLook(t,evidence.appearance?.(t.view.card))))t.view.visible=false;
        // Keep sampling motion/appearance while the worker embeds. Never infer
        // stillness or disappearance from a stale outline during this interval.
        for(const t of tracks)if(t.read&&(evidence.motion(t.view.card)>.025||(t.appearance?.length&&evidence.appearance&&!sameFieldAppearance(t.appearance,evidence.appearance(t.view.card))))) {
          invalidateRead(t);t.stableSince=NaN;t.observations=0;t.best=undefined;
        }
        pruneFrames();return;
      }
      detectFrame=await clone(current);
      const detectStart=now(),detected=await options.recognizer.detectCards(detectFrame);
      metrics.detectorMs=now()-detectStart;lastDetectionAt=sample.at;
      if(generation!==epoch||disposed)return;
      const cards=detected.filter(c=>c.quad.length===4&&c.quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).slice(0,60);
      metrics.samples++;status='watching';error=undefined;
      // Expire departures before matching, including after a long hidden pause.
      for(let i=tracks.length-1;i>=0;i--)if(tracks[i].view.removed&&tracks[i].view.state==='identified'&&sample.at-tracks[i].view.lastSeen>30000)tracks.splice(i,1);
      const appearances=new Map(cards.map(c=>[c,evidence.appearance?.(c)]));
      const appearance=(c:DetectedQuad)=>appearances.get(c);
      const matched=new Map<InternalTrack,DetectedQuad>(),taken=new Set<DetectedQuad>();
      const clearOldSpot=(t:InternalTrack)=>{
        const halo=evidence.halo?.(t.view.card);
        return evidence.motion(t.view.card)<=.01&&!!halo?.length&&halo.length===t.halo?.length&&halo.filter((v,i)=>Math.abs(v-t.halo![i])>.06).length/halo.length<=.08&&clearFieldBackground(evidence.appearance?.(t.view.card),t.halo);
      };
      const followsAppearance=(t:InternalTrack,c:DetectedQuad)=>bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(c)):sameFieldAppearance(t.identityAppearance,appearance(c));
      const pairs=tracks.flatMap(t=>cards.map(c=>{
        const a=boundsOf(t.view.card.quad),b=boundsOf(c.quad),ratio=(a.w*a.h)/(b.w*b.h||1);
        const overlap=quadIou(t.view.card,c),d=distance(t.view.card,c);
        // A light tick may hide changed pixels without a detector miss. Preserve
        // that physical ref at the same spot; the changed path below rereads it.
        const sameSpot=overlap>=.84&&d<.012;
        const needsLook=!bound(t)&&t.view.state==='identified'&&t.view.card.kind==='face-up'&&!sameSpot&&(d>.02||overlap<.84||t.missed);
        const looks=c.kind==='face-up'&&((!t.identityAppearance?.length&&overlap>=.84&&d<.012)||sameFieldAppearance(t.identityAppearance,appearance(c)));
        return {t,c,score:overlap+(1-d)*.1+(c.confidence>=.7?2:0),eligible:ratio>.35&&ratio<2.85&&(overlap>=.12||d<.16)&&(!t.view.removed||(t.view.card.kind===c.kind&&(c.kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&sameFieldAppearance(t.identityAppearance,appearance(c))))&&(!needsLook||looks)&&(!(bound(t)&&(overlap<.12||t.missed)&&d>.04)||clearOldSpot(t))};
      })).filter(p=>p.eligible).sort((a,b)=>b.score-a.score);
      for(const {t,c} of pairs)if(!matched.has(t)&&!taken.has(c)){matched.set(t,c);taken.add(c);}
      // A single recently hidden instance and a single new outline can be followed
      // across the mat. Multiple unmatched cards remain ambiguous and are not guessed.
      const incoming=cards.filter(c=>!taken.has(c));
      const lost=tracks.filter(t=>!matched.has(t)&&(t.view.state==='identified'||t.prompted)&&(t.view.removed?
        incoming.length===1&&t.view.card.kind===incoming[0].kind&&(incoming[0].kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&sameFieldAppearance(t.identityAppearance,appearance(incoming[0])):
        sample.at-t.view.lastSeen<=removalMs));
      if(lost.length===1&&incoming.length===1) {
        const a=boundsOf(lost[0].view.card.quad),b=boundsOf(incoming[0].quad),ratio=a.w*a.h/(b.w*b.h||1);
        if(ratio>.5&&ratio<2&&lost[0].view.card.kind===incoming[0].kind&&followsAppearance(lost[0],incoming[0])){
          if(clearOldSpot(lost[0])){matched.set(lost[0],incoming[0]);taken.add(incoming[0]);}
          // Do not turn the first motion frame into a new birth. Reserve this
          // ambiguous outline until the old spot clears or both copies reappear.
          else if(bound(lost[0]))taken.add(incoming[0]);
        }
      }
      for(const c of cards)if(c.confidence>=.7&&!taken.has(c)&&tracks.filter(t=>!t.view.removed).length<maxTracks) {
        if(calibration&&c.quad.map(p=>onMat(p,calibration)).some(p=>p.x<0||p.x>1||p.y<0||p.y>1))continue;
        const zone=mapFieldZone(c,calibration,cards,options.format).zone;
        const known=options.getKnownCards?.().find(k=>!tracks.some(t=>t.view.id===k.id||t.binding?.id===k.id)&&(k.card?quadIou(k.card,c)>.5:k.zone===zone));
        const trusted=known?.card?known:undefined;
        const t:InternalTrack={view:{id:trusted?.id??`fw-${session}-${++serial}`,card:c,zone,position:fieldOrientation(c,current.width,current.height),faceDown:trusted?.faceDown??c.kind==='face-down',cardId:trusted?.faceDown?undefined:trusted?.cardId,state:trusted?'identified':'candidate',firstSeen:sample.at,lastSeen:sample.at,removed:false},anchor:c,...(trusted?{announced:c,announcedZone:trusted.zone,announcedPosition:trusted.position??fieldOrientation(c,current.width,current.height),identityAppearance:appearance(c)}:{}),...(trusted?{resolvedAt:sample.at}:{}),binding:trusted?undefined:known,newOutline:!trusted,promptOnly:suppressed.some(q=>q.appearance?.length?sameFieldAppearance(q.appearance,appearance(c)):quadIou(q.card,c)>.5)?'suppressed':tracks.some(old=>!old.view.removed&&old.view.state==='identified'&&quadIou(old.view.card,c)>.84&&old.identityAppearance?.length&&!sameFieldAppearance(old.identityAppearance,appearance(c)))?'changed':undefined,missed:false,stableSince:sample.at,observations:0,clearMissing:0,missingSamples:0,kind:c.kind,position:fieldOrientation(c,current.width,current.height),needsRead:!trusted||(!trusted.faceDown&&!trusted.cardId)};
        tracks.push(t);matched.set(t,c);
      }
      // Simultaneous deck-search outlines stay private; a single clean new card
      // settles immediately after its first read and next clean detector frame.
      const recent=tracks.filter(t=>t.newOutline&&sample.at-t.view.firstSeen<=1500);
      const newcomers=recent.filter(t=>t.view.state==='candidate').sort((a,b)=>Number(isCovered(a.view.card,cards))-Number(isCovered(b.view.card,cards)));
      if(recent.length>=3){for(const [i,t] of newcomers.entries()){t.promptOnly='spread';if(i>0){t.view.state='dismissed';t.needsRead=false;t.read=undefined;}}}
      for(let i=suppressed.length-1;i>=0;i--){
        const q=suppressed[i],halo=evidence.halo?.(q.card);
        const clear=!cards.some(c=>quadIou(c,q.card)>.04)&&evidence.motion(q.card)<=.01&&halo?.length&&halo.length===q.halo?.length&&halo.filter((v,j)=>Math.abs(v-q.halo![j])>.06).length/halo.length<=.08&&clearFieldBackground(evidence.appearance?.(q.card),q.halo);
        if(!clear){q.clearAt=undefined;q.samples=0;}else{q.clearAt??=sample.at;q.samples++;if(q.samples>=5&&sample.at-q.clearAt>=removalMs)suppressed.splice(i,1);}
      }
      const reconnected=new Set<InternalTrack>();
      for(const t of [...tracks]) {
        if(reconnected.has(t))continue;
        const c=matched.get(t);
        if(!c) {
          t.view.visible=false;
          invalidateRead(t);
          t.missed=true;t.best=undefined;t.stableSince=NaN;t.observations=0;
          // Full detector evidence only. A stationary hand still has different
          // footprint/halo pixels; an overlapping outline is never clear mat.
          const halo=evidence.halo?.(t.view.card),blocked=!halo?.length||halo.length!==t.halo?.length||halo.filter((v,i)=>Math.abs(v-t.halo![i])>.06).length/halo.length>.08;
          if(evidence.motion(t.view.card)>.01||blocked||cards.some(c=>quadIou(c,t.view.card)>.04)||!clearFieldBackground(evidence.appearance?.(t.view.card),t.halo)){resetAbsence(t);continue;}
          const elapsed=sample.at-(t.missingAt??sample.at);
          if(elapsed>1000)resetAbsence(t,true);
          t.clearWindowAt??=sample.at;
          if(t.missingSamples)t.clearMissing+=elapsed;
          t.missingAt=sample.at;t.missingSamples++;
          if((t.view.state==='prompt'||t.view.state==='dismissed')&&t.clearMissing>=removalMs&&t.missingSamples>=5){t.view.removed=true;t.view.state='dismissed';}
          if(t.view.state==='identified'&&!t.view.removed&&t.clearMissing>=removalMs&&t.missingSamples>=5){t.view.removed=true;t.restoredAt=undefined;emit('removed',t);}
          continue;
        }
        t.reappeared ||= t.view.removed;t.missed=false;t.view.removed=false;resetAbsence(t);t.view.lastSeen=sample.at;t.view.card=c;
        // Uncalibrated ordering is assigned at settlement, then kept until the card actually moves.
        if(calibration||t.view.state==='candidate'||distance(t.anchor,c)>.02)t.view.zone=mapFieldZone(c,calibration,cards,options.format).zone;
        const position=fieldOrientation(c,current.width,current.height);
        if(t.view.state==='identified'&&t.announced){
          const moved=distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position;
          if(moved)t.moveAt??=sample.at;else t.moveAt=undefined;
        }
        const pixels=appearance(c);
        const publicIdentity=bound(t)?options.getKnownCards?.().find(k=>k.id===t.view.id&&!k.faceDown)?.cardId:undefined;
        if(publicIdentity&&publicIdentity!==t.view.cardId){gallery.remember(t.identityEmbedding,publicIdentity);t.view.cardId=publicIdentity;t.view.bestMatch=undefined;}

        if(t.identityCheck&&sameFieldAppearance(t.identityAppearance,pixels)&&t.kind===c.kind&&evidence.motion(c)<=.025&&!c.covered&&!c.partial&&!isCovered(c,cards))restoreIdentity(t,pixels);
        const appearanceChanged=t.read?.appearance?.length&&pixels&&!sameFieldAppearance(t.read.appearance,pixels);
        const changedKind=(t.view.state==='prompt'||t.view.state==='dismissed')&&t.view.faceDown!==(c.kind==='face-down');
        const changedLook=(t.view.state==='prompt'||t.view.state==='dismissed'||(t.view.state==='identified'&&Boolean(t.view.cardId||!t.view.faceDown)&&c.kind==='face-up'))&&t.identityAppearance?.length&&pixels&&!sameFieldAppearance(t.identityAppearance,pixels);
        if(t.prompted&&changedKind){t.view.state='dismissed';t.view.revision=(t.view.revision??0)+1;t.read=undefined;t.needsRead=false;t.best=undefined;}
        const changed=!t.prompted&&!bound(t)&&(changedKind||changedLook)&&evidence.motion(c)<=.025&&!c.covered&&!c.partial;
        if(changed){t.moveAt=undefined;t.identityCheck??={state:t.view.state,cardId:t.view.cardId,result:t.lastResult,reason:t.promptOnly,strongSamples:0};invalidateRead(t);t.view.revision=(t.view.revision??0)+1;t.view.cardId=undefined;t.view.state='candidate';t.view.visible=false;t.needsRead=true;t.promptOnly='changed';t.stableSince=sample.at;t.observations=0;t.best=undefined;}
        if(cards.some(other=>other!==c&&quadIou(c,other)>0)&&t.view.state==='candidate')t.promptOnly??='spread';
        const sizes=tracks.filter(other=>other!==t&&other.view.state==='identified'&&!other.view.removed).map(other=>{const b=boundsOf(other.view.card.quad);return b.w*b.h;}).sort((a,b)=>a-b),size=boundsOf(c.quad);
        if(sizes.length&&size.w*size.h>sizes[Math.floor(sizes.length/2)]*1.8)t.promptOnly??='uncertain';
        const clean=!appearanceChanged&&c.confidence>=.7&&!c.partial&&!c.covered&&!isCovered(c,cards)&&evidence.motion(c)<=.025;
        if(t.identityCheck){if(!clean)t.identityCheck.strongSamples=0;else if(fieldAppearanceDistance(t.identityAppearance,pixels)>=.025)t.identityCheck.strongSamples++;}
        t.view.visible=!changed&&(!t.identityAppearance?.length||c.kind!=='face-up'||matchesLook(t,pixels))&&evidence.motion(c)<=.025&&(t.view.state==='identified'||t.view.state==='prompt')&&c.confidence>=.7&&!c.partial&&!c.covered&&!isCovered(c,cards);
        if(clean&&!t.appearance?.length)t.appearance=pixels;
        const still=quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012&&t.kind===c.kind&&t.position===position;
        if(!clean||!still||!Number.isFinite(t.stableSince)) {
          invalidateRead(t);
          t.anchor=c;t.stableSince=clean?sample.at:NaN;t.observations=0;t.best=undefined;t.kind=c.kind;t.position=position;
        }
        if(!clean)continue;
        t.observations++;
        const score=evidence.sharpness(c);
        if(!t.best||score>t.best.score)t.best={frame:current,card:structuredClone(c),score};
        const movingKnown=t.view.state==='identified'&&!t.needsRead&&t.view.faceDown===(c.kind==='face-down');
        if(t.observations<(movingKnown?2:3)||sample.at-t.stableSince<(movingKnown?100:stableMs))continue;
        const wasFaceDown=t.view.faceDown;
        t.view.faceDown=c.kind==='face-down';t.view.position=position;
        if(t.reappeared){if(t.view.state==='identified')emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.reappeared=false;}
        if(t.view.state==='identified') {
          if(t.announced&&(quadIou(t.announced,c)<.7||distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position)){emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;}
          if(wasFaceDown!==t.view.faceDown){emit('flipped',t);t.needsRead=!t.view.faceDown&&!t.view.cardId;if(t.needsRead)t.identityAppearance=undefined;}
        }
        t.halo=evidence.halo?.(c);t.appearance=pixels;
        if(t.read&&(t.read.result||t.read.error)&&sample.at>t.read.at) {
          const pending=t.read,result=pending.result;t.read=undefined;
          metrics.latencyMs=now()-t.view.firstSeen;
          const safe=result&&result.tier!=='low match'&&result.candidates[0]&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&result.candidates[0].cardId!==options.profile.cardBack.cardId;
          let winner=safe?result!.candidates[0].cardId:undefined;
          if(t.identityCheck){
            const similarity=fieldEmbeddingSimilarity(t.identityEmbedding,result?.identityEmbedding),saved=t.identityCheck;
            const unchanged=similarity!==undefined?similarity>=.84:!t.identityEmbedding&&winner&&winner===saved.cardId;
            if(unchanged){
              t.identityEmbedding??=result?.identityEmbedding;t.latestEmbedding=t.identityEmbedding;
              restoreIdentity(t,pixels);t.view.visible=t.view.state==='identified'||t.view.state==='prompt';continue;
            }
            // Hysteresis: only clearly different embeddings and three strong,
            // clean pixel observations can reopen an answered/dismissed track.
            const incomparable=t.identityEmbedding&&similarity===undefined;
            if(saved.strongSamples<3||incomparable||(similarity!==undefined&&similarity>.68)||sample.at<(t.resolvedAt??-Infinity)+5000){t.read=pending;continue;}
            t.identityCheck=undefined;t.latestEmbedding=result?.identityEmbedding;t.lastResult=result;t.identityAppearance=pixels;t.view.visible=true;
            if(winner&&!['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)){t.view.state='identified';t.view.cardId=winner;t.view.bestMatch=true;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;emit('placed',t,{result,latencyMs:metrics.latencyMs});continue;}
            if(result&&result.tier!=='low match'){t.view.state='dismissed';continue;}
            t.view.state='prompt';
            emit('prompt',t,{result,reason:'changed',latencyMs:metrics.latencyMs});continue;
          }
          t.latestEmbedding=result?.identityEmbedding;t.lastResult=result;
          const remembered=gallery.resolve(result?.identityEmbedding);
          const readable=result&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown;
          if((!t.binding||!t.binding.cardId||t.binding.faceDown)&&!t.promptOnly&&readable&&remembered.kind!=='new'&&(remembered.kind!=='hold'||result.tier==='low match')) {
            if(remembered.kind==='hold'||!remembered.cardId){t.view.state='dismissed';t.prompted=true;t.identityAppearance=pixels;t.best=undefined;continue;}
            winner=remembered.cardId;
          }
          const deck=options.getPriors?.()?.decklist;
          const inDeck=!!winner&&!!deck?.some(id=>String(id)===winner)&&!result?.quality.notInDecklist;
          const pile=['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone);
          // A rotated crop can lose its cheap pixel match. A fresh read may
          // follow only an acknowledged live ref, or an explicitly undone removal.
          const known=options.getKnownCards?.();
          const publicRef=(old:InternalTrack)=>known?.find(card=>card.id===old.view.id&&!card.faceDown&&card.cardId===old.view.cardId&&!['GY','BANISHED','DECK','EXTRA'].includes(card.zone));
          const restored=(old:InternalTrack)=>old.restoredAt!==undefined&&sample.at-old.restoredAt<10000;
          if(t.newOutline&&!t.binding&&!t.promptOnly){
            const sameRestoredSpot=tracks.filter(old=>old!==t&&old.view.removed&&restored(old)&&publicRef(old)?.zone===t.view.zone&&!tracks.some(other=>other!==t&&other.binding?.id===old.view.id));
            if(sameRestoredSpot.length===1){const old=sameRestoredSpot[0];t.binding={id:old.view.id,zone:old.view.zone,cardId:old.view.cardId};t.promptOnly='reappeared';}
          }
          if(winner&&t.newOutline&&!pile&&!t.binding&&!t.promptOnly){
            const clearSpots=new Map<InternalTrack,boolean>();
            const displaced=tracks.filter(old=>{
              const halo=evidence.halo?.(old.view.card),publicTwin=publicRef(old);
              const clear=old.missingSamples>=2&&evidence.motion(old.view.card)<=.01&&!cards.some(other=>quadIou(old.view.card,other)>.04)&&
                halo?.length===old.halo?.length&&!!halo?.length&&halo.filter((v,i)=>Math.abs(v-old.halo![i])>.06).length/halo.length<=.08&&clearFieldBackground(evidence.appearance?.(old.view.card),halo);
              clearSpots.set(old,clear);
              return old!==t&&old.view.state==='identified'&&old.missed&&old.resolvedAt!==undefined&&old.view.cardId===winner&&old.kind==='face-up'&&
                (old.view.removed?!!publicTwin&&sample.at-old.view.lastSeen<30000:clear&&sample.at-old.view.lastSeen<removalMs)&&
                (!known||!!publicTwin)&&(fieldEmbeddingSimilarity(old.identityEmbedding,result?.identityEmbedding)??-1)>=.84;
            });
            if(displaced.length){
              const unverified=tracks.filter(other=>matched.has(other)&&(other.view.state!=='identified'||!other.view.visible));
              const old=displaced[0],reserved=tracks.some(other=>other!==t&&other.binding?.id===old.view.id);
              const canFollow=!old.view.removed||(restored(old)&&clearSpots.get(old));
              if(displaced.length===1&&unverified.length===1&&!reserved&&canFollow){
                const {id,revision,firstSeen}=old.view;
                old.view={...copy(t.view),id,revision,firstSeen,state:'identified',cardId:winner,visible:true};
                old.anchor=c;old.kind=c.kind;old.position=position;old.appearance=pixels;old.identityAppearance=pixels;old.identityEmbedding=result?.identityEmbedding;old.latestEmbedding=result?.identityEmbedding;old.lastResult=result;
                old.halo=evidence.halo?.(c);old.read=undefined;old.best=undefined;old.needsRead=false;old.reappeared=false;old.missed=false;old.restoredAt=undefined;old.stableSince=t.stableSince;old.observations=t.observations;resetAbsence(old);
                old.announced=c;old.announcedZone=old.view.zone;old.announcedPosition=position;old.moveAt=undefined;
                tracks.splice(tracks.indexOf(t),1);reconnected.add(old);emit('moved',old);continue;
              }
              t.promptOnly='reappeared';
              if(displaced.length===1&&!reserved)t.binding={id:old.view.id,zone:old.view.zone,cardId:winner};
            }
          }
          if(t.binding){
            if(!winner&&!t.binding.cardId&&!t.promptOnly){t.view.id=t.binding.id;t.view.cardId=undefined;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;t.binding=undefined;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.needsRead=false;if(t.view.faceDown===false)emit('flipped',t);emit('moved',t);continue;}
            if((t.binding.cardId||winner)&&!t.promptOnly){const reveal=t.binding.faceDown||!t.binding.cardId;t.view.id=t.binding.id;t.view.cardId=reveal?winner:t.binding.cardId;t.view.bestMatch=reveal?(result?.tier!=='sure'||!inDeck):undefined;t.view.state='identified';t.view.visible=true;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.resolvedAt=sample.at;t.binding=undefined;if(reveal)emit('placed',t,{result,latencyMs:metrics.latencyMs});else emit('moved',t);}
            else if(result&&result.tier!=='low match'){t.view.state='dismissed';t.best=undefined;}else {t.view.state='prompt';t.identityAppearance=pixels;t.view.visible=true;emit('prompt',t,{result,reason:t.promptOnly??'restart'});}
          }else if(winner&&!t.promptOnly&&!pile){
            t.view.bestMatch=result?.tier!=='sure'||!inDeck;t.view.state='identified';t.view.visible=true;t.view.cardId=winner;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;metrics.placements++;emit('placed',t,{result,latencyMs:metrics.latencyMs});
          }else if(result&&result.tier!=='low match'){t.view.state='dismissed';t.best=undefined;}else {t.view.state='prompt';t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.view.visible=true;emit('prompt',t,{...(result?{result:{...result,candidates:result.candidates.slice(0,5)}}:{}),latencyMs:metrics.latencyMs,reason:t.promptOnly??(pile?'pile':pending.error?'recognition-error':'uncertain')});}

        }
        if(!t.needsRead){t.best=undefined;continue;}
        if(reading)continue;
        t.needsRead=false;
        if(t.view.faceDown) {
          if(t.binding){const flip=t.binding.faceDown===false;t.view.id=t.binding.id;t.view.cardId=undefined;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;t.binding=undefined;t.identityAppearance=pixels;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.best=undefined;if(flip)emit('flipped',t);emit('moved',t);continue;}
          if(t.prompted){t.best=undefined;continue;}
          if(sample.at<(t.resolvedAt??-Infinity)+5000){t.needsRead=true;t.best=undefined;continue;}
          t.identityCheck=undefined;t.latestEmbedding=undefined;
          t.view.cardId=undefined;t.view.state='prompt';t.view.visible=true;t.identityAppearance=pixels;t.best=undefined;
          emit('prompt',t,{reason:t.promptOnly??(['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)?'pile':'uncertain')});continue;
        }
        const best=t.best!,pending:PendingRead={at:sample.at,appearance:t.appearance?.slice()};t.read=pending;
        const input=await clone(best.frame);
        if(generation!==epoch||disposed||t.read!==pending||!tracks.includes(t)){closeFieldFrame(input);return;}
        reading=read(t,input,best.card,pending,generation).finally(()=>{reading=undefined;});t.best=undefined;
      }
      if(tracks.some(t=>t.best?.frame===current)){retained.add(current);current=undefined;}
      // Keep one-shot metadata tombstones for this camera session. Clear absent
      // dismissals are removed from live capacity, while native frames are released.
      for(let i=tracks.length-1;i>=0;i--)if(tracks[i].view.state==='candidate'&&!tracks[i].prompted&&sample.at-tracks[i].view.lastSeen>3000)tracks.splice(i,1);
      // Keep recent departures for Undo/reappearance without consuming live slots.
      const retired=tracks.filter(t=>t.view.removed&&t.view.state==='identified').sort((a,b)=>b.view.lastSeen-a.view.lastSeen);
      for(const t of retired.filter((t,i)=>i>=maxTracks||sample.at-t.view.lastSeen>30000))tracks.splice(tracks.indexOf(t),1);
      pruneFrames();
    } catch(cause) {
      if(generation===epoch&&!disposed){error=cause instanceof Error?cause.message:String(cause);if(error.includes('Waiting for a camera frame')){status='starting';error=undefined;}else{status='error';metrics.errors++;}interruptWindow();}
    } finally {
      if(detectFrame)closeFieldFrame(detectFrame);if(current)closeFieldFrame(current);
      const elapsed=Math.max(0,now()-start);
      // Startup/model downloads and occasional recognition are not the continuous detector load.
      if(metrics.samples>samplesBefore)ema=ema?ema*.8+elapsed*.2:Math.min(elapsed,80);
      // A bounded placement burst takes priority over the idle CPU budget. With
      // a 100 ms detector, a 20% budget otherwise stretches each confirmation
      // to 500+ ms and defeats the 1–2 second identification target.
      const settling=Boolean(reading)||tracks.some(t=>t.read||(t.view.state==='candidate'&&t.view.card.confidence>=.7&&!t.view.card.partial&&!t.view.card.covered&&now()-t.view.firstSeen<2500)||(t.view.state==='identified'&&!t.view.removed&&((t.missed&&now()-t.view.lastSeen<removalMs+1500)||(t.missingSamples>0&&now()-(t.clearWindowAt??now())<removalMs+1500)||(t.announced&&t.moveAt!==undefined&&now()-t.moveAt<1500&&(distance(t.announced,t.view.card)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==t.position)))));
      metrics.intervalMs=settling?100:Math.max(250,Math.min(5000,ema/budget));metrics.dutyPercent=Math.min(100,100*ema/metrics.intervalMs);
      if(metrics.intervalMs>650)guarded=true;else if(metrics.intervalMs<450)guarded=false;if(status==='watching'&&guarded)status='budget';inFlight=false;notify();
    }
  }
  function schedule() {if(!active)return;timer=setTimeout(async()=>{const start=now();await tick();const interval=!tracks.some(t=>!t.view.removed)?Math.min(100,metrics.intervalMs):tracks.some(t=>t.view.state==='identified'&&!t.view.removed)?Math.min(100,metrics.intervalMs):metrics.intervalMs;if(active)scheduleAfter(Math.max(0,interval-(now()-start)));},0);}
  function scheduleAfter(delay:number) {if(active)timer=setTimeout(()=>schedule(),delay);}
  function stop() {active=false;epoch++;clearTimeout(timer);observer?.disconnect();observer=undefined;interruptWindow();status='stopped';notify();}
  return {
    tick,
    start() {
      if(active||disposed)return;active=true;status=options.recognizer.prepare?'starting':'watching';notify();
      if(typeof PerformanceObserver!=='undefined')try {observer=new PerformanceObserver(list=>{if(list.getEntries().some(e=>e.duration>50))busyUntil=now()+250;});observer.observe({entryTypes:['longtask']});}catch{/* Not supported by every browser. */}
      if(options.recognizer.prepare) {
        const generation=epoch;
        void options.recognizer.prepare().then(()=>{if(generation===epoch&&!disposed&&active){status='watching';schedule();notify();}}).catch(cause=>{if(generation===epoch&&!disposed){active=false;status='error';error=cause instanceof Error?cause.message:String(cause);metrics.errors++;notify();}});
      }else schedule();
    },
    stop,
    dispose(){stop();disposed=true;for(const t of tracks)t.best=undefined;pruneFrames();listeners.clear();updates.clear();},
    subscribe(listener:(event:FieldEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    subscribeState(listener:()=>void){updates.add(listener);return()=>{updates.delete(listener);};},
    getSnapshot():FieldSnapshot{return {status,tracks:tracks.map(t=>copy(t.view)),metrics:{...metrics},error};},
    setCalibration(value?:FieldCalibration){calibration=value;interruptWindow();},
    confirm(id:string,cardId?:string,ref?:string,human=true){const t=tracks.find(t=>t.view.id===id);if(t){t.read=undefined;const other=tracks.find(other=>other!==t&&other.view.id===ref);if(other&&(other.view.removed||!other.view.visible))tracks.splice(tracks.indexOf(other),1);if(ref&&!tracks.some(other=>other!==t&&other.view.id===ref))t.view.id=ref;t.view.visible=!t.missed;for(let i=suppressed.length-1;i>=0;i--)if(sameFieldAppearance(suppressed[i].appearance,t.appearance)||quadIou(suppressed[i].card,t.view.card)>.5)suppressed.splice(i,1);if(human||t.lastResult?.tier==='sure'&&t.lastResult.candidates[0]?.cardId===cardId)gallery.remember(t.latestEmbedding,cardId);t.view.cardId=cardId;t.identityAppearance=t.appearance?.slice();t.identityEmbedding=t.latestEmbedding;t.identityCheck=undefined;t.resolvedAt=now();t.promptOnly=undefined;t.binding=undefined;t.view.state='identified';t.needsRead=false;t.announced=t.view.card;t.announcedZone=t.view.zone;t.announcedPosition=t.view.position;t.moveAt=undefined;t.best=undefined;pruneFrames();notify();}},
    dismiss(id:string){const t=tracks.find(t=>t.view.id===id);if(t){t.read=undefined;if(t.view.state!=='identified')gallery.remember(t.latestEmbedding);t.prompted=true;if(t.view.removed)t.restoredAt=now();t.resolvedAt=now();t.identityCheck=undefined;t.identityEmbedding=t.latestEmbedding;if(t.view.state!=='identified')t.view.state='dismissed';t.needsRead=false;t.best=undefined;pruneFrames();notify();}},
    forget(id:string){const i=tracks.findIndex(t=>t.view.id===id);if(i>=0){suppressed.push({card:tracks[i].view.card,appearance:tracks[i].identityAppearance??tracks[i].appearance,halo:tracks[i].halo,samples:0});if(suppressed.length>maxTracks)suppressed.shift();tracks.splice(i,1);}pruneFrames();notify();},
  };
}
export type FieldWatcher=ReturnType<typeof createFieldWatcher>;

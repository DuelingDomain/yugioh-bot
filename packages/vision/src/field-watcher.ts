import {classifyFaceState,createFaceStateHysteresis,type FaceStateOptions} from './face-state';
import type {RGBAImage} from './pixels';
import {createFieldIdentityGallery, type FieldIdentityGallery} from './field-gallery';
import type { Recognizer } from './client';
import type { DetectedQuad, FractionalBox, GameProfile, RecognitionPriors, RecognitionResult } from './types';
import { boundsOf } from './geometry';
import { isCovered } from './board';
import { createFieldAnalyzer, cloneFieldFrame, closeFieldFrame, sameFieldAppearance, sameRotatedFieldAppearance, fieldAppearanceDistance, fieldEmbeddingSimilarity, clearFieldBackground, clearFieldTransfer, type FieldFrame, type FieldAnalysis } from './field-motion';
import { fieldZoneLayout, fieldZoneCells, fieldMatPoint, fieldCenter, onMat, fieldOrientation, mapFieldZone, quadIou, type FieldCalibration, type FieldZone, type FieldFormat } from './field-zones';

export interface FieldTrack {
  id:string; revision?:number; card:DetectedQuad; zone:FieldZone; position:'attack'|'defense'; faceDown:boolean; cardId?:string;
  state:'candidate'|'identified'|'prompt'|'dismissed'; bestMatch?:boolean; firstSeen:number; lastSeen:number; removed:boolean; visible?:boolean;
}
/** Epoch origin crosses browser/worker/HTTP boundaries; stages are offsets, never mixed clocks. */
export interface FieldTiming { id:string; originAt:number; stagesMs:Record<string,number>; durationsMs:Record<string,number> }
export type FieldEvent = { type:'reading'|'placed'|'moved'|'flipped'|'removed'|'prompt'; track:FieldTrack; bindRef?:string; fromRef?:string; previousId?:string; result?:RecognitionResult; latencyMs?:number; reason?:'uncertain'|'recognition-error'|'reappeared'|'changed'|'restart'|'pile'|'spread'|'suppressed'; source:'auto'; destination?:'DECK'|'EXTRA'; timing?:FieldTiming };
export interface FieldMetrics { detectorMs:number; recognitionMs:number; dutyPercent:number; intervalMs:number; samples:number; skipped:number; placements:number; latencyMs:number; errors:number; event?:FieldTiming }
export interface FieldSnapshot { status:'stopped'|'starting'|'watching'|'hidden'|'busy'|'budget'|'error'; tracks:FieldTrack[]; piles?:{zone:'DECK'|'EXTRA';card:DetectedQuad}[]; metrics:FieldMetrics; error?:string }
export interface FieldBuffer { sample(options?:{maxAgeMs?:number}):Promise<{frame:FieldFrame;at:number}> }
export interface KnownFieldCard { id:string; card?:DetectedQuad; zone:FieldZone|'HAND'; cardId?:string; faceDown?:boolean; position?:FieldTrack['position'] }
export interface FieldWatcherOptions {
  recognizer:Pick<Recognizer,'detectCards'|'recognize'>&Partial<Pick<Recognizer,'prepare'|'detectorBackend'|'detectorTimingsMs'>>; buffer:FieldBuffer; profile:GameProfile;
  getPriors?:()=>RecognitionPriors|undefined; getKnownCards?:()=>KnownFieldCard[]; calibration?:FieldCalibration; format?:FieldFormat;
  gallery?:FieldIdentityGallery; earlyExitMargin?:number; stableMs?:number; removalMs?:number; cpuBudget?:number; maxTracks?:number;
  now?:()=>number; hidden?:()=>boolean; cpuBusy?:()=>boolean;
  /** Dependency injection for replay/tests; production defaults sample browser pixels. */
  analyze?:(frame:FieldFrame)=>FieldAnalysis; clone?:(frame:FieldFrame)=>Promise<FieldFrame>;
}
interface PendingRead { crop?:RGBAImage; at:number; appearance?:number[]; result?:RecognitionResult; error?:boolean }
interface IdentityCheck { state:FieldTrack['state']; cardId?:string; result?:RecognitionResult; reason?:FieldEvent['reason']; strongSamples:number }
interface PendingPose {card:DetectedQuad;origin:DetectedQuad;appearance:number[];at:number;cleanAt?:number;samples:number}
// Private evidence follows the physical track through ref adoption and is never serialized.
interface FaceEvidence { setCardId?:string; gate:ReturnType<typeof createFaceStateHysteresis>; setGate?:ReturnType<typeof createFaceStateHysteresis>; reference?:FaceStateOptions['reference']; front?:RGBAImage; pendingAt?:number; transitionAt?:number; outlineAppearance?:number[] }
interface InternalTrack { setRecovery?:boolean; timing?:FieldTiming; timingOpen?:boolean; placeholder?:boolean; placeholderId?:string; previewEligible?:boolean; clearCandidate?:boolean; clearCandidateAt?:number; face?:FaceEvidence; pose?:PendingPose; view:FieldTrack; anchor:DetectedQuad; announced?:DetectedQuad; announcedZone?:FieldZone; announcedPosition?:FieldTrack['position']; reappeared?:boolean; identityAppearance?:number[]; identityEmbedding?:RecognitionResult['identityEmbedding']; latestEmbedding?:RecognitionResult['identityEmbedding']; lastResult?:RecognitionResult; identityCheck?:IdentityCheck; resolvedAt?:number; prompted?:boolean; newOutline?:boolean; binding?:KnownFieldCard; promptOnly?:FieldEvent['reason']; missed:boolean; halo?:number[]; appearance?:number[]; stableSince:number; observations:number; moveAt?:number; restoredAt?:number; missingSamples:number; missingAt?:number; clearWindowAt?:number; best?:{frame:FieldFrame;card:DetectedQuad;score:number;crop?:RGBAImage}; kind:DetectedQuad['kind']; position:FieldTrack['position']; needsRead:boolean; read?:PendingRead }
const distance=(a:DetectedQuad,b:DetectedQuad)=>{const x=fieldCenter(a),y=fieldCenter(b);return Math.hypot(x.x-y.x,x.y-y.y);};
const mat:DetectedQuad={kind:'face-up',confidence:1,partial:false,quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]};
const copy=(track:FieldTrack):FieldTrack=>({...track,card:structuredClone(track.card)});
const backOutline=(card:DetectedQuad)=>card.kind==='face-down'&&card.confidence>=.4;
const deckZone=(zone:FieldZone):zone is 'DECK'|'EXTRA'=>zone==='DECK'||zone==='EXTRA';
const publicPile=(zone:string):zone is 'GY'|'BANISHED'=>zone==='GY'||zone==='BANISHED';
const overlapFraction=(a:FractionalBox,b:FractionalBox)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));
/** Owner-only caller, native frame buffer. One detector/read at a time; no AI or uploads. */
export function createFieldWatcher(options:FieldWatcherOptions) {
  const now=options.now??(()=>performance.now()),analyze=options.analyze??createFieldAnalyzer(),clone=options.clone??cloneFieldFrame;
  const hidden=options.hidden??(()=>typeof document!=='undefined'&&document.hidden);
  const stableMs=Math.max(300,Math.min(600,options.stableMs??300)),removalMs=Math.max(150,options.removalMs??200);
  const budget=Math.max(.05,Math.min(.5,options.cpuBudget??.2)),maxTracks=Math.max(1,Math.min(60,options.maxTracks??20));
  const gallery=options.gallery??createFieldIdentityGallery();
  const tracks:InternalTrack[]=[],listeners=new Set<(event:FieldEvent)=>void>(),updates=new Set<()=>void>(),retained=new Set<FieldFrame>();
  // Deck stacks are observations, never physical field tracks or identity reads.
  const piles=new Map<'DECK'|'EXTRA',{gate:ReturnType<typeof createFaceStateHysteresis>;card:DetectedQuad;at:number;firstSeen:number;down:boolean;appearance?:number[]}>();
  const metrics:FieldMetrics={detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0};
  let status:FieldSnapshot['status']='stopped',error:string|undefined,active=false,disposed=false,inFlight=false,epoch=0,serial=0,previousAt=-Infinity,lastFrameAt=-Infinity,lastDetectionAt=-Infinity;
  let timer:ReturnType<typeof setTimeout>|undefined,ema=0,calibration=options.calibration,reading:Promise<void>|undefined;
  let recentMotion:{region:FractionalBox;at:number;since:number}|undefined,lastFullDetectionAt=-Infinity,deckTouchedAt=-Infinity,extraTouchedAt=-Infinity;
  const pileTouches=new Map<FieldZone,number>(),pileDepartures=new Set<string>();
  let latestEvidence:FieldAnalysis|undefined;
  const suppressed:{card:DetectedQuad;appearance?:number[];halo?:number[];clearAt?:number;samples:number}[]=[];let guarded=false;
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  const epochAt=()=>performance.timeOrigin;
  const beginTiming=(t:InternalTrack,at:number)=>{if(t.timingOpen)return;t.timingOpen=true;t.timing={id:`${session}:${++timingSerial}`,originAt:epochAt()+at,stagesMs:{capture:0},durationsMs:{}};};
  const stage=(t:InternalTrack,name:string,at=now())=>{if(t.timing){const value=Math.max(0,epochAt()+at-t.timing.originAt);t.timing.stagesMs[name]??=value;t.timing.stagesMs[`${name}Last`]=value;}};
  let timingSerial=0;
  const notify=()=>{for(const listener of updates)listener();};
  // Once attached to a twin, only an explicit owner correction changes identity.
  const bound=(t:InternalTrack)=>t.view.state==='identified'&&t.resolvedAt!==undefined;
  const matchesLook=(t:InternalTrack,pixels?:number[])=>bound(t)?sameRotatedFieldAppearance(t.identityAppearance,pixels):sameFieldAppearance(t.identityAppearance,pixels);
  const departureDestination=(t:InternalTrack,at:number):Pick<FieldEvent,'destination'>=>{
    const touched=Math.max(deckTouchedAt,extraTouchedAt);
    return touched>=t.view.lastSeen-250&&at-touched<=Math.max(2500,removalMs+500)?{destination:extraTouchedAt>deckTouchedAt?'EXTRA':'DECK'}:{};
  };
  const emit=(type:FieldEvent['type'],t:InternalTrack,extra:Partial<FieldEvent>={})=>{if(type==='prompt'){if(t.resolvedAt!==undefined){t.view.state='identified';return;}if(t.prompted){t.view.state='dismissed';return;}const answer=gallery.resolve(extra.result?.identityEmbedding);if(answer.kind!=='new'){t.prompted=true;t.view.state='dismissed';return;}t.prompted=true;t.identityEmbedding=extra.result?.identityEmbedding;t.latestEmbedding=t.identityEmbedding;}if(type==='placed'&&!t.view.faceDown&&t.view.cardId&&t.face?.front)t.face.reference={crop:t.face.front,embedding:t.identityEmbedding};if(!t.timing)beginTiming(t,t.view.firstSeen);stage(t,'commit');
    const timing=structuredClone(t.timing!);timing.stagesMs.commit=timing.stagesMs.commitLast;timing.id+=`:${type}`;metrics.event=timing;metrics.latencyMs=timing.stagesMs.commit;
    const known=options.getKnownCards?.()??[],origin=known.find(card=>card.id===t.view.id&&publicPile(card.zone)&&card.zone!==t.view.zone);
    // Seeing a lower member at the top removes the lifted suffix, not the prefix.
    if((type==='placed'||type==='moved')&&publicPile(t.view.zone)){
      const members=known.filter(card=>card.zone===t.view.zone),index=members.findIndex(card=>card.id===t.view.id),top=members.at(-1);
      const topTrack=tracks.find(old=>old!==t&&old.view.id===top?.id&&old.view.zone===t.view.zone);
      const stillShown=topTrack&&matchesLook(topTrack,latestEvidence?.appearance?.(topTrack.view.card));
      const spread=tracks.some(other=>other!==t&&!other.view.removed&&other.view.zone===t.view.zone&&quadIou(other.view.card,t.view.card)<.35);
      if(index>=0&&top?.cardId!==t.view.cardId&&!stillShown&&!spread)for(const member of members.slice(index+1).reverse()){
        if(pileDepartures.has(member.id))continue;
        let taken=tracks.find(old=>old!==t&&old.view.id===member.id);
        if(taken&&(taken.view.zone!==t.view.zone||matchesLook(taken,latestEvidence?.appearance?.(taken.view.card))))continue;
        taken??={...t,view:{...copy(t.view),id:member.id,cardId:member.cardId,lastSeen:topTrack?.view.lastSeen??t.view.firstSeen},binding:undefined,read:undefined,best:undefined,needsRead:false,identityAppearance:undefined,identityEmbedding:undefined,latestEmbedding:undefined,lastResult:undefined,face:undefined,appearance:undefined};
        if(!tracks.includes(taken))tracks.push(taken);
        taken.view.removed=true;taken.view.visible=false;pileDepartures.add(member.id);emit('removed',taken);
      }
    }
    if(type==='removed'&&publicPile(t.view.zone))pileDepartures.add(t.view.id);
    if((type==='placed'||type==='moved')&&publicPile(t.view.zone))pileDepartures.delete(t.view.id);
    const event:FieldEvent={type,track:copy(t.view),...(type==='removed'?departureDestination(t,now()):{}),...(origin?{fromRef:origin.id}:{}),...(t.placeholderId&&t.placeholderId!==t.view.id?{previousId:t.placeholderId}:{}),...(type==='prompt'&&t.binding?{bindRef:t.binding.id}:{}),source:'auto',...extra,latencyMs:metrics.latencyMs,timing};for(const listener of listeners)listener(event);if(type!=='reading')t.timingOpen=false;};
  function pruneFrames() {
    const used=new Set(tracks.flatMap(t=>t.best?[t.best.frame]:[]));
    for(const frame of retained)if(!used.has(frame)){closeFieldFrame(frame);retained.delete(frame);}
    // At most six native originals, shared among all tracks rather than one clone per card.
    while(retained.size>6){const frame=retained.values().next().value!;for(const t of tracks)if(t.best?.frame===frame)t.best=undefined;closeFieldFrame(frame);retained.delete(frame);}
  }
  function invalidateRead(t:InternalTrack) {if(t.read){t.read=undefined;t.needsRead=t.view.state!=='dismissed';}}
  // Pixel evidence remains available while the inference worker is occupied.
  // Missing outlines alone never remove a card: the whole footprint and its
  // original halo must agree with clear mat, including at the camera edge.
  function observeAbsence(t:InternalTrack,evidence:FieldAnalysis,at:number) {
    if(t.view.removed)return;
    const halo=evidence.halo?.(t.view.card),pixels=evidence.background?.(t.view.card)??evidence.appearance?.(t.view.card);
    // A uniform sleeve can match the mat. Unchanged card pixels are never
    // evidence of departure, even when the detector is between samples.
    const clear=!sameFieldAppearance(t.identityAppearance??t.appearance,pixels)&&!evidence.occluded?.(t.view.card)&&
      clearFieldBackground(pixels,halo);
    t.clearCandidate=!!clear;if(clear)t.clearCandidateAt??=at;else t.clearCandidateAt=undefined;
    if(!clear||evidence.motion(t.view.card)>.01){resetAbsence(t);return;}
    t.view.visible=false;t.missed=true;invalidateRead(t);t.best=undefined;
    if(t.missingAt!==undefined&&at-t.missingAt>Math.max(1000,metrics.detectorMs*2))resetAbsence(t);
    t.clearWindowAt??=at;t.missingAt=at;t.missingSamples++;
    if(t.missingSamples<3||at-t.clearWindowAt<removalMs)return;
    t.view.removed=true;t.restoredAt=undefined;
    if(t.view.state==='identified'||t.placeholder)emit('removed',t);
    if(t.view.state!=='identified')t.view.state='dismissed';
  }
  async function startRead(t:InternalTrack,frame:FieldFrame,card:DetectedQuad,crop:RGBAImage|undefined,at:number,generation:number) {
    if(reading||t.read||!t.needsRead)return;
    const pending:PendingRead={at,appearance:t.appearance?.slice(),crop};
    t.read=pending;t.needsRead=false;
    const input=await clone(frame);
    if(generation!==epoch||disposed||t.read!==pending||!tracks.includes(t)){closeFieldFrame(input);return;}
    reading=read(t,input,card,pending,generation).finally(()=>{reading=undefined;});
  }
  function restoreIdentity(t:InternalTrack,pixels?:number[]) {
    const saved=t.identityCheck!;t.identityCheck=undefined;t.read=undefined;t.needsRead=false;t.best=undefined;
    t.view.state=saved.state;t.view.cardId=saved.cardId;t.promptOnly=saved.reason;t.appearance=pixels;
    t.identityAppearance=pixels;t.lastResult=saved.result;t.view.visible=!t.missed&&(saved.state==='identified'||saved.state==='prompt');
    if(saved.state==='prompt')emit('prompt',t,{result:saved.result,reason:saved.reason??'uncertain'});
    else if(saved.state==='identified'&&t.resolvedAt===undefined&&saved.result)emit('placed',t,{result:saved.result});
  }
  function resetFace(t:InternalTrack){t.face?.gate.reset();t.face?.setGate?.reset();if(t.face){t.face.pendingAt=undefined;t.face.transitionAt=undefined;t.face.outlineAppearance=undefined;}}
  function resetAbsence(t:InternalTrack,preserveWindow=false){t.missingSamples=0;t.missingAt=undefined;if(!preserveWindow)t.clearWindowAt=undefined;}
  function interruptWindow(preserveVisibility=false,preserveAbsenceWindow=false) {previousAt=-Infinity;piles.clear();for(const t of tracks){resetFace(t);t.pose=undefined;if(!preserveVisibility)t.view.visible=false;invalidateRead(t);t.stableSince=NaN;t.observations=0;if(!preserveAbsenceWindow)resetAbsence(t);t.best=undefined;}pruneFrames();}
  const preparation=()=>({priors:options.getPriors?.(),sessionGallery:gallery.entries().flatMap(entry=>entry.cardId&&entry.embedding.values.length===options.profile.embedding.dim?[{cardId:entry.cardId,embedding:entry.embedding}]:[]).slice(-512)});
  async function read(t:InternalTrack,input:FieldFrame,card:DetectedQuad,pending:PendingRead,generation:number) {
    try {
      const start=now();stage(t,'embedStart');
      if(generation!==epoch||disposed||t.read!==pending)return;
      // Refresh fallback references too: owner corrections must replace the
      // startup gallery even when a shortlist match misses the early-exit gate.
      await options.recognizer.prepare?.(preparation());
      if(generation!==epoch||disposed||t.read!==pending)return;
      const priors=options.getPriors?.();
      const result=await options.recognizer.recognize([input] as ImageBitmap[]|ImageData[],{card,k:5,maxFrames:1,includeIdentityEmbedding:true,includeDiagnosticCrop:true,includeRaw:true,preferUpright:true,priors,gallery:gallery.entries(),deckFirst:!!priors?.decklist?.length,earlyExitMargin:options.earlyExitMargin??.02});
      if(generation===epoch&&!disposed&&t.read===pending){metrics.recognitionMs=now()-start;pending.result=result;stage(t,'searchDone');if(t.timing)Object.assign(t.timing.durationsMs,result.timingsMs);}
    }catch{if(generation===epoch&&!disposed&&t.read===pending){metrics.errors++;pending.error=true;}}
    finally{closeFieldFrame(input);}
  }
  const idle=()=>{
    const nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{scheduling?:{isInputPending():boolean}};
    // A completed main-thread task says nothing about current input pressure.
    // Worker scans already obey their duty budget; fresh frames must keep the
    // face gate progressing while unrelated rendering/network work settles.
    return (!reading&&options.cpuBusy?.()) || nav?.scheduling?.isInputPending();
  };
  function proposePose(t:InternalTrack,card:DetectedQuad,cards:DetectedQuad[],evidence:FieldAnalysis,at:number,width:number,height:number) {
    const origin=t.announced??t.view.card,pixels=evidence.appearance?.(card);
    if(!bound(t)||card.kind!==t.view.card.kind||(card.kind==='face-down')!==t.view.faceDown||card.confidence<.7||card.partial||card.covered||isCovered(card,cards)||!pixels?.length||
      (distance(origin,card)<=.04&&fieldOrientation(card,width,height,calibration)===t.view.position))return;
    t.pose={card:structuredClone(card),origin:structuredClone(origin),appearance:pixels,at,cleanAt:at,samples:1};
  }
  function confirmPoses(evidence:FieldAnalysis,at:number,width:number,height:number):boolean {
    let pending=false;
    for(const t of tracks){
      const pose=t.pose;if(!pose)continue;
      const pixels=evidence.appearance?.(pose.card),translated=distance(pose.origin,pose.card)>.04;
      // Only a fresh detector quad can be retained. Never invent or revive an
      // outline from pixels, and abandon the shortcut on further motion/occlusion.
      if(at-pose.at>600||!bound(t)||t.view.removed||(pose.card.kind==='face-down')!==t.view.faceDown||!sameFieldAppearance(pose.appearance,pixels)||evidence.motion(pose.card)>.025||
        (translated&&(evidence.motion(pose.origin)>.01||!clearFieldTransfer(evidence,pose.origin,pose.card,t.halo)))){t.pose=undefined;continue;}
      pending=true;pose.cleanAt??=at;pose.samples++;
      t.view.visible=false;
      if(pose.samples<2||at-pose.cleanAt<100)continue;
      const card=pose.card,position=fieldOrientation(card,width,height,calibration);
      t.view.card=card;t.view.zone=mapFieldZone(card,calibration,[],options.format).zone;t.view.position=position;t.view.lastSeen=at;t.view.visible=true;t.view.removed=false;
      t.anchor=card;t.kind=card.kind;t.position=position;t.appearance=pixels;t.halo=evidence.halo?.(card);t.missed=false;t.reappeared=false;t.stableSince=pose.cleanAt;t.observations=pose.samples;resetAbsence(t);
      t.pose=undefined;t.announced=card;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;emit('moved',t);
    }
    if(pending)for(const t of tracks)if(t.view.visible&&evidence.motion(t.view.card)>.025)t.view.visible=false;
    return pending;
  }
  // Pixel confirmations use decoded camera frames at a bounded faster cadence.
  // Inference retains its backend budget; repeated frames never advance gates.
  const pixelBurst=()=>{
    if(status==='busy'||status==='hidden')return false;
    const at=now();
    return [...piles.values()].some(p=>!p.down&&at-p.firstSeen<1500)||tracks.some(t=>
      t.view.state==='candidate'&&at-Math.max(t.view.firstSeen,t.face?.transitionAt??-Infinity)<1500&&(t.view.card.confidence>=.7||backOutline(t.view.card))&&!t.view.card.partial&&!t.view.card.covered||
      t.view.state==='identified'&&t.view.faceDown!==(t.view.card.kind==='face-down')&&at-(t.face?.transitionAt??at)<1500&&at-t.view.lastSeen<450||
      t.face?.pendingAt!==undefined&&at-t.face.pendingAt<1500||t.face?.transitionAt!==undefined&&at-t.face.transitionAt<1500||t.pose&&at-t.pose.at<600||t.read&&at-t.read.at<1500||
      t.missingSamples>0&&at-(t.clearWindowAt??at)<removalMs+1500);
  };
  async function tick() {
    if(disposed||inFlight)return;
    if(hidden()){status='hidden';metrics.skipped++;interruptWindow();notify();return;}
    const busy=idle(),tracked=tracks.some(t=>t.view.state==='identified'&&!t.view.removed),empty=!tracks.some(t=>!t.view.removed);
    if(busy&&empty){status='busy';metrics.skipped++;interruptWindow();notify();return;}
    const pileBurst=()=>[...piles.values()].some(p=>!p.down&&now()-p.firstSeen<1500);
    const faceBurst=pileBurst()||tracks.some(t=>t.face?.pendingAt!==undefined&&now()-t.face.pendingAt<1500);
    // Quiet empty fields need fewer background scans, which can block arrivals.
    // Keep a bounded retry so a stationary card recovers from a detector miss.
    const light=busy||(!faceBurst&&(tracked||empty)&&!reading&&!tracks.some(t=>t.needsRead||t.read||t.view.state==='candidate')&&
      now()-lastDetectionAt<(empty&&!tracks.length&&!piles.size&&!suppressed.length?Math.max(2000,metrics.intervalMs):metrics.intervalMs));
    const generation=epoch;inFlight=true;const start=now();let detectorRan=false,current:FieldFrame|undefined,detectFrame:FieldFrame|undefined;
    try {
      const captureAt=now(),sample=await options.buffer.sample({maxAgeMs:30}),captureMs=now()-captureAt;current=sample.frame;
      if(generation!==epoch||disposed)return;
      if(sample.at<=lastFrameAt){metrics.skipped++;return;}
      lastFrameAt=sample.at;
      const maxGap=Math.max(1000,metrics.intervalMs*1.8),gap=sample.at-previousAt;
      if(gap>maxGap)interruptWindow(light,true);previousAt=sample.at;
      const evidence=analyze(current);latestEvidence=evidence;
      // Use the adjustable mat cells for buried members too: they have no live quad.
      for(const cell of fieldZoneCells(options.format,calibration?.zoneSpacing,calibration?.zones))if(publicPile(cell.zone)||cell.zone==='EXTRA'){
        const quad=[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},{x:cell.x+cell.w,y:cell.y+cell.h},{x:cell.x,y:cell.y+cell.h}].map(p=>calibration?fieldMatPoint(p,calibration):p);
        if(evidence.motion({quad,kind:'face-up',confidence:1,partial:false})>.025){pileTouches.set(cell.zone,sample.at);if(cell.zone==='EXTRA')extraTouchedAt=sample.at;}
      }
      for(const t of tracks)if(publicPile(t.view.zone)&&!t.view.removed&&evidence.motion(t.view.card)>.025)pileTouches.set(t.view.zone,sample.at);
      // Deck identity stays private. Its motion still supplies a destination
      // for a field card whose own footprint becomes clear in this window.
      const deck=piles.get('DECK');
      if(deck&&evidence.motion(deck.card)>.025)deckTouchedAt=sample.at;
      const difference=evidence.motionRegion,localizedDifference=!!difference&&difference.w*difference.h>=.001&&difference.w*difference.h<=.35;
      if(difference)recentMotion={region:difference,at:sample.at,since:recentMotion&&sample.at-recentMotion.at<=250?recentMotion.since:sample.at};
      for(const t of [...tracks]){
        // Even a frame skipped by the detector throttle interrupts confirmation.
        if(evidence.motion(t.view.card)>.025||evidence.occluded?.(t.view.card)||t.view.card.partial||t.view.card.covered)resetFace(t);
        // Unplaced draw outlines have no public state to remove. Once a real
        // detector miss and clear mat agree, stop their confirmation scans.
        if(t.view.state==='candidate'&&t.view.faceDown&&!t.placeholder&&!t.binding&&!t.prompted&&t.resolvedAt===undefined&&!t.read&&t.missed&&lastDetectionAt>t.view.lastSeen&&
          evidence.motion(t.view.card)<=.01&&!evidence.occluded?.(t.view.card)&&clearFieldBackground(evidence.appearance?.(t.view.card),evidence.halo?.(t.view.card))){
          tracks.splice(tracks.indexOf(t),1);t.best=undefined;pruneFrames();continue;
        }
        if(!t.view.removed&&(evidence.motion(t.view.card)>.025||t.identityAppearance?.length&&!matchesLook(t,evidence.appearance?.(t.view.card))))beginTiming(t,sample.at);
        if(busy)resetAbsence(t);else observeAbsence(t,evidence,sample.at);
      }
      if(!reading)for(const t of tracks){
        const c=t.view.card,pixels=evidence.appearance?.(c);
        if(!t.previewEligible||t.view.state!=='candidate'||t.view.removed||t.promptOnly||sample.at-t.view.lastSeen>500||c.confidence<.7||c.partial||c.covered||
          evidence.motion(c)>.025||evidence.occluded?.(c)||!sameFieldAppearance(t.appearance,pixels)||evidence.sharpness(c)<12)continue;
        const crop=evidence.crop?.(c);if(!crop)continue;
        const observation=classifyFaceState(crop,{detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined});
        if(observation.state!=='up')continue;
        if(!t.placeholder&&!t.binding&&!['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)){
          t.placeholder=true;t.placeholderId=t.view.id;t.view.faceDown=false;t.halo=evidence.halo?.(c);
          emit('reading',t,{latencyMs:now()-t.view.firstSeen});
        }
        if(!busy&&observation.state==='up'){t.halo=evidence.halo?.(c);await startRead(t,current,c,crop,sample.at,generation);}
        if(reading)break;
      }
      // A clear footprint with no motion elsewhere is a departure, not a
      // transfer. Sample it at camera cadence even on a slow CPU. Motion outside
      // the old quad still runs detection so field/pile transfers keep their ref.
      if(!reading&&tracks.some(t=>!t.view.removed&&t.clearCandidate&&sample.at-(t.clearCandidateAt??sample.at)<650&&(evidence.motionOutside?.(t.view.card)??1)<=.004&&(!recentMotion||sample.at-recentMotion.at>650||(()=>{const b=boundsOf(t.view.card.quad),r=recentMotion.region;return r.x>=b.x-b.w*.2&&r.y>=b.y-b.h*.2&&r.x+r.w<=b.x+b.w*1.2&&r.y+r.h<=b.y+b.h*1.2;})()))&&
        !tracks.some(t=>!t.view.removed&&t.view.state==='candidate')){status='watching';return;}
      if(!busy&&!reading&&confirmPoses(evidence,sample.at,current.width,current.height)){status='watching';return;}
      const trackedMotion=!busy&&tracks.some(t=>t.view.state==='identified'&&(t.view.removed?(evidence.motionOutside?.(t.view.card)??evidence.motion(mat))>.004:evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&!matchesLook(t,evidence.appearance?.(t.view.card)))));
      if(light&&!trackedMotion&&(busy||!localizedDifference&&evidence.motion(mat)<=.004)) {
        // Keep cached clicks fresh during input pressure and long detector gaps.
        // Pixel evidence can retain an outline, but only the detector restores one.
        if(busy)interruptWindow(true,true);status=busy?'busy':guarded?'budget':'watching';metrics.skipped++;
        for(const t of tracks){
          t.view.visible=!!t.view.visible&&t.view.state==='identified'&&!t.view.removed&&evidence.motion(t.view.card)<=.025&&matchesLook(t,evidence.appearance?.(t.view.card));
          if(!t.view.visible){resetFace(t);t.missed=true;t.stableSince=NaN;t.observations=0;}
        }
        return;
      }
      if(reading) {
        for(const t of tracks)if(evidence.occluded?.(t.view.card)||evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&t.view.card.kind==='face-up'&&!matchesLook(t,evidence.appearance?.(t.view.card)))){t.view.visible=false;resetFace(t);}
        // Keep sampling motion/appearance while the worker embeds. Never infer
        // stillness or disappearance from a stale outline during this interval.
        for(const t of tracks)if(t.read&&(evidence.occluded?.(t.view.card)||evidence.motion(t.view.card)>.025||(t.appearance?.length&&evidence.appearance&&!sameFieldAppearance(t.appearance,evidence.appearance(t.view.card))))) {
          resetFace(t);invalidateRead(t);t.stableSince=NaN;t.observations=0;t.best=undefined;
        }
        for(const t of tracks)if(t.read&&t.face&&!evidence.occluded?.(t.view.card)&&evidence.motion(t.view.card)<=.025){
          const crop=evidence.crop?.(t.view.card);
          if(crop)t.face.gate.update(classifyFaceState(crop,{reference:t.face.reference,detectorFaceDownScore:t.view.card.kind==='face-down'?t.view.card.confidence:undefined}),sample.at);
        }
        pruneFrames();return;
      }
      const readyRead=tracks.some(t=>t.previewEligible&&!t.view.removed&&!t.promptOnly&&!t.identityCheck&&t.read?.result?.tier==='sure'&&
        (t.read.result.candidates[0]?.score??0)>=.84&&sample.at-t.view.lastSeen<=1500&&evidence.motion(t.view.card)<=.025&&
        sameFieldAppearance(t.read.appearance,evidence.appearance?.(t.view.card)));
      // A tiny appearance patch can match the mat after a moving card leaves.
      // Only a new detector result can confirm a candidate on clear background.
      const cachedTracks=tracks.filter(t=>t.view.state!=='candidate'||t.view.card.kind!=='face-down'||!clearFieldBackground(evidence.appearance?.(t.view.card),evidence.halo?.(t.view.card)));
      // Leave a bounded confirmation window after inference returns. Its input
      // timestamp includes the model's own wait; it is not the result's age.
      const confirmationAge=Math.max(450,Math.min(1000,metrics.detectorMs+250));
      const faceSamples=cachedTracks.some(t=>t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined||t.read?.result||t.view.state==='candidate'&&t.newOutline||t.view.state==='identified'&&t.view.faceDown!==(t.view.card.kind==='face-down'))&&now()-lastDetectionAt<confirmationAge&&
        cachedTracks.every(t=>t.view.removed||t.view.state==='candidate'&&!t.view.visible&&!t.read&&t.face?.pendingAt===undefined||sample.at-t.view.lastSeen<450&&!t.view.card.partial&&!t.view.card.covered&&evidence.motion(t.view.card)<=.025&&
          sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(t.view.card)))&&evidence.motion(mat)<=.004;
      let detected:DetectedQuad[],region:FractionalBox|undefined;
      if(readyRead||faceSamples){
        // Retain only outlines whose current pixels still agree. A new outline
        // or changed/occluded pixels must go through detection as usual.
        // The outline's detector age is bounded above, independently of the
        // physical track's age (a moving draw may have created it earlier).
        detected=cachedTracks.filter(t=>!t.view.removed&&(t.view.visible||t.read||t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined||t.newOutline&&faceSamples&&sample.at-t.view.lastSeen<450&&!t.view.card.partial&&!t.view.card.covered||t.view.state==='identified'&&t.view.faceDown!==(t.view.card.kind==='face-down'))&&evidence.motion(t.view.card)<=.025&&
          sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(t.view.card))).map(t=>structuredClone(t.view.card));
      }else{
      if(pixelBurst()&&sample.at-lastDetectionAt<(options.recognizer.detectorBackend==='webgpu'?Math.max(100,metrics.intervalMs):100))return;
      detectorRan=true;
      detectFrame=await clone(current);
      // Discover new outlines in the recent motion crop, including all live
      // tracks so association and overlap checks still see the whole field.
      // Periodic full scans catch stationary cards missed outside that crop.
      // A new localized change is useful even after a long idle interval. Quiet
      // periodic scans still cover the full frame; cropped misses retry below.
      if(recentMotion&&sample.at-recentMotion.at<1500&&(localizedDifference||sample.at-lastFullDetectionAt<2000)){
        const boxes=[recentMotion.region,...tracks.filter(t=>!t.view.removed).map(t=>boundsOf(t.view.card.quad))];
        const x=Math.max(0,Math.min(...boxes.map(b=>b.x))-.06),y=Math.max(0,Math.min(...boxes.map(b=>b.y))-.08);
        const right=Math.min(1,Math.max(...boxes.map(b=>b.x+b.w))+.06),bottom=Math.min(1,Math.max(...boxes.map(b=>b.y+b.h))+.08);
        if((right-x)*(bottom-y)<.6)region={x,y,w:right-x,h:bottom-y};
      }
      const detectStart=now();
      detected=await options.recognizer.detectCards(detectFrame,region?{region}:undefined);
      // A crop changes the detector's context. In particular, a plain sleeve
      // may be found only in the full frame. A missed crop must not add the
      // entire periodic full-scan delay to first sight or a flip.
      const unexplainedDifference=recentMotion&&sample.at-recentMotion.at<=250&&!detected.some(c=>
        overlapFraction(boundsOf(c.quad),recentMotion!.region)>=.12&&!tracks.some(t=>bound(t)&&quadIou(t.view.card,c)>=.84&&distance(t.view.card,c)<.012&&
          t.view.faceDown===(c.kind==='face-down')&&evidence.motion(c)<=.025&&matchesLook(t,evidence.appearance?.(c))));
      if(region&&(!detected.length||detected.some(c=>c.partial)||unexplainedDifference)){
        closeFieldFrame(detectFrame);detectFrame=await clone(current);
        detected=await options.recognizer.detectCards(detectFrame);region=undefined;
      }
      if(!region)lastFullDetectionAt=sample.at;
      metrics.detectorMs=now()-detectStart;lastDetectionAt=sample.at;
      }
      if(generation!==epoch||disposed)return;
      const cardAspect=(c:DetectedQuad)=>{
        const side=calibration?.orientation?.playerSide,quarterTurn=side==='left'||side==='right';
        const width=quarterTurn?current!.height:current!.width,height=quarterTurn?current!.width:current!.height;
        const fits=(q:{x:number;y:number}[])=>{
          const edge=(a:number,b:number)=>Math.hypot(q[a].x-q[b].x,q[a].y-q[b].y);
          const w=(edge(0,1)+edge(2,3))/2,h=(edge(1,2)+edge(3,0))/2,ratio=Math.min(w,h)/Math.max(w,h);
          return ratio>=59/86*.88&&ratio<=59/86*1.12;
        };
        // Calibration describes zone placement, not camera pixel aspect. A
        // narrow/short calibrated grid must not turn a real sleeve into a phone.
        return fits(c.quad.map(p=>({x:p.x*current!.width,y:p.y*current!.height})))||
          fits(c.quad.map(p=>onMat(p,calibration)).map(p=>({x:p.x*width,y:p.y*height})));
      };
      const outlines=detected.filter(c=>c.quad.length===4&&c.quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).slice(0,60);
      const cards=outlines.filter(c=>!deckZone(mapFieldZone(c,calibration,[],options.format).zone));
      const seenPiles=new Set<FieldZone>();
      const area=(c:DetectedQuad)=>Math.abs(c.quad.reduce((sum,p,i)=>{const next=c.quad[(i+1)%4];return sum+p.x*next.y-next.x*p.y;},0))/2;
      for(const c of [...outlines].sort((a,b)=>area(b)-area(a)||b.confidence-a.confidence)){
        const zone=mapFieldZone(c,calibration,[],options.format).zone;
        if(!deckZone(zone)||seenPiles.has(zone))continue;
        seenPiles.add(zone);
        const pile=piles.get(zone)??{gate:createFaceStateHysteresis({sustainMs:120,minSamples:3}),card:c,at:sample.at,firstSeen:sample.at,down:false};
        const clean=c.confidence>=.4&&(c.confidence>=.7||cardAspect(c))&&!c.partial&&!c.covered&&!isCovered(c,outlines)&&evidence.motion(c)<=.025;
        const crop=clean?evidence.crop?.(c):undefined;
        const observation=crop?classifyFaceState(crop,{detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined}):{state:'unknown' as const,confidence:0};
        // Unknown observations retain a verified stack; a confident front clears it.
        // Detector absence expires it after three seconds. Never infer its count.
        pile.down=pile.gate.update(observation,sample.at).state==='down'||pile.down&&!(observation.state==='up'&&observation.confidence>=.8);
        const pixels=evidence.appearance?.(c);
        if(zone==='DECK'&&(evidence.motion(c)>.025||pile.appearance?.length&&!sameFieldAppearance(pile.appearance,pixels)||
          !piles.has(zone)&&tracks.some(t=>!t.view.removed&&(t.missed||t.clearCandidate))))deckTouchedAt=sample.at;
        pile.appearance=pixels;pile.card=c;pile.at=sample.at;piles.set(zone,pile);
      }
      // Cached field outlines cannot prove deck absence.
      if(!readyRead&&!faceSamples)for(const [zone,pile] of piles)if(!seenPiles.has(zone)&&sample.at-pile.at>3000)piles.delete(zone);
      metrics.samples++;status='watching';error=undefined;
      // Expire departures before matching, including after a long hidden pause.
      for(let i=tracks.length-1;i>=0;i--)if(tracks[i].view.removed&&tracks[i].view.state==='identified'&&sample.at-tracks[i].view.lastSeen>30000)tracks.splice(i,1);
      const appearances=new Map(cards.map(c=>[c,evidence.appearance?.(c)]));
      const appearance=(c:DetectedQuad)=>appearances.get(c);
      const matched=new Map<InternalTrack,DetectedQuad>(),taken=new Set<DetectedQuad>();
      const clearOldSpot=(t:InternalTrack,incoming:DetectedQuad)=>evidence.motion(t.view.card)<=.01&&clearFieldTransfer(evidence,t.view.card,incoming,t.halo);
      const followsAppearance=(t:InternalTrack,c:DetectedQuad)=>bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(c)):sameFieldAppearance(t.identityAppearance,appearance(c));
      const pileCanLeave=(t:InternalTrack)=>{
        if(!publicPile(t.view.zone))return true;
        const members=options.getKnownCards?.().filter(card=>card.zone===t.view.zone)??[];
        if(sameRotatedFieldAppearance(t.identityAppearance,evidence.appearance?.(t.view.card)))return false;
        return sample.at-(pileTouches.get(t.view.zone)??-Infinity)<=2500||pileDepartures.has(t.view.id)||members.at(-1)?.id===t.view.id;
      };
      const pairs=tracks.flatMap(t=>cards.map(c=>{
        const a=boundsOf(t.view.card.quad),b=boundsOf(c.quad),ratio=(a.w*a.h)/(b.w*b.h||1);
        const overlap=quadIou(t.view.card,c),d=distance(t.view.card,c);
        // A light tick may hide changed pixels without a detector miss. Preserve
        // that physical ref at the same spot; the changed path below rereads it.
        const sameSpot=overlap>=.84&&d<.012;
        const needsLook=!bound(t)&&t.view.state==='identified'&&t.view.card.kind==='face-up'&&!sameSpot&&(d>.02||overlap<.84||t.missed);
        const looks=c.kind==='face-up'&&((!t.identityAppearance?.length&&overlap>=.84&&d<.012)||sameFieldAppearance(t.identityAppearance,appearance(c)));
        return {t,c,score:overlap+(1-d)*.1+(c.confidence>=.7?2:0),eligible:ratio>.35&&ratio<2.85&&(overlap>=.12||d<.16)&&(!t.view.removed||((t.view.state==='dismissed'||t.restoredAt!==undefined||sample.at-t.view.lastSeen<=2500)&&t.view.card.kind===c.kind&&(c.kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&(bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(c)):sameFieldAppearance(t.identityAppearance,appearance(c)))))&&(!needsLook||looks)&&(!bound(t)||!["GY","BANISHED"].includes(t.view.zone)||followsAppearance(t,c))&&(!(bound(t)&&(overlap<.12||t.missed)&&d>.04)||clearOldSpot(t,c))};
      })).filter(p=>p.eligible).sort((a,b)=>b.score-a.score);
      for(const {t,c} of pairs)if(!matched.has(t)&&!taken.has(c)){matched.set(t,c);taken.add(c);}
      // A single recently hidden instance and a single new outline can be followed
      // across the mat. Multiple unmatched cards remain ambiguous and are not guessed.
      const incoming=cards.filter(c=>!taken.has(c));
      const lost=tracks.filter(t=>!matched.has(t)&&(t.view.state==='identified'||t.prompted)&&(t.view.removed?
        (t.view.state==='dismissed'||t.restoredAt!==undefined||sample.at-t.view.lastSeen<=2500)&&incoming.length===1&&t.view.card.kind===incoming[0].kind&&(incoming[0].kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&(bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(incoming[0])):sameFieldAppearance(t.identityAppearance,appearance(incoming[0]))):
        sample.at-t.view.lastSeen<=Math.max(2500,removalMs))).filter(t=>pileCanLeave(t)&&(incoming.length!==1||followsAppearance(t,incoming[0])));
      if(lost.length===1&&incoming.length===1) {
        const a=boundsOf(lost[0].view.card.quad),b=boundsOf(incoming[0].quad),ratio=a.w*a.h/(b.w*b.h||1);
        if(ratio>.5&&ratio<2&&lost[0].view.card.kind===incoming[0].kind&&followsAppearance(lost[0],incoming[0])){
          if(clearOldSpot(lost[0],incoming[0])){matched.set(lost[0],incoming[0]);taken.add(incoming[0]);}
          // Matching identity pixels and no simultaneous second copy follow the
          // existing ref even if the player's hand still covers its old spot.
          else if(bound(lost[0])){matched.set(lost[0],incoming[0]);taken.add(incoming[0]);}
        }
      }
      // Covered pile history remains in the authoritative twin list, not live
      // detector capacity. Only the freshly observed top keeps a live outline.
      for(const t of tracks)if(bound(t)&&['GY','BANISHED'].includes(t.view.zone)&&!matched.has(t)&&
        cards.some(c=>mapFieldZone(c,calibration,[],options.format).zone===t.view.zone&&quadIou(c,t.view.card)>.35)){
        t.view.visible=false;t.view.removed=true;t.pose=undefined;t.read=undefined;t.needsRead=false;t.best=undefined;
      }
      const pileRead=(c:DetectedQuad)=>c.confidence>=.4&&['GY','BANISHED'].includes(mapFieldZone(c,calibration,cards,options.format).zone)&&tracks.some(t=>bound(t)&&!matched.has(t));
      for(const c of cards)if((c.confidence>=.7||backOutline(c)||pileRead(c))&&!taken.has(c)&&tracks.filter(t=>!t.view.removed).length<maxTracks) {
        if(backOutline(c)&&c.confidence<.7&&!cardAspect(c))continue;
        const gridBounds=fieldZoneLayout(calibration?.zoneSpacing);
        const center=onMat(fieldCenter(c),calibration);
        if(calibration&&(center.x<gridBounds.minX-.012||center.x>gridBounds.maxX+.012||center.y<0||center.y>1))continue;
        const zone=mapFieldZone(c,calibration,cards,options.format).zone;
        const known=options.getKnownCards?.().find(k=>!tracks.some(t=>t.view.id===k.id||t.binding?.id===k.id)&&(k.card?quadIou(k.card,c)>.5:!['GY','BANISHED'].includes(zone)&&k.zone===zone));
        const trusted=known?.card?known:undefined;
        const t:InternalTrack={view:{id:trusted?.id??`fw-${session}-${++serial}`,card:c,zone,position:fieldOrientation(c,current.width,current.height,calibration),faceDown:trusted?.faceDown??c.kind==='face-down',cardId:trusted?.faceDown?undefined:trusted?.cardId,state:trusted?'identified':'candidate',firstSeen:sample.at,lastSeen:sample.at,removed:false},anchor:c,...(trusted?{announced:c,announcedZone:zone,announcedPosition:trusted.position??fieldOrientation(c,current.width,current.height,calibration),identityAppearance:appearance(c)}:{}),...(trusted?{resolvedAt:sample.at}:{}),binding:trusted?undefined:known,newOutline:!trusted,promptOnly:suppressed.some(q=>q.appearance?.length?sameFieldAppearance(q.appearance,appearance(c)):quadIou(q.card,c)>.5)?'suppressed':tracks.some(old=>!['GY','BANISHED'].includes(zone)&&!old.view.removed&&old.view.state==='identified'&&quadIou(old.view.card,c)>.84&&old.identityAppearance?.length&&!sameFieldAppearance(old.identityAppearance,appearance(c)))?'changed':undefined,missed:false,stableSince:sample.at,observations:0,missingSamples:0,kind:c.kind,position:fieldOrientation(c,current.width,current.height,calibration),needsRead:!trusted||(!trusted.faceDown&&!trusted.cardId)};
        t.appearance=appearance(c);
        const probed=recentMotion&&sample.at-recentMotion.at<=1500&&overlapFraction(boundsOf(c.quad),recentMotion.region)>=.12;
        beginTiming(t,probed?recentMotion!.since:sample.at);if(probed)stage(t,'probe',recentMotion!.since);stage(t,'firstOutline',sample.at);
        tracks.push(t);matched.set(t,c);
      }
      // Simultaneous deck-search outlines stay private; a single clean new card
      // settles immediately after its first read and next clean detector frame.
      const recent=tracks.filter(t=>t.newOutline&&!t.view.faceDown&&sample.at-t.view.firstSeen<=1500);
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
          t.previewEligible=false;
          resetFace(t);
          t.view.visible=false;
          invalidateRead(t);
          t.missed=true;t.best=undefined;t.stableSince=NaN;t.observations=0;
          // The lightweight observation above already checked clear mat.
          continue;
        }
        t.previewEligible=c.confidence>=.7&&!c.partial&&!c.covered&&!isCovered(c,cards)&&!cards.some(other=>other!==c&&quadIou(c,other)>0);
        proposePose(t,c,cards,evidence,sample.at,current.width,current.height);
        t.reappeared ||= t.view.removed;t.missed=false;t.view.removed=false;resetAbsence(t);t.view.lastSeen=sample.at;t.view.card=c;
        // Uncalibrated ordering is assigned at settlement, then kept until the card actually moves.
        if(calibration||t.view.state==='candidate'||distance(t.anchor,c)>.02)t.view.zone=mapFieldZone(c,calibration,cards,options.format).zone;
        const position=fieldOrientation(c,current.width,current.height,calibration);
        if(t.view.state==='identified'&&t.announced){
          const moved=distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position;
          if(moved)t.moveAt??=sample.at;else t.moveAt=undefined;
        }
        if(!t.timing)beginTiming(t,t.view.firstSeen);stage(t,'detectorDone');if(t.timing){t.timing.durationsMs.detector=metrics.detectorMs;for(const [key,value] of Object.entries(options.recognizer.detectorTimingsMs??{}))t.timing.durationsMs[`detector.${key}`]=value;}stage(t,'tracker');if(t.timing)t.timing.durationsMs.capture=captureMs;
        const pixels=appearance(c);
        const publicIdentity=bound(t)&&!t.view.faceDown?options.getKnownCards?.().find(k=>k.id===t.view.id&&!k.faceDown)?.cardId:undefined;
        if(publicIdentity&&publicIdentity!==t.view.cardId){if(t.face)t.face.setCardId=undefined;gallery.remember(t.identityEmbedding,publicIdentity);t.view.cardId=publicIdentity;t.view.bestMatch=undefined;}

        // A fresh full-card warp, never the tiny appearance patch or a retained read.
        const faceState=t.face??={gate:createFaceStateHysteresis({sustainMs:120,minSamples:3}),setCardId:t.binding?.faceDown?t.binding.cardId:undefined};
        // The latest detector's appearance validates a new outline or changed
        // face without overwriting identity or re-running inference.
        // A white/art sleeve can retain the detector's front class. Its fresh
        // outline still supports pixel confirmation when the bound face changes.
        if((t.view.state==='candidate'||t.view.faceDown!==(c.kind==='face-down')||bound(t)&&!matchesLook(t,pixels))&&c.confidence>=.4&&!c.partial&&!c.covered&&!evidence.occluded?.(c)&&!isCovered(c,cards)){faceState.transitionAt??=sample.at;faceState.outlineAppearance=pixels;}
        // Bound cards need fresh face pixels in either direction, even when a
        // plain sleeve has a weak/wrong detector class. New fronts keep .7.
        const boundOutline=c.confidence>=.4&&cardAspect(c)&&!!(t.setRecovery||t.binding?.faceDown||bound(t));
        const faceClean=(c.confidence>=.7||backOutline(c)&&cardAspect(c)||boundOutline)&&!c.partial&&!c.covered&&!evidence.occluded?.(c)&&!isCovered(c,cards)&&
          !cards.some(other=>other!==c&&quadIou(c,other)>0)&&evidence.motion(c)<=.025&&quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012;
        const crop=faceClean?evidence.crop?.(c):undefined;
        const observation=crop?classifyFaceState(crop,{reference:faceState.reference,detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined}):{state:'unknown' as const,confidence:0};
        if(t.prompted&&observation.state==='down'&&!t.view.faceDown&&t.view.state==='prompt'){t.view.state='dismissed';t.view.revision=(t.view.revision??0)+1;t.read=undefined;t.needsRead=false;}
        // Publish geometry before identity inference; never invent an identity
        // or a public front while face-state evidence is still ambiguous.
        if(!t.placeholder&&!t.binding&&!t.promptOnly&&t.view.state==='candidate'&&faceClean&&observation.state==='up'&&evidence.sharpness(c)>=12&&
          !['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)) {
          t.placeholder=true;t.placeholderId=t.view.id;t.view.faceDown=false;t.view.visible=true;t.halo=evidence.halo?.(c);
          emit('reading',t,{latencyMs:now()-t.view.firstSeen});
        }
        // Speculate on the first sharp front while the face gate settles. Any
        // subsequent motion invalidates the result without restarting the worker.
        if(faceClean&&observation.state==='up'&&evidence.sharpness(c)>=12&&(t.needsRead||t.view.faceDown)&&!t.read&&!reading) {
          t.needsRead=true;t.appearance=pixels;t.halo=evidence.halo?.(c);
          await startRead(t,current,c,crop,sample.at,generation);
        }
        const knownFace=bound(t)&&c.kind===t.kind&&t.view.faceDown===(c.kind==='face-down')&&matchesLook(t,pixels)&&
          c.confidence>=.4&&!c.partial&&!c.covered&&!evidence.occluded?.(c)&&!isCovered(c,cards)&&evidence.motion(c)<=.025;
        const sureFront=observation.state==='up'&&t.read?.result?.tier==='sure'&&(t.read.result.candidates[0]?.score??0)>=.84&&
          !t.read.result.quality.fallback&&!t.read.result.quality.covered&&!t.read.result.quality.partial&&!t.read.result.quality.faceDown&&
          sameFieldAppearance(t.read.appearance,pixels);
        const gatedFace=faceState.gate.update(observation,sample.at);
        const setFace=(faceState.setGate??=createFaceStateHysteresis({sustainMs:60,minSamples:2})).update(observation,sample.at);
        // Two fresh clean samples reject a moving draw, without waiting for the
        // full face window. Existing cards retain their normal flip hysteresis.
        const sureBack=t.view.state==='candidate'&&t.resolvedAt===undefined&&!t.binding&&!t.prompted&&
          faceClean&&c.kind==='face-down'&&c.confidence>=.7&&setFace.state==='down';
        const face=knownFace?{state:t.view.faceDown?'down' as const:'up' as const,confidence:1}:sureFront||sureBack?observation:gatedFace;
        if(face.state==='unknown'){
          if(observation.state!=='unknown')faceState.pendingAt??=sample.at;else faceState.pendingAt=undefined;
          t.view.visible=false;t.pose=undefined;t.best=undefined;
          if(observation.state!=='up'||!sameFieldAppearance(t.read?.appearance,pixels))invalidateRead(t);
          if(!faceClean){t.anchor=c;t.stableSince=NaN;t.observations=0;}
          continue;
        }
        faceState.pendingAt=undefined;faceState.transitionAt=undefined;faceState.outlineAppearance=undefined;stage(t,'faceState');
        c.kind=face.state==='down'?'face-down':'face-up';
        const faceChanged=t.view.faceDown!==(face.state==='down');
        const revealRead=faceChanged&&face.state==='up'&&t.read&&sameFieldAppearance(t.read.appearance,pixels)?t.read:undefined;
        if(faceChanged){if(!revealRead)invalidateRead(t);t.view.revision=(t.view.revision??0)+1;t.best=undefined;t.pose=undefined;t.identityCheck=undefined;}
        if(face.state==='down'){
          if(t.promptOnly==='suppressed'){t.view.state='dismissed';t.prompted=true;t.needsRead=false;t.best=undefined;continue;}
          if(!t.view.faceDown&&t.view.cardId)faceState.setCardId=t.view.cardId;
          t.view.cardId=undefined;t.read=undefined;t.needsRead=false;t.identityCheck=undefined;
          if(faceChanged||t.view.state==='candidate'){
            const binding=t.binding,placed=t.resolvedAt===undefined&&!binding;
            if(binding)t.view.id=binding.id;
            t.binding=undefined;t.view.faceDown=true;t.view.position=position;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;
            t.identityAppearance=pixels;t.appearance=pixels;t.kind=c.kind;t.anchor=c;t.stableSince=sample.at;t.observations=3;
            t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.best=undefined;t.halo=evidence.halo?.(c);
            if(placed){metrics.placements++;emit('placed',t);}
            else {if(faceChanged||binding?.faceDown===false)emit('flipped',t);if(binding)emit('moved',t);}
            continue;
          }
        }else if(faceChanged){
          const binding=options.getKnownCards?.().find(k=>k.id===t.view.id)??(t.resolvedAt!==undefined?{id:t.view.id,zone:t.view.zone}:t.binding);
          t.binding=binding?{...binding,faceDown:true}:undefined;
          t.view.cardId=undefined;t.view.faceDown=false;t.view.state='candidate';t.read=revealRead;t.needsRead=!revealRead;
          // This read belongs to the fresh front quad, including its rotation.
          // Retaining the back's pose would invalidate it below and embed twice.
          t.identityAppearance=undefined;t.promptOnly=undefined;t.kind=c.kind;t.anchor=c;t.position=position;t.view.position=position;t.stableSince=sample.at-stableMs;t.observations=3;
        }

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
        const confident=c.confidence>=.7||backOutline(c)&&cardAspect(c)||boundOutline||c.confidence>=.4&&['GY','BANISHED'].includes(t.view.zone)&&(t.view.state==='candidate'||bound(t)&&sameRotatedFieldAppearance(t.identityAppearance,pixels));
        const clean=!appearanceChanged&&confident&&!c.partial&&!c.covered&&!isCovered(c,cards)&&evidence.motion(c)<=.025;
        if(t.identityCheck){if(!clean)t.identityCheck.strongSamples=0;else if(fieldAppearanceDistance(t.identityAppearance,pixels)>=.025)t.identityCheck.strongSamples++;}
        t.view.visible=!changed&&(!t.identityAppearance?.length||c.kind!=='face-up'||matchesLook(t,pixels))&&evidence.motion(c)<=.025&&(t.view.state==='identified'||t.view.state==='prompt')&&confident&&!c.partial&&!c.covered&&!isCovered(c,cards);
        if(clean&&!t.appearance?.length)t.appearance=pixels;
        const still=quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012&&t.kind===c.kind&&t.position===position;
        if(!clean||!still||!Number.isFinite(t.stableSince)) {
          if(!clean||!still)invalidateRead(t);
          t.anchor=c;t.stableSince=clean?sample.at:NaN;t.observations=0;t.best=undefined;t.kind=c.kind;t.position=position;
        }
        if(!clean)continue;
        t.observations++;
        const score=evidence.sharpness(c);
        if(!t.best||score>t.best.score)t.best={frame:current,card:structuredClone(c),score,crop};
        const movingKnown=t.view.state==='identified'&&!t.needsRead&&t.view.faceDown===(c.kind==='face-down');
        if(movingKnown?(t.observations<2||sample.at-t.stableSince<100):score<12)continue;
        const wasFaceDown=t.view.faceDown;
        t.view.faceDown=c.kind==='face-down';t.view.position=position;
        if(t.reappeared){if(t.view.state==='identified')emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.reappeared=false;}
        if(t.view.state==='identified') {
          t.pose=undefined;
          if(t.announced&&(quadIou(t.announced,c)<.7||distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position)){emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;}
          if(wasFaceDown!==t.view.faceDown){emit('flipped',t);t.needsRead=!t.view.faceDown&&!t.view.cardId;if(t.needsRead)t.identityAppearance=undefined;}
        }
        t.halo=evidence.halo?.(c);t.appearance=pixels;
        if(t.read&&(t.read.result||t.read.error)&&sample.at>t.read.at) {
          const pending=t.read,result=pending.result;t.read=undefined;
          metrics.latencyMs=now()-t.view.firstSeen;
          const safe=result&&result.tier!=='low match'&&result.candidates[0]&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&result.candidates[0].cardId!==options.profile.cardBack.cardId;
          let winner=safe?result!.candidates[0].cardId:undefined;
          if(result&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&pending.crop)faceState.front=pending.crop;
          // A failed reveal must neither restore private identity nor publish an unnamed front.
          if(t.binding?.faceDown&&!safe){t.needsRead=false;t.view.visible=false;t.best=undefined;if(t.prompted||t.resolvedAt!==undefined){t.view.state='dismissed';t.prompted=true;}else{t.view.state='prompt';emit('prompt',t,{result,reason:'uncertain'});}continue;}
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
            if(winner&&!['DECK','EXTRA'].includes(t.view.zone)){t.view.state='identified';t.view.cardId=winner;t.view.bestMatch=true;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;emit('placed',t,{result,latencyMs:metrics.latencyMs});continue;}
            if(result&&result.tier!=='low match'){t.view.state='dismissed';continue;}
            t.view.state='prompt';
            emit('prompt',t,{result,reason:'changed',latencyMs:metrics.latencyMs});continue;
          }
          t.latestEmbedding=result?.identityEmbedding;t.lastResult=result;
          const recentIds=tracks.filter(old=>old!==t&&old.view.removed&&old.view.cardId).sort((a,b)=>b.view.lastSeen-a.view.lastSeen).map(old=>old.view.cardId!);
          const deckIds=options.getPriors?.()?.decklist??[];
          const preferred=[...recentIds,...(options.getKnownCards?.()??[]).filter(card=>['DECK','HAND'].includes(card.zone)).map(card=>card.cardId).filter((id):id is string=>!!id),...deckIds].filter(id=>!deckIds.length||deckIds.includes(id));
          const remembered=gallery.resolve(result?.identityEmbedding,preferred);
          const readable=result&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown;
          if((!t.binding||!t.binding.cardId||t.binding.faceDown)&&!t.promptOnly&&readable&&remembered.kind!=='new'&&(remembered.kind!=='hold'||result.tier==='low match')) {
            if(remembered.kind==='hold'||!remembered.cardId){t.view.state='dismissed';t.prompted=true;t.identityAppearance=pixels;t.best=undefined;continue;}
            winner=remembered.cardId;
          }
          const deck=options.getPriors?.()?.decklist;
          const inDeck=!!winner&&!!deck?.some(id=>String(id)===winner)&&!result?.quality.notInDecklist;
          const pile=['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone);
          // Follow physical lifts. Pile history needs touch or top-change evidence;
          // an unchanged top remains a separate copy from a new field outline.
          const known=options.getKnownCards?.();
          if(t.newOutline&&!t.binding&&!t.promptOnly){
            const restored=tracks.find(old=>old!==t&&old.view.removed&&old.restoredAt!==undefined&&sample.at-old.restoredAt<10000&&old.view.cardId!==winner&&known?.some(card=>card.id===old.view.id&&card.zone===t.view.zone&&!card.faceDown));
            if(restored){t.binding={id:restored.view.id,zone:restored.view.zone,cardId:restored.view.cardId};t.promptOnly='reappeared';}
          }
          if(winner&&t.newOutline&&!t.binding&&!t.promptOnly){
            // A formerly public Set may leave as a front while a different
            // front occupies its old spot. Fresh reads of both quads preserve
            // the old ref for its identity, independent of read/HTTP order.
            const shiftedSet=tracks.find(old=>{
              if(old===t||old.face?.setCardId!==winner||old.view.cardId===winner||old.view.removed||old.view.lastSeen!==t.view.lastSeen||quadIou(old.view.card,c)>=.04||!known?.some(card=>card.id===old.view.id))return false;
              const card=old.view.card,crop=evidence.crop?.(card);
              return card.kind==='face-up'&&(card.confidence>=.7||card.confidence>=.4&&cardAspect(card))&&!card.partial&&!card.covered&&!isCovered(card,cards)&&evidence.motion(card)<=.025&&!!crop&&classifyFaceState(crop,{reference:old.face?.reference}).state==='up';
            });
            const readyReplacement=!!shiftedSet?.view.cardId&&!shiftedSet.view.faceDown&&shiftedSet.view.state==='identified';
            const replacement:InternalTrack|undefined=shiftedSet?{...shiftedSet,view:{...copy(shiftedSet.view),id:`fw-${session}-${++serial}`,revision:0,firstSeen:t.view.firstSeen,faceDown:false,...(!readyReplacement?{state:'candidate',cardId:undefined,visible:false}:{})},
              face:readyReplacement&&shiftedSet.face?{...shiftedSet.face,setCardId:undefined}:{gate:createFaceStateHysteresis({sustainMs:120,minSamples:3})},resolvedAt:undefined,binding:undefined,placeholder:false,placeholderId:undefined,newOutline:!readyReplacement,setRecovery:!readyReplacement,read:undefined,best:undefined,
              ...(!readyReplacement?{identityAppearance:undefined,identityEmbedding:undefined,latestEmbedding:undefined,lastResult:undefined,needsRead:true,prompted:false,promptOnly:undefined,appearance:evidence.appearance?.(shiftedSet.view.card),halo:evidence.halo?.(shiftedSet.view.card),stableSince:sample.at,observations:0,anchor:shiftedSet.view.card,kind:'face-up' as const}:{} )}:undefined;
            if(shiftedSet){shiftedSet.view.revision=(shiftedSet.view.revision??0)+1;tracks.push(replacement!);}
            let awaitingPile=false;
            const pileAvailable=(card:KnownFieldCard)=>{
              if(!publicPile(card.zone))return false;
              if(card.zone===t.view.zone)return true;
              // A field read can finish before the pile read after restart.
              // Keep its result while the other outline establishes the top.
              if(tracks.some(other=>other!==t&&!other.view.removed&&other.view.zone===card.zone&&other.view.state==='candidate')){awaitingPile=true;return false;}
              // A missed detector outline cannot erase an unchanged pile top.
              const top=known?.filter(member=>member.zone===card.zone).at(-1);
              const witness=tracks.find(other=>other!==t&&other.view.id===top?.id&&other.view.zone===card.zone);
              if(top?.cardId===winner&&witness&&sameRotatedFieldAppearance(witness.identityAppearance,evidence.appearance?.(witness.view.card)))return false;
              return sample.at-(pileTouches.get(card.zone)??-Infinity)<=2500||pileDepartures.has(card.id);
            };
            const displaced=tracks.filter(old=>old!==t&&bound(old)&&old.view.cardId===winner&&(!old.view.removed||old.restoredAt!==undefined||sample.at-old.view.lastSeen<=30000||known?.some(card=>card.id===old.view.id&&pileAvailable(card)))&&
              (!known||known.some(card=>card.id===old.view.id&&card.cardId===winner))&&
              (!known?.some(card=>card.id===old.view.id&&publicPile(card.zone))||known.some(card=>card.id===old.view.id&&pileAvailable(card)))&&
              (!matched.has(old)||!old.view.visible||old.view.removed||
                !sameRotatedFieldAppearance(old.identityAppearance,appearance(matched.get(old)!))))
              .sort((a,b)=>b.view.lastSeen-a.view.lastSeen);
            const old=shiftedSet??displaced.find(old=>!tracks.some(other=>other!==t&&other.binding?.id===old.view.id));
            if(old){
              const {id,revision,firstSeen}=old.view;
              old.view={...copy(t.view),id,revision,firstSeen,state:'identified',cardId:winner,visible:true};
              if(shiftedSet)old.resolvedAt=undefined;
              old.anchor=c;old.kind=c.kind;old.position=position;old.appearance=pixels;old.identityAppearance=pixels;old.identityEmbedding=result?.identityEmbedding;old.latestEmbedding=result?.identityEmbedding;old.lastResult=result;
              old.face=t.face;if(old.face?.front)old.face.reference={crop:old.face.front,embedding:result?.identityEmbedding};old.halo=evidence.halo?.(c);old.read=undefined;old.best=undefined;old.needsRead=false;old.reappeared=false;old.missed=false;old.restoredAt=undefined;old.stableSince=t.stableSince;old.observations=t.observations;resetAbsence(old);
              old.announced=c;old.announcedZone=old.view.zone;old.announcedPosition=position;old.moveAt=undefined;
              tracks.splice(tracks.indexOf(t),1);reconnected.add(old);emit(shiftedSet?'placed':'moved',old,{previousId:t.placeholderId,result});if(replacement&&readyReplacement)emit('placed',replacement,{result:replacement.lastResult});continue;
            }
            // No local tombstone after restart: reserve the existing pile ref
            // after the read instead of silently dismissing a recognized GY card.
            const reserved=[...(known??[])].reverse().find(card=>card.cardId===winner&&(!publicPile(card.zone)||pileAvailable(card))&&!tracks.some(other=>other!==t&&(other.view.id===card.id||other.binding?.id===card.id)));
            if(reserved)t.binding=reserved;
            else if(awaitingPile){t.read=pending;continue;}
          }
          if(t.binding){
            if(!winner&&!t.binding.cardId&&!t.binding.faceDown&&!t.promptOnly){t.view.id=t.binding.id;t.view.cardId=undefined;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;t.binding=undefined;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.needsRead=false;if(t.view.faceDown===false)emit('flipped',t);emit('moved',t);continue;}
            if(winner&&!t.promptOnly){const replaced=!!t.binding.cardId&&t.binding.cardId!==winner,reveal=t.binding.faceDown||!t.binding.cardId||replaced;t.view.id=t.binding.id;t.view.cardId=winner;t.view.bestMatch=reveal?(result?.tier!=='sure'||!inDeck):undefined;t.view.state='identified';t.view.visible=true;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.resolvedAt=replaced?undefined:sample.at;t.binding=undefined;if(reveal)emit('placed',t,{result,latencyMs:metrics.latencyMs});else emit('moved',t);}
            else if(result&&result.tier!=='low match'){t.view.state='dismissed';t.best=undefined;}else {t.view.state='prompt';t.identityAppearance=pixels;t.view.visible=true;emit('prompt',t,{result,reason:t.promptOnly??'restart'});}
          }else if(winner&&!t.promptOnly&&!['DECK','EXTRA'].includes(t.view.zone)){
            t.view.bestMatch=result?.tier!=='sure'||!inDeck;t.view.state='identified';t.view.visible=true;t.view.cardId=winner;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;metrics.placements++;emit('placed',t,{result,latencyMs:metrics.latencyMs});
          }else if(result&&result.tier!=='low match'){t.view.state='dismissed';t.best=undefined;}else {t.view.state='prompt';t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.view.visible=true;emit('prompt',t,{...(result?{result:{...result,candidates:result.candidates.slice(0,5)}}:{}),latencyMs:metrics.latencyMs,reason:t.promptOnly??(pile?'pile':pending.error?'recognition-error':'uncertain')});}

        }
        if(!t.needsRead){t.best=undefined;continue;}
        if(reading)continue;
        if(t.view.faceDown){t.needsRead=false;t.best=undefined;continue;}
        const best=t.best!;
        await startRead(t,best.frame,best.card,best.crop,sample.at,generation);t.best=undefined;
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
      // Cheap cached pixel samples are not detector measurements. Mixing them
      // into the EMA makes idle scans run too often and blocks the next arrival.
      if(detectorRan)ema=ema?ema*.8+elapsed*.2:Math.min(elapsed,80);
      // A bounded placement burst takes priority over the idle CPU budget. With
      // a 100 ms detector, a 20% budget otherwise stretches each confirmation
      // to 500+ ms and defeats the 1–2 second identification target.
      const settling=[...piles.values()].some(p=>!p.down&&now()-p.firstSeen<1500)||Boolean(reading)||tracks.some(t=>(t.face?.pendingAt!==undefined&&now()-t.face.pendingAt<1500)||t.pose||t.read||(t.view.state==='candidate'&&(t.view.card.confidence>=.7||backOutline(t.view.card))&&!t.view.card.partial&&!t.view.card.covered&&now()-t.view.firstSeen<2500)||(t.view.state==='identified'&&!t.view.removed&&((t.missed&&now()-t.view.lastSeen<removalMs+1500)||(t.missingSamples>0&&now()-(t.clearWindowAt??now())<removalMs+1500)||(t.announced&&t.moveAt!==undefined&&now()-t.moveAt<1500&&(distance(t.announced,t.view.card)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==t.position)))));
      // GPU inference leaves the CPU free; still leave room for input/rendering
      // and back off with detector load. Unknown providers keep the WASM guard.
      const gpu=options.recognizer.detectorBackend==='webgpu',scanBudget=gpu&&options.cpuBudget===undefined ? .5 : budget;
      const interval=Math.max(gpu?66:250,Math.min(5000,ema/scanBudget));
      metrics.intervalMs=settling?(gpu?Math.max(100,interval):100):interval;metrics.dutyPercent=Math.min(100,100*ema/metrics.intervalMs);
      if(metrics.intervalMs>650)guarded=true;else if(metrics.intervalMs<450)guarded=false;if(status==='watching'&&guarded)status='budget';inFlight=false;notify();
    }
  }
  function schedule() {if(!active)return;timer=setTimeout(async()=>{const start=now();await tick();if(active)scheduleAfter(Math.max(0,Math.min(pixelBurst()?33:66,metrics.intervalMs)-(now()-start)));},0);}
  function scheduleAfter(delay:number) {if(active)timer=setTimeout(()=>schedule(),delay);}
  function stop() {active=false;epoch++;clearTimeout(timer);interruptWindow();status='stopped';notify();}
  return {
    tick,
    start() {
      if(active||disposed)return;active=true;status=options.recognizer.prepare?'starting':'watching';notify();
      if(options.recognizer.prepare) {
        const generation=epoch;
        void options.recognizer.prepare(preparation()).then(()=>{if(generation===epoch&&!disposed&&active){status='watching';schedule();notify();}}).catch(cause=>{if(generation===epoch&&!disposed){active=false;status='error';error=cause instanceof Error?cause.message:String(cause);metrics.errors++;notify();}});
      }else schedule();
    },
    stop,
    dispose(){stop();disposed=true;for(const t of tracks){t.best=undefined;t.face=undefined;}pruneFrames();listeners.clear();updates.clear();},
    subscribe(listener:(event:FieldEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    subscribeState(listener:()=>void){updates.add(listener);return()=>{updates.delete(listener);};},
    getSnapshot():FieldSnapshot{return {status,tracks:tracks.map(t=>copy(t.view)),piles:[...piles].flatMap(([zone,pile])=>pile.down&&now()-pile.at<=3000?[{zone,card:structuredClone(pile.card)}]:[]),metrics:{...metrics},error};},
    setCalibration(value?:FieldCalibration){calibration=value;if(status!=='starting')epoch++;interruptWindow();for(const t of tracks){t.view.revision=(t.view.revision??0)+1;t.view.zone=mapFieldZone(t.view.card,calibration,[],options.format).zone;}notify();},
    confirm(id:string,cardId?:string,ref?:string,human=true){const t=tracks.find(t=>t.view.id===id);if(t){t.setRecovery=false;t.pose=undefined;t.read=undefined;const other=tracks.find(other=>other!==t&&other.view.id===ref);if(other&&(other.view.removed||!other.view.visible))tracks.splice(tracks.indexOf(other),1);if(ref&&!tracks.some(other=>other!==t&&other.view.id===ref))t.view.id=ref;t.view.visible=!t.missed;for(let i=suppressed.length-1;i>=0;i--)if(sameFieldAppearance(suppressed[i].appearance,t.appearance)||quadIou(suppressed[i].card,t.view.card)>.5)suppressed.splice(i,1);if(human&&!t.view.faceDown&&t.face&&cardId!==t.face.setCardId)t.face.setCardId=undefined;if(!t.view.faceDown&&cardId)gallery.remember(t.latestEmbedding,cardId);t.view.cardId=t.view.faceDown?undefined:cardId;if(!t.view.faceDown&&cardId&&t.face?.front)t.face.reference={crop:t.face.front,embedding:t.latestEmbedding};t.identityAppearance=t.appearance?.slice();t.identityEmbedding=t.latestEmbedding;t.identityCheck=undefined;t.resolvedAt=now();t.promptOnly=undefined;t.binding=undefined;t.view.state='identified';t.needsRead=false;t.announced=t.view.card;t.announcedZone=t.view.zone;t.announcedPosition=t.view.position;t.moveAt=undefined;t.best=undefined;pruneFrames();notify();}},
    dismiss(id:string){const t=tracks.find(t=>t.view.id===id);if(t){t.pose=undefined;t.read=undefined;if(t.view.state!=='identified')gallery.remember(t.latestEmbedding);t.prompted=true;if(t.view.removed)t.restoredAt=now();t.resolvedAt=now();t.identityCheck=undefined;t.identityEmbedding=t.latestEmbedding;if(t.view.state!=='identified')t.view.state='dismissed';t.needsRead=false;t.best=undefined;pruneFrames();notify();}},
    forget(id:string){const i=tracks.findIndex(t=>t.view.id===id);if(i>=0){suppressed.push({card:tracks[i].view.card,appearance:tracks[i].identityAppearance??tracks[i].appearance,halo:tracks[i].halo,samples:0});if(suppressed.length>maxTracks)suppressed.shift();tracks.splice(i,1);}pruneFrames();notify();},
  };
}
export type FieldWatcher=ReturnType<typeof createFieldWatcher>;

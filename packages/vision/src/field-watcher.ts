import {classifyFaceState,createFaceStateHysteresis,type FaceStateOptions} from './face-state';
import type {RGBAImage} from './pixels';
import {createFieldIdentityGallery, type FieldIdentityGallery} from './field-gallery';
import type { Recognizer } from './client';
import { createFieldPacer, fieldPacerDevice } from './field-pacer';
import type { DetectedQuad, FractionalBox, GameProfile, RecognitionPriors, RecognitionResult } from './types';
import { boundsOf } from './geometry';
import { CARD_DETECTOR } from './detector/spec';
import { isCovered } from './board';
import { createFieldAnalyzer, cloneFieldFrame, closeFieldFrame, sameFieldAppearance, sameShadedFieldAppearance, sameRotatedFieldAppearance, fieldAppearanceDistance, fieldEmbeddingSimilarity, clearFieldBackground, clearFieldTransfer, type FieldFrame, type FieldAnalysis } from './field-motion';
import { fieldZoneBounds, fieldZoneCells, fieldMatPoint, fieldCenter, onMat, fieldOrientation, mapFieldZone, matRestGeometry, quadIou, zoneCellAt, type FieldCalibration, type FieldZone, type FieldFormat } from './field-zones';

export interface HeldCardTrack {
  id:string; state:'held'; card:DetectedQuad; at:number; cardId?:string; visible?:boolean;
}
/** First sure read of one held-card episode. Pixels remain local. Never a field placement. */
export interface HeldCardEvent extends HeldCardTrack {type:'held'; cardId:string; result:RecognitionResult; source:'auto'}

/** A separate path so removal/shadow fixes can change the field tracker independently. */
export function createHeldCardReader(options:Pick<FieldWatcherOptions,'recognizer'|'profile'|'getPriors'|'getKnownCards'|'clone'|'onHeldCard'|'now'>) {
  type Track={view:HeldCardTrack;look?:number[];seen:number;tried:number;attempts:number;stable:number;pending:boolean;emitted:boolean;visible:boolean;field:boolean;eligible:boolean;planeHeld:boolean};
  const clone=options.clone??cloneFieldFrame,tracks:Track[]=[];
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  let serial=0,epoch=0;
  return {
    /**
     * `plane`: the watcher's "resting on the mat" verdict for one outline. A card the plane test calls held (certainly off
     * the mat, or off the plane with a hand on it) is a held card even over a zone cell or next to field cards: closer to the
     * camera than the mat, it can never be a field card. `lifted`: its look is a field card's own look (a field card picked up).
     */
    observe(cards:DetectedQuad[],frame:FieldFrame,evidence:FieldAnalysis,at:number,calibration:FieldCalibration|undefined,format:FieldFormat|undefined,busy:boolean,fieldTracks:readonly FieldTrack[]=[],plane?:(card:DetectedQuad)=>PlaneVerdict|undefined,lifted?:(look?:number[])=>boolean) {
      const cells=fieldZoneCells(format,calibration?.zoneSpacing,calibration?.zones),used=new Set<Track>(),held:DetectedQuad[]=[],notes=new Map<DetectedQuad,string>();
      for(const card of cards){
        if(card.quad.length!==4||card.confidence<.7||card.partial)continue;
        const look=evidence.appearance?.(artBox(card)),center=fieldCenter({quad:card.quad.map(p=>onMat(p,calibration))}),cell=zoneCellAt(center,cells);
        // touched measures skin connected through the sleeve edge. Nearby skin alone is not contact.
        const contact=(evidence.touched?.(card)??0)>.003;
        const verdict=plane?.(card),planeHeld=!!verdict&&(verdict.hard||!verdict.ok&&contact)&&!lifted?.(look);
        // Field history is stronger evidence than size, fingers, or an apparent new outline.
        const recentField=fieldTracks.some(t=>at-t.lastSeen<=2000&&(distance(t.card,card)<.18||quadIou(t.card,card)>.2||cell?.zone===t.zone))||
          (options.getKnownCards?.()??[]).some(k=>k.zone!=='HAND'&&(k.card?distance(k.card,card)<.18:cell?.zone===k.zone));
        let track=tracks.filter(t=>!used.has(t)&&at-t.seen<(t.field?10_000:1500)).sort((a,b)=>distance(a.view.card,card)-distance(b.view.card,card))
          .find(t=>t.field&&!!t.look?.length&&!!look?.length&&sameRotatedFieldAppearance(t.look,look)||distance(t.view.card,card)<.18&&(!t.look?.length||!look?.length||sameRotatedFieldAppearance(t.look,look)||t.field&&at-t.seen<2000));
        if(!track){
          // A lifted Set can turn over while occluded. Its new face is not evidence of a hand origin.
          const missingField=tracks.some(t=>t.field&&at-t.seen<10_000&&!cards.some(other=>other!==card&&distance(t.view.card,other)<.18));
          // onMat always maps the player's hand edge to y=1. An uncalibrated frame uses its near edge.
          const fromHandEdge=center.y>=.94;
          track={view:{id:`held-${session}-${++serial}`,state:'held',card:structuredClone(card),at},seen:at,tried:-Infinity,attempts:0,stable:at,pending:false,emitted:false,visible:true,field:!planeHeld&&(recentField||missingField||!!cell&&!fromHandEdge),eligible:false,planeHeld};
          tracks.push(track);
        }
        if(recentField&&!planeHeld)track.field=true;
        const moving=distance(track.view.card,card)>.012||evidence.motion(card)>.025||!track.visible;
        if(moving||!(contact||planeHeld))track.stable=at;
        track.planeHeld=planeHeld;track.eligible=planeHeld||!track.field&&contact;
        track.view.card=structuredClone(card);track.seen=at;track.look=look;used.add(track);
        if(track.eligible){held.push(card);notes.set(card,planeHeld?verdict!.hard?verdict!.text:`${verdict!.text.replace(/^held\? /,'held: ')} · fingers`:'held: hand contact');}
      }
      for(const track of tracks){track.visible=used.has(track);track.view.visible=track.visible;if(!track.visible)track.stable=at;}
      for(let i=tracks.length-1;i>=0;i--)if(at-tracks[i].seen>(tracks[i].field?10_000:1500)&&!tracks[i].pending)tracks.splice(i,1);
      const track=held.length===1?[...used].find(t=>t.eligible&&!t.emitted&&!t.pending&&t.attempts<3&&at-t.stable>=200&&at-t.tried>=250&&t.view.card.kind==='face-up'):undefined;
      let read:Promise<void>|undefined;
      if(!busy&&track){
        track.pending=true;track.tried=at;track.attempts++;
        const generation=epoch,card=structuredClone(track.view.card),readStart=performance.now();
        read=(async()=>{
          const input=await clone(frame);
          try{
            if(generation!==epoch)return;
            const result=await options.recognizer.recognize([input] as ImageBitmap[]|ImageData[],{card,priors:options.getPriors?.(),maxFrames:1,k:5,preferUpright:true,includeIdentityEmbedding:true});
            const cardId=result.candidates[0]?.cardId;
            // A captured frame remains valid after the outline leaves the view.
            if(generation!==epoch||track.field&&!track.planeHeld||track.emitted||result.tier!=='sure'||!cardId||cardId===options.profile.cardBack.cardId||result.quality.faceDown||result.quality.fallback||result.quality.partial)return;
            const repeated=tracks.some(t=>t!==track&&t.emitted&&t.view.cardId===cardId&&at-t.seen<1500&&distance(t.view.card,card)<.18);
            track.seen=options.now?.()??at+Math.max(0,performance.now()-readStart);
            track.emitted=true;track.view.cardId=cardId;
            if(!repeated)options.onHeldCard?.({...track.view,card,type:'held',cardId,result,source:'auto',at:performance.timeOrigin+at});
          }finally{closeFieldFrame(input);}
        })().finally(()=>{track.pending=false;});
      }
      return {cards:held,read,notes};
    },
    snapshot:()=>tracks.filter(t=>t.eligible).map(t=>({...t.view,visible:t.visible,card:structuredClone(t.view.card)})),
    hasVisibleCard:()=>tracks.some(t=>t.eligible&&t.visible),
    reset(){epoch++;tracks.length=0;},
  };
}

export interface FieldTrack {
  id:string; revision?:number; card:DetectedQuad; zone:FieldZone; position:'attack'|'defense'; faceDown:boolean; cardId?:string;
  state:'candidate'|'identified'|'prompt'|'dismissed'; bestMatch?:boolean; firstSeen:number; lastSeen:number; removed:boolean; visible?:boolean;
  /** Id of the track whose card lies on top of this one (hidden, kept on the field). */ under?:string; /** Since when this outline rests still on the mat plane with no hand on it (watcher clock). Absent while it moves or has no box. */ restSince?:number; /** The latest clean crop of this box shows a back in its pixels. */ pixelsDown?:boolean;
}
/** Epoch origin crosses browser/worker/HTTP boundaries; stages are offsets, never mixed clocks. */
export interface FieldTiming { id:string; originAt:number; stagesMs:Record<string,number>; durationsMs:Record<string,number> }
export type FieldEvent = { type:'reading'|'placed'|'moved'|'flipped'|'removed'|'prompt'|'covered'; /** covered: the track now on top of this card. */ coverRef?:string; track:FieldTrack; bindRef?:string; fromRef?:string; previousId?:string; result?:RecognitionResult; latencyMs?:number; reason?:'uncertain'|'recognition-error'|'reappeared'|'changed'|'restart'|'pile'|'spread'|'suppressed'|'empty'|/** No plausible card box ever backed this track (an arm, a held card): the board card it placed is taken back, not sent to the hand. */'phantom'; source:'auto'; /** A watcher-placed Set ref that this event's pile ref replaces: the card left the pile face-up. */ replacesRef?:string; destination?:'DECK'|'EXTRA'; timing?:FieldTiming };
export interface FieldMetrics { detectorMs:number; recognitionMs:number; dutyPercent:number; intervalMs:number; samples:number; skipped:number; placements:number; latencyMs:number; errors:number; event?:FieldTiming }
/** What the watcher saw on its last sample, for the owner's debug overlay. Local only, never sent. */
export interface FieldDebug { at:number; path:string; full:boolean; region?:FractionalBox; detections:{quad:DetectedQuad['quad'];kind:DetectedQuad['kind'];confidence:number;zone:FieldZone;use:string}[]; reasons:Record<string,string>; /** Best raw detector score inside the calibrated Deck/Extra cell this full pass (null: no outline at or above the decode floor .2). */ pileScores?:Partial<Record<'DECK'|'EXTRA',number|null>> }
export interface FieldSnapshot { held?:HeldCardTrack[]; /** Frame sharpness vs its recent baseline (ratio) and whether removals hold for blur (debug line). */ blur?:{sharpness:number;ratio:number;hold:boolean}; /** Shadow over the mat (share 0..1) and whether removals wait for it to settle (debug line). */ shadow?:{share:number;hold:boolean}; /** Field twin refs whose zone showed no outline in 2 full scans (no hand, no moving shadow): the re-sync removes them. */ missingTwins?:string[]; /** Pile zones with no stack outline in 2 full scans in a row (no hand over them). */ missingPiles?:FieldZone[]; /** Last time a hand moved over the GY / banished pile (watcher clock). */ pileTouchedAt?:Partial<Record<'GY'|'BANISHED',number>>; /** Since when the GY / banished cell shows the empty mat on sharp frames with no hand over it (watcher clock). */ pileClearSince?:Partial<Record<'GY'|'BANISHED',number>>; /** Sample time of the last full detector pass (watcher clock). */ lastFullAt?:number; /** Sample time when the last Scan field sweep (two fresh full passes) finished (watcher clock). */ lastScanAt?:number; /** Field zones where that sweep saw a back resting on the mat (weak boxes count), over no front that still looks like itself. */ lastScanBacks?:FieldZone[]; status:'stopped'|'starting'|'watching'|'hidden'|'busy'|'budget'|'error'; tracks:FieldTrack[]; piles?:{zone:'DECK'|'EXTRA';card:DetectedQuad}[]; metrics:FieldMetrics; error?:string; debug?:FieldDebug }
export interface FieldBuffer { sample(options?:{maxAgeMs?:number}):Promise<{frame:FieldFrame;at:number}> }
export interface KnownFieldCard { id:string; card?:DetectedQuad; zone:FieldZone|'HAND'; cardId?:string; faceDown?:boolean; position?:FieldTrack['position'] }
export interface FieldWatcherOptions {
  recognizer:Pick<Recognizer,'detectCards'|'recognize'>&Partial<Pick<Recognizer,'prepare'|'detectorBackend'|'detectorTimingsMs'|'separateDetector'>>; buffer:FieldBuffer; profile:GameProfile;
  onHeldCard?:(event:HeldCardEvent)=>void;
  getPriors?:()=>RecognitionPriors|undefined; getKnownCards?:()=>KnownFieldCard[]; calibration?:FieldCalibration; format?:FieldFormat;
  gallery?:FieldIdentityGallery; earlyExitMargin?:number; stableMs?:number; removalMs?:number; cpuBudget?:number; maxTracks?:number;
  now?:()=>number; hidden?:()=>boolean; cpuBusy?:()=>boolean;
  /** Dependency injection for replay/tests; production defaults sample browser pixels. */
  analyze?:((frame:FieldFrame)=>FieldAnalysis)&{reset?:()=>void}; clone?:(frame:FieldFrame)=>Promise<FieldFrame>;
}
interface PendingRead { crop?:RGBAImage; at:number; appearance?:number[]; result?:RecognitionResult; error?:boolean; card?:DetectedQuad; art?:number[] }
interface IdentityCheck { state:FieldTrack['state']; cardId?:string; result?:RecognitionResult; reason?:FieldEvent['reason']; strongSamples:number; /** Fresh reads taken while the embedding stayed in the unsure band (.68-.84). */ rereads?:number }
/** One sample's verdict on whether an outline lies on the mat plane (size, shape, cells). `hard`: certainly not on the mat (held well above it). */
export interface PlaneVerdict { ok:boolean; hard:boolean; text:string; size?:number }
interface RestState { samples:number; since?:number; ok:boolean; text:string; /** This sample's outline lies on the mat plane / is certainly held above it. */ planeOk?:boolean; hard?:boolean }
interface PendingPose {card:DetectedQuad;origin:DetectedQuad;appearance:number[];at:number;cleanAt?:number;samples:number}
// Private evidence follows the physical track through ref adoption and is never serialized.
interface FaceEvidence { setCardId?:string; gate:ReturnType<typeof createFaceStateHysteresis>; setGate?:ReturnType<typeof createFaceStateHysteresis>; reference?:FaceStateOptions['reference']; front?:RGBAImage; pendingAt?:number; transitionAt?:number; outlineAppearance?:number[] }
interface InternalTrack { /** "Resting on the mat" test for a new card (see planeVerdict): consecutive samples on the plane, still, with no hand contact. */ rest?:RestState; /** Last outline of this card that lay on the mat plane (a real card's spot when a later outline is a hand or a lifted card). */ restQuad?:DetectedQuad; /** Scan field: a plausible detector box matched this track in one of the two scan passes. */ scanHit?:boolean; /** A still face-down outline whose pixels stay undecided (a plain white sleeve), since when. */ backWaitAt?:number; /** Still skin-coloured pixels on a still, confident outline (since when / past HAND_WAIT_MS): print or locked-camera colour, not a hand. */ stillSkinAt?:number; stillSkin?:boolean; under?:string; /** Orientation of the last outline that showed this card's own look. */ lookUpright?:boolean; softDismiss?:boolean; faceWaitAt?:number; frontScans?:number; rearms?:number; userDismissed?:boolean; handWaitAt?:number; unsureReads?:number; fullMisses?:number; fullMissAt?:number; early?:{card:DetectedQuad;art?:number[]}; confirming?:boolean; rereadEarly?:boolean; prevArt?:number[]; curArt?:number[]; reason?:string; selfSetAt?:number; upSince?:number; setRecovery?:boolean; timing?:FieldTiming; timingOpen?:boolean; placeholder?:boolean; placeholderId?:string; previewEligible?:boolean; clearCandidate?:boolean; clearCandidateAt?:number; face?:FaceEvidence; pose?:PendingPose; view:FieldTrack; anchor:DetectedQuad; announced?:DetectedQuad; announcedZone?:FieldZone; announcedPosition?:FieldTrack['position']; reappeared?:boolean; identityAppearance?:number[]; identityEmbedding?:RecognitionResult['identityEmbedding']; latestEmbedding?:RecognitionResult['identityEmbedding']; lastResult?:RecognitionResult; identityCheck?:IdentityCheck; resolvedAt?:number; prompted?:boolean; newOutline?:boolean; binding?:KnownFieldCard; promptOnly?:FieldEvent['reason']; missed:boolean; halo?:number[]; appearance?:number[]; stableSince:number; observations:number; moveAt?:number; restoredAt?:number; missingSamples:number; missingAt?:number; clearWindowAt?:number; best?:{frame:FieldFrame;card:DetectedQuad;score:number;crop?:RGBAImage}; kind:DetectedQuad['kind']; position:FieldTrack['position']; needsRead:boolean; read?:PendingRead }
// Periodic full-frame pass: ~300 ms on WebGPU, 500+ ms on CPU (by detector
// EMA over the duty budget, backing off to 1.5 s). Busy/hidden ticks skip it.
// The art window of a card quad (portrait corner order): reads and their
// stillness use it, so a hand at the card's edge does not delay or cancel a read.
const artBox=(c:DetectedQuad):DetectedQuad=>{
  const [a,b,d,e]=c.quad,at=(u:number,v:number)=>{const top={x:a.x+(b.x-a.x)*u,y:a.y+(b.y-a.y)*u},bottom={x:e.x+(d.x-e.x)*u,y:e.y+(d.y-e.y)*u};return {x:top.x+(bottom.x-top.x)*v,y:top.y+(bottom.y-top.y)*v};};
  return {...c,quad:[at(.14,.2),at(.86,.2),at(.86,.6),at(.14,.6)]};
};
const FULL_SCAN_MS=300,CPU_FULL_SCAN_MS=500,EMPTY_MAT_MS=2000;
const SHADOW_PASS_EVERY_MS=3000;
/** A hand over a GY/banished pile is exit evidence for a card that shows on the field up to 10 s later (slow CPU reads). */
const PILE_EXIT_MS=10_000;
/** A whole GY/banished pile counts as picked up only after this long: sharp frames, no hand, a clearly changed spot. */
const PILE_LIFT_MS=2000;
/** A shadow covering this share of the mat that moves holds removals until SHADOW_SETTLE_MS after it stops. */
const SHADOW_SHARE=.05,SHADOW_SETTLE_MS=500;
/** A candidate with no outline for this long, or an outline larger than ~2 zones, expires. */
const CANDIDATE_EXPIRE_MS=1500,MAX_ZONE_AREAS=2.5;
/** A back seen in the zone a card left this long ago is that card turned face-down (it keeps its ref). */
const RETURN_MS=10_000;
/** Blur gate: a frame below this share of the recent sharpness baseline is blurred; removals hold until BLUR_SETTLE_MS after. */
const BLUR_RATIO=.55,BLUR_SETTLE_MS=500,BLUR_RELEARN_MS=1500;
const distance=(a:DetectedQuad,b:DetectedQuad)=>{const x=fieldCenter(a),y=fieldCenter(b);return Math.hypot(x.x-y.x,x.y-y.y);};
const mat:DetectedQuad={kind:'face-up',confidence:1,partial:false,quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]};
const copy=(track:FieldTrack):FieldTrack=>({...track,card:structuredClone(track.card)});
/** A face-down outline: from .4, or a light sleeve in a calibrated field cell from the decode floor (its sleeve colour already differs from the mat). */
const backOutline=(card:DetectedQuad)=>card.kind==='face-down'&&(card.confidence>=.4||!!card.cell);
const deckZone=(zone:FieldZone):zone is 'DECK'|'EXTRA'=>zone==='DECK'||zone==='EXTRA';
/** Median RGB of a flat [r,g,b,...] list. */
const medianColour=(pixels:number[])=>[0,1,2].map(c=>{const v=pixels.filter((_,i)=>i%3===c).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];});
/** Mean channel gap between the median colour inside an outline and of the mat ring around it, from which a weak pile outline is a sleeve, not empty mat. */
const PILE_SLEEVE_GAP=.08;
/** Resting test: limits on the mapped size (one cell = 1, or the learned size of cards resting on this mat), opposite-edge tilt
 * (degrees) and length ratio, and the share inside one cell. A card passes REST_SAMPLES samples in a row over REST_MS. */
const REST_CELL_LIMIT=1.2,REST_CELL_HARD=1.35,REST_SIZE_LIMIT=1.2,REST_SIZE_HARD=1.35,REST_TILT=14,REST_TILT_HARD=25,REST_SIDES=.78,REST_SIDES_HARD=.6,REST_CELL_SHARE=.35,REST_SAMPLES=2,REST_MS=100,REST_PRINT_MS=1500;
/** A Deck/Extra pile stays while its spot still looks like it or a hand is over it; it goes after this long without either. */
const PILE_GONE_MS=5000;
const sleeveOnMat=(inside?:number[],halo?:number[])=>{
  if(!inside?.length||inside.length%3||!halo?.length||halo.length%3)return false;
  const a=medianColour(inside),b=medianColour(halo);return (Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3>=PILE_SLEEVE_GAP;
};
/** A box under .4 is a back only as a plain sleeve: one colour over most of it (glare on art, an arm or a dark object do not qualify when
 * they are not flat), clearly unlike the mat around it, and light: a score that low comes from white sleeves, while a flat dark object looks like a dark sleeve. */
const WEAK_BACK_REST_MS=800,WEAK_SLEEVE_GAP=.15,WEAK_SLEEVE_FLAT=.85,WEAK_SLEEVE_NEAR=.12,WEAK_SLEEVE_LIGHT=.5;
const plainSleeve=(inside:number[]|undefined,halo:number[]|undefined)=>{
  if(!inside?.length||inside.length%3||!halo?.length||halo.length%3)return false;
  const a=medianColour(inside),b=medianColour(halo);
  if((Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3<WEAK_SLEEVE_GAP)return false;
  if((a[0]+a[1]+a[2])/3<WEAK_SLEEVE_LIGHT)return false;
  let near=0;for(let i=0;i<inside.length;i+=3)if(Math.max(Math.abs(inside[i]-a[0]),Math.abs(inside[i+1]-a[1]),Math.abs(inside[i+2]-a[2]))<=WEAK_SLEEVE_NEAR)near++;
  return near*3/inside.length>=WEAK_SLEEVE_FLAT;
};
const publicPile=(zone:string):zone is 'GY'|'BANISHED'=>zone==='GY'||zone==='BANISHED';
const fieldSlot=(zone:string)=>/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone);
const fieldZoneName=(zone:string)=>/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone);
const overlapFraction=(a:FractionalBox,b:FractionalBox)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));
/** Owner-only caller, native frame buffer. One detector/read at a time; no AI or uploads. */
export function createFieldWatcher(options:FieldWatcherOptions) {
  const now=options.now??(()=>performance.now()),analyze=options.analyze??createFieldAnalyzer(),clone=options.clone??cloneFieldFrame;
  const hidden=options.hidden??(()=>typeof document!=='undefined'&&document.hidden);
  const stableMs=Math.max(300,Math.min(600,options.stableMs??300)),removalMs=Math.max(150,options.removalMs??200);
  const budget=Math.max(.05,Math.min(.5,options.cpuBudget??.2)),maxTracks=Math.max(1,Math.min(60,options.maxTracks??20));
  const gallery=options.gallery??createFieldIdentityGallery();
  const heldReader=createHeldCardReader(options);
  const tracks:InternalTrack[]=[],listeners=new Set<(event:FieldEvent)=>void>(),updates=new Set<()=>void>(),retained=new Set<FieldFrame>();
  // Deck stacks are observations, never physical field tracks or identity reads.
  const pilePresence=new Map<FieldZone,{misses:number;present:boolean;firstMiss?:number;look?:number[]}>();
  /** `look`: the pile's spot while nothing covered it (retention). `keptAt`: last outline, or last sample whose spot still showed the pile or a hand over it. `backs`: still back-class samples the face classifier left undecided (plain white sleeves). */
  const piles=new Map<'DECK'|'EXTRA',{gate:ReturnType<typeof createFaceStateHysteresis>;card:DetectedQuad;at:number;firstSeen:number;down:boolean;appearance?:number[];look?:number[];keptAt:number;backs:number}>();
  const metrics:FieldMetrics={detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0};
  // CPU budget (WASM only; see field-pacer.ts): pacing is set on each tick from the frame's own scene evidence.
  const pacer=createFieldPacer(fieldPacerDevice(),now());let pacing=false,pacedStill=false,lastShadowPassAt=-Infinity,budgetWaitAt=-Infinity,lastSceneChangeAt=-Infinity,forcePass=false;
  let status:FieldSnapshot['status']='stopped',error:string|undefined,active=false,disposed=false,inFlight=false,wakeQueued=false,wakeAfterRead=false,epoch=0,serial=0,previousAt=-Infinity,lastFrameAt=-Infinity,lastDetectionAt=-Infinity;
  let timer:ReturnType<typeof setTimeout>|undefined,ema=0,calibration=options.calibration,reading:Promise<void>|undefined,lastReadHeld=false;
  /** Scan field: full passes still to run before the sweep, the pile outlines they saw, and when the last sweep finished. */
  let scanSweep=0,lastScanAt=-Infinity,lastScanBacks:FieldZone[]=[];const scanBacks=new Map<FieldZone,number>();const scanPiles=new Map<'DECK'|'EXTRA',DetectedQuad>();
  let scanRequested=false,recentMotion:{region:FractionalBox;at:number;since:number}|undefined,lastFullDetectionAt=-Infinity,deckTouchedAt=-Infinity,extraTouchedAt=-Infinity;
  const pileTouches=new Map<FieldZone,number>(),pileDepartures=new Set<string>();
  /** GY/banished cells that show the empty mat (sharp, no hand, no card that still looks like itself), since when. Scan field: the pile cells its passes saw an outline in. */
  const pileClear=new Map<'GY'|'BANISHED',number>(),scanPileSeen=new Set<FieldZone>();
  let latestEvidence:FieldAnalysis|undefined,latestEvidenceFrame:FieldFrame|undefined;
  // Shadow (a player leaning over the mat, a light from above): removals hold while it moves.
  let shadowShare=0,shadowMovedAt=-Infinity,shadowHold=false,scanFollowUp=false;
  // Blur (autofocus hunting, motion blur): a blurred frame is never "no outline" evidence.
  let sharpBase=0,sharpNow=0,blurredAt=-Infinity,blurHold=false,blurSince:number|undefined,blurRef=0;
  /** Per shadow-grid cell: last time a shadow moved there (watcher clock). */
  let shadowCells:{gx:number;gy:number;at:Float64Array}|undefined,shadowAt=0;
  /** A moving shadow holds only the removals it lies over (its own cell and a ring around it), never the whole frame. */
  const shadowOver=(card:DetectedQuad)=>{
    if(!shadowHold)return false;if(!shadowCells)return true;
    const b=boundsOf(card.quad),{gx,gy,at}=shadowCells,x0=Math.max(0,Math.floor((b.x-b.w*.3)*gx)),x1=Math.min(gx-1,Math.floor((b.x+b.w*1.3)*gx)),y0=Math.max(0,Math.floor((b.y-b.h*.3)*gy)),y1=Math.min(gy-1,Math.floor((b.y+b.h*1.3)*gy));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)if(shadowAt-at[y*gx+x]<SHADOW_SETTLE_MS)return true;
    return false;
  };
  /** A removal waits: a blurred camera (whole frame), or a shadow moving over this card's spot. */
  const removalHold=(card?:DetectedQuad)=>blurHold||(card?shadowOver(card):shadowHold);
  /** A hand or arm on the card or right beside it (skin through the ring around it): its removal waits. */
  const handNear=(evidence:FieldAnalysis,card:DetectedQuad)=>!!evidence.occluded?.(card)||(evidence.touched?.(card)??0)>.02||(evidence.skinNear?.(card)??0)>.04;
  // Field twins with no live track: zone misses in full scans, and refs found missing.
  const twinMisses=new Map<string,{misses:number;at:number;emits:number;emittedAt?:number}>(),missingTwins=new Set<string>();
  /** Illumination-invariant: the card's own texture is still on its spot under lower light. */
  const shadedKeeps=(t:InternalTrack,evidence:FieldAnalysis)=>shadowShare>=.03&&sameShadedFieldAppearance(t.identityAppearance??t.appearance,evidence.appearance?.(t.view.card));
  const cellQuad=(cell:{x:number;y:number;w:number;h:number}):DetectedQuad=>({quad:[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},{x:cell.x+cell.w,y:cell.y+cell.h},{x:cell.x,y:cell.y+cell.h}].map(p=>calibration?fieldMatPoint(p,calibration):p),kind:'face-up',confidence:1,partial:false});
  const fieldCells=()=>calibration?fieldZoneCells(options.format,calibration.zoneSpacing,calibration.zones):[];
  /** Frame area of one field zone (median), for the "larger than two zones" outline check. */
  const zoneArea=()=>{const areas=fieldCells().filter(c=>fieldZoneName(c.zone)).map(c=>{const b=boundsOf(cellQuad(c).quad);return b.w*b.h;}).sort((a,b)=>a-b);return areas.length?areas[Math.floor(areas.length/2)]:undefined;};
  /** Outlines the detector keeps at a lower score: settled tracks, and the zones of field twins that have no live track. */
  const keepOutlines=()=>{
    // Only a quad that lies on the mat plane: a stale box over an arm or a held card must not keep weak outlines alive.
    const quads=tracks.filter(t=>!t.view.removed&&(t.view.state==='identified'||t.view.state==='prompt'||t.placeholder)).flatMap(t=>{const q=plausible(t)?t.view.card:t.restQuad;return q?[q.quad.map(p=>({...p}))]:[];});
    const cells=fieldCells();
    for(const k of options.getKnownCards?.()??[])if(k.zone!=='HAND'&&fieldZoneName(k.zone)&&!tracks.some(t=>!t.view.removed&&(t.view.id===k.id||t.binding?.id===k.id))){const cell=cells.find(c=>c.zone===k.zone);if(cell)quads.push(cellQuad(cell).quad);}
    return quads.slice(0,60);
  };
  /** Calibrated Deck/Extra cells: the detector returns weaker outlines there (coloured sleeves on a dark mat score low). */
  const pileCells=()=>fieldCells().filter(c=>deckZone(c.zone as FieldZone)).map(c=>({zone:c.zone as 'DECK'|'EXTRA',quad:cellQuad(c).quad}));
  /** A candidate that lost its outline (or never was card-sized) expires; a provisional placeholder is taken back. */
  const expireCandidate=(t:InternalTrack,why:string)=>{note(t,why);if(t.placeholder){t.view.removed=true;t.view.visible=false;t.view.state='dismissed';emit('removed',t);}const i=tracks.indexOf(t);if(i>=0)tracks.splice(i,1);t.best=undefined;t.read=undefined;};
  // "Resting on the mat": depth cues from one webcam. Through the mat homography a card ON the mat has the same size
  // (in cell units) at every position and keeps parallel opposite edges. A card held above the mat is closer to the
  // camera, so it maps larger; tilted toward the camera, its edges stop being parallel. Sizes are compared with the
  // cards that already rest on this mat (learned), or with one cell before any card rested.
  let restSize:number|undefined;
  const planeVerdict=(c:DetectedQuad):PlaneVerdict=>{
    if(!calibration)return {ok:true,hard:false,text:'on mat (no calibration)'};
    const g=matRestGeometry(c,calibration,options.format);
    if(!g)return {ok:false,hard:false,text:'held: off the mat plane'};
    const ref=restSize??1,ratio=g.size/ref,unit=restSize===undefined?'x cell':'x';
    const soft=restSize===undefined?REST_CELL_LIMIT:restSize*REST_SIZE_LIMIT,hard=restSize===undefined?REST_CELL_HARD:restSize*REST_SIZE_HARD;
    if(g.size>=hard)return {ok:false,hard:true,text:`held: size ${ratio.toFixed(1)}${unit}`,size:g.size};
    if(g.tilt>=REST_TILT_HARD||g.sides<=REST_SIDES_HARD)return {ok:false,hard:true,text:`held: tilted ${Math.round(g.tilt)}°`,size:g.size};
    if(g.size>soft)return {ok:false,hard:false,text:`held? size ${ratio.toFixed(1)}${unit}`,size:g.size};
    if(g.tilt>REST_TILT||g.sides<REST_SIDES)return {ok:false,hard:false,text:`held? tilted ${Math.round(g.tilt)}° · sides ${g.sides.toFixed(2)}`,size:g.size};
    // Across two cells AND about a cell or more in size: an arm, or a held card over the line (a sloppy card on a line is smaller).
    if(g.cellShare<REST_CELL_SHARE&&g.size>soft*.85)return {ok:false,hard:false,text:`held? across cells (${Math.round(g.cellShare*100)}% in ${g.zone})`,size:g.size};
    return {ok:true,hard:false,text:'on mat',size:g.size};
  };
  /**
   * One sample of the resting test for a matched outline. Stillness belongs to the physical outline (the same quad as in
   * the previous sample), not to the track object, so two cards that swap tracks still count as resting.
   * Contact = skin connected through the card edge (fingers holding it).
   */
  let restPrev:{quad:DetectedQuad;samples:number;since?:number;contactAt?:number}[]=[],restNext:typeof restPrev=[];
  const observeRest=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis,at:number)=>{
    const plane=planeVerdict(c),prev=restPrev.find(p=>quadIou(p.quad,c)>=.84&&distance(p.quad,c)<.012),still=!!prev&&evidence.motion(c)<=.025;
    let contact=!t.stillSkin&&(evidence.touched?.(c)??0)>.003,contactAt=prev?.contactAt;
    // Skin-coloured print at the edge of a still card (an orange frame under a locked exposure) is not a hand: hands tremble.
    if(contact&&still&&evidence.motion(c)<=.01){contactAt??=at;if(at-contactAt>=REST_PRINT_MS)contact=false;}else contactAt=undefined;
    let samples=0,since:number|undefined,text:string;
    if(!plane.ok||contact)text=plane.ok?'held: hand contact':plane.text;
    else if(still&&prev!.samples>0){samples=prev!.samples+1;since=prev!.since;text='settling';}
    else{samples=1;since=at;text=prev?'moving':'settling';}
    restNext.push({quad:structuredClone(c),samples,since,contactAt});
    const ok=samples>=REST_SAMPLES&&at-(since??at)>=REST_MS;
    t.rest={samples,since,ok,planeOk:plane.ok,hard:plane.hard,text:ok?'on mat':samples?`${text} ${samples}/${REST_SAMPLES}`:text};
    if(plane.ok)t.restQuad=structuredClone(c);
    // Learn the size of cards resting on this mat from settled cards only.
    if(ok&&calibration&&t.view.state==='identified'&&plane.size!==undefined&&plane.size<=REST_CELL_LIMIT&&plane.size>=.3)restSize=restSize===undefined?plane.size:restSize*.9+plane.size*.1;
  };
  /** A new card commits (Reading…, placed, Set, prompt) only once it rests on the mat. */
  const restOk=(t:InternalTrack)=>!!t.rest?.ok;
  /** The last outline of a track that lay on the plane (its quad now may be a hand, a lifted card or an arm). */
  const plausible=(t:InternalTrack)=>planeVerdict(t.view.card).ok;
  /** An identified card follows an outline off the plane only if it rested before and the outline is a real (not kept/weak) box. */
  const follows=(t:InternalTrack,c:DetectedQuad)=>t.view.state!=='identified'||planeVerdict(c).ok||!!t.restQuad&&!c.kept&&!c.cell;
  // Empty-mat baseline: the look of each zone cell while nothing was there (no outline, track, known card or hand in
  // three full scans in a row). A cell that looks like its baseline is empty, whatever the detector or a stale track says.
  const emptyLooks=new Map<string,{look:number[];pending?:number[];passes:number}>();
  const cellOf=(zone:string)=>{const cell=fieldCells().find(c=>c.zone===zone);return cell?cellQuad(cell):undefined;};
  const cellEmpty=(evidence:FieldAnalysis,zone:string)=>{
    const base=emptyLooks.get(zone),box=cellOf(zone);if(!base?.look.length||!box)return false;
    return !handNear(evidence,box)&&evidence.motion(box)<=.025&&sameFieldAppearance(base.look,evidence.appearance?.(box));
  };
  /** A GY/banished cell is clear: a sharp frame, no hand or moving shadow over it, no card there that still looks like
   * itself, and the cell looks like its empty-mat baseline or like plain mat. A blurred frame is never clear. */
  const pileCellClear=(evidence:FieldAnalysis,zone:'GY'|'BANISHED')=>{
    const box=cellOf(zone);if(!box||removalHold(box)||handNear(evidence,box)||evidence.motion(box)>.025)return false;
    if(tracks.some(t=>!t.view.removed&&t.view.visible&&t.view.zone===zone&&(!t.identityAppearance?.length||matchesLook(t,evidence.appearance?.(t.view.card)))))return false;
    return cellEmpty(evidence,zone)||clearFieldBackground(evidence.appearance?.(box),evidence.halo?.(box));
  };
  const shadowNote=()=>blurHold?`blur ${(sharpBase>0?sharpNow/sharpBase:1).toFixed(2)} · hold`:`shadow ${Math.round(shadowShare*100)}% · hold`;
  // Owner debug overlay: raw detector output and the last decision per track.
  let debug:FieldDebug|undefined;
  /** Last full pass's pile-cell scores; motion-crop passes keep showing them. */
  let lastPileScores:FieldDebug['pileScores'];
  const note=(t:InternalTrack,reason:string)=>{t.reason=reason;};
  let debugAt=0,debugTick='',emptySince:number|undefined,emptyPasses=0,emptyPassAt=-Infinity;
  const debugPath=(path:string,at:number)=>{debugTick=path;debugAt=at;};
  const suppressed:{card:DetectedQuad;appearance?:number[];halo?:number[];clearAt?:number;samples:number}[]=[];let guarded=false;
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  const epochAt=()=>performance.timeOrigin;
  const beginTiming=(t:InternalTrack,at:number)=>{if(t.timingOpen)return;t.timingOpen=true;t.timing={id:`${session}:${++timingSerial}`,originAt:epochAt()+at,stagesMs:{capture:0},durationsMs:{}};};
  const stage=(t:InternalTrack,name:string,at=now())=>{if(t.timing){const value=Math.max(0,epochAt()+at-t.timing.originAt);t.timing.stagesMs[name]??=value;t.timing.stagesMs[`${name}Last`]=value;}};
  let timingSerial=0;
  // Profile counters on the open timing (reads started/dropped, detector passes, motion resets).
  const count=(t:InternalTrack,name:string)=>{if(t.timing&&t.timingOpen)t.timing.durationsMs[`n.${name}`]=(t.timing.durationsMs[`n.${name}`]??0)+1;};
  const notify=()=>{for(const listener of updates)listener();};
  // Once attached to a twin, only an explicit owner correction changes identity.
  const bound=(t:InternalTrack)=>t.view.state==='identified'&&t.resolvedAt!==undefined;
  // Detector centres shift as a card turns over or rotates. Retain the settled
  // cell until its centre actually travels, through both face gates and reads.
  const settledZone=(t:InternalTrack,card:DetectedQuad,cards:DetectedQuad[])=>
    t.announced&&t.announcedZone&&(t.resolvedAt!==undefined||t.binding)&&distance(t.announced,card)<=.04
      ?t.announcedZone:mapFieldZone(card,calibration,cards,options.format).zone;
  const matchesLook=(t:InternalTrack,pixels?:number[])=>bound(t)?sameRotatedFieldAppearance(t.identityAppearance,pixels):sameFieldAppearance(t.identityAppearance,pixels);
  const departureDestination=(t:InternalTrack,at:number):Pick<FieldEvent,'destination'>=>{
    const touched=Math.max(deckTouchedAt,extraTouchedAt);
    return touched>=t.view.lastSeen-250&&at-touched<=Math.max(2500,removalMs+500)?{destination:extraTouchedAt>deckTouchedAt?'EXTRA':'DECK'}:{};
  };
  // Identity lock: a sure read (art clear) or a player's choice fixes a card's
  // name. Only the player, or a later sure read that beats the locked score by
  // LOCK_MARGIN, changes it. Moves, flips and re-detections keep it.
  type IdentityLock={cardId:string;score:number;at:number;embedding?:RecognitionResult['identityEmbedding'];look?:number[]};
  const LOCK_MARGIN=.05,locks=new Map<string,IdentityLock>();
  const lockFor=(ref:string|undefined)=>{
    if(!ref)return;const lock=locks.get(ref);if(!lock)return;
    // The player changed it (drawer, Wrong card?, Undo): the board is the truth.
    const known=options.getKnownCards?.().find(k=>k.id===ref);
    if(known?.cardId&&!known.faceDown&&known.cardId!==lock.cardId&&now()-lock.at>3000){const user={cardId:known.cardId,score:Infinity,at:now(),embedding:lock.embedding,look:lock.look};locks.set(ref,user);return user;}
    return lock;
  };
  // A clearly different embedding is another physical card (a swap), not a re-guess.
  const lockHolds=(lock:IdentityLock|undefined,result?:RecognitionResult,look?:number[]):lock is IdentityLock=>{if(!lock)return false;const similarity=fieldEmbeddingSimilarity(lock.embedding,result?.identityEmbedding);
    return similarity!==undefined?similarity>.68:!lock.look?.length||!look?.length||sameRotatedFieldAppearance(lock.look,look);};
  // Skin over more than 2% of a new card delays its first read, for at most
  // HAND_WAIT_MS: glare or a warm sleeve must never block a read for ever.
  const HAND_WAIT_MS=600;
  const handBlocks=(t:InternalTrack,touched=0)=>{
    if(touched<=.02||t.stillSkin){t.handWaitAt=undefined;return false;}
    t.handWaitAt??=now();if(now()-t.handWaitAt<HAND_WAIT_MS){note(t,`read waits for the hand to leave the card (skin ${Math.round(touched*100)}%)`);return true;}
    note(t,`hand gate timed out after ${HAND_WAIT_MS} ms (skin ${Math.round(touched*100)}%); reading anyway`);return false;
  };
  /** A dismissed track that still shows a front reads again (bounded; Scan field resets the bound). */
  const rearm=(t:InternalTrack,why:string)=>{
    t.view.state='candidate';t.view.removed=false;t.view.cardId=undefined;t.view.bestMatch=undefined;t.view.revision=(t.view.revision??0)+1;
    t.prompted=false;t.promptOnly=undefined;t.identityCheck=undefined;t.resolvedAt=undefined;t.read=undefined;t.needsRead=true;t.best=undefined;
    t.unsureReads=0;t.rereadEarly=false;t.handWaitAt=undefined;t.faceWaitAt=undefined;t.frontScans=0;t.userDismissed=false;t.softDismiss=false;resetFace(t);resetAbsence(t);note(t,`re-armed: ${why}`);
  };
  const beatsLock=(lock:{score:number},result?:RecognitionResult)=>!!result&&result.tier==='sure'&&(result.candidates[0]?.score??0)>=lock.score+LOCK_MARGIN;
  const emit=(type:FieldEvent['type'],t:InternalTrack,extra:Partial<FieldEvent>={})=>{
    note(t,`${type}${extra.reason?` (${extra.reason})`:''}`);
    if(type==='placed'&&t.view.cardId&&!t.view.faceDown&&extra.result?.tier==='sure'&&!extra.result.quality.fallback&&!extra.result.quality.covered&&!extra.result.quality.partial&&extra.result.candidates[0]?.cardId===t.view.cardId&&!t.view.bestMatch){
      const lock=lockFor(t.view.id);if(!lock||lock.cardId!==t.view.cardId)locks.set(t.view.id,{cardId:t.view.cardId,score:extra.result.candidates[0].score,at:now(),embedding:extra.result.identityEmbedding,look:t.identityAppearance?.slice()});
    }
    if(type==='prompt'){
      // A fresh front still needs an answer when its Set has a known ref.
      // Neither old public knowledge nor the gallery can answer a low read.
      const reveal=t.binding?.faceDown&&!t.view.faceDown;
      if(!reveal&&t.resolvedAt!==undefined){t.view.state='identified';return;}
      if(!reveal&&t.prompted){t.view.state='dismissed';return;}
      const answer=gallery.resolve(extra.result?.identityEmbedding);
      if(!reveal&&answer.kind!=='new'){t.prompted=true;t.view.state='dismissed';return;}
      t.prompted=true;t.identityEmbedding=extra.result?.identityEmbedding;t.latestEmbedding=t.identityEmbedding;
    }
    if(type==='placed'&&!t.view.faceDown&&t.view.cardId&&t.face?.front)t.face.reference={crop:t.face.front,embedding:t.identityEmbedding};if(!t.timing)beginTiming(t,t.view.firstSeen);stage(t,'commit');
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
  function invalidateRead(t:InternalTrack) {if(t.read){count(t,'readsDropped');t.read=undefined;t.needsRead=t.view.state!=='dismissed';}}
  // Pixel evidence remains available while the inference worker is occupied.
  // Missing outlines alone never remove a card: the whole footprint and its
  // original halo must agree with clear mat, including at the camera edge.
  function observeAbsence(t:InternalTrack,evidence:FieldAnalysis,at:number) {
    if(t.view.removed||t.under)return;
    // A moving shadow is occlusion; a settled one only removes a card whose texture is gone.
    if(removalHold(t.view.card)||shadedKeeps(t,evidence)){t.clearCandidate=false;t.clearCandidateAt=undefined;resetAbsence(t);if(removalHold(t.view.card))note(t,shadowNote());return;}
    const halo=evidence.halo?.(t.view.card),pixels=evidence.background?.(t.view.card)??evidence.appearance?.(t.view.card);
    // A uniform sleeve can match the mat. Unchanged card pixels are never
    // evidence of departure, even when the detector is between samples.
    const clear=!sameFieldAppearance(t.identityAppearance??t.appearance,pixels)&&!evidence.occluded?.(t.view.card)&&
      clearFieldBackground(pixels,halo);
    t.clearCandidate=!!clear;if(clear)t.clearCandidateAt??=at;else t.clearCandidateAt=undefined;
    if(!clear||evidence.motion(t.view.card)>.01){resetAbsence(t);return;}
    t.view.visible=false;t.missed=true;invalidateRead(t);t.best=undefined;
    // A lifted card may already be under a new outline whose identity read is
    // still pending. Give that read a bounded chance to reconnect the same ref
    // before starting a fresh clear-mat window for a move to hand.
    if(tracks.some(other=>other!==t&&!other.view.removed&&other.view.state==='candidate'&&
      at-(other.read?.at??other.view.firstSeen)<2500&&(other.read||other.needsRead&&at-other.view.lastSeen<450))){resetAbsence(t);return;}
    if(t.missingAt!==undefined&&at-t.missingAt>Math.max(1000,metrics.detectorMs*2))resetAbsence(t);
    t.clearWindowAt??=at;t.missingAt=at;t.missingSamples++;
    if(t.missingSamples<3||at-t.clearWindowAt<removalMs)return;
    t.view.removed=true;t.restoredAt=undefined;
    if(t.view.state==='identified'||t.placeholder)emit('removed',t);
    // A candidate lost from view is dismissed softly: it reads again when it shows again.
    if(t.view.state!=='identified'){t.softDismiss=t.view.state==='candidate';t.view.state='dismissed';}
  }
  async function startRead(t:InternalTrack,frame:FieldFrame,card:DetectedQuad,crop:RGBAImage|undefined,at:number,generation:number) {
    if(reading||t.read||!t.needsRead)return;
    // A first read waits for the first frame without a hand on the card: an
    // embed of card plus fingers is rarely sure and costs a second read.
    if(t.view.state==='candidate'&&card.kind==='face-up'&&frame===latestEvidenceFrame&&handBlocks(t,latestEvidence?.touched?.(card)))return;
    t.handWaitAt=undefined;
    const pending:PendingRead={at,appearance:t.appearance?.slice(),crop,card:structuredClone(card),art:latestEvidence?.appearance?.(artBox(card))};
    t.read=pending;t.needsRead=false;
    const cloneAt=now(),input=await clone(frame);if(t.timing)t.timing.durationsMs.readClone=now()-cloneAt;count(t,'reads');
    if(generation!==epoch||disposed||t.read!==pending||!tracks.includes(t)){closeFieldFrame(input);return;}
    lastReadHeld=false;
    reading=read(t,input,card,pending,generation).finally(()=>{reading=undefined;if(wakeAfterRead){wakeAfterRead=false;wake();}});
  }
  function restoreIdentity(t:InternalTrack,pixels?:number[]) {
    const saved=t.identityCheck!;t.identityCheck=undefined;t.read=undefined;t.needsRead=false;t.best=undefined;
    t.view.state=saved.state;t.view.cardId=saved.cardId;t.promptOnly=saved.reason;t.appearance=pixels;
    t.identityAppearance=pixels;t.lastResult=saved.result;t.view.visible=!t.missed&&(saved.state==='identified'||saved.state==='prompt');
    if(saved.state==='prompt')emit('prompt',t,{result:saved.result,reason:saved.reason??'uncertain'});
    else if(saved.state==='identified'&&t.resolvedAt===undefined&&saved.result)emit('placed',t,{result:saved.result});
  }
  function resetFace(t:InternalTrack){if(t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined)count(t,'faceResets');t.face?.gate.reset();t.face?.setGate?.reset();if(t.face){t.face.pendingAt=undefined;t.face.transitionAt=undefined;t.face.outlineAppearance=undefined;}}
  function resetAbsence(t:InternalTrack,preserveWindow=false){t.missingSamples=0;t.missingAt=undefined;if(!preserveWindow)t.clearWindowAt=undefined;}
  function interruptWindow(preserveVisibility=false,preserveAbsenceWindow=false) {previousAt=-Infinity;if(!preserveVisibility)forcePass=true;for(const t of tracks){resetFace(t);t.pose=undefined;if(!preserveVisibility)t.view.visible=false;invalidateRead(t);t.stableSince=NaN;t.observations=0;if(!preserveAbsenceWindow)resetAbsence(t);t.best=undefined;}pruneFrames();}
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
      if(generation===epoch&&!disposed&&t.read===pending){metrics.recognitionMs=now()-start;pending.result=result;stage(t,'searchDone');if(t.timing)Object.assign(t.timing.durationsMs,result.timingsMs);wakeAfterRead=true;}
    }catch(cause){if(generation===epoch&&!disposed&&t.read===pending){console.error('[remote field] recognition failed',t.view.id,cause);metrics.errors++;pending.error=true;}}
    finally{closeFieldFrame(input);}
  }
  /** Event-driven save: a finished read is consumed at once, not at the next timed tick. */
  function wake(){if(!active||disposed)return;if(inFlight){wakeQueued=true;return;}clearTimeout(timer);schedule();}
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
      if(at-pose.at>600||!bound(t)||t.view.removed||!planeVerdict(pose.card).ok||(pose.card.kind==='face-down')!==t.view.faceDown||!sameFieldAppearance(pose.appearance,pixels)||evidence.motion(pose.card)>.025||
        (translated&&(evidence.motion(pose.origin)>.01||!clearFieldTransfer(evidence,pose.origin,pose.card,t.halo)))){t.pose=undefined;continue;}
      pending=true;pose.cleanAt??=at;pose.samples++;
      t.view.visible=false;
      if(pose.samples<2||at-pose.cleanAt<100)continue;
      const card=pose.card,position=fieldOrientation(card,width,height,calibration);
      t.view.zone=settledZone(t,card,[]);t.view.card=card;t.view.position=position;t.view.lastSeen=at;t.view.visible=true;t.view.removed=false;
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
  /** A placement, read, pose or removal is in progress: the watcher needs fresh detector outlines. */
  const settlingNow=()=>[...piles.values()].some(p=>!p.down&&now()-p.firstSeen<1500)||Boolean(reading)||tracks.some(t=>(t.face?.pendingAt!==undefined&&now()-t.face.pendingAt<1500)||t.pose||t.read||(t.view.state==='candidate'&&(t.view.card.confidence>=.7||backOutline(t.view.card))&&!t.view.card.partial&&!t.view.card.covered&&now()-t.view.firstSeen<2500)||(t.view.state==='identified'&&!t.view.removed&&((t.missed&&now()-t.view.lastSeen<removalMs+1500)||(t.missingSamples>0&&now()-(t.clearWindowAt??now())<removalMs+1500)||(t.announced&&t.moveAt!==undefined&&now()-t.moveAt<1500&&(distance(t.announced,t.view.card)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==t.position)))));
  /** Work that a still frame cannot finish: it keeps detector passes coming (in budget). A stuck candidate or flip counts for some seconds only. */
  const pacingPending=(at:number)=>settlingNow()||heldReader.hasVisibleCard()||tracks.some(t=>!t.view.removed&&t.view.state!=='dismissed'&&(t.needsRead||!!t.read||(t.fullMisses??0)>0||t.view.state==='candidate'&&at-t.view.firstSeen<8000||(t.face?.pendingAt!==undefined&&at-t.face.pendingAt<8000)||t.view.state==='identified'&&at-lastSceneChangeAt<8000&&(t.view.faceDown!==(t.view.card.kind==='face-down')||!!t.rest&&!t.rest.ok)))||[...pilePresence.values()].some(p=>p.present&&p.misses>0&&p.misses<3)||[...twinMisses.values()].some(m=>m.misses<2);
  async function tick() {
    if(disposed||inFlight)return;
    if(hidden()){status='hidden';metrics.skipped++;interruptWindow();notify();return;}
    const busy=idle(),tracked=tracks.some(t=>t.view.state==='identified'&&!t.view.removed),empty=!tracks.some(t=>!t.view.removed);
    if(busy&&empty){status='busy';metrics.skipped++;interruptWindow();notify();return;}
    const pileBurst=()=>[...piles.values()].some(p=>!p.down&&now()-p.firstSeen<1500);
    const faceBurst=pileBurst()||tracks.some(t=>t.face?.pendingAt!==undefined&&now()-t.face.pendingAt<1500);
    // Quiet empty fields need fewer background scans, which can block arrivals.
    // Keep a bounded retry so a stationary card recovers from a detector miss.
    const light=busy||(!heldReader.hasVisibleCard()&&!faceBurst&&(tracked||empty)&&!reading&&!tracks.some(t=>t.needsRead||t.read||t.view.state==='candidate')&&
      now()-lastDetectionAt<(empty&&!tracks.length&&!piles.size&&!suppressed.length?Math.max(2000,metrics.intervalMs):metrics.intervalMs));
    const generation=epoch;inFlight=true;const start=now();let detectorRan=false,current:FieldFrame|undefined,detectFrame:FieldFrame|undefined;
    try {
      const captureAt=now(),sample=await options.buffer.sample({maxAgeMs:pacedStill?200:30}),captureMs=now()-captureAt;current=sample.frame;
      if(generation!==epoch||disposed)return;
      if(sample.at<=lastFrameAt){metrics.skipped++;return;}
      lastFrameAt=sample.at;
      const maxGap=Math.max(1000,metrics.intervalMs*1.8),gap=sample.at-previousAt;
      if(gap>maxGap)interruptWindow(light,true);previousAt=sample.at;
      const evidence=analyze(current);latestEvidence=evidence;latestEvidenceFrame=current;
      const shade=evidence.shadow;shadowShare=shade?.share??0;
      if(shade&&shade.share>=SHADOW_SHARE&&shade.changed>=.01)shadowMovedAt=sample.at;
      shadowHold=shadowShare>=SHADOW_SHARE&&sample.at-shadowMovedAt<SHADOW_SETTLE_MS;
      shadowAt=sample.at;
      if(shade?.moved&&shade.gx&&shade.gy&&shade.moved.length===shade.gx*shade.gy){
        if(shadowCells?.gx!==shade.gx||shadowCells.gy!==shade.gy)shadowCells={gx:shade.gx,gy:shade.gy,at:new Float64Array(shade.gx*shade.gy).fill(-Infinity)};
        for(let i=0;i<shade.moved.length;i++)if(shade.moved[i])shadowCells.at[i]=sample.at;
      }
      if(evidence.frameSharpness!==undefined){
        sharpNow=evidence.frameSharpness;const blurred=sharpBase>0&&sharpNow<sharpBase*BLUR_RATIO;
        if(blurred){
          blurredAt=sample.at;
          // A darker exposure (camera lock, anti-glare) lowers sharpness for good, and the baseline never
          // follows blurred frames. Stable "blurred" frames for BLUR_RELEARN_MS are the new normal: learn them.
          // Cards leaving a dark mat also lower whole-frame sharpness for good, and an arm moving keeps it
          // changing: the episode counts from its first soft frame, however much the soft frames vary.
          if(blurSince===undefined){blurSince=sample.at;blurRef=sharpNow;}
          else if(sample.at-blurSince>=BLUR_RELEARN_MS){sharpBase=sharpNow;blurSince=undefined;blurredAt=-Infinity;}
        }
        // The baseline follows sharper frames fast and softer (but not blurred) frames slowly.
        else {blurSince=undefined;sharpBase=sharpBase<=0?sharpNow:sharpNow>sharpBase?sharpBase*.7+sharpNow*.3:sharpBase*.97+sharpNow*.03;}
      }
      blurHold=sample.at-blurredAt<BLUR_SETTLE_MS;
      // A full-frame detector pass at least every ~300 ms (slower only on a
      // CPU detector over budget). Cached outlines, motion crops and quiet
      // skips can never hide a card that sits outside the tracked set.
      const scene=evidence.scene,liveCards=tracks.some(t=>!t.view.removed);
      pacing=!!scene&&options.recognizer.detectorBackend!=='webgpu';
      const urgentScan=scanRequested||scanFollowUp;
      const sceneMoving=pacing&&scene!.moving>0,sceneDirty=pacing&&scene!.sinceMark>0;
      if(sceneMoving)pacer.changed(sample.at);if(sceneMoving||sceneDirty)lastSceneChangeAt=sample.at;
      const pacedPending=pacing&&(forcePass||pacingPending(sample.at)),handOnly=sceneMoving&&!pacedPending;
      pacedStill=pacing&&!sceneMoving&&!sceneDirty&&!pacedPending;
      // Paced: a still scene waits for the slow timer. A changed one takes one full pass as soon as it stops moving, so the
      // detector always has the final scene. A settling card (rest test, read, removal check) needs samples soon, so it takes
      // the burst room too; while a hand moves, passes run in budget.
      const pacedFullEvery=pacedStill?pacer.stillEvery(sample.at,liveCards):sceneDirty&&!sceneMoving||pacedPending&&!sceneMoving?0:Math.max(CPU_FULL_SCAN_MS,Math.min(1500,Math.max(ema,metrics.detectorMs)*2));
      const fullEvery=pacing?pacedFullEvery:options.recognizer.detectorBackend==='webgpu'?Math.max(FULL_SCAN_MS,Math.min(1500,Math.max(ema,metrics.detectorMs)/.5)):Math.max(CPU_FULL_SCAN_MS,Math.min(1500,Math.max(ema,metrics.detectorMs)/budget));
      const fullDue=!busy&&(scanRequested||scanFollowUp&&sample.at-lastFullDetectionAt>=250||(pacing||liveCards||twinMisses.size>0)&&sample.at-lastFullDetectionAt>=fullEvery&&(!pacing||pacer.allow(sample.at,handOnly)));
      debugPath('sample',sample.at);
      // Local stillness: the card's own art window, not motion elsewhere or a hand at its edge.
      // Exposure-robust: the art patch matches the previous sample (camera noise
      // and exposure flicker pass; a sliding card or a hand over the art does not).
      for(const t of tracks){t.prevArt=t.curArt;t.curArt=evidence.appearance?.(artBox(t.view.card));}
      // Skin that does not move for HAND_WAIT_MS on a still card is not a hand (see stillSkin): it no longer blocks this card's own gates.
      const blocks=(t:InternalTrack,q:DetectedQuad)=>!t.stillSkin&&!!evidence.occluded?.(q);
      const artStill=(t:InternalTrack,c:DetectedQuad)=>c.quad.length===4&&evidence.motion(artBox(c))<=.06&&!blocks(t,artBox(c))&&sameFieldAppearance(t.prevArt,evidence.appearance?.(artBox(c)));
      const sameArt=(read:PendingRead|undefined,c:DetectedQuad)=>!!read?.art?.length&&sameFieldAppearance(read.art,evidence.appearance?.(artBox(c)));
      // A running read survives motion elsewhere; only its own card moving or changing ends it.
      // The pixels where the read looked must be unchanged; the detector outline may
      // still jump while a hand touches the card edge. The new outline must overlap it.
      const readHolds=(t:InternalTrack,c:DetectedQuad)=>!!t.read?.card&&!!t.read.art?.length&&quadIou(t.read.card,c)>=.3&&evidence.motion(artBox(t.read.card))<=.06&&!blocks(t,artBox(t.read.card))&&sameArt(t.read,t.read.card);
      // Use the adjustable mat cells for buried members too: they have no live quad.
      for(const cell of fieldZoneCells(options.format,calibration?.zoneSpacing,calibration?.zones))if(publicPile(cell.zone)||cell.zone==='EXTRA'){
        const quad=[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},{x:cell.x+cell.w,y:cell.y+cell.h},{x:cell.x,y:cell.y+cell.h}].map(p=>calibration?fieldMatPoint(p,calibration):p);
        if(evidence.motion({quad,kind:'face-up',confidence:1,partial:false})>.025){pileTouches.set(cell.zone,sample.at);if(cell.zone==='EXTRA')extraTouchedAt=sample.at;}
      }
      for(const t of tracks)if(publicPile(t.view.zone)&&!t.view.removed&&evidence.motion(t.view.card)>.025)pileTouches.set(t.view.zone,sample.at);
      for(const zone of ['GY','BANISHED'] as const){if(pileCellClear(evidence,zone))pileClear.set(zone,pileClear.get(zone)??sample.at);else pileClear.delete(zone);}
      // Deck identity stays private. Its motion still supplies a destination
      // for a field card whose own footprint becomes clear in this window.
      const deck=piles.get('DECK');
      if(deck&&evidence.motion(deck.card)>.025)deckTouchedAt=sample.at;
      // Deck/Extra piles are kept by pixels on every sample (CPU mode has few detector passes, and a motion crop
      // elsewhere never sees them): the spot still shows the pile, or a hand or arm is over it. Only a long absence
      // of both (or Scan field) takes a pile off the board.
      for(const [zone,pile] of piles){
        if(sameFieldAppearance(pile.look,evidence.appearance?.(pile.card))||handNear(evidence,pile.card)||evidence.motion(pile.card)>.025||removalHold(pile.card))pile.keptAt=sample.at;
        else if(sample.at-pile.keptAt>PILE_GONE_MS)piles.delete(zone);
      }
      const difference=evidence.motionRegion,localizedDifference=!!difference&&difference.w*difference.h>=.001&&difference.w*difference.h<=.35;
      if(difference)recentMotion={region:difference,at:sample.at,since:recentMotion&&sample.at-recentMotion.at<=250?recentMotion.since:sample.at};
      for(const t of [...tracks]){
        // Even a frame skipped by the detector throttle interrupts confirmation.
        if(evidence.motion(t.view.card)>.025||blocks(t,t.view.card)||t.view.card.partial||t.view.card.covered)resetFace(t);
        // Unplaced draw outlines have no public state to remove. Once a real
        // detector miss and clear mat agree, stop their confirmation scans.
        if(t.view.state==='candidate'&&t.view.faceDown&&!t.placeholder&&!t.binding&&!t.prompted&&t.resolvedAt===undefined&&!t.read&&t.missed&&lastDetectionAt>t.view.lastSeen&&
          evidence.motion(t.view.card)<=.01&&!evidence.occluded?.(t.view.card)&&clearFieldBackground(evidence.appearance?.(t.view.card),evidence.halo?.(t.view.card))){
          tracks.splice(tracks.indexOf(t),1);t.best=undefined;pruneFrames();continue;
        }
        if(!t.view.removed&&(evidence.motion(t.view.card)>.025||t.identityAppearance?.length&&!matchesLook(t,evidence.appearance?.(t.view.card))))beginTiming(t,sample.at);
        if(busy)resetAbsence(t);else observeAbsence(t,evidence,sample.at);
      }
      // A clear footprint with no motion elsewhere is a departure, not a
      // transfer. Sample it at camera cadence even on a slow CPU. Motion outside
      // the old quad still runs detection so field/pile transfers keep their ref.
      if(!fullDue&&!reading&&tracks.some(t=>!t.view.removed&&t.clearCandidate&&sample.at-(t.clearCandidateAt??sample.at)<650&&(evidence.motionOutside?.(t.view.card)??1)<=.004&&(!recentMotion||sample.at-recentMotion.at>650||(()=>{const b=boundsOf(t.view.card.quad),r=recentMotion.region;return r.x>=b.x-b.w*.2&&r.y>=b.y-b.h*.2&&r.x+r.w<=b.x+b.w*1.2&&r.y+r.h<=b.y+b.h*1.2;})()))&&
        !tracks.some(t=>!t.view.removed&&t.view.state==='candidate')){status='watching';debugPath('clear-mat check',sample.at);return;}
      if(!busy&&!reading&&!fullDue&&confirmPoses(evidence,sample.at,current.width,current.height)){status='watching';debugPath('pose confirm',sample.at);return;}
      const trackedMotion=!busy&&tracks.some(t=>t.view.state==='identified'&&(t.view.removed?(evidence.motionOutside?.(t.view.card)??evidence.motion(mat))>.004:evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&!matchesLook(t,evidence.appearance?.(t.view.card)))));
      if(pacing&&pacedStill&&!fullDue||light&&!fullDue&&!trackedMotion&&(busy||!pacing&&!localizedDifference&&evidence.motion(mat)<=.004)) {
        debugPath(busy?'skip (busy)':'skip (quiet)',sample.at);
        // Keep cached clicks fresh during input pressure and long detector gaps.
        // Pixel evidence can retain an outline, but only the detector restores one.
        if(busy)interruptWindow(true,true);status=busy?'busy':guarded?'budget':'watching';metrics.skipped++;
        for(const t of tracks){
          t.view.visible=!!t.view.visible&&t.view.state==='identified'&&!t.view.removed&&evidence.motion(t.view.card)<=.025&&matchesLook(t,evidence.appearance?.(t.view.card));
          if(!t.view.visible){resetFace(t);t.missed=true;t.stableSince=NaN;t.observations=0;}
          // No change in the scene and the same look: the card lies there, so a later move or flip counts from now.
          else if(pacedStill)t.view.lastSeen=sample.at;
        }
        return;
      }
      // One shared worker: a detector pass would wait behind the read, so the
      // tick only samples pixels. A separate detector worker keeps detecting.
      if(reading&&!options.recognizer.separateDetector) {
        for(const t of tracks)if(blocks(t,t.view.card)||evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&t.view.card.kind==='face-up'&&!matchesLook(t,evidence.appearance?.(t.view.card)))){t.view.visible=false;resetFace(t);}
        // Keep sampling motion/appearance while the worker embeds. Never infer
        // stillness or disappearance from a stale outline during this interval.
        for(const t of tracks)if(t.read&&!readHolds(t,t.view.card)&&(blocks(t,t.view.card)||evidence.motion(t.view.card)>.025||(t.appearance?.length&&evidence.appearance&&!sameFieldAppearance(t.appearance,evidence.appearance(t.view.card))))) {
          resetFace(t);invalidateRead(t);t.stableSince=NaN;t.observations=0;t.best=undefined;
        }
        for(const t of tracks)if(t.read&&t.face&&!blocks(t,t.view.card)&&evidence.motion(t.view.card)<=.025){
          const crop=evidence.crop?.(t.view.card);
          if(crop)t.face.gate.update(classifyFaceState(crop,{reference:t.face.reference,detectorFaceDownScore:t.view.card.kind==='face-down'?t.view.card.confidence:undefined}),sample.at);
        }
        debugPath('identity read running',sample.at);pruneFrames();return;
      }
      const readyRead=tracks.some(t=>t.previewEligible&&!t.view.removed&&!t.promptOnly&&!t.identityCheck&&t.read?.result?.tier==='sure'&&
        (t.read.result.candidates[0]?.score??0)>=.84&&sample.at-t.view.lastSeen<=1500&&(readHolds(t,t.view.card)||evidence.motion(t.view.card)<=.025&&
        sameFieldAppearance(t.read.appearance,evidence.appearance?.(t.view.card))));
      // A tiny appearance patch can match the mat after a moving card leaves.
      // Only a new detector result can confirm a candidate on clear background.
      const cachedTracks=tracks.filter(t=>t.view.state!=='candidate'||t.view.card.kind!=='face-down'||!clearFieldBackground(evidence.appearance?.(t.view.card),evidence.halo?.(t.view.card)));
      // Leave a bounded confirmation window after inference returns. Its input
      // timestamp includes the model's own wait; it is not the result's age.
      const confirmationAge=Math.max(450,Math.min(1000,metrics.detectorMs+250));
      const faceSamples=cachedTracks.some(t=>t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined||t.read?.result||t.view.state==='candidate'&&t.newOutline||t.view.state==='identified'&&t.view.faceDown!==(t.view.card.kind==='face-down'))&&now()-lastDetectionAt<confirmationAge&&
        cachedTracks.every(t=>t.view.removed||t.view.state==='candidate'&&!t.view.visible&&!t.read&&t.face?.pendingAt===undefined||sample.at-t.view.lastSeen<450&&!t.view.card.partial&&!t.view.card.covered&&evidence.motion(t.view.card)<=.025&&
          sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(t.view.card)))&&evidence.motion(mat)<=.004;
      let detected:DetectedQuad[],region:FractionalBox|undefined,rawOutlines:DetectedQuad[]=[];
      // A sure read on a held outline commits now; a due full pass waits one tick.
      if(readyRead||!fullDue&&faceSamples){
        debugPath('cached outlines',sample.at);
        // Retain only outlines whose current pixels still agree. A new outline
        // or changed/occluded pixels must go through detection as usual.
        // The outline's detector age is bounded above, independently of the
        // physical track's age (a moving draw may have created it earlier).
        detected=cachedTracks.filter(t=>!t.view.removed&&(t.read?.result&&readHolds(t,t.view.card))||!t.view.removed&&(t.view.visible||t.read||t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined||t.newOutline&&faceSamples&&sample.at-t.view.lastSeen<450&&!t.view.card.partial&&!t.view.card.covered||t.view.state==='identified'&&t.view.faceDown!==(t.view.card.kind==='face-down'))&&evidence.motion(t.view.card)<=.025&&
          sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(t.view.card))).map(t=>structuredClone(t.view.card));
      }else{
      if(!fullDue&&pixelBurst()&&sample.at-lastDetectionAt<(options.recognizer.detectorBackend==='webgpu'?Math.max(100,metrics.intervalMs):100))return;
      if(pacing&&!urgentScan&&!pacer.allow(sample.at,handOnly)){debugPath('budget wait',sample.at);if(!handOnly)budgetWaitAt=sample.at;return;}
      detectorRan=true;
      detectFrame=await clone(current);
      // Discover new outlines in the recent motion crop, including all live
      // tracks so association and overlap checks still see the whole field.
      // Periodic full scans catch stationary cards missed outside that crop.
      // A new localized change is useful even after a long idle interval. Quiet
      // periodic scans still cover the full frame; cropped misses retry below.
      if(!fullDue&&recentMotion&&sample.at-recentMotion.at<1500&&(localizedDifference||sample.at-lastFullDetectionAt<2000)){
        const boxes=[recentMotion.region,...tracks.filter(t=>!t.view.removed).map(t=>boundsOf(t.view.card.quad))];
        const x=Math.max(0,Math.min(...boxes.map(b=>b.x))-.06),y=Math.max(0,Math.min(...boxes.map(b=>b.y))-.08);
        const right=Math.min(1,Math.max(...boxes.map(b=>b.x+b.w))+.06),bottom=Math.min(1,Math.max(...boxes.map(b=>b.y+b.h))+.08);
        if((right-x)*(bottom-y)<.6)region={x,y,w:right-x,h:bottom-y};
      }
      const detectStart=now();
      // Known cards keep weaker outlines (hysteresis, shadow-lifted pass); kept outlines never start a card.
      const keep=keepOutlines(),pileQuads=pileCells(),slotQuads=fieldCells().filter(c=>fieldZoneName(c.zone)).map(c=>cellQuad(c).quad).slice(0,20);
      // CPU: on a dim mat darkShare is always high, so one lost card doubled every pass. A second pass needs a measured shadow, or waits 3 s.
      const shadowPass=!pacing||urgentScan||scanSweep>0||shadowShare>=.03||sample.at-lastShadowPassAt>=SHADOW_PASS_EVERY_MS;if(pacing&&shadowPass)lastShadowPassAt=sample.at;
      const detectOpts=(r?:FractionalBox)=>r||keep.length||pileQuads.length||slotQuads.length?{...(shadowPass?{}:{shadowPass:false}),...(r?{region:r}:{}),...(keep.length?{keep}:{}),...(pileQuads.length?{piles:pileQuads.map(p=>p.quad)}:{}),...(slotQuads.length?{cells:slotQuads}:{})}:undefined;
      detected=await options.recognizer.detectCards(detectFrame,detectOpts(region));
      // A crop changes the detector's context. In particular, a plain sleeve
      // may be found only in the full frame. A missed crop must not add the
      // entire periodic full-scan delay to first sight or a flip.
      const unexplainedDifference=recentMotion&&sample.at-recentMotion.at<=250&&!detected.some(c=>
        overlapFraction(boundsOf(c.quad),recentMotion!.region)>=.12&&!tracks.some(t=>bound(t)&&quadIou(t.view.card,c)>=.84&&distance(t.view.card,c)<.012&&
          t.view.faceDown===(c.kind==='face-down')&&evidence.motion(c)<=.025&&matchesLook(t,evidence.appearance?.(c))));
      if(region&&(!detected.length||detected.some(c=>c.partial)||unexplainedDifference)){
        closeFieldFrame(detectFrame);detectFrame=await clone(current);
        detected=await options.recognizer.detectCards(detectFrame,detectOpts());region=undefined;
      }
      // Pile-cell outlines below the pile floor are a debug probe only: record the best score, then drop them.
      const inCell=(c:DetectedQuad,q:DetectedQuad['quad'])=>{const a=boundsOf(c.quad),b=boundsOf(q),w=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x)),h=Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return w*h/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h))>=.6;};
      rawOutlines=detected.slice();
      // Scan field: any decoded stack outline in a Deck/Extra cell whose colour differs from the mat around it.
      if(!region&&scanSweep>0)for(const p of pileQuads){
        const best=detected.filter(c=>inCell(c,p.quad)&&!c.partial&&(c.confidence>=CARD_DETECTOR.minConfidence||sleeveOnMat(evidence.appearance?.(c),evidence.halo?.(c)))).sort((a,b)=>b.confidence-a.confidence)[0];
        if(best&&!scanPiles.has(p.zone))scanPiles.set(p.zone,structuredClone(best));
      }
      const pileScores=region?undefined:Object.fromEntries(pileQuads.map(p=>[p.zone,detected.filter(c=>inCell(c,p.quad)).reduce<number|null>((best,c)=>Math.max(best??0,c.confidence),null)]));
      // A weak pile outline must also show a sleeve colour unlike the mat around it: an empty dark
      // mat cell can decode a low-score outline and the face classifier reads uniform mat as a back.
      detected=detected.filter(c=>!c.pile||c.confidence>=CARD_DETECTOR.minConfidence||c.confidence>=CARD_DETECTOR.pileMinConfidence&&sleeveOnMat(evidence.appearance?.(c),evidence.halo?.(c)));
      // A weak face-down outline in a field cell (a white sleeve on a dark mat scores .3-.45) is a Set only
      // when its sleeve colour differs from the mat around it and it is about one card in size.
      const cellArea=zoneArea(),cellSized=(c:DetectedQuad)=>{if(!cellArea)return false;const b=boundsOf(c.quad);return b.w*b.h>=cellArea*.25&&b.w*b.h<=cellArea*1.3;};
      detected=detected.filter(c=>!c.cell||c.confidence>=CARD_DETECTOR.minConfidence||cellSized(c)&&planeVerdict(c).ok&&sleeveOnMat(evidence.appearance?.(c),evidence.halo?.(c)));
      // Scan field runs two full passes back to back: two misses remove a card at once.
      if(!region){lastFullDetectionAt=sample.at;forcePass=false;evidence.scene?.mark();if(scanRequested)scanFollowUp=true;else scanFollowUp=false;scanRequested=false;}
      // "Out of view is gone" for piles: a GY, Banished, Deck or Extra cell with
      // no outline in 2 full scans in a row, and no hand over it, is missing.
      if(!region&&calibration)for(const cell of fieldZoneCells(options.format,calibration.zoneSpacing,calibration.zones))if(['GY','BANISHED','DECK','EXTRA'].includes(cell.zone)){
        const box:DetectedQuad={quad:[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},{x:cell.x+cell.w,y:cell.y+cell.h},{x:cell.x,y:cell.y+cell.h}].map(p=>fieldMatPoint(p,calibration!)),kind:'face-up',confidence:1,partial:false};
        // A kept (low-score) outline of a stale track is no witness on a GY/banished cell that shows the empty mat.
        const zone=cell.zone as FieldZone,clearSince=publicPile(zone)?pileClear.get(zone):undefined,seen=detected.some(d=>mapFieldZone(d,calibration,detected,options.format).zone===zone&&!(d.kept&&clearSince!==undefined));
        const hand=!seen&&(evidence.occluded?.(box)||(evidence.touched?.(box)??0)>.02||evidence.motion(box)>.06);
        const state=pilePresence.get(zone)??{misses:0,present:true},look=evidence.appearance?.(box);
        // The pile is a log: only sharp frames (the frame blur gate) of a changed, empty spot for 2 s mean it was picked up.
        // A blurred frame or a spot that still looks like the pile is no evidence and restarts the window.
        const same=!!state.look?.length&&sameFieldAppearance(state.look,look);
        if(seen){state.misses=0;state.firstMiss=undefined;state.present=true;if(!blurHold)state.look=look;if(publicPile(zone))pileClear.delete(zone);if(scanSweep>0)scanPileSeen.add(zone);}
        // Re-check against the empty mat: a GY/banished cell clear for 2 s of sharp frames with no hand is picked up.
        else if(!hand&&!blurHold&&clearSince!==undefined&&sample.at-clearSince>=PILE_LIFT_MS){state.misses=Math.max(1,state.misses);state.firstMiss??=clearSince;state.present=false;}
        else if(hand||same||blurHold){state.misses=0;state.firstMiss=undefined;}
        else{state.firstMiss??=sample.at;if(++state.misses>=3&&sample.at-state.firstMiss>=PILE_LIFT_MS)state.present=false;}
        pilePresence.set(zone,state);
      }
      debugPath(region?'detector (motion crop)':fullDue?'detector (periodic full)':'detector (full)',sample.at);
      debug={at:sample.at,path:debugTick,full:!region,region,detections:[],reasons:{},...(lastPileScores=pileScores&&Object.keys(pileScores).length?pileScores:region?lastPileScores:undefined)?{pileScores:lastPileScores}:{}};
      metrics.detectorMs=now()-detectStart;lastDetectionAt=sample.at;
      }
      if(generation!==epoch||disposed)return;
      const fieldWaiting=tracks.some(t=>!t.view.removed&&(t.needsRead||t.view.state==='candidate'&&!t.read));
      const held=heldReader.observe(detected,current,evidence,sample.at,calibration,options.format,!!reading||busy||lastReadHeld&&fieldWaiting,tracks.map(t=>t.view),
        c=>calibration?planeVerdict(c):undefined,look=>!!look?.length&&tracks.some(t=>bound(t)&&!t.view.removed&&!t.view.faceDown&&fieldSlot(t.view.zone)&&sameRotatedFieldAppearance(t.identityAppearance,look)));
      if(held.read){lastReadHeld=true;reading=held.read.catch(()=>{metrics.errors++;}).finally(()=>{reading=undefined;wake();});}
      detected=detected.filter(card=>!held.cards.includes(card));
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
      const frontOutline=(c:DetectedQuad)=>c.kind==='face-up'&&c.confidence>=.5&&!c.partial&&cardAspect(c);
      const outlines=detected.filter(c=>c.quad.length===4&&c.quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).slice(0,60);
      const cards=outlines.filter(c=>!deckZone(mapFieldZone(c,calibration,[],options.format).zone));
      if(!reading)for(const t of tracks.filter(t=>!held.cards.some(c=>quadIou(c,t.view.card)>.3))){
        const c=t.view.card,pixels=evidence.appearance?.(c);
        if(!t.previewEligible||t.view.state!=='candidate'||!restOk(t)||t.view.removed||t.promptOnly||sample.at-t.view.lastSeen>500||c.confidence<.7||c.partial||c.covered||
          (evidence.motion(c)>.025||evidence.occluded?.(c)||!sameFieldAppearance(t.appearance,pixels))&&!artStill(t,c)||evidence.sharpness(c)<12)continue;
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
      const seenPiles=new Set<FieldZone>();
      const area=(c:DetectedQuad)=>Math.abs(c.quad.reduce((sum,p,i)=>{const next=c.quad[(i+1)%4];return sum+p.x*next.y-next.x*p.y;},0))/2;
      const zoneSize=zoneArea(),tooBig=(c:DetectedQuad)=>{if(!zoneSize)return false;const b=boundsOf(c.quad);return b.w*b.h>zoneSize*MAX_ZONE_AREAS;};
      for(const c of [...outlines].sort((a,b)=>area(b)-area(a)||b.confidence-a.confidence)){
        const zone=mapFieldZone(c,calibration,[],options.format).zone;
        if(!deckZone(zone)||seenPiles.has(zone))continue;
        seenPiles.add(zone);
        const pile=piles.get(zone)??{gate:createFaceStateHysteresis({sustainMs:120,minSamples:3}),card:c,at:sample.at,firstSeen:sample.at,down:false,keptAt:sample.at,backs:0};
        const clean=(c.confidence>=.4||!!c.pile&&c.confidence>=CARD_DETECTOR.pileMinConfidence)&&(c.confidence>=.7||cardAspect(c))&&!c.partial&&!c.covered&&!isCovered(c,outlines)&&evidence.motion(c)<=.025;
        const crop=clean?evidence.crop?.(c):undefined;
        const observation=crop?classifyFaceState(crop,{detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined}):{state:'unknown' as const,confidence:0};
        // Unknown observations retain a verified stack; a confident front clears it.
        // Detector absence expires it after three seconds. Never infer its count.
        // A plain white sleeve leaves the pixel classifier undecided: three still back-class samples with no front are a back.
        pile.backs=clean&&c.kind==='face-down'&&observation.state==='unknown'?pile.backs+1:observation.state==='unknown'&&!clean?pile.backs:0;
        pile.down=pile.gate.update(observation,sample.at).state==='down'||pile.backs>=3||pile.down&&!(observation.state==='up'&&observation.confidence>=.8);
        const pixels=evidence.appearance?.(c);
        if(clean&&!handNear(evidence,c)||!pile.look)pile.look=pixels;pile.keptAt=sample.at;
        if(zone==='DECK'&&(evidence.motion(c)>.025||pile.appearance?.length&&!sameFieldAppearance(pile.appearance,pixels)||
          !piles.has(zone)&&tracks.some(t=>!t.view.removed&&(t.missed||t.clearCandidate))))deckTouchedAt=sample.at;
        pile.appearance=pixels;pile.card=c;pile.at=sample.at;piles.set(zone,pile);
      }
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
      // A settled face-up card never takes an outline that looks like another card: that card lies on top of it
      // (Xyz on its materials, a monster over a Field Spell). A card already under another needs its own look back.
      // Any battle position: an Xyz in Defense on Attack materials is a new card too. A new outline that then reads as the
      // card under it (a turn, glare), or does not read sure, merges back into that card (see the read result below).
      const upright=(q:DetectedQuad)=>{const b=boundsOf(q.quad);return b.h>=b.w;};
      // A GY/banished top is a log entry: a new look on the pile is a new card pushed on top, never a rename (even before the glue
      // confirms the old top, and also for an unread "Unknown" top in prompt state).
      // A blurred frame or a shadow on the card is light, not a new card.
      const lookBlocked=(t:InternalTrack,c:DetectedQuad)=>(fieldSlot(t.view.zone)&&bound(t)||publicPile(t.view.zone)&&(t.view.state==='identified'||t.view.state==='prompt'))&&!t.view.faceDown&&!!t.identityAppearance?.length&&c.kind==='face-up'&&
        (t.under!==undefined||evidence.motion(c)<=.025&&c.confidence>=.7&&!c.partial&&!removalHold(c)&&!shadedKeeps(t,evidence))&&!sameRotatedFieldAppearance(t.identityAppearance,appearance(c));
      const pairs=tracks.flatMap(t=>cards.map(c=>{
        const a=boundsOf(t.view.card.quad),b=boundsOf(c.quad),ratio=(a.w*a.h)/(b.w*b.h||1);
        const overlap=quadIou(t.view.card,c),d=distance(t.view.card,c);
        // A light tick may hide changed pixels without a detector miss. Preserve
        // that physical ref at the same spot; the changed path below rereads it.
        const sameSpot=overlap>=.84&&d<.012;
        const needsLook=!bound(t)&&t.view.state==='identified'&&t.view.card.kind==='face-up'&&!sameSpot&&(d>.02||overlap<.84||t.missed);
        const looks=c.kind==='face-up'&&((!t.identityAppearance?.length&&overlap>=.84&&d<.012)||sameFieldAppearance(t.identityAppearance,appearance(c)));
        return {t,c,score:overlap+(1-d)*.1+(c.confidence>=.7?2:0),eligible:!lookBlocked(t,c)&&follows(t,c)&&ratio>.35&&ratio<2.85&&(overlap>=.12||d<.16)&&(!t.view.removed||((t.view.state==='dismissed'||t.restoredAt!==undefined||sample.at-t.view.lastSeen<=2500)&&t.view.card.kind===c.kind&&(c.kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&(bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(c)):sameFieldAppearance(t.identityAppearance,appearance(c)))))&&(!needsLook||looks)&&(!bound(t)||!["GY","BANISHED"].includes(t.view.zone)||followsAppearance(t,c))&&(!(bound(t)&&(overlap<.12||t.missed)&&d>.04)||clearOldSpot(t,c))};
      })).filter(p=>p.eligible).sort((a,b)=>b.score-a.score);
      for(const {t,c} of pairs)if(!matched.has(t)&&!taken.has(c)){matched.set(t,c);taken.add(c);}
      // A single recently hidden instance and a single new outline can be followed
      // across the mat. Multiple unmatched cards remain ambiguous and are not guessed.
      const incoming=cards.filter(c=>!taken.has(c));
      const lost=tracks.filter(t=>!matched.has(t)&&(t.view.state==='identified'||t.prompted)&&(t.view.removed?
        (t.view.state==='dismissed'||t.restoredAt!==undefined||sample.at-t.view.lastSeen<=2500)&&incoming.length===1&&t.view.card.kind===incoming[0].kind&&(incoming[0].kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&(bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(incoming[0])):sameFieldAppearance(t.identityAppearance,appearance(incoming[0]))):
        sample.at-t.view.lastSeen<=Math.max(2500,removalMs))).filter(t=>pileCanLeave(t)&&(incoming.length!==1||followsAppearance(t,incoming[0])&&follows(t,incoming[0])));
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
      for(const t of tracks)if((bound(t)||(t.view.state==='identified'||t.view.state==='prompt')&&!!t.identityAppearance?.length)&&['GY','BANISHED'].includes(t.view.zone)&&!matched.has(t)&&
        cards.some(c=>mapFieldZone(c,calibration,[],options.format).zone===t.view.zone&&quadIou(c,t.view.card)>.35)){
        t.view.visible=false;t.view.removed=true;t.pose=undefined;t.read=undefined;t.needsRead=false;t.best=undefined;note(t,'covered by a newer pile top');
      }
      const pileRead=(c:DetectedQuad)=>c.confidence>=.4&&['GY','BANISHED'].includes(mapFieldZone(c,calibration,cards,options.format).zone)&&tracks.some(t=>bound(t)&&!matched.has(t));
      const skipped=new Map<DetectedQuad,string>();
      // Every unmatched card-shaped outline starts a track, including a front
      // the detector scores lower under coloured light. Reads still decide identity.
      for(const c of cards){
        if(taken.has(c))continue;
        if(c.kept){skipped.set(c,'kept outline (known card only)');continue;}
        if(tooBig(c)){skipped.set(c,'larger than two zones');continue;}
        if(!(c.confidence>=.7||backOutline(c)||pileRead(c)||frontOutline(c))){skipped.set(c,`low score ${c.confidence.toFixed(2)}`);continue;}
        if(tracks.filter(t=>!t.view.removed).length>=maxTracks){skipped.set(c,'max tracks');continue;}
        if(backOutline(c)&&c.confidence<.7&&!cardAspect(c)){skipped.set(c,'not card-shaped');continue;}
        const gridBounds=fieldZoneBounds(calibration,options.format);
        const center=onMat(fieldCenter(c),calibration);
        if(calibration&&(center.x<gridBounds.minX-.012||center.x>gridBounds.maxX+.012||center.y<gridBounds.minY||center.y>gridBounds.maxY)){skipped.set(c,'outside zone grid');continue;}
        const zone=mapFieldZone(c,calibration,cards,options.format).zone;
        // A second outline of a card already tracked in this zone (card plus
        // hand, a double detection) joins that track; it never starts a card.
        const same=publicPile(zone)?undefined:tracks.find(t=>!t.view.removed&&t.view.zone===zone&&quadIou(t.view.card,c)>=.5&&!lookBlocked(t,c)&&follows(t,c));
        if(same){if(!matched.has(same)){matched.set(same,c);taken.add(c);}else skipped.set(c,'same card as a track');continue;}
        const known=options.getKnownCards?.().find(k=>!tracks.some(t=>t.view.id===k.id||t.binding?.id===k.id)&&(k.card?quadIou(k.card,c)>.5:!['GY','BANISHED'].includes(zone)&&k.zone===zone));
        const trusted=known?.card?known:undefined;
        const t:InternalTrack={view:{id:trusted?.id??`fw-${session}-${++serial}`,card:c,zone,position:fieldOrientation(c,current.width,current.height,calibration),faceDown:trusted?.faceDown??c.kind==='face-down',cardId:trusted?.faceDown?undefined:trusted?.cardId,state:trusted?'identified':'candidate',firstSeen:sample.at,lastSeen:sample.at,removed:false},anchor:c,...(trusted?{announced:c,announcedZone:zone,announcedPosition:trusted.position??fieldOrientation(c,current.width,current.height,calibration),identityAppearance:appearance(c)}:{}),...(trusted?{resolvedAt:sample.at}:{}),binding:trusted?undefined:known,newOutline:!trusted,promptOnly:suppressed.some(q=>q.appearance?.length?sameFieldAppearance(q.appearance,appearance(c)):quadIou(q.card,c)>.5)?'suppressed':tracks.some(old=>!['GY','BANISHED'].includes(zone)&&!old.view.removed&&old.view.state==='identified'&&quadIou(old.view.card,c)>.84&&old.identityAppearance?.length&&!sameFieldAppearance(old.identityAppearance,appearance(c))&&!lookBlocked(old,c))?'changed':undefined,missed:false,stableSince:sample.at,observations:0,missingSamples:0,kind:c.kind,position:fieldOrientation(c,current.width,current.height,calibration),needsRead:!trusted||(!trusted.faceDown&&!trusted.cardId)};
        t.appearance=appearance(c);
        const probed=recentMotion&&sample.at-recentMotion.at<=1500&&overlapFraction(boundsOf(c.quad),recentMotion.region)>=.12;
        beginTiming(t,probed?recentMotion!.since:sample.at);if(probed)stage(t,'probe',recentMotion!.since);stage(t,'firstOutline',sample.at);
        tracks.push(t);matched.set(t,c);note(t,'new outline');
      }
      if(detectorRan&&debug){
        const owners=new Map([...matched].map(([t,c])=>[c,t]));
        debug.detections=outlines.map(c=>{const zone=mapFieldZone(c,calibration,[],options.format).zone,owner=owners.get(c);
          return {quad:structuredClone(c.quad),kind:c.kind,confidence:c.confidence,zone,use:deckZone(zone)?'deck pile':owner?`track ${owner.view.id.slice(-4)}`:skipped.get(c)??'not used'};});
        // Held cards (add-to-hand path) with the reason the resting test gave.
        for(const c of held.cards)debug.detections.push({quad:structuredClone(c.quad),kind:c.kind,confidence:c.confidence,zone:mapFieldZone(c,calibration,[],options.format).zone,use:held.notes.get(c)??'held card'});
      }
      // Simultaneous deck-search outlines stay private; a single clean new card
      // settles immediately after its first read and next clean detector frame.
      const recent=tracks.filter(t=>t.newOutline&&!t.view.faceDown&&sample.at-t.view.firstSeen<=1500);
      const newcomers=recent.filter(t=>t.view.state==='candidate').sort((a,b)=>Number(isCovered(a.view.card,cards))-Number(isCovered(b.view.card,cards)));
      // A fanned hand is guarded; a laid-out board on a calibrated mat (each card
      // alone in its own zone, no overlaps) is not a spread: camera start, a
      // re-sync or Scan field sees many cards at once.
      const laidOut=!!calibration&&new Set(recent.map(t=>t.view.zone)).size===recent.length&&
        recent.every(t=>/^(M[1-5]|S[1-5]|EMZ[12]|FIELD|GY|BANISHED)$/.test(t.view.zone)&&!recent.some(o=>o!==t&&quadIou(o.view.card,t.view.card)>0));
      if(recent.length>=3&&!laidOut){for(const [i,t] of newcomers.entries()){t.promptOnly='spread';if(i>0){t.view.state='dismissed';t.softDismiss=!!calibration;t.needsRead=false;t.read=undefined;}}}
      for(let i=suppressed.length-1;i>=0;i--){
        const q=suppressed[i],halo=evidence.halo?.(q.card);
        const clear=!cards.some(c=>quadIou(c,q.card)>.04)&&evidence.motion(q.card)<=.01&&halo?.length&&halo.length===q.halo?.length&&halo.filter((v,j)=>Math.abs(v-q.halo![j])>.06).length/halo.length<=.08&&clearFieldBackground(evidence.appearance?.(q.card),q.halo);
        if(!clear){q.clearAt=undefined;q.samples=0;}else{q.clearAt??=sample.at;q.samples++;if(q.samples>=5&&sample.at-q.clearAt>=removalMs)suppressed.splice(i,1);}
      }
      // An empty, still mat clears the field: after ~2 s of full detector passes
      // with no field outline and no motion, every field card not seen leaves
      // (piles stay). Known twins without a live track get a removal too.
      const fieldZone=(zone:string)=>/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone);
      if(detectorRan&&!region){
        const seen=cards.some(c=>fieldZone(mapFieldZone(c,calibration,cards,options.format).zone));
        // Evidence must be continuous: a long gap between passes restarts the window.
        if(seen||blurHold||evidence.motion(mat)>.004||localizedDifference||sample.at-emptyPassAt>Math.max(1000,2*fullEvery,pacing?4*Math.max(ema,metrics.detectorMs):0)){emptySince=undefined;emptyPasses=0;}
        if(!seen&&evidence.motion(mat)<=.004&&!localizedDifference){emptySince??=sample.at;emptyPasses++;emptyPassAt=sample.at;}else emptyPassAt=-Infinity;
        if(emptySince!==undefined&&emptyPasses>=3&&sample.at-emptySince>=EMPTY_MAT_MS){
          // A hand resting on a card is not an empty spot: its pixels must read as clear mat.
          const clearSpot=(t:InternalTrack)=>{const pixels=evidence.background?.(t.view.card)??evidence.appearance?.(t.view.card);
            return !removalHold(t.view.card)&&!shadedKeeps(t,evidence)&&!evidence.occluded?.(t.view.card)&&!sameFieldAppearance(t.identityAppearance??t.appearance,pixels)&&clearFieldBackground(pixels,evidence.halo?.(t.view.card));};
          for(const t of tracks)if(!t.view.removed&&fieldZone(t.view.zone)&&clearSpot(t)){
            t.view.removed=true;t.view.visible=false;t.missed=true;t.read=undefined;t.needsRead=false;t.best=undefined;resetAbsence(t);
            if(t.view.state==='identified'||t.placeholder)emit('removed',t,{reason:'empty'});
            if(t.view.state!=='identified'){t.softDismiss=t.view.state==='candidate';t.view.state='dismissed';}
          }
          for(const k of options.getKnownCards?.()??[])if(k.zone!=='HAND'&&fieldZone(k.zone)&&!tracks.some(t=>t.view.id===k.id||t.binding?.id===k.id)){
            const card=k.card??mat,position=k.position??'attack';
            const ghost:InternalTrack={view:{id:k.id,card,zone:k.zone,position,faceDown:!!k.faceDown,cardId:k.cardId,state:'identified',firstSeen:sample.at,lastSeen:sample.at,removed:true,visible:false},
              anchor:card,missed:true,stableSince:NaN,observations:0,missingSamples:0,kind:card.kind,position,needsRead:false,resolvedAt:sample.at};
            tracks.push(ghost);emit('removed',ghost,{reason:'empty'});
          }
        }
      }
      // Field twins with no live track ("out of view is gone", any face): the zone has no
      // outline (kept low-score outlines count) in 2 full scans, no hand and no moving shadow.
      // A card back on a dark mat never counts as seen: only a detector outline does.
      if(detectorRan&&!region&&calibration){
        const known=options.getKnownCards?.()??[],cells=fieldCells();
        for(const id of [...twinMisses.keys()])if(!known.some(k=>k.id===id&&k.zone!=='HAND'&&fieldZoneName(k.zone)))twinMisses.delete(id);
        for(const id of [...missingTwins])if(!known.some(k=>k.id===id&&k.zone!=='HAND'&&fieldZoneName(k.zone)))missingTwins.delete(id);
        for(const k of known){
          if(k.zone==='HAND'||!fieldZoneName(k.zone))continue;
          const own=tracks.filter(t=>t.view.id===k.id||t.binding?.id===k.id);
          if(own.some(t=>!t.view.removed)){twinMisses.delete(k.id);missingTwins.delete(k.id);continue;}
          // A removal sent in the last 3 s is still being saved.
          if(own.some(t=>sample.at-t.view.lastSeen<3000))continue;
          const cell=cells.find(c=>c.zone===k.zone);if(!cell)continue;
          const box=cellQuad(cell),cellBounds=boundsOf(box.quad);
          const seen=outlines.some(c=>!tooBig(c)&&planeVerdict(c).ok&&(mapFieldZone(c,calibration,outlines,options.format).zone===k.zone||overlapFraction(boundsOf(c.quad),cellBounds)>=.5));
          const covered=handNear(evidence,box)||evidence.motion(box)>.06;
          if(seen||covered){twinMisses.delete(k.id);missingTwins.delete(k.id);continue;}
          if(blurHold){twinMisses.delete(k.id);continue;}
          const miss=twinMisses.get(k.id)??{misses:0,at:sample.at,emits:0};miss.misses++;twinMisses.set(k.id,miss);
          if(miss.misses<2||sample.at-miss.at<250)continue;
          missingTwins.add(k.id);
          // Event retries: at most twice, 3 s apart (the re-sync and Scan field also remove it).
          if(removalHold(box)||miss.emits>=2||miss.emittedAt!==undefined&&sample.at-miss.emittedAt<3000)continue;
          miss.emits++;miss.emittedAt=sample.at;
          const old=own[0];
          if(old){old.view.removed=true;old.view.visible=false;old.view.lastSeen=sample.at;note(old,`no outline on ${k.zone} in ${miss.misses} full scans`);emit('removed',old,{reason:'empty'});continue;}
          const card=k.card??box,position=k.position??'attack';
          const ghost:InternalTrack={view:{id:k.id,card,zone:k.zone,position,faceDown:!!k.faceDown,cardId:k.cardId,state:'identified',firstSeen:sample.at,lastSeen:sample.at,removed:true,visible:false},
            anchor:card,missed:true,stableSince:NaN,observations:0,missingSamples:0,kind:card.kind,position,needsRead:false,resolvedAt:sample.at};
          note(ghost,`no outline on ${k.zone} in ${miss.misses} full scans`);tracks.push(ghost);emit('removed',ghost,{reason:'empty'});
        }
      }
      if(detectorRan&&!region&&calibration){
        // Empty-mat baseline per zone cell: learned in three full scans in a row with nothing in or over the cell.
        const known=options.getKnownCards?.()??[],boxes=[...rawOutlines,...held.cards];
        for(const cell of fieldCells()){
          const zone=cell.zone,box=cellQuad(cell),b=boundsOf(box.quad),look=evidence.appearance?.(box),e=emptyLooks.get(zone);
          // A card rests in this cell while the cell still shows its "empty" look: that baseline was learned over an undetected card.
          if(e?.look.length&&tracks.some(t=>!t.view.removed&&t.view.zone===zone&&t.view.state==='identified'&&matched.has(t)&&!!t.rest?.ok)&&sameFieldAppearance(e.look,look)){emptyLooks.delete(zone);continue;}
          const occupied=boxes.some(c=>overlapFraction(boundsOf(c.quad),b)>=.2)||tracks.some(t=>!t.view.removed&&(t.view.zone===zone||overlapFraction(boundsOf(t.view.card.quad),b)>=.2))||
            known.some(k=>k.zone===zone)||deckZone(zone as FieldZone)&&piles.has(zone as 'DECK'|'EXTRA');
          if(occupied||!look?.length||blurHold||evidence.motion(box)>.01||removalHold(box)||handNear(evidence,box)){if(e){e.pending=undefined;e.passes=0;}continue;}
          const next=e??{look:[],passes:0};
          if(next.pending&&sameFieldAppearance(next.pending,look))next.passes++;else{next.pending=look;next.passes=1;}
          if(next.passes>=3)next.look=look;
          emptyLooks.set(zone,next);
        }
      }
      // Scan field is authoritative: after its two fresh full passes, every field track with no box on the mat plane in
      // either pass goes when it is a phantom, or when its spot shows the empty mat (any face, with or without a read).
      // Deck/Extra piles follow the same two passes: a stack outline puts the pile on the board, an empty cell takes it off.
      if(detectorRan&&!region&&scanSweep>0){
        for(const [t,c] of matched)if(planeVerdict(c).ok||!!t.restQuad&&!c.kept&&!c.cell)t.scanHit=true;
        // A back in a field zone is evidence for the board's face check when both passes show it, unless a front in that zone still looks like itself.
        const backsNow=new Set<FieldZone>();
        for(const c of cards){
          if(c.kind!=='face-down'||c.partial||c.covered||!planeVerdict(c).ok||evidence.motion(c)>.025||handNear(evidence,c)||removalHold(c)||!cardAspect(c))continue;
          const zone=mapFieldZone(c,calibration,cards,options.format).zone,look=evidence.appearance?.(c);
          if(!fieldSlot(zone)||cellEmpty(evidence,zone)||!(c.confidence>=.4?sleeveOnMat(look,evidence.halo?.(c)):plainSleeve(look,evidence.halo?.(c))))continue;
          const crop=evidence.crop?.(c);if(crop&&classifyFaceState(crop,{detectorFaceDownScore:c.confidence}).state==='up')continue;
          if(!tracks.some(t=>!t.view.removed&&t.view.zone===zone&&!t.view.faceDown&&bound(t)&&matchesLook(t,look)))backsNow.add(zone);
        }
        for(const zone of backsNow)scanBacks.set(zone,(scanBacks.get(zone)??0)+1);
        if(--scanSweep===0){
          lastScanAt=sample.at;lastScanBacks=[...scanBacks].filter(([,passes])=>passes>=2).map(([zone])=>zone);scanBacks.clear();
          for(const t of [...tracks]){
            if(t.view.removed||t.scanHit||t.under||!fieldZone(t.view.zone))continue;
            const phantom=!plausible(t)&&!t.restQuad,spot=plausible(t)?t.view.card:t.restQuad??t.view.card,box=cellOf(t.view.zone);
            if(!phantom){
              if(removalHold(spot)||handNear(evidence,spot)||!!box&&handNear(evidence,box)){note(t,'Scan field: a hand is over its spot');continue;}
              const pixels=evidence.background?.(spot)??evidence.appearance?.(spot);
              if(!cellEmpty(evidence,t.view.zone)&&!clearFieldBackground(pixels,evidence.halo?.(spot))){note(t,'Scan field: no box, but its spot is not empty mat');continue;}
            }
            if(t.view.state==='identified'||t.placeholder){
              t.view.removed=true;t.view.visible=false;t.missed=true;t.read=undefined;t.needsRead=false;t.best=undefined;resetAbsence(t);
              note(t,phantom?'Scan field: phantom (no box on the mat plane)':'Scan field: no box and its spot shows the empty mat');emit('removed',t,phantom?{reason:'phantom'}:{});
            }else expireCandidate(t,'Scan field: nothing on its spot');
          }
          for(const zone of ['DECK','EXTRA'] as const){
            const seen=scanPiles.get(zone),box=cellOf(zone),pile=piles.get(zone);
            if(seen){
              const crop=evidence.crop?.(seen),front=crop?classifyFaceState(crop,{detectorFaceDownScore:seen.kind==='face-down'?seen.confidence:undefined}):undefined;
              if(front?.state==='up'&&front.confidence>=.8)continue;
              const entry=pile??{gate:createFaceStateHysteresis({sustainMs:120,minSamples:3}),card:seen,at:sample.at,firstSeen:sample.at,down:true,keptAt:sample.at,backs:0};
              entry.down=true;entry.card=seen;entry.at=entry.keptAt=sample.at;entry.look??=evidence.appearance?.(seen);piles.set(zone,entry);
            }else if(pile&&box&&!handNear(evidence,box)&&(cellEmpty(evidence,zone)||clearFieldBackground(evidence.appearance?.(box),evidence.halo?.(box))))piles.delete(zone);
          }
          // GY/banished follow the same two passes: an outline keeps the pile; a cell that shows the empty mat with no
          // hand is picked up at once (the board lifts the cards that did not show up elsewhere).
          for(const zone of ['GY','BANISHED'] as const){
            const box=cellOf(zone),state=pilePresence.get(zone);if(!box||!state)continue;
            if(scanPileSeen.has(zone)){state.present=true;continue;}
            if(!blurHold&&!removalHold(box)&&!handNear(evidence,box)&&(pileClear.has(zone)||cellEmpty(evidence,zone)||clearFieldBackground(evidence.appearance?.(box),evidence.halo?.(box)))){state.present=false;pileClear.set(zone,pileClear.get(zone)??sample.at);}
          }
          scanPiles.clear();scanPileSeen.clear();
        }
      }
      const reconnected=new Set<InternalTrack>();
      for(const t of [...tracks]) {
        if(reconnected.has(t))continue;
        const c=matched.get(t);
        if(!c) {
          t.previewEligible=false;
          resetFace(t);
          t.view.visible=false;delete t.view.restSince;delete t.view.pixelsDown;
          invalidateRead(t);
          t.missed=true;t.best=undefined;t.stableSince=NaN;t.observations=0;if(!t.view.removed&&detectorRan)note(t,'no detector outline this scan');
          // Under: no outline of its own, and the outline of another live card lies over its spot. Kept, hidden, never sent to the hand.
          if(!t.view.removed&&fieldSlot(t.view.zone)&&(t.view.state==='identified'||t.placeholder)){
            // The top lies ON the mat in the same zone: settled (identified, or still for 300 ms), about the same size (not a card
            // held up in the air), it covers >= 40% of this card and its centre. A neighbour or a hovering card is not a top.
            const box=boundsOf(t.view.card.quad),area=box.w*box.h,cx=box.x+box.w/2,cy=box.y+box.h/2;
            const top=[...matched].find(([o,oc])=>{
              if(o===t||o.view.removed||o.under===t.view.id||o.view.zone!==t.view.zone||!area)return false;
              const b=boundsOf(oc.quad),ratio=b.w*b.h/area,inter=Math.max(0,Math.min(box.x+box.w,b.x+b.w)-Math.max(box.x,b.x))*Math.max(0,Math.min(box.y+box.h,b.y+b.h)-Math.max(box.y,b.y));
              const settled=o.view.state==='identified'||sample.at-o.stableSince>=300&&evidence.motion(oc)<=.025;
              return settled&&ratio>.6&&ratio<1.7&&inter/area>=.4&&cx>=b.x&&cx<=b.x+b.w&&cy>=b.y&&cy<=b.y+b.h;
            })?.[0];
            if(top){
              if(t.under!==top.view.id){t.under=top.view.id;t.view.under=top.view.id;note(t,`under ${top.view.id.slice(-4)}`);emit('covered',t,{coverRef:top.view.id});}
              t.fullMisses=0;t.fullMissAt=undefined;resetAbsence(t);continue;
            }
            if(t.under&&detectorRan&&!region){note(t,`the card on top (${t.under.slice(-4)}) left`);t.under=undefined;delete t.view.under;}
          }
          // Detector absence ("out of view is gone"): no outline on a field card's
          // spot in two full passes in a row, no hand on it and only camera-noise motion. This
          // does not depend on the mat colour (glare, tinted light, zone lines).
          if(detectorRan&&!region&&!t.view.removed&&fieldZone(t.view.zone)&&(t.view.state==='identified'||t.placeholder)){
            // A stale box that is not a card on the plane (an arm, a lifted card) falls back to the card's last resting outline.
            if(!plausible(t)&&t.restQuad)t.view.card=structuredClone(t.restQuad);
            // Phantom: no box of it ever lay on the mat plane (the S1→M1 box over an arm). Only a real resting outline keeps it:
            // never a hand nearby, its own look (the arm's), motion, nor a weak kept outline. Nor does a cell that shows its empty mat.
            const phantom=!plausible(t),empty=!phantom&&cellEmpty(evidence,t.view.zone),weak=phantom||empty;
            const spotSeen=detected.some(d=>quadIou(d,t.view.card)>=.1&&planeVerdict(d).ok),handOn=!weak&&handNear(evidence,t.view.card);
            // Relative, not absolute: pixels that still look like this card mean a detector miss. A Set
            // counts too when its sleeve differs from the mat (a white sleeve whose score dropped is still there).
            const stillLooks=!weak&&(!!t.identityAppearance?.length&&(t.view.card.kind==='face-up'||sleeveOnMat(t.identityAppearance,t.halo))&&matchesLook(t,evidence.appearance?.(t.view.card))||shadedKeeps(t,evidence));
            if(blurHold){t.fullMisses=0;t.fullMissAt=undefined;note(t,shadowNote());}
            else if(spotSeen||handOn||stillLooks||!weak&&evidence.motion(t.view.card)>.06){t.fullMisses=0;t.fullMissAt=undefined;note(t,spotSeen?'an outline still covers its spot':handOn?'a hand is over its spot':stillLooks?'its spot still looks like the card':'its spot is moving');}
            else{
              t.fullMissAt??=sample.at;t.fullMisses=(t.fullMisses??0)+1;
              const pendingNew=tracks.some(o=>o!==t&&!o.view.removed&&o.view.state==='candidate'&&o.read&&!o.read.result&&sample.at-o.view.firstSeen<2500);
              // Two separate scans (>= 250 ms apart), not two passes of one burst.
              if(removalHold(t.view.card))note(t,shadowNote());
              else if(t.fullMisses>=2&&sample.at-t.fullMissAt>=250&&(!pendingNew||weak)){
                note(t,`${phantom?'phantom (no box on the mat plane)':empty?'its cell shows the empty mat':'no outline'} in ${t.fullMisses} full passes over ${Math.round(sample.at-t.fullMissAt)} ms`);
                t.view.removed=true;t.restoredAt=undefined;t.fullMisses=0;t.fullMissAt=undefined;emit('removed',t,phantom?{reason:'phantom'}:{});
                // A candidate lost from view is dismissed softly: it reads again when it shows again.
                if(t.view.state!=='identified'){t.softDismiss=t.view.state==='candidate';t.view.state='dismissed';}
              }
            }
          }
          // A candidate (never confirmed) with no outline for 1.5 s, or a huge box, expires.
          if(detectorRan&&!t.view.removed&&t.view.state==='candidate'&&!t.binding&&(sample.at-t.view.lastSeen>CANDIDATE_EXPIRE_MS||tooBig(t.view.card)))expireCandidate(t,'candidate expired: no outline');
          // The lightweight observation above already checked clear mat.
          continue;
        }
        t.fullMisses=0;t.fullMissAt=undefined;
        if(t.view.state==='candidate'&&tooBig(c)){expireCandidate(t,'candidate expired: outline larger than two zones');continue;}
        if(t.view.state==='dismissed'&&detectorRan&&c.kind==='face-up'&&c.confidence>=.8&&!c.partial&&fieldZone(t.view.zone)&&t.softDismiss&&!t.userDismissed&&(t.rearms??0)<2){
          t.frontScans=(t.frontScans??0)+1;if(t.frontScans>=3){t.rearms=(t.rearms??0)+1;rearm(t,`detector front ${c.confidence.toFixed(2)} in ${t.frontScans} scans`);}
        }else if(t.view.state!=='dismissed')t.frontScans=0;
        t.previewEligible=c.confidence>=.7&&!c.partial&&!c.covered&&!isCovered(c,cards)&&!cards.some(other=>other!==c&&quadIou(c,other)>0);
        proposePose(t,c,cards,evidence,sample.at,current.width,current.height);
        if(t.under){note(t,'seen again on top');t.under=undefined;delete t.view.under;}
        t.reappeared ||= t.view.removed;t.missed=false;t.view.removed=false;resetAbsence(t);t.view.lastSeen=sample.at;t.view.card=c;
        // A hand moves. Skin-coloured pixels that stay still on a still, confident outline for HAND_WAIT_MS are
        // the card's own print (an orange frame or warm art read as skin under a locked, darker exposure or white
        // balance): they stop blocking the face gate and the read, so a clearly seen card is never held for ever.
        if(!(evidence.occluded?.(c)||evidence.occluded?.(artBox(c)))||evidence.motion(c)>.025||c.confidence<.7||c.partial||c.covered){t.stillSkinAt=undefined;t.stillSkin=false;}
        else {t.stillSkinAt??=sample.at;const was=t.stillSkin;t.stillSkin=sample.at-t.stillSkinAt>=HAND_WAIT_MS;if(t.stillSkin&&!was)note(t,`still skin-coloured pixels for ${Math.round(sample.at-t.stillSkinAt)} ms; not a hand`);}
        observeRest(t,c,evidence,sample.at);
        if(t.rest?.ok&&t.rest.since!==undefined)t.view.restSince=t.rest.since;else delete t.view.restSince;
        // Uncalibrated ordering is assigned at settlement, then kept until the card actually moves.
        if(calibration||t.view.state==='candidate'||distance(t.anchor,c)>.02)t.view.zone=settledZone(t,c,cards);
        const position=fieldOrientation(c,current.width,current.height,calibration);
        if(t.view.state==='identified'&&t.announced){
          const moved=distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position;
          if(moved)t.moveAt??=sample.at;else t.moveAt=undefined;
        }
        if(!t.timing)beginTiming(t,t.view.firstSeen);if(detectorRan)count(t,'detects');stage(t,'detectorDone');if(t.timing){t.timing.durationsMs.detector=metrics.detectorMs;for(const [key,value] of Object.entries(options.recognizer.detectorTimingsMs??{}))t.timing.durationsMs[`detector.${key}`]=value;}stage(t,'tracker');if(t.timing)t.timing.durationsMs.capture=captureMs;
        const pixels=appearance(c);
        if(t.identityAppearance?.length&&matchesLook(t,pixels))t.lookUpright=upright(c);
        const publicIdentity=bound(t)&&!t.view.faceDown?options.getKnownCards?.().find(k=>k.id===t.view.id&&!k.faceDown)?.cardId:undefined;
        if(publicIdentity&&publicIdentity!==t.view.cardId){if(t.face)t.face.setCardId=undefined;gallery.remember(t.identityEmbedding,publicIdentity);t.view.cardId=publicIdentity;t.view.bestMatch=undefined;}

        // A fresh full-card warp, never the tiny appearance patch or a retained read.
        const faceState=t.face??={gate:createFaceStateHysteresis({sustainMs:120,minSamples:3}),setCardId:t.binding?.faceDown?t.binding.cardId:undefined};
        // The latest detector's appearance validates a new outline or changed
        // face without overwriting identity or re-running inference.
        // A white/art sleeve can retain the detector's front class. Its fresh
        // outline still supports pixel confirmation when the bound face changes.
        if((t.view.state==='candidate'||t.view.faceDown!==(c.kind==='face-down')||bound(t)&&!matchesLook(t,pixels))&&c.confidence>=.4&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,cards)){faceState.transitionAt??=sample.at;faceState.outlineAppearance=pixels;}
        // Bound cards need fresh face pixels in either direction, even when a
        // plain sleeve has a weak/wrong detector class. New fronts keep .7.
        // A weak back (a white sleeve can score .20) counts too: a plain sleeve at rest for a while, with no hand, blur or moving shadow on it.
        const weakBack=c.kind==='face-down'&&!!t.rest?.ok&&sample.at-(t.rest.since??sample.at)>=WEAK_BACK_REST_MS&&!c.partial&&cardAspect(c)&&!handNear(evidence,c)&&!removalHold(c)&&!cellEmpty(evidence,t.view.zone)&&plainSleeve(pixels,evidence.halo?.(c));
        const boundOutline=(c.confidence>=.4||weakBack)&&cardAspect(c)&&!!(t.setRecovery||t.binding?.faceDown||bound(t));
        // A new front needs only a still art window, not N stable detector passes.
        const freshFront=t.view.state==='candidate'&&c.kind==='face-up'&&!c.partial&&!c.covered&&!isCovered(c,cards)&&(c.confidence>=.7||frontOutline(c))&&artStill(t,c);
        const faceClean=freshFront||(c.confidence>=.7||backOutline(c)&&cardAspect(c)||boundOutline||frontOutline(c))&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,cards)&&
          // Neighbours that only touch (IoU <= .1) and light flicker (<= .06) do not make it unclean.
          !cards.some(other=>other!==c&&quadIou(c,other)>.1)&&evidence.motion(c)<=.06&&quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012;
        const crop=faceClean?evidence.crop?.(c):undefined;
        let observation=crop?classifyFaceState(crop,{reference:faceState.reference,detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined}):{state:'unknown' as const,confidence:0};
        if(observation.state==='down')t.view.pixelsDown=true;else delete t.view.pixelsDown;
        // Coloured light can leave the pixel classifier undecided on a real
        // front. A steady, confident detector front then overrides a stale
        // face-down state; a confident pixel back still keeps the Set.
        if(crop&&observation.state==='unknown'&&c.kind==='face-up'&&c.confidence>=.8&&t.view.faceDown&&(bound(t)||t.binding?.faceDown)){
          t.upSince??=sample.at;if(sample.at-t.upSince>=500)observation={...observation,state:'up',confidence:c.confidence};
        }else t.upSince=undefined;
        if(t.prompted&&observation.state==='down'&&!t.view.faceDown&&t.view.state==='prompt'){t.view.state='dismissed';t.view.revision=(t.view.revision??0)+1;t.read=undefined;t.needsRead=false;}
        // Publish geometry before identity inference; never invent an identity
        // or a public front while face-state evidence is still ambiguous.
        if(!t.placeholder&&!t.binding&&!t.promptOnly&&t.view.state==='candidate'&&restOk(t)&&faceClean&&observation.state==='up'&&evidence.sharpness(c)>=12&&
          !['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)) {
          t.placeholder=true;t.placeholderId=t.view.id;t.view.faceDown=false;t.view.visible=true;t.halo=evidence.halo?.(c);
          emit('reading',t,{latencyMs:now()-t.view.firstSeen});
        }
        // Speculate on the first sharp front while the face gate settles. Any
        // subsequent motion invalidates the result without restarting the worker.
        if(faceClean&&observation.state==='up'&&evidence.sharpness(c)>=12&&(t.needsRead||t.view.faceDown)&&!t.read&&!reading&&!(t.view.state==='candidate'&&t.rest?.hard)) {
          t.needsRead=true;t.appearance=pixels;t.halo=evidence.halo?.(c);
          await startRead(t,current,c,crop,sample.at,generation);
        }
        // A finished early read that is not sure, while the card pixels changed
        // since (a hand left its edge): read the fresh still front at once.
        if(t.read?.result&&t.read.result.tier!=='sure'&&!t.rereadEarly&&t.view.state==='candidate'&&!t.promptOnly&&t.read.appearance?.length&&
          !sameFieldAppearance(t.read.appearance,pixels)&&faceClean&&observation.state==='up'&&evidence.sharpness(c)>=12&&!reading){
          t.rereadEarly=true;t.read=undefined;t.needsRead=true;t.appearance=pixels;note(t,'early read not sure; reading again');
          await startRead(t,current,c,crop,sample.at,generation);
        }
        const knownFace=bound(t)&&c.kind===t.kind&&t.view.faceDown===(c.kind==='face-down')&&matchesLook(t,pixels)&&
          (c.confidence>=.4||weakBack)&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,cards)&&evidence.motion(c)<=.025;
        // A sure read of a still, detector-front outline is itself front evidence (its read
        // started from an 'up' pixel sample); do not wait for another face sample.
        const sureFront=(observation.state==='up'||t.view.state==='candidate'&&c.kind==='face-up'&&c.confidence>=.7&&readHolds(t,c))&&t.read?.result?.tier==='sure'&&(t.read.result.candidates[0]?.score??0)>=.84&&
          !t.read.result.quality.fallback&&!t.read.result.quality.covered&&!t.read.result.quality.partial&&!t.read.result.quality.faceDown&&
          (sameFieldAppearance(t.read.appearance,pixels)||readHolds(t,c));
        const gatedFace=faceState.gate.update(observation,sample.at);
        const setFace=(faceState.setGate??=createFaceStateHysteresis({sustainMs:60,minSamples:2})).update(observation,sample.at);
        // Two fresh clean samples reject a moving draw, without waiting for the
        // full face window. Existing cards retain their normal flip hysteresis.
        const sureBack=t.view.state==='candidate'&&t.resolvedAt===undefined&&!t.binding&&!t.prompted&&
          faceClean&&c.kind==='face-down'&&c.confidence>=.7&&setFace.state==='down';
        let face=knownFace?{state:t.view.faceDown?'down' as const:'up' as const,confidence:1}:sureFront||sureBack?observation:gatedFace;
        // The face gate never waits for ever: after 600 ms a confident detector
        // front (>= .8) decides, unless the pixels clearly show a back.
        if(face.state==='unknown'&&c.kind==='face-up'&&c.confidence>=.8&&!c.partial&&observation.state!=='down'&&!blocks(t,c)){
          t.faceWaitAt??=sample.at;if(sample.at-t.faceWaitAt>=600){face={state:'up',confidence:c.confidence};note(t,`face gate timed out after ${Math.round(sample.at-t.faceWaitAt)} ms; detector front ${c.confidence.toFixed(2)}`);}
        }else if(face.state!=='unknown'||c.kind!=='face-up')t.faceWaitAt=undefined;
        // Nor on a back: a still face-down outline whose pixels stay undecided (a plain white sleeve) for 600 ms is a
        // Set. On a known face-up card whose own look is gone, that is a flip in place (identity kept privately).
        const backCase=c.kind==='face-down'&&cardAspect(c)&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,cards)&&evidence.motion(c)<=.025&&observation.state!=='up'&&
          (bound(t)&&!t.view.faceDown&&(c.confidence>=.4||weakBack)&&!handNear(evidence,c)&&!removalHold(c)&&!matchesLook(t,pixels)||t.view.state==='candidate'&&!t.binding&&!t.prompted&&backOutline(c)&&fieldSlot(t.view.zone));
        if(face.state==='unknown'&&backCase){
          t.backWaitAt??=sample.at;if(sample.at-t.backWaitAt>=600){face={state:'down',confidence:Math.max(.8,c.confidence)};note(t,`face gate timed out after ${Math.round(sample.at-t.backWaitAt)} ms; detector back ${c.confidence.toFixed(2)}`);}
        }else t.backWaitAt=undefined;
        if(face.state==='unknown'){
          if(observation.state!=='unknown')faceState.pendingAt??=sample.at;else faceState.pendingAt=undefined;
          t.view.visible=false;t.pose=undefined;t.best=undefined;note(t,`face gate waiting (pixels: ${observation.state}${faceClean?'':', outline not clean'})`);
          if((observation.state!=='up'||!sameFieldAppearance(t.read?.appearance,pixels))&&!readHolds(t,c))invalidateRead(t);
          if(!faceClean){t.anchor=c;t.stableSince=NaN;t.observations=0;}
          continue;
        }
        faceState.pendingAt=undefined;faceState.transitionAt=undefined;faceState.outlineAppearance=undefined;stage(t,'faceState');
        c.kind=face.state==='down'?'face-down':'face-up';
        const faceChanged=t.view.faceDown!==(face.state==='down');
        const revealRead=faceChanged&&face.state==='up'&&t.read&&sameFieldAppearance(t.read.appearance,pixels)?t.read:undefined;
        if(faceChanged){t.prompted=false;if(!revealRead)invalidateRead(t);t.view.revision=(t.view.revision??0)+1;t.best=undefined;t.pose=undefined;t.identityCheck=undefined;}
        if(face.state==='down'){
          if(t.promptOnly==='suppressed'){t.view.state='dismissed';t.prompted=true;t.needsRead=false;t.best=undefined;continue;}
          // A new back is a Set only once it rests on the mat (never a card held up, an arm or a box across two cells).
          if(t.view.state==='candidate'&&!restOk(t)){t.view.visible=false;note(t,`Set waits: ${t.rest?.text??'not resting yet'}`);continue;}
          if(!t.view.faceDown&&t.view.cardId)faceState.setCardId=t.view.cardId;
          t.view.cardId=undefined;t.read=undefined;t.needsRead=false;t.identityCheck=undefined;
          // A card that left this zone moments ago, and now a back in the same zone: the same card turned
          // face-down (lifted to flip it, or out of view for a moment). It keeps its ref, so the board
          // shows a flip in place, never a departure to the hand plus a new unknown Set.
          const back=t.view.state==='candidate'&&!t.binding&&t.resolvedAt===undefined&&fieldSlot(t.view.zone)?tracks.filter(o=>o!==t&&o.view.removed&&o.view.state==='identified'&&!o.under&&o.view.zone===t.view.zone&&
            sample.at-o.view.lastSeen<=RETURN_MS&&(options.getKnownCards?.()??[]).some(k=>k.id===o.view.id&&(k.zone===o.view.zone||k.zone==='HAND'))).sort((a,b)=>b.view.lastSeen-a.view.lastSeen)[0]:undefined;
          if(back){
            const setCardId=back.view.faceDown?back.face?.setCardId:back.view.cardId;
            tracks.splice(tracks.indexOf(back),1);back.best=undefined;twinMisses.delete(back.view.id);missingTwins.delete(back.view.id);
            t.binding={id:back.view.id,zone:back.view.zone,cardId:setCardId,faceDown:back.view.faceDown};t.view.revision=(back.view.revision??0)+1;
            t.identityEmbedding=back.identityEmbedding;t.latestEmbedding=back.latestEmbedding;faceState.setCardId=setCardId;faceState.reference=back.face?.reference;faceState.front=back.face?.front;
            note(t,`same card back in ${t.view.zone} (${back.view.id.slice(-4)})`);
          }
          if(faceChanged||t.view.state==='candidate'){
            const binding=t.binding,placed=t.resolvedAt===undefined&&!binding;
            if(binding)t.view.id=binding.id;
            t.binding=undefined;t.view.faceDown=true;t.view.position=position;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;
            t.identityAppearance=pixels;t.appearance=pixels;t.kind=c.kind;t.anchor=c;t.stableSince=sample.at;t.observations=3;
            t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.best=undefined;t.halo=evidence.halo?.(c);
            if(placed){metrics.placements++;t.selfSetAt=sample.at;emit('placed',t);}
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
        const appearanceChanged=t.read?.appearance?.length&&pixels&&!sameFieldAppearance(t.read.appearance,pixels)&&!readHolds(t,c);
        const changedKind=(t.view.state==='prompt'||t.view.state==='dismissed')&&t.view.faceDown!==(c.kind==='face-down');
        const changedLook=(t.view.state==='prompt'||t.view.state==='dismissed'||(t.view.state==='identified'&&Boolean(t.view.cardId||!t.view.faceDown)&&c.kind==='face-up'))&&t.identityAppearance?.length&&pixels&&!sameFieldAppearance(t.identityAppearance,pixels);
        if(t.prompted&&changedKind){t.view.state='dismissed';t.view.revision=(t.view.revision??0)+1;t.read=undefined;t.needsRead=false;t.best=undefined;}
        const changed=!t.prompted&&!bound(t)&&(changedKind||changedLook)&&evidence.motion(c)<=.025&&!c.covered&&!c.partial;
        if(changed){t.moveAt=undefined;t.identityCheck??={state:t.view.state,cardId:t.view.cardId,result:t.lastResult,reason:t.promptOnly,strongSamples:0};invalidateRead(t);t.view.revision=(t.view.revision??0)+1;t.view.cardId=undefined;t.view.state='candidate';t.view.visible=false;t.needsRead=true;t.promptOnly='changed';t.stableSince=sample.at;t.observations=0;t.best=undefined;}
        // A card under this one (its stale outline) is not a fanned spread.
        if(t.view.state==='candidate'&&!t.promptOnly&&cards.some(other=>other!==c&&quadIou(c,other)>0&&!tracks.some(o=>o!==t&&(o.under||lookBlocked(o,c))&&quadIou(o.view.card,other)>.9)))t.promptOnly='spread';
        const sizes=tracks.filter(other=>other!==t&&other.view.state==='identified'&&!other.view.removed).map(other=>{const b=boundsOf(other.view.card.quad);return b.w*b.h;}).sort((a,b)=>a-b),size=boundsOf(c.quad);
        if(sizes.length&&size.w*size.h>sizes[Math.floor(sizes.length/2)]*1.8)t.promptOnly??='uncertain';
        const confident=c.confidence>=.7||backOutline(c)&&cardAspect(c)||boundOutline||frontOutline(c)||c.confidence>=.4&&['GY','BANISHED'].includes(t.view.zone)&&(t.view.state==='candidate'||bound(t)&&sameRotatedFieldAppearance(t.identityAppearance,pixels));
        const clean=!appearanceChanged&&confident&&!c.partial&&!c.covered&&!isCovered(c,cards)&&(evidence.motion(c)<=.025||freshFront||readHolds(t,c));
        if(t.identityCheck){if(!clean)t.identityCheck.strongSamples=0;else if(fieldAppearanceDistance(t.identityAppearance,pixels)>=.025)t.identityCheck.strongSamples++;}
        const earlyHolds=!!t.early&&quadIou(t.early.card,c)>=.3&&evidence.motion(artBox(t.early.card))<=.06&&!blocks(t,artBox(t.early.card))&&sameFieldAppearance(t.early.art,evidence.appearance?.(artBox(t.early.card)));
        t.view.visible=!changed&&(!t.identityAppearance?.length||c.kind!=='face-up'||matchesLook(t,pixels))&&(evidence.motion(c)<=.025||earlyHolds)&&(t.view.state==='identified'||t.view.state==='prompt')&&confident&&!c.partial&&!c.covered&&!isCovered(c,cards);
        if(clean&&!t.appearance?.length)t.appearance=pixels;
        const still=quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012&&t.kind===c.kind&&t.position===position;
        if(!clean||!still||!Number.isFinite(t.stableSince)) {
          if((!clean||!still)&&!readHolds(t,c))invalidateRead(t);
          t.anchor=c;t.stableSince=clean?sample.at:NaN;t.observations=0;t.best=undefined;t.kind=c.kind;t.position=position;
        }
        // Show earlier: a sure first read whose art pixels still hold names the
        // card now, while a hand or the outline still settles. A confirm read
        // follows once the card is clean and still; it corrects in place.
        const sure=t.read?.result,earlyNow=!clean&&!!sure&&sure.tier==='sure'&&(sure.candidates[0]?.score??0)>=.84&&!sure.quality.fallback&&!sure.quality.covered&&!sure.quality.partial&&!sure.quality.faceDown&&
          t.view.state==='candidate'&&restOk(t)&&!t.binding&&!t.promptOnly&&!t.identityCheck&&!t.view.faceDown&&c.kind==='face-up'&&confident&&!c.partial&&!['DECK','EXTRA','GY','BANISHED'].includes(t.view.zone)&&readHolds(t,c)&&sample.at>t.read!.at;
        if(!clean&&!earlyNow){note(t,t.read?'read waits for a still, clean outline':'outline not still/clean');continue;}
        if(clean&&t.early&&t.view.state==='identified'&&!t.read&&!reading&&t.observations>=1&&still){t.early=undefined;t.confirming=true;t.needsRead=true;}
        t.observations++;
        const score=evidence.sharpness(c);
        if((!t.best||score>t.best.score)&&!(t.view.state==='candidate'&&c.kind==='face-up'&&handBlocks(t,evidence.touched?.(c))))t.best={frame:current,card:structuredClone(c),score,crop};
        const movingKnown=t.view.state==='identified'&&!t.needsRead&&t.view.faceDown===(c.kind==='face-down');
        if(movingKnown?(t.observations<2||sample.at-t.stableSince<100):score<12)continue;
        const wasFaceDown=t.view.faceDown;
        t.view.faceDown=c.kind==='face-down';t.view.position=position;
        if(t.reappeared&&t.rest?.planeOk!==false){if(t.view.state==='identified')emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.reappeared=false;}
        if(t.view.state==='identified') {
          t.pose=undefined;
          if(t.announced&&t.rest?.planeOk!==false&&(quadIou(t.announced,c)<.7||distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position)){emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;}
          if(wasFaceDown!==t.view.faceDown){emit('flipped',t);t.needsRead=!t.view.faceDown&&!t.view.cardId;if(t.needsRead)t.identityAppearance=undefined;}
        }
        t.halo=evidence.halo?.(c);t.appearance=pixels;
        // A read of a new card is used only while the card rests on the mat: a card held above it goes to the held path.
        if(t.view.state==='candidate'&&t.read&&(t.read.result||t.read.error)&&!restOk(t)){note(t,`read waits: ${t.rest?.text??'not resting yet'}`);continue;}
        if(t.read&&(t.read.result||t.read.error)&&sample.at>t.read.at) {
          const pending=t.read,result=pending.result;t.read=undefined;
          metrics.latencyMs=now()-t.view.firstSeen;
          // An early read can include a hand at the card edge. If it is not sure and
          // the card itself has changed since (the hand left), read once more
          // rather than ask the player.
          if(result&&result.tier!=='sure'&&!t.rereadEarly&&t.view.state==='candidate'&&pending.appearance?.length&&!sameFieldAppearance(pending.appearance,pixels)){
            t.rereadEarly=true;t.needsRead=true;t.best={frame:current,card:structuredClone(c),score,crop:evidence.crop?.(c)};note(t,'early read not sure; reading again');
            if(!reading){await startRead(t,current,c,t.best.crop,sample.at,generation);t.best=undefined;}continue;
          }
          const safe=result&&result.tier!=='low match'&&result.candidates[0]&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&result.candidates[0].cardId!==options.profile.cardBack.cardId;
          let winner=safe?result!.candidates[0].cardId:undefined;
          const lockedRef=t.view.faceDown&&!t.binding?undefined:lockFor(t.binding?.id??t.view.id),locked=lockHolds(lockedRef,result,pixels)?lockedRef:undefined;
          if(result&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&pending.crop)faceState.front=pending.crop;
          // A failed reveal must neither restore private identity nor publish an unnamed front.
          if(t.binding?.faceDown&&!safe&&!locked){t.needsRead=false;t.identityAppearance=pixels;t.view.visible=true;t.best=undefined;t.view.state='prompt';emit('prompt',t,{result,reason:pending.error?'recognition-error':'uncertain'});continue;}
          if(t.confirming){
            t.confirming=false;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding??t.identityEmbedding;t.latestEmbedding=t.identityEmbedding;
            if(winner&&result!.tier==='sure'&&winner!==t.view.cardId&&t.view.state==='identified'&&(!locked||beatsLock(locked,result))){t.view.cardId=winner;t.view.bestMatch=undefined;note(t,'confirm read corrected the name');emit('placed',t,{result});}
            continue;
          }
          if(t.identityCheck&&locked&&!beatsLock(locked,result)&&locked.cardId===t.identityCheck.cardId){restoreIdentity(t,pixels);t.view.visible=t.view.state==='identified';note(t,'identity locked');continue;}
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
            if(saved.strongSamples<3||sample.at<(t.resolvedAt??-Infinity)+5000){t.read=pending;continue;}
            // Unsure band (.68-.84, or no embedding to compare): the same read never changes, so holding it
            // keeps the card a candidate for ever (a locked or new exposure). Read the card again, at most twice;
            // then the same name keeps the card with its new look, and another name asks the player.
            if(incomparable||(similarity!==undefined&&similarity>.68)){
              saved.rereads=(saved.rereads??0)+1;
              if(saved.rereads<=2){t.needsRead=true;t.best=undefined;note(t,`identity check unsure (${similarity?.toFixed(2)??'no embedding'}); reading again`);continue;}
              if(winner&&winner===saved.cardId){t.identityEmbedding=result?.identityEmbedding??t.identityEmbedding;t.latestEmbedding=t.identityEmbedding;restoreIdentity(t,pixels);note(t,'identity check: same name after fresh reads; new look kept');continue;}
              t.identityCheck=undefined;t.latestEmbedding=result?.identityEmbedding;t.lastResult=result;t.identityAppearance=pixels;t.view.state='prompt';t.view.visible=true;
              emit('prompt',t,{result,reason:'changed',latencyMs:metrics.latencyMs});continue;
            }
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
          // A locked card is never re-guessed: a lower or equal read keeps its name.
          if(locked&&winner!==locked.cardId&&!beatsLock(locked,result)){winner=locked.cardId;note(t,'identity locked');}
          const deck=options.getPriors?.()?.decklist;
          const inDeck=!!winner&&!!deck?.some(id=>String(id)===winner)&&!result?.quality.notInDecklist;
          const pile=['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone);
          // Follow physical lifts. Pile history needs touch or top-change evidence;
          // an unchanged top remains a separate copy from a new field outline.
          const known=options.getKnownCards?.();
          // A new outline on top of a confirmed card that reads as that card (glare, shadow, a turn to the other battle
          // position) is that card: it takes the outline back. No new ref, no "placed".
          const lies=(o:InternalTrack)=>{const a=boundsOf(o.view.card.quad),b=boundsOf(c.quad),cx=a.x+a.w/2,cy=a.y+a.h/2;return cx>=b.x&&cx<=b.x+b.w&&cy>=b.y&&cy<=b.y+b.h;};
          const beneath=t.newOutline&&!t.binding?tracks.find(o=>o!==t&&bound(o)&&!o.view.removed&&!o.view.visible&&fieldSlot(o.view.zone)&&(o.under===t.view.id||!matched.has(o)&&lies(o))):undefined;
          // Merge only on the same identity, or on a read that is not sure while the look is the same card in other light
          // or turned. A different look with an unsure read is a new card on top (best match / prompt, as on the field).
          const sameLook=!!beneath&&(sameRotatedFieldAppearance(beneath.identityAppearance,pixels)||sameShadedFieldAppearance(beneath.identityAppearance,pixels));
          if(beneath&&(winner===beneath.view.cardId||result?.tier!=='sure'&&sameLook)){
            beneath.under=undefined;delete beneath.view.under;beneath.identityAppearance=pixels;beneath.appearance=pixels;beneath.lookUpright=upright(c);
            beneath.view.card=c;beneath.view.visible=true;beneath.view.lastSeen=sample.at;beneath.missed=false;beneath.fullMisses=0;resetAbsence(beneath);
            t.best=undefined;tracks.splice(tracks.indexOf(t),1);note(beneath,'the same card again (light or a turn)');continue;
          }
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
              // Exit evidence: the whole pile outline is gone, or a hand over the pile at most
              // 2.5 s ago (any member: a revive can take a card from under the top). Only for
              // the pile TOP: a hand over the pile from 10 s before to 1 s after this card
              // showed (a slow CPU read finishes seconds later), or a seen top that changed.
              const touched=pileTouches.get(card.zone)??-Infinity;
              // The pile cell shows the empty mat: the whole pile left, so this member did too.
              if(pileDepartures.has(card.id)||pilePresence.get(card.zone)?.present===false||pileClear.has(card.zone as 'GY'|'BANISHED')||sample.at-touched<=2500)return true;
              return top?.id===card.id&&(touched>=t.view.firstSeen-PILE_EXIT_MS&&touched<=t.view.firstSeen+1000||
                !!witness&&!sameRotatedFieldAppearance(witness.identityAppearance,evidence.appearance?.(witness.view.card)));
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
            const available=[...(known??[])].reverse().filter(card=>card.cardId===winner&&(!publicPile(card.zone)||pileAvailable(card))&&!tracks.some(other=>other!==t&&(other.view.id===card.id||other.binding?.id===card.id)));
            // After a restart, an unseen field owner outranks an ordinary hand
            // copy. There is no time limit on correcting its physical zone.
            const owner=!known?.some(card=>card.cardId===winner&&publicPile(card.zone))&&available.find(card=>!['HAND','DECK','EXTRA','GY','BANISHED'].includes(card.zone));
            const reserved=owner||available[0];
            if(reserved)t.binding=reserved;
            else if(awaitingPile){t.read=pending;continue;}
          }
          if(t.binding){
            if(!winner&&!t.binding.cardId&&!t.binding.faceDown&&!t.promptOnly){t.view.id=t.binding.id;t.view.cardId=undefined;t.view.state='identified';t.view.visible=true;t.resolvedAt=sample.at;t.binding=undefined;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.needsRead=false;if(t.view.faceDown===false)emit('flipped',t);emit('moved',t);continue;}
            // A Set this watcher placed moments ago that turns out to be a card
            // just lifted from the GY/banish is that pile card: move the pile ref
            // here and drop the provisional Set, so the pile count drops.
            const lifted=winner&&!t.promptOnly&&t.binding.faceDown&&t.selfSetAt!==undefined&&sample.at-t.selfSetAt<=15000?[...(known??[])].reverse().find(k=>publicPile(k.zone)&&k.cardId===winner&&
              (pileDepartures.has(k.id)||(pileTouches.get(k.zone)??-Infinity)>=t.selfSetAt!-5000)&&
              !tracks.some(o=>o!==t&&o.view.id===k.id&&!o.view.removed&&o.view.visible&&o.view.zone===k.zone&&matchesLook(o,evidence.appearance?.(o.view.card)))):undefined;
            if(lifted){
              const setRef=t.binding.id;
              for(let i=tracks.length-1;i>=0;i--)if(tracks[i]!==t&&tracks[i].view.id===lifted.id){tracks[i].best=undefined;tracks.splice(i,1);}
              t.view.id=lifted.id;t.view.cardId=winner;t.view.bestMatch=result?.tier!=='sure'||!inDeck?true:undefined;t.view.state='identified';t.view.visible=true;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;
              t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.resolvedAt=sample.at;t.binding=undefined;t.selfSetAt=undefined;pileDepartures.delete(lifted.id);
              emit('moved',t,{result,replacesRef:setRef});continue;
            }
            if(winner&&!t.promptOnly){const replaced=!!t.binding.cardId&&t.binding.cardId!==winner,reveal=t.binding.faceDown||!t.binding.cardId||replaced;t.view.id=t.binding.id;t.view.cardId=winner;t.view.bestMatch=reveal?(result?.tier!=='sure'||!inDeck):undefined;t.view.state='identified';t.view.visible=true;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.resolvedAt=replaced?undefined:sample.at;t.binding=undefined;if(reveal)emit('placed',t,{result,latencyMs:metrics.latencyMs});else emit('moved',t);}
            else if(result&&result.tier!=='low match'){t.view.state='dismissed';t.best=undefined;}else {t.view.state='prompt';t.identityAppearance=pixels;t.view.visible=true;emit('prompt',t,{result,reason:t.promptOnly??'restart'});}
          }else if(winner&&!t.promptOnly&&!['DECK','EXTRA'].includes(t.view.zone)){
            t.view.bestMatch=result?.tier!=='sure'||!inDeck;t.view.state='identified';t.view.visible=true;t.view.cardId=winner;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;metrics.placements++;if(earlyNow){t.early={card:structuredClone(pending.card??c),art:pending.art};t.identityAppearance=undefined;stage(t,'early');}emit('placed',t,{result,latencyMs:metrics.latencyMs});
          }else if(t.view.state==='candidate'&&!t.promptOnly&&!['DECK','EXTRA'].includes(t.view.zone)&&result?.candidates[0]&&result.candidates[0].cardId!==options.profile.cardBack.cardId&&!result.quality.faceDown&&
            result.tier!=='low match'){
            // Never stay in Reading: an unsure or flagged read (glare) reads once
            // more, then the top match is placed as a Best match (Wrong card? fixes
            // it; it is not locked). The reason is in Debug.
            const why=[result.tier,...(['fallback','covered','partial'] as const).filter(k=>result.quality[k])].join(', ');
            t.unsureReads=(t.unsureReads??0)+1;
            if(t.unsureReads<2&&sample.at-t.view.firstSeen<1500){t.needsRead=true;note(t,`read not sure (${why}); reading again`);}
            else {
              t.view.bestMatch=true;t.view.state='identified';t.view.visible=true;t.view.cardId=result.candidates[0].cardId;t.identityAppearance=pixels;t.identityEmbedding=result.identityEmbedding;
              t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;metrics.placements++;note(t,`best match after ${t.unsureReads} unsure read(s) (${why})`);
              emit('placed',t,{result,latencyMs:metrics.latencyMs});
            }
         }else if(result&&result.tier!=='low match'){t.view.state='dismissed';t.best=undefined;}else {t.view.state='prompt';t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.view.visible=true;emit('prompt',t,{...(result?{result:{...result,candidates:result.candidates.slice(0,5)}}:{}),latencyMs:metrics.latencyMs,reason:t.promptOnly??(pile?'pile':pending.error?'recognition-error':'uncertain')});}

        }
        if(!t.needsRead){t.best=undefined;continue;}
        if(reading)continue;
        if(t.view.faceDown){t.needsRead=false;t.best=undefined;continue;}
        if(!t.best)continue;
        const best=t.best;
        await startRead(t,best.frame,best.card,best.crop,sample.at,generation);t.best=undefined;
      }
      restPrev=restNext;restNext=[];
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
      const settling=settlingNow();
      if(detectorRan&&pacing)pacer.spend(elapsed,now());
      // GPU inference leaves the CPU free; still leave room for input/rendering
      // and back off with detector load. Unknown providers keep the WASM guard.
      const gpu=options.recognizer.detectorBackend==='webgpu',scanBudget=gpu&&options.cpuBudget===undefined ? .5 : budget;
      const interval=Math.max(gpu?66:250,Math.min(5000,ema/scanBudget));
      metrics.intervalMs=pacing?pacer.gap(now()):settling?(gpu?Math.max(100,interval):100):interval;metrics.dutyPercent=pacing?pacer.duty(now()):Math.min(100,100*ema/metrics.intervalMs);
      if(pacing)guarded=now()-budgetWaitAt<2000;else if(metrics.intervalMs>650)guarded=true;else if(metrics.intervalMs<450)guarded=false;if(status==='watching'&&guarded)status='budget';inFlight=false;notify();
    }
  }
  function schedule() {if(!active)return;clearTimeout(timer);timer=setTimeout(async()=>{const start=now();await tick();if(!active)return;if(wakeQueued){wakeQueued=false;schedule();return;}const wanted=pacing?pacer.tickMs(pacedStill?'still':pixelBurst()?'burst':'active'):Math.min(pixelBurst()?33:66,metrics.intervalMs);scheduleAfter(Math.max(0,wanted-(now()-start)));},0);}
  function scheduleAfter(delay:number) {if(!active)return;const asked=now(),wasHidden=hidden();timer=setTimeout(()=>{if(!wasHidden&&!hidden())pacer.late(now()-asked-delay);schedule();},delay);}
  function stop() {active=false;epoch++;heldReader.reset();clearTimeout(timer);interruptWindow();piles.clear();status='stopped';notify();}
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
    /** Shared blur measure: last whole-frame sharpness, and whether removals hold for blur now. */
    frameSharpness(){return {value:sharpNow,baseline:sharpBase,ratio:sharpBase>0?sharpNow/sharpBase:1};},
    isBlurred(){return blurHold;},
    /** The camera lock, anti-glare or exposure changed: learn the sharpness and shadow baselines again from the next frames. */
    resetBaselines(){emptyLooks.clear();pileClear.clear();shadowCells=undefined;sharpBase=0;sharpNow=0;blurredAt=-Infinity;blurHold=false;blurSince=undefined;shadowMovedAt=-Infinity;shadowHold=false;shadowShare=0;analyze.reset?.();notify();},
    dispose(){stop();disposed=true;for(const t of tracks){t.best=undefined;t.face=undefined;}pruneFrames();listeners.clear();updates.clear();},
    subscribe(listener:(event:FieldEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    subscribeState(listener:()=>void){updates.add(listener);return()=>{updates.delete(listener);};},
    getSnapshot():FieldSnapshot{return {held:heldReader.snapshot(),blur:{sharpness:sharpNow,ratio:sharpBase>0?sharpNow/sharpBase:1,hold:blurHold},shadow:{share:shadowShare,hold:shadowHold},missingTwins:[...missingTwins],missingPiles:[...pilePresence].flatMap(([zone,p])=>p.present?[]:[zone]),pileTouchedAt:Object.fromEntries([...pileTouches].filter(([zone])=>publicPile(zone))),pileClearSince:Object.fromEntries(pileClear),lastFullAt:Number.isFinite(lastFullDetectionAt)?lastFullDetectionAt:undefined,...(Number.isFinite(lastScanAt)?{lastScanAt,lastScanBacks:[...lastScanBacks]}:{}),status,tracks:tracks.map(t=>copy(t.view)),piles:[...piles].flatMap(([zone,pile])=>pile.down&&now()-pile.keptAt<=PILE_GONE_MS?[{zone,card:structuredClone(pile.card)}]:[]),metrics:{...metrics},error,
      debug:{at:debugAt,path:debugTick,full:debug?.full??false,region:debug?.region,detections:debug?.detections??[],...(debug?.pileScores?{pileScores:debug.pileScores}:{}),reasons:Object.fromEntries(tracks.map(t=>[t.view.id,`${t.rest?.text?`${t.rest.text} · `:''}${t.read?'reading identity · ':''}${t.reason??''}${t.lastResult?.prior?` · prior: ${t.lastResult.prior}`:''}`]))}};},
    setCalibration(value?:FieldCalibration){calibration=value;heldReader.reset();if(status!=='starting')epoch++;interruptWindow();piles.clear();emptyLooks.clear();pileClear.clear();restSize=undefined;for(const t of tracks){t.prompted=false;t.view.revision=(t.view.revision??0)+1;t.view.zone=mapFieldZone(t.view.card,calibration,[],options.format).zone;t.announcedZone=undefined;}notify();},
    confirm(id:string,cardId?:string,ref?:string,human=true){const lock=locks.get(id);if(ref&&lock&&!locks.has(ref))locks.set(ref,lock);const t=tracks.find(t=>t.view.id===id);if(human&&cardId)for(const key of [id,ref])if(key)locks.set(key,{cardId,score:Infinity,at:now(),embedding:t?.latestEmbedding??t?.identityEmbedding,look:t?.identityAppearance?.slice()});if(t){t.prompted=false;t.setRecovery=false;t.pose=undefined;t.read=undefined;const other=tracks.find(other=>other!==t&&other.view.id===ref);if(other&&(other.view.removed||!other.view.visible))tracks.splice(tracks.indexOf(other),1);if(ref&&!tracks.some(other=>other!==t&&other.view.id===ref))t.view.id=ref;t.view.visible=!t.missed;for(let i=suppressed.length-1;i>=0;i--)if(sameFieldAppearance(suppressed[i].appearance,t.appearance)||quadIou(suppressed[i].card,t.view.card)>.5)suppressed.splice(i,1);if(human&&!t.view.faceDown&&t.face&&cardId!==t.face.setCardId)t.face.setCardId=undefined;if(!t.view.faceDown&&cardId)gallery.remember(t.latestEmbedding,cardId);t.view.cardId=t.view.faceDown?undefined:cardId;if(!t.view.faceDown&&cardId&&t.face?.front)t.face.reference={crop:t.face.front,embedding:t.latestEmbedding};t.identityAppearance=t.appearance?.slice();t.identityEmbedding=t.latestEmbedding;t.identityCheck=undefined;t.resolvedAt=now();t.promptOnly=undefined;t.binding=undefined;t.view.state='identified';t.needsRead=false;t.announced=t.view.card;t.announcedZone=t.view.zone;t.announcedPosition=t.view.position;t.moveAt=undefined;t.best=undefined;pruneFrames();notify();}},
    dismiss(id:string){const t=tracks.find(t=>t.view.id===id);if(t){t.userDismissed=true;t.softDismiss=false;t.pose=undefined;t.read=undefined;if(t.view.state!=='identified')gallery.remember(t.latestEmbedding);t.prompted=true;if(t.view.removed)t.restoredAt=now();t.resolvedAt=now();t.identityCheck=undefined;t.identityEmbedding=t.latestEmbedding;if(t.view.state!=='identified')t.view.state='dismissed';t.needsRead=false;t.best=undefined;pruneFrames();notify();}},
    /** "Scan field": the next sample runs a full-frame detector pass at once. */
    // "Scan field": a full pass now; every dismissed card in view (not one the
    // player dismissed) reads again, and cards still waiting for a read read at once.
    scanNow(){scanSweep=2;lastScanAt=-Infinity;lastScanBacks=[];scanBacks.clear();scanPiles.clear();scanPileSeen.clear();for(const t of tracks){t.scanHit=false;if(t.view.state==='dismissed'&&!t.view.removed&&!t.userDismissed){t.rearms=0;rearm(t,'Scan field');}else if(t.view.state==='candidate'&&!t.read){t.needsRead=true;t.unsureReads=0;t.handWaitAt=undefined;t.faceWaitAt=undefined;}}for(const miss of twinMisses.values()){miss.emits=0;miss.emittedAt=undefined;}scanRequested=true;wake();},
    forget(id:string){const i=tracks.findIndex(t=>t.view.id===id);if(i>=0){suppressed.push({card:tracks[i].view.card,appearance:tracks[i].identityAppearance??tracks[i].appearance,halo:tracks[i].halo,samples:0});if(suppressed.length>maxTracks)suppressed.shift();tracks.splice(i,1);}pruneFrames();notify();},
  };
}
export type FieldWatcher=ReturnType<typeof createFieldWatcher>;

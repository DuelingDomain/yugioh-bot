import {unsureNameCandidates} from './unsure-names';
import { sharpness } from './quality';
import { glareMask } from './preclean';
import { fieldGlareChoices, fieldGlareNotice, sampleFieldGlare, type FieldGlareNotice, type FieldGlareSample } from './field-glare';
import {classifyFaceState,createFaceStateHysteresis,type FaceStateOptions,type FaceStateResult} from './face-state';
import type {RGBAImage} from './pixels';
import {createFieldIdentityGallery, type FieldIdentityGallery} from './field-gallery';
import type { Recognizer } from './client';
import { createFieldPacer, fieldPacerDevice } from './field-pacer';
import { canZoomCell, detectZoomedCell } from './field-set-zoom';
import type { DetectedQuad, FractionalBox, GameProfile, Point, RecognitionPriors, RecognitionResult, FieldActionEvidence } from './types';
import { boundsOf, quadMap, type Quad } from './geometry';
import { DUELSIGHT_CONFIDENT } from './hybrid-models';
import { DINO_CONFIDENT } from './models';
import { CARD_DETECTOR } from './detector/spec';
import {DEFAULT_SET_GUARDS, newSetCardMemory, measureSetEvidence, findFlatSleeve, rememberSetBack, ignoreSetRegion, sameSetRegion, setMatQuad, setLookDistance, setCropLook, type SetGuards, type SetEvidence, type SetDecision, type SetCardMemory} from './set-card-evidence';
import { isCovered } from './board';
import { fieldStackCovers, fieldStackUnder } from './field-stack-memory';
import { createZoneInstant, sameZoneLook, zoneLook, type ZoneInstant, type ZoneInstantRead } from './zone-instant';
import type { GrayFrame, ZoneTier } from './zone-events';
import { createFieldAnalyzer, cloneFieldFrame, closeFieldFrame, sameFieldAppearance, sameShadedFieldAppearance, sameRotatedFieldAppearance, fieldAppearanceDistance, fieldEmbeddingSimilarity, clearFieldBackground, clearFieldTransfer, type FieldFrame, type FieldAnalysis } from './field-motion';
import { fieldQuarterTurn, fieldZoneBounds, fieldZoneCells, fieldMatPoint, fieldCenter, onMat, fieldOrientation, mapFieldZone, matRestGeometry, quadIou, zoneCellAt, type FieldCalibration, type FieldZone, type FieldFormat } from './field-zones';

// The shortcut requires visual evidence and a registered identity. Priors alone cannot supply the margin.
function confidentDeckRead(result:RecognitionResult,priors:RecognitionPriors|undefined) {
  const id=result.candidates[0]?.cardId,{quality,raw,reader}=result;
  if(result.tier!=='sure'||!id||!priors?.decklist?.includes(id)||quality.notInDecklist||quality.fallback||
    quality.covered||quality.partial||quality.faceDown||quality.framesAgree===false||raw?.blocked.length)return false;
  if(reader?.stage==='first'){
    const first=reader.first;
    return !!first&&first.score>=DUELSIGHT_CONFIDENT.score&&first.margin>=DUELSIGHT_CONFIDENT.margin;
  }
  const [top]=raw?.visual??[],runner=raw?.visual.find(candidate=>candidate.cardId!==id);
  return top?.cardId===id&&!!runner&&top.score>=DINO_CONFIDENT.score&&top.score-runner.score>=DINO_CONFIDENT.margin;
}

export interface HeldCardTrack {
  id:string; state:'held'; card:DetectedQuad; at:number; cardId?:string; visible?:boolean;
}
/** First sure read of one held-card episode. Pixels remain local. Never a field placement. */
/** `lifted`: the outline was off the mat plane (certainly lifted, or off the plane with fingers on it). Fingers alone on a flat card may only be a placement or a discard. */
export interface HeldCardEvent extends HeldCardTrack {type:'held'; cardId:string; result:RecognitionResult; source:'auto'; lifted:boolean; timing?:FieldTiming}
/** A held card the reader could not name after its last try: the best few candidates for a one-tap pick. Never a field placement. */
export interface HeldUnsureEvent extends HeldCardTrack {type:'held-unsure'; candidates:{cardId:string;score:number}[]; source:'auto'; lifted:boolean}

/** A separate path so removal/shadow fixes can change the field tracker independently. */
export function createHeldCardReader(options:Pick<FieldWatcherOptions,'recognizer'|'profile'|'getPriors'|'getKnownCards'|'clone'|'onHeldCard'|'onHeldUnsure'|'now'>) {
  type Track={view:HeldCardTrack;look?:number[];seen:number;tried:number;attempts:number;stable:number;detectorWait:number;readMs:number;firstReadAt?:number;restGate?:number;pending:boolean;emitted:boolean;visible:boolean;field:boolean;eligible:boolean;planeHeld:boolean;/** Last sample this outline was off the mat plane (watcher clock). */lastLifted:number;unsure:boolean;/** Consecutive sure reads naming the same card. */sure?:{cardId:string;count:number}};
  const clone=options.clone??cloneFieldFrame,tracks:Track[]=[],lastRead=new Map<string,number>();
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  let serial=0,epoch=0;
  return {
    /**
     * `plane`: the watcher's "resting on the mat" verdict for one outline. A card the plane test calls held (certainly off
     * the mat, or off the plane with a hand on it) is a held card even over a zone cell or next to field cards: closer to the
     * camera than the mat, it can never be a field card. `lifted`: its look is a field card's own look (a field card picked up).
     */
    observe(cards:DetectedQuad[],frame:FieldFrame,evidence:FieldAnalysis,at:number,calibration:FieldCalibration|undefined,format:FieldFormat|undefined,busy:boolean,fieldTracks:readonly FieldTrack[]=[],plane?:(card:DetectedQuad)=>PlaneVerdict|undefined,lifted?:(look?:number[])=>boolean) {
      for(const [id,seen] of lastRead)if(at-seen>FIELD_SET_RETURN_MS)lastRead.delete(id);
      const cells=fieldZoneCells(format,calibration?.zoneSpacing,calibration?.zones),used=new Set<Track>(),held:DetectedQuad[]=[],notes=new Map<DetectedQuad,string>();
      for(const card of cards){
        if(card.quad.length!==4||card.confidence<.7||card.partial)continue;
        const look=evidence.appearance?.(artBox(card)),center=fieldCenter({quad:card.quad.map(p=>onMat(p,calibration))}),cell=zoneCellAt(center,cells);
        // touched measures skin connected through the sleeve edge. Nearby skin alone is not contact.
        const contact=(evidence.touched?.(card)??0)>.003||evidence.edgeGrip?.(card)==='grip';
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
          track={view:{id:`held-${session}-${++serial}`,state:'held',card:structuredClone(card),at},seen:at,tried:-Infinity,attempts:0,stable:at,detectorWait:Math.max(0,(options.now?.()??performance.now())-at),readMs:0,pending:false,emitted:false,visible:true,field:!planeHeld&&(recentField||missingField||!!cell&&!fromHandEdge),eligible:false,planeHeld,lastLifted:-Infinity,unsure:false};
          tracks.push(track);
        }
        if(recentField&&!planeHeld)track.field=true;
        const moving=distance(track.view.card,card)>.012||evidence.motion(card)>.025||!track.visible;
        if(moving||!(contact||planeHeld))track.stable=at;
        track.planeHeld=planeHeld;track.eligible=planeHeld||!track.field&&contact;if(planeHeld)track.lastLifted=at;
        track.view.card=structuredClone(card);track.seen=at;track.look=look;used.add(track);
        if(track.eligible&&track.view.cardId)lastRead.set(track.view.cardId,at);
        if(track.eligible){held.push(card);notes.set(card,planeHeld?verdict!.hard?verdict!.text:`${verdict!.text.replace(/^held\? /,'held: ')} · fingers`:'held: hand contact');}
      }
      for(const track of tracks){track.visible=used.has(track);track.view.visible=track.visible;if(!track.visible)track.stable=at;}
      for(let i=tracks.length-1;i>=0;i--)if(at-tracks[i].seen>(tracks[i].field?10_000:1500)&&!tracks[i].pending)tracks.splice(i,1);
      const track=held.length===1?[...used].find(t=>t.eligible&&!t.emitted&&!t.pending&&t.attempts<3&&at-t.stable>=200&&at-t.tried>=250&&t.view.card.kind==='face-up'):undefined;
      let read:Promise<void>|undefined;
      if(!busy&&track){
        track.pending=true;track.tried=at;track.attempts++;
        const generation=epoch,card=structuredClone(track.view.card),readStart=performance.now();
        const firstReadAt=track.firstReadAt??=at;track.restGate??=at-track.stable;
        read=(async()=>{
          const input=await clone(frame);
          try{
            if(generation!==epoch)return;
            const priors=options.getPriors?.();
            const result=await options.recognizer.recognize([input] as ImageBitmap[]|ImageData[],{card,priors,maxFrames:1,k:5,preferUpright:true,includeIdentityEmbedding:true,includeRaw:true});
            const elapsed=performance.now()-readStart;
            track.readMs+=elapsed;
            const cardId=result.candidates[0]?.cardId;
            // A captured frame remains valid after the outline leaves the view.
            if(generation!==epoch||track.field&&!track.planeHeld||track.emitted)return;
            const sure=result.tier==='sure'&&!!cardId&&cardId!==options.profile.cardBack.cardId&&!result.quality.faceDown&&!result.quality.fallback&&!result.quality.partial;
            if(sure)lastRead.set(cardId,Math.max(at,lastRead.get(cardId)??-Infinity));
            // A confident registered name can reveal at once. Other names need two consecutive sure reads.
            track.sure=sure&&cardId?{cardId,count:track.sure?.cardId===cardId?track.sure.count+1:1}:undefined;
            if(!sure||track.sure!.count<2&&!confidentDeckRead(result,priors)){
              // After the last try the player gets the best few to pick from. A wrong automatic card is worse than one tap.
              const top=result.candidates.filter(c=>c.cardId&&c.cardId!==options.profile.cardBack.cardId).slice(0,3);
              if(track.attempts>=3&&!track.unsure&&(sure||result.tier==='not sure')&&!result.quality.faceDown&&!result.quality.partial&&top.length){
                track.unsure=true;
                options.onHeldUnsure?.({...track.view,card,type:'held-unsure',candidates:top.map(c=>({cardId:c.cardId,score:c.score})),source:'auto',lifted:track.planeHeld,at:performance.timeOrigin+at});
              }
              return;
            }
            const repeated=tracks.some(t=>t!==track&&t.emitted&&t.view.cardId===cardId&&at-t.seen<1500&&distance(t.view.card,card)<.18);
            track.seen=options.now?.()??at+Math.max(0,performance.now()-readStart);
            track.emitted=true;track.view.cardId=cardId;
            const origin=track.view.at,done=track.seen-origin;
            const timing:FieldTiming={id:track.view.id,originAt:performance.timeOrigin+origin,durationsMs:{},reader:result.reader,stagesMs:{
              firstOutline:0,searchDone:done,commit:done,detectorWait:track.detectorWait,restGate:track.restGate??0,
              handGate:0,read:track.readMs,nameVote:Math.max(0,done-(firstReadAt-origin)-track.readMs),post:0,
            }};
            if(!repeated)options.onHeldCard?.({...track.view,card,type:'held',cardId,result,source:'auto',lifted:track.planeHeld,at:performance.timeOrigin+at,timing});
          }finally{closeFieldFrame(input);}
        })().finally(()=>{track.pending=false;});
      }
      return {cards:held,read,notes};
    },
    /**
     * A card that was held up must never become a field card by passing over a zone. An outline near one that was lifted
     * (off the mat plane) stays out of the field until `holdMs` after the last lifted sample. Fingers on a flat card are a placement.
     */
    claims(card:DetectedQuad,at:number,holdMs:number){
      return tracks.some(t=>(t.planeHeld||at-t.lastLifted<holdMs)&&(distance(t.view.card,card)<.18||quadIou(t.view.card,card)>.2));
    },
    snapshot:()=>tracks.filter(t=>t.eligible).map(t=>({...t.view,visible:t.visible,card:structuredClone(t.view.card)})),
    hasVisibleCard:()=>tracks.some(t=>t.eligible&&t.visible),
    lastReadAt:(cardId:string)=>lastRead.get(cardId)??-Infinity,
    reset(){epoch++;tracks.length=0;lastRead.clear();},
  };
}

export interface FieldTrack {
  /** Local glare guidance for an unresolved face-up card. */ glare?:FieldGlareNotice;
  /** Local diagnostics for the Set admission decision; no hidden identity. */ setEvidence?:SetEvidence;
  /** Public tentative identity choices; presence/geometry have already passed. */ nameCandidates?:{cardId:string;score:number}[];
  id:string; revision?:number; card:DetectedQuad; zone:FieldZone; position:'attack'|'defense'; faceDown:boolean; cardId?:string;
  state:'candidate'|'identified'|'prompt'|'dismissed'; bestMatch?:boolean; firstSeen:number; lastSeen:number; removed:boolean; visible?:boolean;
  /** First removal of this track in its current absence (watcher clock). */ removedAt?:number;
  /** First frame of the evidence window that confirmed removal. */ removedFrameAt?:number;
  /** Pixel proof that this track's cell was vacant during its current absence. */ emptyProofAt?:number;
  /** Id of the track whose card lies on top of this one (hidden, kept on the field). */ under?:string; /** Since when this outline rests still on the mat plane with no hand on it (watcher clock). Absent while it moves or has no box. */ restSince?:number; /** The latest clean crop of this box shows a back in its pixels. */ pixelsDown?:boolean;
}
/** Epoch origin crosses browser/worker/HTTP boundaries; stages are offsets, never mixed clocks. */
/** Per-card trace. Existing markers in stagesMs are offsets from originAt. The six named waits are durations and may overlap. */
export interface FieldTiming { id:string; originAt:number; stagesMs:Record<string,number>; durationsMs:Record<string,number>; notes?:Record<string,string>; reader?:RecognitionResult['reader'] }
export type FieldEvent = { type:'reading'|'placed'|'moved'|'flipped'|'removed'|'prompt'|'covered'; /** covered: the track now on top of this card. */ coverRef?:string; /** Removed: the known bottom revealed by this card leaving a waiting stack. */ uncoveredRef?:string; track:FieldTrack; bindRef?:string; fromRef?:string; previousId?:string; result?:RecognitionResult; latencyMs?:number; reason?:'card-presence'|'uncertain'|'recognition-error'|'reappeared'|'changed'|'restart'|'pile'|'spread'|'suppressed'|'empty'|/** No plausible card box ever backed this track (an arm, a held card): the board card it placed is taken back, not sent to the hand. */'phantom'; source:'auto'; evidence?:FieldActionEvidence; /** A watcher-placed Set ref that this event's pile ref replaces: the card left the pile face-up. */ replacesRef?:string; destination?:'DECK'|'EXTRA'; /** First removal of a field track, also on its Set return (watcher clock). */ removedAt?:number; timing?:FieldTiming };
export interface FieldMetrics { detectorMs:number; /** Wall time of the latest priority Set pass, included in detector duty. */ priorityPassMs?:number; /** Wall time of the latest tick that checked one or more zoomed cells. */ zoomMs?:number; recognitionMs:number; dutyPercent:number; intervalMs:number; samples:number; skipped:number; placements:number; latencyMs:number; errors:number; event?:FieldTiming }
/** What the watcher saw on its last sample, for the owner's debug overlay. Local only, never sent. */
export interface FieldDebug { at:number; path:string; full:boolean; region?:FractionalBox; detections:{quad:DetectedQuad['quad'];kind:DetectedQuad['kind'];confidence:number;zone:FieldZone;use:string; /** The box centre lies between two zone cells (zone shown is the nearest). */ gap?:boolean}[]; reasons:Record<string,string>; /** Best raw detector score inside the calibrated Deck/Extra cell this full pass (null: no outline at or above the decode floor .2). */ pileScores?:Partial<Record<'DECK'|'EXTRA',number|null>> }
export interface FieldSnapshot {
  /** Named local board previews awaiting a real outline and the ordinary placement guards. */
  instantPreviews?:{id:string;zone:FieldZone;cardId:string}[];
  /** Latest motion over each field slot and public pile, on the watcher clock. */
  lastFieldActivityAtByZone?:Partial<Record<FieldZone,number>>;
  /** Latest valid learned-empty proof by calibrated cell, on the watcher clock. */
  emptyProofAt?:Partial<Record<FieldZone,number>>;
  /** Activity horizon calculated from the camera sample interval. */
  fieldActivityWindowMs?:number;
  /** Recent field or public pile motion. */
  fieldActive?:boolean;
  /** Live Set tracks currently covered or whose own pixels have changed. */
  missingSetLooks?:string[];
  /** Latest completed cell check and slots still awaiting a post-removal check, on the watcher clock. */
  zoomCheckedAt?:Partial<Record<FieldZone,number>>;
  zoomDeparturePending?:FieldZone[];
  /** True once per watcher, while a resting card has never been sharp enough to read (soft camera): the page shows one focus hint instead of a prompt per card. */ softCamera?:boolean; held?:HeldCardTrack[]; /** Frame sharpness vs its recent baseline (ratio) and whether removals hold for blur (debug line). */ blur?:{sharpness:number;ratio:number;hold:boolean;/** Crop sharpness a card needs to be read now (12 on a good camera, lower on a soft one). */limit:number}; /** Shadow over the mat (share 0..1) and whether removals wait for it to settle (debug line). */ shadow?:{share:number;hold:boolean}; /** Field twin refs whose zone showed no outline in 2 full scans (no hand, no moving shadow): the re-sync removes them. */ missingTwins?:string[]; /** Pile zones with no stack outline in 2 full scans in a row (no hand over them). */ missingPiles?:FieldZone[]; /** Last time a hand moved over the GY / banished pile (watcher clock). */ pileTouchedAt?:Partial<Record<'GY'|'BANISHED',number>>; /** Last time a hand moved over the Deck / Extra Deck (watcher clock). */ deckTouchedAt?:Partial<Record<'DECK'|'EXTRA',number>>; /** Hand contact within a tracked public pile, excluding motion nearby. */ pileContactAt?:Partial<Record<'GY'|'BANISHED',number>>; /** Since when the GY / banished cell shows the empty mat on sharp frames with no hand over it (watcher clock). */ pileClearSince?:Partial<Record<'GY'|'BANISHED',number>>; /** Spell/Trap zones that looked occupied in a still, hand-free cell on the last full pass. */ blindZones?:FieldZone[]; /** Recently vacated slots with a resting object awaiting a zoom check. */ zoomPendingZones?:FieldZone[]; /** Time of the latest clean full scan with sleeve edges in a blind Spell/Trap cell. */ blindSleeveAt?:Partial<Record<FieldZone,number>>; /** First full scan that saw the current stable blind sleeve. */ blindSleeveSince?:Partial<Record<FieldZone,number>>; /** Main Monster and Spell/Trap zones with a hand over the cell on the last full pass. */ handZones?:FieldZone[]; /** Sample time of the last full detector pass (watcher clock). */ lastFullAt?:number; /** Sample time when the last Scan field sweep (two fresh full passes) finished (watcher clock). */ lastScanAt?:number; /** Field zones with a card on the board that the sweep could not judge: the spot lies mostly outside the frame. */ lastScanOffFrame?:FieldZone[]; /** Field zones where that sweep saw a back resting on the mat (weak boxes count), over no front that still looks like itself. */ lastScanBacks?:FieldZone[]; status:'stopped'|'starting'|'watching'|'hidden'|'busy'|'budget'|'error'; tracks:FieldTrack[]; piles?:{zone:'DECK'|'EXTRA';card:DetectedQuad}[]; metrics:FieldMetrics; error?:string; debug?:FieldDebug; /** Resting cards whose centres fall in a gap between cells or outside the grid, seen in several full passes in a row: the grid is probably shifted (Recalibrate). */ gridShift?:{gap:number;outside:number;suspect:boolean}; /** Watcher clock time of the last sample that showed motion on the mat. */ lastMotionAt?:number; /** Resting cards inside a zone in the last full pass that no track follows and that nothing skipped, so the board may miss them. */ untracked?:number
}
export interface FieldBuffer { /** `urgent`: a new card is settling, so the buffer must not add a wait before this sample. */ sample(options?:{maxAgeMs?:number;urgent?:boolean}):Promise<{frame:FieldFrame;at:number}>; /** A small grey picture of the live camera for the instant zone path, or nothing when there is no new frame. */ gray?():GrayFrame|undefined }
export interface KnownFieldCard { id:string; card?:DetectedQuad; zone:FieldZone|'HAND'; cardId?:string; faceDown?:boolean; position?:FieldTrack['position'] }
export interface FieldWatcherOptions {
  recognizer:Pick<Recognizer,'detectCards'|'recognize'>&Partial<Pick<Recognizer,'prepare'|'detectorBackend'|'detectorTimingsMs'|'separateDetector'>>; buffer:FieldBuffer; profile:GameProfile;
  onHeldCard?:(event:HeldCardEvent)=>void;
  onHeldUnsure?:(event:HeldUnsureEvent)=>void;
  getPriors?:()=>RecognitionPriors|undefined; getKnownCards?:()=>KnownFieldCard[]; calibration?:FieldCalibration; format?:FieldFormat;
  setGuards?:Partial<SetGuards>; setCardMemory?:SetCardMemory; onSetMemoryChange?:()=>void; onSetDecision?:(decision:SetDecision)=>void;
  /** The buffer supplies native camera pixels and the recognizer supports the zoom detector mode. */
  zoomSets?:boolean;
  /** Instant zone path (zone-instant.ts): read a settled face-up zone at once, without a detector pass. The host selects the device budget for its own seat. */
  zoneInstant?:{tier:ZoneTier;enabled?:()=>boolean;maxPerSecond?:number;maxReadDuty?:number};
  /** Default on: one three-frame mean after a fast, unusable first read of a new resting front. */ nameVoting?:boolean;
  /** Default on: unanswered fronts retry with backoff and a shared 10% read duty limit. */ backgroundReread?:boolean;
  /** Experimental; off unless the owner web runtime allowlist grants it. */ placeUnsure?:boolean;
  gallery?:FieldIdentityGallery; earlyExitMargin?:number; stableMs?:number; removalMs?:number; cpuBudget?:number; maxTracks?:number;
  now?:()=>number; hidden?:()=>boolean; /** `urgent`: a new card settles; the host then reports busy only while a detector pass is pending (a queued read must not hold the next outline pass). */ cpuBusy?:(urgent?:boolean)=>boolean;
  /** Dependency injection for replay/tests; production defaults sample browser pixels. */
  analyze?:((frame:FieldFrame,/** Sample time on the watcher clock. */at?:number,mat?:readonly Point[])=>FieldAnalysis)&{reset?:()=>void}; clone?:(frame:FieldFrame)=>Promise<FieldFrame>;
}
interface NameSample {frame:FieldFrame;score:number;at:number}
interface PendingRead { fingerprint?:number[]; background?:boolean; nativeFront?:boolean; verifyOnly?:boolean; voting?:NameSample[]; confidentDeck?:boolean; /** Crop sharpness when the read started. */ sharp?:number; crop?:RGBAImage; at:number; /** Low reads from a moving outline may get one settled retry. */ moving?:boolean; appearance?:number[]; result?:RecognitionResult; error?:boolean; card?:DetectedQuad; art?:number[] }
interface IdentityCheck { state:FieldTrack['state']; cardId?:string; result?:RecognitionResult; reason?:FieldEvent['reason']; strongSamples:number; /** Fresh reads taken while the embedding stayed in the unsure band (.68-.84). */ rereads?:number }
/** One sample's verdict on whether an outline lies on the mat plane (size, shape, cells). `hard`: certainly not on the mat (held well above it). */
export interface PlaneVerdict { ok:boolean; hard:boolean; text:string; size?:number }
interface RestState { samples:number; since?:number; ok:boolean; text:string; /** This sample's outline lies on the mat plane / is certainly held above it. */ planeOk?:boolean; hard?:boolean }
interface PendingPose {card:DetectedQuad;origin:DetectedQuad;appearance:number[];at:number;cleanAt?:number;samples:number}
type HandContactWait = {state:'held'} | {state:'still-held';card:DetectedQuad;since:number;samples:number};
// Private evidence follows the physical track through ref adoption and is never serialized.
interface FaceEvidence { revealUntil?:number; sample?:{look:number[];card:DetectedQuad;observation:FaceStateResult;reference?:FaceStateOptions['reference']}; setCardId?:string; gate:ReturnType<typeof createFaceStateHysteresis>; setGate?:ReturnType<typeof createFaceStateHysteresis>; reference?:FaceStateOptions['reference']; front?:RGBAImage; pendingAt?:number; transitionAt?:number; outlineAppearance?:number[] }
interface InternalTrack {
  handGateAt?:number;
  /** A recent sure read can confirm the same still crop without another inference. */
  readCache?:{result:RecognitionResult;card:DetectedQuad;zone:FieldZone;look:number[];at:number};
  /** Unread pile top: motion or a hand was over it since it was seen; and the different look that has held on it (see pileSplit). */ pileSighted?:boolean; pileLook?:number[]; pileDisturbed?:boolean; pileSplit?:{look:number[];n:number}; /** Urgent-tick budget left for this new card (ms) and the last tick that spent it; see URGENT_MS. */ urgentLeft?:number; urgentTickAt?:number; /** Set bridge: last positive Set evidence, last real detector hit, the back pixels then, whether this scan reused the outline, and clean still back scans in a row. */ setPositiveAt?:number; setRealAt?:number; setBackLook?:number[]; setBridged?:boolean; setDownScans?:number; awaitingName?:{previous?:string;next:string}; nameRetry?:{attempts:number;nextAt:number}; /** One targeted native-pixel check for a stalled front. */ nameZoomed?:boolean; nameRest?:{card:DetectedQuad;look:number[];since:number}; /** Best crop sharpness since this outline last settled (see sharpOk), the last checked one, and whether this settle already fed the baseline. */ sharpPeak?:number; lastSharp?:number; sharpLearned?:boolean; /** Since when this resting card has shown the reading cue without a name (watcher clock); see IDENTIFY_DEADLINE_MS. */ identifyingSince?:number; /** Set for one deadline prompt: the gallery was already asked, so emit must not turn the track into a quiet dismissal. */ askAnyway?:boolean; /** Look of the last confident, still outline of this card with no hand over it (never a kept outline's: those may show an empty cell). */ realLook?:number[]; /** "Resting on the mat" test for a new card (see planeVerdict): consecutive samples on the plane, still, with no hand contact. */ rest?:RestState; /** Last outline of this card that lay on the mat plane (a real card's spot when a later outline is a hand or a lifted card). */ restQuad?:DetectedQuad; /** Scan field: a plausible detector box matched this track in one of the two scan passes. */ scanHit?:boolean; /** A still face-down outline whose pixels stay undecided (a plain white sleeve), since when. */ backWaitAt?:number; /** Still skin-coloured pixels on a still, confident outline (since when / past HAND_WAIT_MS): print or locked-camera colour, not a hand. */ stillSkinAt?:number; stillSkin?:boolean; under?:string; /** Orientation of the last outline that showed this card's own look. */ lookUpright?:boolean; softDismiss?:boolean; faceWaitAt?:number; frontScans?:number; dismissedMissAt?:number; rearms?:number; userDismissed?:boolean; handWaitAt?:number; unsureReads?:number; fullMisses?:number; fullMissAt?:number; early?:{card:DetectedQuad;art?:number[]}; confirming?:boolean; rereadEarly?:boolean; prevArt?:number[]; curArt?:number[]; reason?:string; selfSetAt?:number; upSince?:number; setRecovery?:boolean; timing?:FieldTiming; timingOpen?:boolean; placeholder?:boolean; placeholderId?:string; previewEligible?:boolean; clearCandidate?:boolean; clearCandidateAt?:number; face?:FaceEvidence; pose?:PendingPose; view:FieldTrack; anchor:DetectedQuad; announced?:DetectedQuad; announcedZone?:FieldZone; announcedPosition?:FieldTrack['position']; reappeared?:boolean; identityAppearance?:number[]; identityEmbedding?:RecognitionResult['identityEmbedding']; latestEmbedding?:RecognitionResult['identityEmbedding']; lastResult?:RecognitionResult; identityCheck?:IdentityCheck; resolvedAt?:number; prompted?:boolean; newOutline?:boolean; binding?:KnownFieldCard; promptOnly?:FieldEvent['reason']; missed:boolean; halo?:number[]; appearance?:number[]; stableSince:number; observations:number; moveAt?:number; restoredAt?:number; missingSamples:number; missingAt?:number; clearWindowAt?:number; best?:{frame:FieldFrame;card:DetectedQuad;score:number;crop?:RGBAImage}; kind:DetectedQuad['kind']; position:FieldTrack['position']; needsRead:boolean; read?:PendingRead }
// Periodic full scans backstop scene-change pacing. Busy/hidden ticks skip inference.
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
/** Repeated sharp, hand-free misses can outlast a moving shadow, never actual blur. */
const DEPARTURE_HOLD_MS=1500,EMPTY_ZONE_HOLD_MS=800,DEPARTURE_SCANS=3;
const READ_CACHE_MS=1500,READ_CACHE_DIFF=.0004;
/** Sparse RGB samples from the exact frame and crop the reader received. */
function readFingerprint(crop:RGBAImage|undefined):number[]|undefined {
  if(!crop||crop.width<8||crop.height<12)return;
  const {width,height,data}=crop,look:number[]=[];
  for(let y=0;y<12;y++)for(let x=0;x<8;x++){
    const i=(Math.floor((y+.5)*height/12)*width+Math.floor((x+.5)*width/8))*4;
    look.push(data[i]/255,data[i+1]/255,data[i+2]/255);
  }
  return look;
}
/** A candidate with no outline for this long, or an outline larger than ~2 zones, expires. */
/** A candidate with no outline expires after 1.5 s; while a hand or arm is over its cell it waits up to 6 s, keeping its rest and read progress. */
const CANDIDATE_EXPIRE_MS=1500,CANDIDATE_ARM_MS=6000,MAX_ZONE_AREAS=2.5;
/** A resting card that showed the reading cue may stay a candidate this long (twice while a hand or its read is pending); then it becomes a prompt. */
const IDENTIFY_DEADLINE_MS=8000;
/** Dismissals expire after sustained detector absence; automatic retries stay bounded until Scan field. */
const DISMISSED_EXPIRE_MS=3000,MAX_REARMS=3;
/** Maximum gap for a lifted field card to come back as the same Set. */
export const FIELD_SET_RETURN_MS=10_000;
/** Blur gate: a frame below this share of the recent sharpness baseline is blurred; removals hold until BLUR_SETTLE_MS after. */
const BLUR_RATIO=.55,BLUR_SETTLE_MS=500,BLUR_RELEARN_MS=1500;
/** Card read gate: a crop is read from this sharpness (a good camera). A soft camera or a dim room learns a lower limit (SHARP_SHARE of the
 *  crop sharpness seen on still front cards), never below SHARP_FLOOR (a crop with almost no detail is never read) and never above SHARP_LIMIT.
 *  A card still and clean for SHARP_STILL_MS that scores near its own best may be read from the floor: it will not get sharper. */
const SHARP_LIMIT=12,SHARP_FLOOR=5,SHARP_SHARE=.6,SHARP_LEARN_MIN=3,SHARP_STILL_MS=1200,SHARP_PEAK_SHARE=.7;
const distance=(a:DetectedQuad,b:DetectedQuad)=>{const x=fieldCenter(a),y=fieldCenter(b);return Math.hypot(x.x-y.x,x.y-y.y);};
const mat:DetectedQuad={kind:'face-up',confidence:1,partial:false,quad:[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:1}]};
const copy=(track:FieldTrack):FieldTrack=>({...track,card:structuredClone(track.card)});
// CPU scans can be 800–900 ms apart. Keep consecutive clean face samples across
// that cadence; resetFace still interrupts them on motion, contact and misses.
const trackFaceGate=()=>createFaceStateHysteresis({sustainMs:120,minSamples:3,maxGapMs:1500});
const trackSetFaceGate=()=>createFaceStateHysteresis({sustainMs:60,minSamples:2,maxGapMs:1500});
/** A face-down outline: from .4, or a light sleeve in a calibrated field cell from the decode floor (its sleeve colour already differs from the mat). */
const backOutline=(card:DetectedQuad)=>card.kind==='face-down'&&(card.confidence>=.4||!!card.cell);
// A sure read from a closed set (deck list, cards seen this duel) already cleared its own .80 floor, an off-list guard and the catalog check.
/** Lowest top score that names a new sideways card; below it the player is asked. A holo sideways card under glare matched a
 * wrong card at .748 to .750 depending on the frame, while correct sideways names in the replay clips scored .751 to .793.
 * No limit separates them: this one keeps a .02 gap above the wrong read and turns the weakest correct ones into a question. */
// Spend another window only on a fast first read; a slow device keeps the ordinary one-frame path.
const NAME_VOTE_FIRST_READ_MS=500,NAME_VOTE_WINDOW_MS=420,NAME_VOTE_SAMPLE_MS=100;
/** Pile tops (GY, Banished) are log entries read at once: no name vote, and the GY (never face-down) waits only 100 ms for the face gate, so a send is named about one read after the card rests. */
const PILE_FACE_WAIT_MS=100,pileZone=(zone:string)=>zone==='GY'||zone==='BANISHED';
const NAME_RETRY_MIN_MS=1000,NAME_RETRY_ATTEMPTS=4,NAME_ZOOM_DELAY_MS=800;
export const SIDEWAYS_NAME_MIN=.77;
export const weakSidewaysRead=(r:RecognitionResult|undefined,position:FieldTrack['position'])=>!!r&&position==='defense'&&r.tier!=='low match'&&!r.quality.faceDown&&(r.candidates[0]?.score??0)<SIDEWAYS_NAME_MIN;
const closedRead=(r:RecognitionResult)=>r.tier==='sure'&&['deck','dynamic','likely'].includes(r.quality.searchSource??'');
const deckZone=(zone:FieldZone):zone is 'DECK'|'EXTRA'=>zone==='DECK'||zone==='EXTRA';
/** Median RGB of a flat [r,g,b,...] list. */
const medianColour=(pixels:number[])=>[0,1,2].map(c=>{const v=pixels.filter((_,i)=>i%3===c).sort((a,b)=>a-b);return v[Math.floor(v.length/2)];});
/** Mean channel gap between the median colour inside an outline and of the mat ring around it, from which a weak pile outline is a sleeve, not empty mat. */
const PILE_SLEEVE_GAP=.08;
/** Resting test: limits on the mapped size (one cell = 1, or the learned size of cards resting on this mat), opposite-edge tilt
 * (degrees) and length ratio, and the share inside one cell. A card passes REST_SAMPLES samples in a row over REST_MS. */
const REST_CELL_LIMIT=1.2,REST_CELL_HARD=1.35,REST_SIZE_LIMIT=1.2,REST_SIZE_HARD=1.35,REST_TILT=14,REST_TILT_HARD=25,REST_SIDES=.78,REST_SIDES_HARD=.6,REST_CELL_SHARE=.35,REST_SAMPLES=2,REST_MS=100,REST_PRINT_MS=1500;
/** Edge-connected skin, not nearby skin. A timeout can ask the player, never release this gate. */
const HAND_CONTACT_MAX=.02,DECK_CONTACT_MS=200,HAND_CONTACT_PROMPT_MS=10_000;
const EXPOSED_MAT_CONTACT_MAX=.12;
/** A new card that rests on the mat (hand released) gets at most this long of urgent ticks before its first read: no moving-scene rest, no backoff, no slowed sampling, and `cpuBusy(true)` instead of `cpuBusy()`. */
const URGENT_MS=1500;
/** A Deck/Extra pile stays while its spot still looks like it or a hand is over it; it goes after this long without either. */
const PILE_GONE_MS=5000;
/** Mean channel gap between the median colours of two flat pixel lists, no exposure shift allowed (Infinity when either is unusable). */
const medianGap=(a?:number[],b?:number[])=>{
  if(!a?.length||a.length%3||!b?.length||b.length%3)return Infinity;
  const x=medianColour(a),y=medianColour(b);return (Math.abs(x[0]-y[0])+Math.abs(x[1]-y[1])+Math.abs(x[2]-y[2]))/3;
};
const sleeveOnMat=(inside?:number[],halo?:number[])=>{const gap=medianGap(inside,halo);return gap!==Infinity&&gap>=PILE_SLEEVE_GAP;};
/** A box under .4 is a back only as a plain sleeve: one colour over most of it (glare on art, an arm or a dark object do not qualify when
 * they are not flat), clearly unlike the mat around it, and light: a score that low comes from white sleeves, while a flat dark object looks like a dark sleeve. */
const BLIND_PAD=.15,SET_STEADY_SCANS=3,PILE_BLIND_HOLD=5,SET_BRIDGE_MS=1200,SET_BRIDGE_LOOK=.05,WEAK_BACK_REST_MS=800,WEAK_SLEEVE_GAP=.15,WEAK_SLEEVE_FLAT=.85,WEAK_SLEEVE_NEAR=.12,WEAK_SLEEVE_LIGHT=.5;
const SET_FOLLOW_UP_MS=1000,SET_FOLLOW_UP_WINDOW_MS=8000,PILE_BLIND_STALE_MS=2000;
/** The middle of an 8x12 look (cell or outline pixels, flat RGB list): hands and printed edges at the border do not count. */
const centreLook=(look?:number[])=>{if(look?.length!==8*12*3)return undefined;const out:number[]=[];for(let y=3;y<9;y++)for(let x=2;x<6;x++)out.push(...look.slice((y*8+x)*3,(y*8+x)*3+3));return out;};
const centreChroma=(look?:number[])=>{
  const centre=centreLook(look);if(!centre)return undefined;
  const rgb=medianColour(centre),sum=rgb.reduce((a,b)=>a+b,0);
  if(sum>.12)return rgb.map(v=>v/sum);
};
/** Tone does not decide: with the zone's empty-mat look known, a flat sleeve of any tone (dark, mid or light) only has to differ from that mat;
 * glare turns one green sleeve bright in one zone and dark in the next. Without that look a dark flat object cannot be told from a dark mat edge. */
const plainSleeve=(inside:number[]|undefined,halo:number[]|undefined,baseline?:number[])=>{
  if(!inside?.length||inside.length%3||!halo?.length||halo.length%3)return false;
  const a=medianColour(inside),b=medianColour(halo);
  if(baseline?.length){if(medianGap(baseline,inside)<PILE_SLEEVE_GAP||!sleeveOnMat(inside,halo))return false;}
  else{
    if((Math.abs(a[0]-b[0])+Math.abs(a[1]-b[1])+Math.abs(a[2]-b[2]))/3<WEAK_SLEEVE_GAP)return false;
    if((a[0]+a[1]+a[2])/3<WEAK_SLEEVE_LIGHT)return false;
  }
  let near=0;for(let i=0;i<inside.length;i+=3)if(Math.max(Math.abs(inside[i]-a[0]),Math.abs(inside[i+1]-a[1]),Math.abs(inside[i+2]-a[2]))<=WEAK_SLEEVE_NEAR)near++;
  return near*3/inside.length>=WEAK_SLEEVE_FLAT;
};
const publicPile=(zone:string):zone is 'GY'|'BANISHED'=>zone==='GY'||zone==='BANISHED';
const fieldSlot=(zone:string):zone is Extract<FieldZone,`${'M'|'S'|'EMZ'}${number}`|'FIELD'>=>/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone);
export const FIELD_ACTIVITY_WINDOW_MS=300;
const setFollowUpZone=(zone:string):zone is Extract<FieldZone,`${'M'|'S'}${number}`>=>/^[MS][1-5]$/.test(zone);
const ZOOM_RETRY_MS=500,ZOOM_DECK_HOLD_MS=1500,ZOOM_SLOW_MS=200;
const ZOOM_FULL_WAIT_MS=800,ZOOM_MISS_WINDOW_MS=10_000,ZOOM_MISS_LIMIT=2;
const CELL_CHANGE_HOLD_MS=2200;
interface CellZoomState {
  /** A continuous run of sharp, quiet, unobstructed samples of this look. */
  settle?: {look:number[];since:number};
  /** The last successfully sampled look, including a crop without a card. */
  checkedLook?: number[];
  missedLook?: number[];
  emptyZooms?: number[];
  emptyZoom?: {look:number[];passes:number};
  waitingAt?: number;
  attemptedAt?: number;
  retryAt?: number;
  handAt?: number;
  motionAt?: number;
}
/** A sleeve can reflect light unevenly, so only require a flat patch across half the cell centre. */
const zoomSleeveLook=(centre:number[])=>{
  const median=medianColour(centre);
  let flat=0;
  for(let i=0;i<centre.length;i+=3){
    const gap=Math.max(Math.abs(centre[i]-median[0]),Math.abs(centre[i+1]-median[1]),Math.abs(centre[i+2]-median[2]));
    if(gap<=WEAK_SLEEVE_NEAR)flat++;
  }
  return flat*6>=centre.length;
};
const sameZoomLook=(a?:number[],b?:number[])=>sameFieldAppearance(a,b)&&medianGap(a,b)<=SET_BRIDGE_LOOK;
const fieldZoneName=(zone:string)=>/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone);
const overlapFraction=(a:FractionalBox,b:FractionalBox)=>Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y))/Math.max(1e-9,Math.min(a.w*a.h,b.w*b.h));
/** Share of a card quad that lies inside the camera frame (its box clipped to the picture). Below this the zone cannot be judged. */
const MIN_VISIBLE=.5;
const visibleShare=(quad:DetectedQuad['quad']):number=>{const b=boundsOf(quad),area=b.w*b.h;if(!(area>0))return 1;const w=Math.max(0,Math.min(1,b.x+b.w)-Math.max(0,b.x)),h=Math.max(0,Math.min(1,b.y+b.h)-Math.max(0,b.y));return w*h/area;};
/** Owner-only caller, native frame buffer. One detector/read at a time; no AI or uploads. */
export function createFieldWatcher(options:FieldWatcherOptions) {
  let backgroundReadAfter=-Infinity;
  const now=options.now??(()=>performance.now()),analyze=options.analyze??createFieldAnalyzer(),clone=options.clone??cloneFieldFrame;
  const hidden=options.hidden??(()=>typeof document!=='undefined'&&document.hidden);
  const stableMs=Math.max(300,Math.min(600,options.stableMs??300)),removalMs=Math.max(150,options.removalMs??200);
  const budget=Math.max(.05,Math.min(.5,options.cpuBudget??.2)),maxTracks=Math.max(1,Math.min(60,options.maxTracks??20));
  const gallery=options.gallery??createFieldIdentityGallery();
  let setGuards={...DEFAULT_SET_GUARDS,...options.setGuards};
  const setMemory=options.setCardMemory??newSetCardMemory(),setLooks=new WeakMap<InternalTrack,number[]>(),setWait=new WeakMap<InternalTrack,number>();
  const contactWait=new WeakMap<InternalTrack,HandContactWait>(),handPrompts=new WeakSet<InternalTrack>();
  const departureChecks=new WeakSet<InternalTrack>();
  const gripWait=new WeakSet<InternalTrack>();
  const exposedTops=new Map<InternalTrack,{bottom:string;since:number;scans:number}>();
  const sourceMisses=new WeakMap<InternalTrack,{quad:DetectedQuad;count:number;at:number}>();
  const beforeContact=new WeakMap<InternalTrack,{card:DetectedQuad;look:number[]}>();
  let startupBoxes:DetectedQuad['quad'][]|undefined;
  let startupAppearance:FieldAnalysis['appearance'];
  const startupTracks=new WeakSet<InternalTrack>(),setObserved=new WeakSet<InternalTrack>();
  const heldReader=createHeldCardReader(options);
  const tracks:InternalTrack[]=[],listeners=new Set<(event:FieldEvent)=>void>(),updates=new Set<()=>void>(),retained=new Set<FieldFrame>();
  const glareSamples=new WeakMap<InternalTrack,FieldGlareSample & {revision?:number;candidates?:FieldGlareNotice['candidates']}>();
  // Deck stacks are observations, never physical field tracks or identity reads.
  const pilePresence=new Map<FieldZone,{misses:number;present:boolean;firstMiss?:number;look?:number[]}>();
  /** `look`: the pile's spot while nothing covered it (retention). `keptAt`: last outline, or last sample whose spot still showed the pile or a hand over it. `backs`: still back-class samples the face classifier left undecided (plain white sleeves). */
  const piles=new Map<'DECK'|'EXTRA',{gate:ReturnType<typeof createFaceStateHysteresis>;card:DetectedQuad;at:number;firstSeen:number;down:boolean;appearance?:number[];look?:number[];keptAt:number;backs:number}>();
  const metrics:FieldMetrics={detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0};
  // Detector budget (see field-pacer.ts): both backends follow the frame's scene evidence.
  const device=fieldPacerDevice(),pacer=createFieldPacer(device,now(),()=>options.recognizer.detectorBackend);let pacing=false,pacedStill=false,lastShadowPassAt=-Infinity,budgetWaitAt=-Infinity,lastSceneChangeAt=-Infinity,forcePass=false;
  /** One console warning per distinct failure, with its cause: the badge only shows "Watcher unavailable". */
  const warned=new Set<string>();
  const warnOnce=(where:string,message:string,cause:unknown)=>{const key=`${where}:${message}`;if(warned.has(key))return;warned.add(key);console.warn(`[field watcher] ${where} failed:`,message,cause);};
  let status:FieldSnapshot['status']='stopped',error:string|undefined,active=false,disposed=false,inFlight=false,wakeQueued=false,wakeAfterRead=false,epoch=0,serial=0,previousAt=-Infinity,lastFrameAt=-Infinity,lastDetectionAt=-Infinity;
  let timer:ReturnType<typeof setTimeout>|undefined,ema=0,calibration=options.calibration,reading:Promise<void>|undefined,lastReadHeld=false;
  /** Scan field: full passes still to run before the sweep, the pile outlines they saw, and when the last sweep finished. */
  let scanSweep=0,lastScanAt=-Infinity,lastScanBacks:FieldZone[]=[],lastScanOffFrame:FieldZone[]=[];const scanBacks=new Map<FieldZone,number>();const scanPiles=new Map<'DECK'|'EXTRA',DetectedQuad>();
  let scanRequested=false,recentMotion:{region:FractionalBox;at:number;since:number}|undefined,lastFullDetectionAt=-Infinity,deckTouchedAt=-Infinity,extraTouchedAt=-Infinity;
  const pileTouches=new Map<FieldZone,number>(),pileDepartures=new Set<string>();
  let lastFieldActivityAtByZone:Partial<Record<FieldZone,number>>={};
  /** GY/banished cells that show the empty mat (sharp, no hand, no card that still looks like itself), since when. Scan field: the pile cells its passes saw an outline in. */
  const pileClear=new Map<'GY'|'BANISHED',number>(),pileContacts=new Map<'GY'|'BANISHED',number>(),scanPileSeen=new Set<FieldZone>();
  let latestEvidence:FieldAnalysis|undefined,latestEvidenceFrame:FieldFrame|undefined;
  // Shadow (a player leaning over the mat, a light from above): removals hold while it moves.
  let shadowShare=0,shadowMovedAt=-Infinity,shadowHold=false,scanFollowUp=false;
  // Blur (autofocus hunting, motion blur): a blurred frame is never "no outline" evidence.
  let sharpBase=0,sharpNow=0,blurredAt=-Infinity,blurHold=false,blurSince:number|undefined,blurRef=0;
  // Absence needs sharp detail, rather than a timeout relearning missing detail.
  let removalSharpBase=0,removalBlurred=false;
  /** Slow baseline of crop sharpness on still, clean, face-up cards with no hand (follows sharper crops fast, softer ones slowly), and its sample count. */
  let cropBase=0,cropSamples=0;
  const learnCropSharpness=(score:number)=>{
    if(score<SHARP_FLOOR)return;
    cropBase=cropBase<=0?score:score>cropBase?cropBase*.7+score*.3:cropBase*.95+score*.05;cropSamples++;
  };
  /** The card read limit now: 12 until a few still fronts were seen, then SHARP_SHARE of their baseline, between the floor and 12. */
  const sharpLimit=()=>cropSamples<SHARP_LEARN_MIN?SHARP_LIMIT:Math.min(SHARP_LIMIT,Math.max(SHARP_FLOOR,SHARP_SHARE*cropBase));
  /** May this crop sharpness be read? Above the limit, or (still and clean for SHARP_STILL_MS, near its own best, above the floor) because it will not get sharper. */
  const sharpOk=(t:InternalTrack,score:number,at:number)=>{
    if(score>(t.sharpPeak??0))t.sharpPeak=score;t.lastSharp=score;
    // A blurred frame (focus hunting) lowers every crop for a moment: never read below the full limit then.
    if(blurHold)return score>=SHARP_LIMIT;
    if(score<SHARP_FLOOR)return false;
    return score>=sharpLimit()||Number.isFinite(t.stableSince)&&at-t.stableSince>=SHARP_STILL_MS&&score>=SHARP_PEAK_SHARE*(t.sharpPeak??score);
  };
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
  const removalHold=(card?:DetectedQuad)=>removalBlurred||blurHold||(card?shadowOver(card):shadowHold);
  const handOver=(evidence:FieldAnalysis,card:DetectedQuad)=>!!evidence.occluded?.(card)||(evidence.touched?.(card)??0)>HAND_CONTACT_MAX;
  const handContact=(evidence:FieldAnalysis,card:DetectedQuad)=>handOver(evidence,card)||evidence.edgeGrip?.(card)==='grip';
  /** Admission also waits for nearby skin; departure judges the actual source footprint. */
  const handNear=(evidence:FieldAnalysis,card:DetectedQuad)=>handContact(evidence,card)||(evidence.skinNear?.(card)??0)>.04;
  // Field twins with no live track: zone misses in full scans, and refs found missing.
  const twinMisses=new Map<string,{misses:number;at:number;emits:number;emittedAt?:number}>(),missingTwins=new Set<string>();
  /** Illumination-invariant: the card's own texture is still on its spot under lower light. */
  const shadedKeeps=(t:InternalTrack,evidence:FieldAnalysis)=>shadowShare>=.03&&sameShadedFieldAppearance(t.identityAppearance??t.appearance,evidence.appearance?.(t.view.card));
  const readCells=()=>fieldZoneCells(options.format,calibration?.zoneSpacing,calibration?.zones);
  let cameraCells=readCells(),cellQuads=new WeakMap<object,DetectedQuad>();
  const cellQuad=(cell:{x:number;y:number;w:number;h:number}):DetectedQuad=>{
    const cached=cellQuads.get(cell);
    if(cached)return cached;
    const box:DetectedQuad={quad:[{x:cell.x,y:cell.y},{x:cell.x+cell.w,y:cell.y},{x:cell.x+cell.w,y:cell.y+cell.h},{x:cell.x,y:cell.y+cell.h}].map(p=>calibration?fieldMatPoint(p,calibration):p),kind:'face-up',confidence:1,partial:false};
    cellQuads.set(cell,box);
    return box;
  };
  const fieldCells=()=>calibration?cameraCells:[];
  /** Frame area of one field zone (median), for the "larger than two zones" outline check. */
  const zoneArea=()=>{const areas=fieldCells().filter(c=>fieldZoneName(c.zone)).map(c=>{const b=boundsOf(cellQuad(c).quad);return b.w*b.h;}).sort((a,b)=>a-b);return areas.length?areas[Math.floor(areas.length/2)]:undefined;};
  /** Lower-score outlines: settled or automatically dismissed tracks, and field twins with no live track. */
  const keepOutlines=(shadowOnly=false)=>{
    // Only a quad that lies on the mat plane: a stale box over an arm or a held card must not keep weak outlines alive.
    const quads=tracks.filter(t=>!t.view.removed&&(t.view.state==='identified'||t.view.state==='prompt'||t.placeholder||!shadowOnly&&t.view.state==='dismissed'&&!t.userDismissed)).flatMap(t=>{const q=plausible(t)?t.view.card:shadowOnly?undefined:t.restQuad;return q?[q.quad.map(p=>({...p}))]:[];});
    const cells=fieldCells();
    for(const k of shadowOnly?[]:options.getKnownCards?.()??[])if(k.zone!=='HAND'&&fieldZoneName(k.zone)&&!tracks.some(t=>!t.view.removed&&(t.view.id===k.id||t.binding?.id===k.id))){const cell=cells.find(c=>c.zone===k.zone);if(cell)quads.push(cellQuad(cell).quad);}
    return quads.slice(0,60);
  };
  /** Calibrated Deck/Extra cells: the detector returns weaker outlines there (coloured sleeves on a dark mat score low). */
  const pileCells=()=>fieldCells().filter(c=>deckZone(c.zone as FieldZone)).map(c=>({zone:c.zone as 'DECK'|'EXTRA',quad:cellQuad(c).quad}));
  /** A candidate that lost its outline (or never was card-sized) expires; a provisional placeholder is taken back. */
  const expireCandidate=(t:InternalTrack,why:string)=>{note(t,why);if(t.placeholder&&!t.view.removed){t.view.removed=true;t.view.visible=false;t.view.state='dismissed';emit('removed',t);}const i=tracks.indexOf(t);if(i>=0)tracks.splice(i,1);t.best=undefined;t.read=undefined;};
  // "Resting on the mat": depth cues from one webcam. Through the mat homography a card ON the mat has the same size
  // (in cell units) at every position and keeps parallel opposite edges. A card held above the mat is closer to the
  // camera, so it maps larger; tilted toward the camera, its edges stop being parallel. Sizes are compared with the
  // cards that already rest on this mat (learned), or with one cell before any card rested.
  let restSize:number|undefined;
  const restSizes=new Map<string,number>();
  // A stack sits above the mat and projects larger than a single card. The
  // general resting test tolerates more size variation than Set admission.
  const oversizedSet=(c:DetectedQuad,zone:FieldZone)=>{
    if(!calibration)return false;
    // Just after calibration or the first placement, the old card in this
    // cell may be the only single-card size reference.
    const previous=restSize===undefined?tracks.find(t=>t.view.zone===zone&&t.view.state==='identified'&&t.announced)?.announced:undefined;
    const expected=restSize??(previous&&matRestGeometry(previous,calibration,options.format)?.size);
    if(expected===undefined)return false;
    const size=matRestGeometry(c,calibration,options.format)?.size;
    return size!==undefined&&size>expected*1.1;
  };
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
  const gripping=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis,matched=false)=>{
    const grip=evidence.edgeGrip?.(c);
    if(grip==='grip')gripWait.add(t);else if(matched&&grip!=='near')gripWait.delete(t);
    return gripWait.has(t);
  };
  const observeRest=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis,at:number,cellSince?:number)=>{
    const plane=planeVerdict(c),prev=restPrev.find(p=>quadIou(p.quad,c)>=.84&&distance(p.quad,c)<.012),still=!!prev&&evidence.motion(c)<=.025;
    const grip=gripping(t,c,evidence,true);
    let contact=grip||!t.stillSkin&&!priorRestHolds(t,c,evidence)&&(evidence.touched?.(c)??0)>(setGuards.handRelease?HAND_CONTACT_MAX:.003),contactAt=prev?.contactAt;
    // Skin-coloured print at the edge of a still card (an orange frame under a locked exposure) is not a hand: hands tremble.
    if(contact&&!grip&&still&&evidence.motion(c)<=.01){contactAt??=at;if(at-contactAt>=REST_PRINT_MS)contact=false;}else contactAt=undefined;
    let samples=0,since:number|undefined,text:string;
    if(!plane.ok||contact)text=plane.ok?'held: hand contact':plane.text;
    else if(cellSince!==undefined){samples=REST_SAMPLES;since=cellSince;text='settling';}
    else if(still&&prev!.samples>0&&!contactWait.has(t)){samples=prev!.samples+1;since=prev!.since;text='settling';}
    else{samples=1;since=at;text=prev?'moving':'settling';}
    restNext.push({quad:structuredClone(c),samples,since,contactAt});
    // A card that was just held up (or has a hand on it) is no field card yet: it counts only after it lies still on the mat for stableMs.
    const heldUp=t.view.state==='candidate'&&heldReader.claims(c,at,stableMs);
    const ok=samples>=REST_SAMPLES&&at-(since??at)>=REST_MS&&!heldUp;
    if(heldUp&&samples)text='held up';
    t.rest={samples,since,ok,planeOk:plane.ok,hard:plane.hard,text:ok?'on mat':samples?`${text} ${samples}/${REST_SAMPLES}`:text};
    if(ok)stage(t,'restOk');
    if(plane.ok)t.restQuad=structuredClone(c);
    // Learn single-card size from settled fronts so sleeve scores cannot bias Set geometry.
    if(ok&&calibration&&t.view.state==='identified'&&!t.view.faceDown&&c.kind==='face-up'&&!c.kept&&!c.cell&&!c.partial&&!c.covered&&c.confidence>=.7&&plane.size!==undefined&&plane.size<=REST_CELL_LIMIT&&plane.size>=.3){
      // One vote per identified card: a small outline seen often must not shrink the whole mat's reference.
      restSizes.set(t.view.id,plane.size);
      if(restSizes.size>32)restSizes.delete(restSizes.keys().next().value!);
      const sizes=[...restSizes.values()].sort((a,b)=>a-b),middle=Math.floor(sizes.length/2);
      restSize=sizes.length%2?sizes[middle]:(sizes[middle-1]+sizes[middle])/2;
    }
  };
  /** A new card commits (Reading…, placed, Set, prompt) only once it rests on the mat. */
  const restOk=(t:InternalTrack)=>!!t.rest?.ok;
  const readBeforeRest=(t:InternalTrack,read:PendingRead)=>setGuards.handRelease&&read.moving&&restOk(t)&&t.rest?.since!==undefined&&read.at<t.rest.since+REST_MS;
  const sameContactBox=(a:DetectedQuad,b:DetectedQuad)=>quadIou(a,b)>=.84&&distance(a,b)<.012;
  const interruptContact=(t:InternalTrack)=>{beforeContact.delete(t);if(contactWait.has(t))contactWait.set(t,{state:'held'});};
  const priorRestHolds=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis)=>{
    const previous=beforeContact.get(t);if(!previous)return false;
    if(gripWait.has(t)){beforeContact.delete(t);return false;}
    if(evidence.motion(c)<=.025&&!c.partial&&!c.covered&&planeVerdict(c).ok&&!blurHold&&sameContactBox(previous.card,c)&&sameFieldAppearance(previous.look,evidence.appearance?.(artBox(c))))return true;
    beforeContact.delete(t);return false;
  };
  // Contact never times out into placement. Only a matched outline can establish release or still-contact time.
  // A card already resting before an edge touch keeps that evidence while its footprint and art stay unchanged.
  const observeContact=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis,at:number,matched=false)=>{
    if(!setGuards.handRelease||t.view.state!=='candidate'&&t.promptOnly!=='card-presence'){contactWait.delete(t);beforeContact.delete(t);return;}
    const touched=(evidence.touched?.(c)??0)>HAND_CONTACT_MAX||gripping(t,c,evidence,matched);
    const clean=evidence.motion(c)<=.025&&!c.partial&&!c.covered&&planeVerdict(c).ok&&!blurHold;
    if(priorRestHolds(t,c,evidence))return;
    const look=evidence.appearance?.(artBox(c));
    const wait=contactWait.get(t);
    if(!touched&&(!evidence.occluded?.(c)||t.stillSkin)){
      if(!matched)return;
      if(wait){
        contactWait.delete(t);
        resetFace(t);t.faceWaitAt=undefined;t.backWaitAt=undefined;t.handWaitAt=undefined;
      }
      if(clean&&restOk(t)&&(evidence.touched?.(c)??0)<=.003&&c.confidence>=.7&&!c.kept&&!c.cell&&look?.length)
        beforeContact.set(t,{card:structuredClone(c),look:look.slice()});
      return;
    }
    if(!clean||!touched){contactWait.set(t,{state:'held'});return;}
    if(!matched){if(!wait)contactWait.set(t,{state:'held'});return;}
    contactWait.set(t,wait?.state==='still-held'&&sameContactBox(wait.card,c)?
      {...wait,samples:wait.samples+1}:{state:'still-held',card:structuredClone(c),since:at,samples:1});
  };
  /** The last outline of a track that lay on the plane (its quad now may be a hand, a lifted card or an arm). */
  const plausible=(t:InternalTrack)=>planeVerdict(t.view.card).ok;
  /** An identified card follows an outline off the plane only if it rested before and the outline is a real (not kept/weak) box. */
  const follows=(t:InternalTrack,c:DetectedQuad)=>{
    // A weak box drifting with a pickup is not a new location for the twin.
    // Keep absence checks on the last published field footprint.
    if(bound(t)&&t.announced&&c.confidence<.7&&distance(t.announced,c)>.04)return false;
    return t.view.state!=='identified'||planeVerdict(c).ok||!!t.restQuad&&!c.kept&&!c.cell;
  };
  /** A kept (low-score) or cell-only outline over a track's spot whose pixels no longer show the card: hysteresis, not a card.
   * Never when a hand, a shaded card or motion is over the spot (blur and shadow holds still delay the removal itself), nor when the spot lies mostly outside the frame (no evidence there). */
  const lookRefs=(t:InternalTrack)=>[t.realLook,t.identityAppearance].filter((l):l is number[]=>!!l?.length);
  const couldBeSource=(t:InternalTrack,other:InternalTrack,evidence:FieldAnalysis)=>{
    // A read in flight decides identity: the look can differ after a move (light, turn), so it does not rule the source out before the
    // name is back. An outline that was already there while the source was still seen is another card.
    if(other.read&&!other.read.result&&!other.read.error&&other.view.firstSeen>=t.view.lastSeen-100)return true;
    const refs=lookRefs(t),pixels=evidence.appearance?.(other.view.card);
    return !refs.length||!pixels?.length||refs.some(ref=>sameRotatedFieldAppearance(ref,pixels)||sameShadedFieldAppearance(ref,pixels));
  };
  const ghostOutline=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis)=>{
    if(!c.kept&&!c.cell)return false;
    if(visibleShare(c.quad)<MIN_VISIBLE||handNear(evidence,c)||evidence.motion(c)>.025||shadedKeeps(t,evidence))return false;
    const pixels=evidence.appearance?.(c),halo=evidence.halo?.(c);
    // Still shows the card, or the card itself looks like plain mat (dark sleeve on dark mat): no evidence that it left.
    if(lookRefs(t).some(l=>matchesLook(t,pixels,l)||clearFieldBackground(l,halo)))return false;
    return cellEmpty(evidence,t.view.zone)||clearFieldBackground(evidence.background?.(c)??pixels,halo);
  };
  // Empty-mat baseline: the look of each zone cell while nothing was there (no outline, track, known card or hand in
  // three full scans in a row). A cell that looks like its baseline is empty, whatever the detector or a stale track says.
  const emptyLooks=new Map<string,{look:number[];halo?:number[];pending?:number[];passes:number;appearance?:FieldAnalysis['appearance']}>();
  const cellOf=(zone:string)=>{const cell=fieldCells().find(c=>c.zone===zone);return cell?cellQuad(cell):undefined;};
  /** The cell centre is far from its learned mat tone (a sleeve, not a light change): the centre's shift since the baseline minus the shift of the mat ring
   * around the cell, per channel, so a lamp or daylight step cancels out. False when either look is unusable. */
  const unlikeMat=(base:{look:number[];halo?:number[]}|undefined,look?:number[],halo?:number[])=>{
    const a=centreLook(base?.look),b=centreLook(look);if(!a||!b)return false;
    const x=medianColour(a),y=medianColour(b),h=base?.halo&&halo?.length&&halo.length%3===0?medianColour(halo):undefined;
    const gap=[0,1,2].reduce((sum,c)=>sum+Math.abs(y[c]-x[c]-(h?h[c]-base!.halo![c]:0)),0)/3;
    return gap>=PILE_SLEEVE_GAP;
  };
  const cellEmpty=(evidence:FieldAnalysis,zone:string,checkHand=true)=>{
    const base=emptyLooks.get(zone),box=cellOf(zone);if(!base?.look.length||!box)return false;
    const look=evidence.appearance?.(box);
    // The shift-tolerant match reads any flat colour as flat mat, so a plain sleeve on a Spell/Trap, Deck or Extra cell would count as empty: its tone must be the mat's too.
    if(/^(S[1-5]|DECK|EXTRA)$/.test(zone)&&unlikeMat(base,look,evidence.halo?.(box)))return false;
    return (!checkHand||!handNear(evidence,box))&&evidence.motion(box)<=.025&&sameFieldAppearance(base.look,look);
  };
  /** A still Spell/Trap cell that differs from its learned empty mat for SET_STEADY_SCANS full scans can supply a Set outline from its pixels.
   * Only a settled track or a known card still on the cell can block this check. A raw detector outline is not evidence the cell is occupied.
   * A Deck/Extra cell works the same without the track and known-card checks (a deck list is known there): a still, hand-free cell unlike its empty mat for
   * SET_STEADY_SCANS full scans, and no usable detector outline over it, gets a face-down pile outline from the sleeve edges. Pile outlines
   * outlive a few failed edge scans (PILE_BLIND_HOLD) so a stack the detector finds only now and then does not flicker. */
  const blindScans=new Map<string,number>(),blindShape=new Map<string,DetectedQuad>(),blindMisses=new Map<string,number>();
  const blindZones=new Set<FieldZone>(),handZones=new Set<FieldZone>(),blindCountAt=new Map<string,number>();
  const blindSleevesSeen=new Map<FieldZone,{at:number;since:number;look:number[]}>(),setFollowUpAt=new Map<FieldZone,number>();
  const zoomPendingZones=new Set<FieldZone>(),zoomDeparturePending=new Set<FieldZone>(),zoomCheckedAt=new Map<FieldZone,number>();
  const zoomCells=new Map<FieldZone,CellZoomState>();
  const clearEmptyZoom=(state:ReturnType<typeof zoomCells.get>)=>{
    if(state?.emptyZoom)state.emptyZoom=state.missedLook=undefined;
  };
  const completeCellCheck=(zone:FieldZone)=>{
    zoomCheckedAt.set(zone,now());
    zoomPendingZones.delete(zone);
    zoomDeparturePending.delete(zone);
  };
  const stackLooks=new Map<FieldZone,number[]>();
  let zoomDeckAt=-Infinity,zoomDeckGone=false,zoomDeckContactSince:number|undefined;
  const departureAt=(track:FieldTrack)=>track.removedAt??track.lastSeen;
  /** The pixel boundary can extend past the detector's top outline on a thick stack. */
  const flatSleeveQuad=(box:DetectedQuad,evidence:FieldAnalysis)=>{
    const map=quadMap(box.quad as Quad);if(!map)return;
    const wide:Quad=[map(-BLIND_PAD,-BLIND_PAD),map(1+BLIND_PAD,-BLIND_PAD),map(1+BLIND_PAD,1+BLIND_PAD),map(-BLIND_PAD,1+BLIND_PAD)];
    const crop=evidence.crop?.({quad:wide,kind:'face-down',confidence:1,partial:false}),found=crop&&findFlatSleeve(crop,BLIND_PAD),back=quadMap(wide);
    if(!found||!back)return;
    return [back(found.u0,found.v0),back(found.u1,found.v0),back(found.u1,found.v1),back(found.u0,found.v1)];
  };
  const sleeveInterior=(card:DetectedQuad):DetectedQuad=>{
    const map=quadMap(card.quad as Quad);
    return map?{...card,quad:[map(.08,.08),map(.92,.08),map(.92,.92),map(.08,.92)]}:card;
  };
  const stackStillThere=(zone:FieldZone,evidence:FieldAnalysis,box=cellOf(zone))=>{
    const previous=stackLooks.get(zone);
    if(!previous||!box)return false;
    const look=evidence.appearance?.(box);
    return sameFieldAppearance(previous,look)&&medianGap(previous,look)<.1;
  };
  const stackFootprint=(c:DetectedQuad,zone:FieldZone,evidence:FieldAnalysis,box=cellOf(zone))=>{
    if(!options.zoomSets||!calibration||!box||!setFollowUpZone(zone))return false;
    if(stackStillThere(zone,evidence,box))return true;
    const boundary=flatSleeveQuad(box,evidence);
    if(!boundary||quadIou(c,{...c,quad:boundary})<.5)return false;
    const footprint=matRestGeometry({quad:boundary},calibration,options.format);
    const single=tracks.find(t=>t.view.zone===zone&&t.view.state==='identified'&&!t.view.faceDown)?.announced;
    const expected=(single&&matRestGeometry(single,calibration,options.format)?.size)??restSize;
    // In the measured M4 sequence the visible footprint grows from .778 to .886–.920
    // as the stack lands. The detector often returns only the smaller top face.
    if(!footprint||footprint.size<=Math.min(.95,Math.max(.82,(expected??0)*1.07)))return false;
    const look=evidence.appearance?.(box);
    if(look?.length)stackLooks.set(zone,look);
    return true;
  };
  const blindSleeves=(evidence:FieldAnalysis,detected:DetectedQuad[],cardAspect:(c:DetectedQuad)=>boolean,at:number):DetectedQuad[]=>{
    const out:DetectedQuad[]=[],known=options.getKnownCards?.()??[];
    for(const cell of fieldCells()){
      const zone=cell.zone,pile=zone==='DECK'||zone==='EXTRA';if(!pile&&!setFollowUpZone(zone))continue;
      const box=cellQuad(cell),hand=handNear(evidence,box);
      if(!pile){if(hand)handZones.add(zone);else handZones.delete(zone);}
      if(zone.startsWith('M'))continue;
      const entry=emptyLooks.get(zone),base=entry?.look,b=boundsOf(box.quad),look=evidence.appearance?.(box);
      const still=!hand&&evidence.motion(box)<=.025;
      // A known card whose own track was removed from this cell (a face-up card flipped Set in place) does not block the scan, unless a GY/banished pile was touched around its removal (the card went there).
      const gone=(k:KnownFieldCard)=>tracks.some(t=>t.view.removed&&t.view.zone===zone&&(t.view.id===k.id||t.binding?.id===k.id)&&
        !(['GY','BANISHED'] as const).some(z=>(pileTouches.get(z)??-Infinity)>=departureAt(t.view)-1500));
      const clear=!!base?.length&&!!look?.length&&(pile||!tracks.some(t=>!t.view.removed&&t.view.zone===zone&&t.view.state==='identified'&&!t.view.card.cell)&&!known.some(k=>k.zone===zone&&!gone(k)))&&
        still&&unlikeMat(entry,look,evidence.halo?.(box));
      const previousSleeve=blindSleevesSeen.get(zone);
      if(!pile){blindSleevesSeen.delete(zone);if(clear)blindZones.add(zone);else blindZones.delete(zone);}
      if(!clear){
        blindScans.delete(zone);blindCountAt.delete(zone);blindShape.delete(zone);blindMisses.delete(zone);
        // A back can already cover the departing front's slot before a detector hit or an empty-mat baseline.
        if(pile||!still||!tracks.some(t=>t.view.zone===zone&&t.view.removed&&!t.view.faceDown&&
          at>=departureAt(t.view)&&at-departureAt(t.view)<=SET_FOLLOW_UP_WINDOW_MS))continue;
      }
      // A shadow or blur over the cell pauses the count; it does not reset it.
      if(removalHold(box)){if(blindCountAt.has(zone))blindCountAt.set(zone,now());continue;}
      // Spell/Trap evidence counts consecutive full passes, which CPU pacing can separate by seconds.
      // Keep the pile count's existing idle timeout.
      const stale=pile&&now()-(blindCountAt.get(zone)??-Infinity)>PILE_BLIND_STALE_MS,scans=(stale?0:blindScans.get(zone)??0)+1;
      if(clear)blindScans.set(zone,scans);
      if(pile){blindCountAt.set(zone,now());if(scans<SET_STEADY_SCANS)continue;}
      // A detector outline decides a pile; the pixel outline only fills in when it is missing.
      if(pile&&detected.some(c=>overlapFraction(boundsOf(c.quad),b)>=.2))continue;
      const old=blindShape.get(zone),hold=()=>{
        const misses=(blindMisses.get(zone)??0)+1;blindMisses.set(zone,misses);
        if(pile&&old&&misses<=PILE_BLIND_HOLD)out.push(structuredClone(old));else blindShape.delete(zone);
      };
      const quad=flatSleeveQuad(box,evidence);
      if(!quad){if(clear)hold();continue;}
      const fresh:DetectedQuad=pile?{quad,kind:'face-down',confidence:.3,partial:false,pile:true,blind:true}:{quad,kind:'face-down',confidence:.3,partial:false,cell:true,blind:true};
      // The same sleeve keeps one outline (pixel edges jitter by a pixel or two).
      // A still deck box or card case is flat and edged too: only about one card in shape counts.
      // Visual only: a plain deck box (about .74 ratio) can still pass this card-aspect check.
      if(!cardAspect(fresh)){if(clear)hold();continue;}
      if(!pile){
        if(!clear){blindZones.add(zone);continue;}
        const same=previousSleeve&&medianGap(previousSleeve.look,look)<=SET_BRIDGE_LOOK&&sameFieldAppearance(previousSleeve.look,look);
        blindSleevesSeen.set(zone,{at,since:same?previousSleeve.since:at,look:look!});
        if(scans<SET_STEADY_SCANS)continue;
      }
      // The pixel outline owns the same footprint if the detector also boxed
      // it. Keep other outlines so overlap and hand checks still apply.
      if(!pile)for(let i=detected.length-1;i>=0;i--)if(quadIou(detected[i],fresh)>=.5)detected.splice(i,1);
      blindMisses.delete(zone);
      const shape=old&&quadIou(old,fresh)>=.8?old:fresh;blindShape.set(zone,shape);out.push(structuredClone(shape));
    }
    return out;
  };
  /** A GY/banished cell is clear: a sharp frame, no hand or moving shadow over it, no card there that still looks like
   * itself, and the cell looks like its empty-mat baseline or like plain mat. A blurred frame is never clear. */
  const pileCellClear=(evidence:FieldAnalysis,zone:'GY'|'BANISHED')=>{
    const box=cellOf(zone);if(!box||removalHold(box)||handNear(evidence,box)||evidence.motion(box)>.025)return false;
    if(tracks.some(t=>!t.view.removed&&t.view.visible&&t.view.zone===zone&&(!t.identityAppearance?.length||matchesLook(t,evidence.appearance?.(t.view.card)))))return false;
    return cellEmpty(evidence,zone)||clearFieldBackground(evidence.appearance?.(box),evidence.halo?.(box));
  };
  const shadowNote=()=>removalBlurred||blurHold?`blur ${(removalSharpBase>0?sharpNow/removalSharpBase:1).toFixed(2)} · hold`:`shadow ${Math.round(shadowShare*100)}% · hold`;
  // Owner debug overlay: raw detector output and the last decision per track.
  let debug:FieldDebug|undefined;
  /** Last full pass's pile-cell scores; motion-crop passes keep showing them. */
  let lastPileScores:FieldDebug['pileScores'];
  const note=(t:InternalTrack,reason:string)=>{t.reason=reason;};
  /** A GY/Banished top that was seen at rest (a clean read ran or finished on it; see pileSighted) but never got an entry. */
  const pileCandidate=(t:InternalTrack)=>{
    if(!pileZone(t.view.zone)||t.view.state!=='candidate'||t.view.removed||t.binding||t.view.faceDown||t.promptOnly||t.identityCheck||t.view.card.kind!=='face-up')return false;
    const quality=(t.read?.result??t.lastResult)?.quality;
    return !(quality&&(quality.faceDown||quality.fallback||quality.partial||quality.covered));
  };
  const unreadPileTop=(t:InternalTrack)=>!!t.pileSighted&&pileCandidate(t);

  const setDecision=(t:InternalTrack,decision:SetEvidence['decision'],basis?:SetEvidence['basis'])=>{
    const previous=t.view.setEvidence;if(!previous)return;
    t.view.setEvidence={...previous,decision,...(basis?{basis}: {})};
    t.timing??={id:`${session}:set:${t.view.id}`,originAt:epochAt()+t.view.firstSeen,stagesMs:{},durationsMs:{}};
    t.timing.notes={...t.timing.notes,setDecision:decision,setEvidence:JSON.stringify(t.view.setEvidence)};
    options.onSetDecision?.({id:t.view.id,at:epochAt()+now(),zone:t.view.zone,quad:setMatQuad(t.view.card,calibration).quad,guards:{...setGuards},evidence:{...t.view.setEvidence}});
  };
  const rejectObject=(t:InternalTrack,decision:'ignored'|'not-a-card')=>{
    if(setGuards.ignore){ignoreSetRegion(setMemory,setMatQuad(t.view.card,calibration).quad,setLooks.get(t)??(()=>{const crop=latestEvidence?.crop?.(t.view.card);return crop?setCropLook(crop):[];})(),decision==='ignored'?'startup':'player');options.onSetMemoryChange?.();}
    t.userDismissed=true;t.prompted=true;t.view.state='dismissed';t.view.visible=false;t.read=undefined;t.needsRead=false;t.best=undefined;
    setDecision(t,decision);note(t,decision==='ignored'?'setup object ignored':'user said not a card');
  };

  let softCamera=false,softHinted=false,softTrack:InternalTrack|undefined;
  let gridOffPasses=0,gridOffAt=-Infinity,gridShift:{gap:number;outside:number;suspect:boolean}|undefined,lastMotionAt:number|undefined,untracked=0,debugAt=0,debugTick='',emptySince:number|undefined,emptyPasses=0,emptyPassAt=-Infinity;
  const debugPath=(path:string,at:number)=>{debugTick=path;debugAt=at;};
  const suppressed:{card:DetectedQuad;appearance?:number[];halo?:number[];clearAt?:number;samples:number}[]=[];let guarded=false;
  const session=globalThis.crypto?.randomUUID?.()??Math.random().toString(36).slice(2);
  const epochAt=()=>performance.timeOrigin;
  const beginTiming=(t:InternalTrack,at:number)=>{if(t.timingOpen)return;t.timingOpen=true;t.timing={id:`${session}:${++timingSerial}`,originAt:epochAt()+at,stagesMs:{capture:0},durationsMs:{}};};
  const addWait=(t:InternalTrack,name:'read'|'nameVote'|'handGate',ms:number)=>{
    if(t.timingOpen&&t.timing)t.timing.stagesMs[name]=(t.timing.stagesMs[name]??0)+Math.max(0,ms);
  };
  const handTiming=(t:InternalTrack,blocked:boolean,at:number)=>{
    if(blocked)t.handGateAt??=at;
    else if(t.handGateAt!==undefined){addWait(t,'handGate',at-t.handGateAt);t.handGateAt=undefined;}
  };
  const stage=(t:InternalTrack,name:string,at=now())=>{if(t.timing){const value=Math.max(0,epochAt()+at-t.timing.originAt);t.timing.stagesMs[name]??=value;t.timing.stagesMs[`${name}Last`]=value;}};
  let timingSerial=0;
  /** Adds the time since this card's last tick to `hold.<reason>` while it waits for a hand, stillness, sharpness or the read slot. */
  const holdAt=new WeakMap<InternalTrack,Record<string,number>>();
  const hold=(t:InternalTrack,reason:string,at=now())=>{const last=holdAt.get(t)??{};holdAt.set(t,last);const before=last[reason];last[reason]=at;if(t.timing&&t.timingOpen&&before!==undefined&&at-before<500)t.timing.durationsMs[`hold.${reason}`]=(t.timing.durationsMs[`hold.${reason}`]??0)+at-before;};
  // Profile counters on the open timing (reads started/dropped, detector passes, motion resets).
  const count=(t:InternalTrack,name:string)=>{if(t.timing&&t.timingOpen)t.timing.durationsMs[`n.${name}`]=(t.timing.durationsMs[`n.${name}`]??0)+1;};
  const notify=()=>{for(const listener of updates)listener();};
  // Once attached to a twin, only an explicit owner correction changes identity.
  const bound=(t:InternalTrack)=>t.view.state==='identified'&&t.resolvedAt!==undefined;
  const unchangedStartup=(t:InternalTrack,c:DetectedQuad,evidence:FieldAnalysis)=>{
    if(!setGuards.startup||t.resolvedAt!==undefined||t.binding||t.placeholder)return false;
    const current=evidence.appearance?.(c);
    const matches=(initial?:number[])=>sameFieldAppearance(initial,current)||sameShadedFieldAppearance(initial,current);
    if(matches(startupAppearance?.(c)))return true;
    // Printed monster slots repeat. A card can hide this slot at startup;
    // the same unverified pattern in an equal slot still supplies a reference.
    if(!calibration||!/^M[1-5]$/.test(t.view.zone))return false;
    const cells=fieldCells(),cell=cells.find(cell=>cell.zone===t.view.zone);
    if(!cell)return false;
    const mapped=setMatQuad(c,calibration);
    return cells.some(other=>{
      if(other===cell||!/^M[1-5]$/.test(other.zone)||Math.abs(other.w-cell.w)>1e-6||Math.abs(other.h-cell.h)>1e-6)return false;
      // Use the same 2% mat tolerance as remembered Set regions. Keep the
      // appearance threshold unchanged; approximate calibration only shifts it.
      for(const dx of [-.02,-.01,0,.01,.02])for(const dy of [-.02,-.01,0,.01,.02]){
        const q:DetectedQuad={...c,quad:mapped.quad.map(p=>fieldMatPoint({x:p.x+other.x-cell.x+dx,y:p.y+other.y-cell.y+dy},calibration!))};
        if(q.quad.every(p=>p.x>=0&&p.x<=1&&p.y>=0&&p.y<=1)&&matches(startupAppearance?.(q)))return true;
      }
      return false;
    });
  };
  // Detector centres shift as a card turns over or rotates. Retain the settled
  // cell until its centre actually travels, through both face gates and reads.
  const settledZone=(t:InternalTrack,card:DetectedQuad,cards:DetectedQuad[])=>
    t.announced&&t.announcedZone&&(t.resolvedAt!==undefined||t.binding)&&distance(t.announced,card)<=.04
      ?t.announcedZone:mapFieldZone(card,calibration,cards,options.format).zone;
  const matchesLook=(t:InternalTrack,pixels?:number[],look=t.identityAppearance)=>bound(t)?sameRotatedFieldAppearance(look,pixels):sameFieldAppearance(look,pixels);
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
    delete t.view.removedAt;
    delete t.view.removedFrameAt;
    delete t.view.emptyProofAt;
    t.view.state='candidate';t.view.removed=false;t.view.cardId=undefined;t.view.bestMatch=undefined;t.view.revision=(t.view.revision??0)+1;
    t.nameRetry=undefined;t.view.nameCandidates=undefined;t.prompted=false;t.promptOnly=undefined;t.identityCheck=undefined;t.resolvedAt=undefined;t.read=undefined;t.needsRead=true;t.best=undefined;
    t.unsureReads=0;t.rereadEarly=false;t.lastResult=undefined;t.readCache=undefined;t.handWaitAt=undefined;t.faceWaitAt=undefined;t.frontScans=0;t.dismissedMissAt=undefined;t.userDismissed=false;t.softDismiss=false;resetFace(t);resetAbsence(t);note(t,`re-armed: ${why}`);
  };
  const sureName=(result:RecognitionResult|undefined)=>result?.tier==='sure'&&!!result.candidates[0]&&
    !result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&
    result.candidates[0].cardId!==options.profile.cardBack.cardId;
  const nameRetryDue=(t:InternalTrack,at:number)=>!!t.nameRetry&&t.nameRetry.attempts<NAME_RETRY_ATTEMPTS&&
    at>=t.nameRetry.nextAt&&at>=backgroundReadAfter&&!t.view.removed&&!t.read&&!t.userDismissed&&!t.binding&&!t.promptOnly&&!t.identityCheck&&
    (t.view.state==='prompt'||t.view.state==='identified'&&!!t.view.bestMatch);
  const beatsLock=(lock:{score:number},result?:RecognitionResult)=>!!result&&result.tier==='sure'&&(result.candidates[0]?.score??0)>=lock.score+LOCK_MARGIN;
  const emit=(type:FieldEvent['type'],t:InternalTrack,extra:Partial<FieldEvent>={})=>{
    note(t,`${type}${extra.reason?` (${extra.reason})`:''}`);
    // The last detector sighting can predate removal by several seconds. Retries keep the original removal time.
    if(type==='removed'&&fieldSlot(t.view.zone)){
      const cell=zoomCells.get(t.view.zone);
      clearEmptyZoom(cell);
      if(cell&&t.view.removedAt===undefined)cell.emptyZooms=cell.missedLook=undefined;
      t.view.removedAt??=now();
      t.view.removedFrameAt??=Number.isFinite(lastFrameAt)?lastFrameAt:t.view.removedAt;
      if(extra.evidence?.emptyProofAt!==undefined)t.view.emptyProofAt=extra.evidence.emptyProofAt;
      else if(t.view.emptyProofAt!==undefined)extra={...extra,evidence:{basis:'pixel',...extra.evidence,emptyProofAt:t.view.emptyProofAt}};
    }
    if(type==='placed')startupTracks.delete(t);
    if(type==='placed'&&options.backgroundReread!==false&&extra.result&&extra.result.tier!=='sure'&&t.view.bestMatch&&!t.view.faceDown&&fieldSlot(t.view.zone)&&!t.binding&&!t.userDismissed)
      t.nameRetry??={attempts:0,nextAt:now()+NAME_RETRY_MIN_MS};
    if(type==='placed'&&startupBoxes)startupBoxes=startupBoxes.filter(q=>!sameSetRegion(q,setMatQuad(t.view.card,calibration).quad));
    if(type==='placed'&&t.view.cardId&&!t.view.faceDown&&extra.result?.tier==='sure'&&!extra.result.quality.fallback&&!extra.result.quality.covered&&!extra.result.quality.partial&&extra.result.candidates[0]?.cardId===t.view.cardId&&!t.view.bestMatch){
      const lock=lockFor(t.view.id);if(!lock||lock.cardId!==t.view.cardId)locks.set(t.view.id,{cardId:t.view.cardId,score:extra.result.candidates[0].score,at:now(),embedding:extra.result.identityEmbedding,look:t.identityAppearance?.slice()});
    }
    if(type==='prompt'){
      // A fresh front still needs an answer when its Set has a known ref.
      // Neither old public knowledge nor the gallery can answer a low read.
      const presence=extra.reason==='card-presence';
      const reveal=presence||t.binding?.faceDown&&!t.view.faceDown;
      if(!reveal&&t.resolvedAt!==undefined){t.view.state='identified';return;}
      if(!reveal&&t.prompted){t.view.state='dismissed';return;}
      const answer=t.askAnyway?{kind:'new' as const}:gallery.resolve(extra.result?.identityEmbedding);t.askAnyway=undefined;
      if(!reveal&&answer.kind!=='new'){t.prompted=true;t.userDismissed=answer.kind==='match'&&!answer.cardId;t.view.state='dismissed';return;}
      if(options.backgroundReread!==false&&(extra.reason==='uncertain'||extra.reason==='recognition-error')&&!t.binding&&!t.promptOnly&&!t.identityCheck&&!t.view.faceDown&&fieldSlot(t.view.zone)&&!t.userDismissed)
        t.nameRetry??={attempts:0,nextAt:now()+NAME_RETRY_MIN_MS};
      t.prompted=true;t.identityEmbedding=extra.result?.identityEmbedding;t.latestEmbedding=t.identityEmbedding;
    }
    if(type==='placed'&&!t.view.faceDown&&t.view.cardId&&t.face?.front)t.face.reference={crop:t.face.front,embedding:t.identityEmbedding};if(!t.timing)beginTiming(t,t.view.firstSeen);stage(t,'commit');
    const timing=structuredClone(t.timing!);
    const stages=timing.stagesMs;
    stages.commit=stages.commitLast;
    if(stages.read!==undefined&&(extra.result||type==='prompt')){
      const outline=stages.firstOutline??0;
      stages.detectorWait??=stages.detectorDone??outline;
      stages.restGate??=Math.max(0,(stages.restOk??outline)-outline);
      stages.handGate??=0;
      stages.nameVote??=0;
      stages.post=0;
    }else{
      delete stages.read;
    }
    if(timing.stagesMs.searchDoneLast!==undefined)timing.durationsMs['hold.publish']=Math.max(0,timing.stagesMs.commit-timing.stagesMs.searchDoneLast);timing.id+=`:${type}`;metrics.event=timing;metrics.latencyMs=timing.stagesMs.commit;
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
    const removedAt=type==='removed'?t.view.removedAt:undefined;
    const event:FieldEvent={type,track:copy(t.view),...(type==='removed'?departureDestination(t,now()):{}),...(removedAt!==undefined?{removedAt}:{}),...(origin?{fromRef:origin.id}:{}),...(t.placeholderId&&t.placeholderId!==t.view.id?{previousId:t.placeholderId}:{}),...(type==='prompt'&&t.binding?{bindRef:t.binding.id}:{}),source:'auto',...extra,latencyMs:metrics.latencyMs,timing};for(const listener of listeners)listener(event);if(type!=='reading')t.timingOpen=false;};
  function pruneFrames() {
    const used=new Set(tracks.flatMap(t=>t.best?[t.best.frame]:[]));
    for(const frame of retained)if(!used.has(frame)){closeFieldFrame(frame);retained.delete(frame);}
    // At most six native originals, shared among all tracks rather than one clone per card.
    while(retained.size>6){const frame=retained.values().next().value!;for(const t of tracks)if(t.best?.frame===frame)t.best=undefined;closeFieldFrame(frame);retained.delete(frame);}
  }
  function invalidateRead(t:InternalTrack) {if(t.read){count(t,'readsDropped');t.read=undefined;t.needsRead=!t.nameRetry&&t.view.state!=='dismissed';}}
  // Pixel evidence remains available while the inference worker is occupied.
  // Missing outlines alone never remove a card: the whole footprint and its
  // original halo must agree with clear mat, including at the camera edge.
  function observeAbsence(t:InternalTrack,evidence:FieldAnalysis,at:number) {
    if(t.view.removed||t.under)return;
    // An unanswered presence question owns its spot until a choice. A detector miss cannot ask it again.
    if(t.promptOnly==='card-presence'){if(evidence.motion(t.view.card)>.025)t.view.visible=false;return;}
    const card=t.view.card,spot=t.announced??card,box=t.view.faceDown&&t.view.setEvidence?.decision==='committed'?cellOf(t.view.zone):undefined;
    const exposedMat=()=>{
      if(!options.zoomSets||!/^S[1-5]$/.test(t.view.zone)||evidence.edgeGrip?.(spot)==='grip')return false;
      // Printed skin tones can trip contact on an empty cell. Require the
      // old footprint to match the learned mat and differ from the sleeve.
      const base=emptyLooks.get(t.view.zone),matLook=base?.appearance?.(spot)??base?.look;
      const look=evidence.appearance?.(spot),matChroma=centreChroma(matLook),backChroma=centreChroma(t.identityAppearance);
      return !!matChroma&&!!backChroma&&medianGap(matChroma,backChroma)>=.05&&
        medianGap(matChroma,centreChroma(look))<=.024&&sameFieldAppearance(centreLook(matLook),centreLook(look));
    };
    const vacantSet=!!box&&
      !evidence.occluded?.(spot)&&
      medianGap(t.setBackLook??t.identityAppearance,evidence.appearance?.(spot))>SET_BRIDGE_LOOK&&
      (!handContact(evidence,box)&&cellEmpty(evidence,t.view.zone,false)||
        (evidence.touched?.(box)??0)<=EXPOSED_MAT_CONTACT_MAX&&exposedMat());
    const stack=stackLooks.size>0&&stackStillThere(t.view.zone,evidence);
    const halo=evidence.halo?.(card),pixels=evidence.background?.(card)??evidence.appearance?.(card);
    // A sharp, hand-free footprint can show the mat even while a shadow
    // crosses its ring. Require a recent, distinct front and no sleeve edge.
    const frontVacant=()=>{
      if(!options.zoomSets||!t.announced||!bound(t)||t.view.faceDown||!t.view.cardId||
        !/^M[1-5]$/.test(t.view.zone)||at-t.view.lastSeen>3000||handNear(evidence,spot)||evidence.motion(spot)>.01)return false;
      const look=evidence.appearance?.(spot),ring=evidence.halo?.(spot),refs=lookRefs(t);
      if(!refs.length||refs.some(ref=>
        clearFieldBackground(ref,ring,true)||matchesLook(t,look,ref)||sameShadedFieldAppearance(ref,look)))return false;
      // A remembered stack can extend past the old card. Judge the entire
      // cell in that case, since a shadow can enter just the old outline's ring.
      const cell=cellOf(t.view.zone);
      if(!cell)return false;
      const bare=stack?clearFieldBackground(evidence.appearance?.(cell),evidence.halo?.(cell),true):
        clearFieldBackground(look,ring,true);
      return bare&&!flatSleeveQuad(cell,evidence);
    };
    const vacantFront=frontVacant();
    // A moving shadow is occlusion; a settled one only removes a card whose texture is gone.
    if(removalBlurred||blurHold||!vacantSet&&!vacantFront&&handNear(evidence,card)||shadedKeeps(t,evidence)||
      !vacantFront&&stack){t.clearCandidate=false;t.clearCandidateAt=undefined;resetAbsence(t);if(removalBlurred||blurHold)note(t,shadowNote());return;}
    // A uniform sleeve can match the mat. Unchanged card pixels are never
    // evidence of departure, even when the detector is between samples.
    const clear=vacantSet||vacantFront||!sameFieldAppearance(t.identityAppearance??t.appearance,pixels)&&!evidence.occluded?.(card)&&
      clearFieldBackground(pixels,halo);
    t.clearCandidate=!!clear;if(clear)t.clearCandidateAt??=at;else t.clearCandidateAt=undefined;
    if(!clear||evidence.motion(vacantSet||vacantFront?spot:card)>.01){resetAbsence(t);return;}
    t.view.visible=false;t.missed=true;invalidateRead(t);t.best=undefined;
    // The detector's receiving outline needs a few samples to settle. Give a new outline over another known
    // monster the same bounded chance here as in the full-scan path, even when its new top looks unlike this source.
    if(bound(t)&&!t.view.faceDown&&t.view.cardId&&/^(M[1-5]|EMZ[12])$/.test(t.view.zone)&&tracks.some(top=>
      top!==t&&!top.view.removed&&top.view.state==='candidate'&&at-top.view.firstSeen<1500&&at-top.view.lastSeen<450&&
      top.view.card.confidence>=.7&&!top.view.card.kept&&!top.view.card.cell&&!top.view.card.covered&&
      !handOver(evidence,top.view.card)&&planeVerdict(top.view.card).ok&&tracks.some(bottom=>bottom!==t&&bottom!==top&&bound(bottom)&&
        !bottom.view.removed&&!bottom.view.faceDown&&/^(M[1-5]|EMZ[12])$/.test(bottom.view.zone)&&quadIou(bottom.announced??bottom.view.card,top.view.card)>=.4))){resetAbsence(t);return;}
    // A lifted card may already be under a new outline whose identity read is
    // still pending. Give that read a bounded chance to reconnect the same ref
    // before starting a fresh clear-mat window for a move to hand.
    if(tracks.some(other=>other!==t&&!other.view.removed&&other.view.state==='candidate'&&couldBeSource(t,other,evidence)&&
      at-(other.read?.at??other.view.firstSeen)<2500&&(other.read||other.needsRead&&at-other.view.lastSeen<450))){resetAbsence(t);return;}
    if(t.missingAt!==undefined&&at-t.missingAt>Math.max(1000,metrics.detectorMs*2))resetAbsence(t);
    t.clearWindowAt??=at;t.missingAt=at;t.missingSamples++;
    if(t.missingSamples<DEPARTURE_SCANS||at-t.clearWindowAt<removalMs)return;
    const zoneSince=zoneEnabled()?zoneInstant?.settledSince(t.view.zone):undefined;
    const cell=zoneSince!==undefined&&at-zoneSince<=DEPARTURE_HOLD_MS?cellOf(t.view.zone):undefined;
    const base=cell&&emptyLooks.get(t.view.zone);
    const watchedEmpty=!!cell&&!!base?.look.length&&cellEmpty(evidence,t.view.zone)&&
      !unlikeMat(base,evidence.appearance?.(cell),evidence.halo?.(cell));
    const holdMs=watchedEmpty?EMPTY_ZONE_HOLD_MS:DEPARTURE_HOLD_MS;
    if(!vacantFront&&shadowOver(card)&&at-t.clearWindowAt<holdMs){note(t,shadowNote());return;}
    t.view.removed=true;t.restoredAt=undefined;
    if(fieldSlot(t.view.zone))t.view.removedFrameAt=t.clearWindowAt;
    if(t.view.state==='identified'||t.placeholder)emit('removed',t,{reason:'empty',...(vacantSet||watchedEmpty?{evidence:{basis:'pixel',emptyProofAt:watchedEmpty?t.clearWindowAt:at}}:{})});
    // A candidate lost from view is dismissed softly: it reads again when it shows again.
    if(t.view.state!=='identified'){t.softDismiss=t.view.state==='candidate';t.view.state='dismissed';}
  }
  const arrivalReads=new Set<InternalTrack>();
  const newRead=(t:InternalTrack)=>t.view.state==='candidate'&&t.newOutline&&!t.binding&&!t.identityCheck&&!t.nameRetry&&!t.promptOnly;
  async function startRead(t:InternalTrack,frame:FieldFrame,card:DetectedQuad,crop:RGBAImage|undefined,at:number,generation:number,nativeFront=false,verifyOnly=false) {
    if(reading||t.read||!t.needsRead){if(reading&&t.needsRead)hold(t,'slot');return;}
    if(!newRead(t)&&[...arrivalReads].some(other=>other.needsRead&&!other.read)){
      hold(t,'slot');return;
    }
    // A first read waits for the first frame without a hand on the card: an
    // embed of card plus fingers is rarely sure and costs a second read.
    if(t.view.state==='candidate'&&card.kind==='face-up'&&frame===latestEvidenceFrame&&handBlocks(t,latestEvidence?.touched?.(card))){handTiming(t,true,now());hold(t,'hand');return;}
    handTiming(t,false,now());
    t.handWaitAt=undefined;
    if(!t.timingOpen&&!t.nameRetry)beginTiming(t,at);
    else if(t.timing)t.timingOpen=true;
    const pending:PendingRead={background:!!t.nameRetry,nativeFront,verifyOnly,sharp:t.lastSharp,at,moving:frame===latestEvidenceFrame&&!restOk(t)&&(latestEvidence?.motion(card)??0)>.025,appearance:t.appearance?.slice(),crop,card:structuredClone(card),art:latestEvidence?.appearance?.(artBox(card))};
    if(t.confirming||newRead(t))pending.fingerprint=readFingerprint(crop);
    t.read=pending;t.needsRead=false;softCamera=false;
    const cached=t.readCache;
    if(t.confirming&&cached&&cached.result.candidates[0]?.cardId===t.view.cardId&&cached.zone===t.view.zone&&at-cached.at<=READ_CACHE_MS&&card.kind===cached.card.kind&&
      sameContactBox(card,cached.card)&&fieldAppearanceDistance(cached.look,pending.fingerprint)<READ_CACHE_DIFF){
      pending.result=cached.result;
      count(t,'readCacheHits');
      wake();
      return;
    }
    const cloneAt=now(),input=await clone(frame);addWait(t,'read',now()-cloneAt);if(t.timing)t.timing.durationsMs.readClone=now()-cloneAt;count(t,'reads');
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
  function resetFace(t:InternalTrack){setWait.delete(t);if(t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined)count(t,'faceResets');t.face?.gate.reset();t.face?.setGate?.reset();if(t.face){t.face.pendingAt=undefined;t.face.transitionAt=undefined;t.face.outlineAppearance=undefined;}}
  function resetAbsence(t:InternalTrack,preserveWindow=false){t.missingSamples=0;t.missingAt=undefined;if(!preserveWindow)t.clearWindowAt=undefined;}
  function interruptWindow(preserveVisibility=false,preserveAbsenceWindow=false) {previousAt=-Infinity;if(!preserveVisibility)forcePass=true;for(const cell of zoomCells.values())cell.settle=cell.waitingAt=undefined;for(const t of tracks){t.readCache=undefined;sourceMisses.delete(t);t.nameRest=undefined;interruptContact(t);resetFace(t);if(t.face)t.face.revealUntil=undefined;t.pose=undefined;if(!preserveVisibility)t.view.visible=false;invalidateRead(t);t.stableSince=NaN;t.observations=0;if(!preserveAbsenceWindow)resetAbsence(t);t.best=undefined;}pruneFrames();}
  const preparation=()=>({priors:options.getPriors?.(),sessionGallery:gallery.entries().flatMap(entry=>entry.cardId&&(entry.embedding.modelId||entry.embedding.values.length===options.profile.embedding.dim)?[{cardId:entry.cardId,embedding:entry.embedding}]:[]).slice(-512)});
  async function read(t:InternalTrack,input:FieldFrame,card:DetectedQuad,pending:PendingRead,generation:number) {
    const start=now();
    try {
      stage(t,'embedStart');
      if(generation!==epoch||disposed||t.read!==pending)return;
      // Refresh fallback references too: owner corrections must replace the
      // startup gallery even when a shortlist match misses the early-exit gate.
      await options.recognizer.prepare?.(preparation());
      if(generation!==epoch||disposed||t.read!==pending)return;
      const priors=options.getPriors?.();
      const readOptions={k:5,maxFrames:1 as const,includeIdentityEmbedding:true,includeDiagnosticCrop:true,includeRaw:true,preferUpright:true,priors,gallery:gallery.entries(),deckFirst:true,deckRescue:!t.view.cardId&&!t.identityCheck&&!t.confirming,earlyExitMargin:options.earlyExitMargin??.02};
      let readAt=start;
      let result=await options.recognizer.recognize([input] as ImageBitmap[]|ImageData[],{...readOptions,card});
      if(t.read===pending)addWait(t,'read',now()-readAt);
      pending.confidentDeck=confidentDeckRead(result,priors);
      if(!pending.confidentDeck && options.nameVoting!==false && now()-start<=NAME_VOTE_FIRST_READ_MS && result.tier!=='sure' && (result.tier==='low match'&&!pileZone(t.view.zone)||weakSidewaysRead(result,t.view.position)) && (t.view.state==='candidate'||pending.background) && !t.binding && !t.identityCheck && !t.confirming && restOk(t) && !pending.moving && !result.quality.faceDown && !result.quality.fallback && !result.quality.partial && !result.quality.covered) {
        const samples:NameSample[]=[];pending.voting=samples;
        try {
          // The ordinary watcher supplies fresh, clean resting frames. Never sample around its hand/plane gates.
          const voteAt=now();
          await new Promise<void>(resolve=>setTimeout(resolve,NAME_VOTE_WINDOW_MS));
          if(t.read===pending)addWait(t,'nameVote',now()-voteAt);
          pending.voting=undefined;
          if(generation===epoch&&!disposed&&t.read===pending&&samples.length>=2) {
            const chosen=samples.sort((a,b)=>b.score-a.score).slice(0,2);
            count(t,'reads');readAt=now();
            result=await options.recognizer.recognize([input,...chosen.map(s=>s.frame)] as ImageBitmap[]|ImageData[],{...readOptions,card,clickPoint:fieldCenter(card),maxFrames:3,earlyExit:false});
            if(t.read===pending)addWait(t,'read',now()-readAt);
          }
        } finally {pending.voting=undefined;for(const sample of samples)closeFieldFrame(sample.frame);}
      }
      if(generation===epoch&&!disposed&&t.read===pending){
        const look=pending.fingerprint;
        if(sureName(result)&&!pending.moving&&look?.length)t.readCache={result,card,zone:t.view.zone,look,at:pending.at};
        metrics.recognitionMs=now()-start;pending.result=result;stage(t,'searchDone');if(t.timing){Object.assign(t.timing.durationsMs,result.timingsMs);t.timing.durationsMs.readMs=now()-start;t.timing.reader=result.reader;t.timing.notes={source:result.quality.searchSource??'catalog',tier:result.tier};}wakeAfterRead=true;}
    }catch(cause){if(generation===epoch&&!disposed&&t.read===pending){console.error('[remote field] recognition failed',t.view.id,cause);metrics.errors++;pending.error=true;wakeAfterRead=true;}}
    finally{if(pending.background)backgroundReadAfter=now()+9*(now()-start);closeFieldFrame(input);}
  }
  /** Event-driven save: a finished read is consumed at once, not at the next timed tick. */
  function wake(){if(!active||disposed)return;if(inFlight){wakeQueued=true;return;}clearTimeout(timer);schedule();}
  // A sure zone read can immediately paint the local board. Only a fresh detector
  // outline through the ordinary placement guards can turn that preview into a write.
  const ZONE_READ_MS=1500,zoneReads:ZoneInstantRead[]=[];
  const zonePreviews=new Map<FieldZone,{read:ZoneInstantRead;track?:InternalTrack}>();
  let zoneInstant:ZoneInstant|undefined,zoneOff=false,detecting=false;
  const resetZoneReads=()=>{zoneReads.length=0;zonePreviews.clear();};
  const dropZoneRead=(read:ZoneInstantRead)=>{
    const index=zoneReads.indexOf(read);
    if(index>=0)zoneReads.splice(index,1);
    if(zonePreviews.get(read.zone)?.read===read)zonePreviews.delete(read.zone);
  };
  const zoneEnabled=()=>!zoneOff&&!disposed&&status!=='starting'&&status!=='error'&&!hidden()&&(options.zoneInstant?.enabled?.()??true);
  const scanning=async<T>(run:()=>Promise<T>)=>{detecting=true;try{return await run();}finally{detecting=false;}};
  const zoneEligible=(zone:FieldZone)=>!!calibration&&fieldSlot(zone)&&!tracks.some(t=>!t.view.removed&&t.view.zone===zone)&&!options.getKnownCards?.().some(k=>k.zone===zone);
  const zoneOutline=(zone:FieldZone):DetectedQuad|undefined=>{const cell=fieldCells().find(c=>c.zone===zone);if(!cell)return undefined;const box=cellQuad(cell);return {quad:box.quad.map(p=>({...p})),kind:'face-up',confidence:.75,partial:false};};
  function makeZoneInstant() {
    const config=options.zoneInstant,gray=options.buffer.gray?.bind(options.buffer);
    if(!config||!gray)return undefined;
    return createZoneInstant({
      calibration:()=>calibration,format:options.format,tier:config.tier,gray,now,maxPerSecond:config.maxPerSecond,maxReadDuty:config.maxReadDuty,
      enabled:zoneEnabled,
      sample:()=>options.buffer.sample({maxAgeMs:30,urgent:true}),release:closeFieldFrame,
      // The reader is also busy for the owner's manual reads: the high-priority lane must not jump them.
      zoneCard:zoneOutline,eligible:zoneEligible,busy:()=>!!reading||detecting||!!options.cpuBusy?.(false),
      read:async(frame,card)=>{
        // No prepare call here: it would queue behind ordinary jobs. The watcher prepares the reader before it starts.
        return options.recognizer.recognize([frame] as ImageBitmap[]|ImageData[],{k:5,maxFrames:1,includeIdentityEmbedding:true,includeDiagnosticCrop:true,includeRaw:true,preferUpright:true,priors:options.getPriors?.(),gallery:gallery.entries(),deckFirst:true,deckRescue:true,earlyExitMargin:options.earlyExitMargin??.02,card,priority:'high'});
      },
      // Only a sure, unflagged face-up name is worth an instant placement; anything else is the normal pipeline's.
      deliver:read=>{
        if(!zoneEnabled()||!sureName(read.result)||!zoneEligible(read.zone)||zoneInstant?.movedSince(read.zone,read.frameAt))return;
        zoneReads.push(read);
        if(read.kind==='face-up')zonePreviews.set(read.zone,{read});
        notify();wake();
      },
    });
  }
  const idle=(urgent=false)=>{
    const nav=typeof navigator==='undefined'?undefined:navigator as Navigator&{scheduling?:{isInputPending():boolean}};
    // A completed main-thread task says nothing about current input pressure.
    // Worker scans already obey their duty budget; fresh frames must keep the
    // face gate progressing while unrelated rendering/network work settles.
    return (!reading&&options.cpuBusy?.(urgent)) || nav?.scheduling?.isInputPending();
  };
  function proposePose(t:InternalTrack,card:DetectedQuad,cards:DetectedQuad[],evidence:FieldAnalysis,at:number,width:number,height:number) {
    const origin=t.announced??t.view.card,pixels=evidence.appearance?.(card);
    if(!bound(t)||card.kind!==t.view.card.kind||(card.kind==='face-down')!==t.view.faceDown||card.confidence<.7||card.partial||card.covered||isCovered(card,cards)||gripWait.has(t)||handNear(evidence,card)||!pixels?.length||
      (distance(origin,card)<=.04&&fieldOrientation(card,width,height,calibration)===t.view.position))return;
    t.pose={card:structuredClone(card),origin:structuredClone(origin),appearance:pixels,at:now(),cleanAt:at,samples:1};
  }
  function confirmPoses(evidence:FieldAnalysis,at:number,width:number,height:number):boolean {
    let pending=false;
    for(const t of tracks){
      const pose=t.pose;if(!pose)continue;
      const pixels=evidence.appearance?.(pose.card),translated=distance(pose.origin,pose.card)>.04;
      // Only a fresh detector quad can be retained. Never invent or revive an
      // outline from pixels, and abandon the shortcut on further motion/occlusion.
      if(at-pose.at>600||!bound(t)||t.view.removed||!planeVerdict(pose.card).ok||gripWait.has(t)||handNear(evidence,pose.card)||(pose.card.kind==='face-down')!==t.view.faceDown||!sameFieldAppearance(pose.appearance,pixels)||evidence.motion(pose.card)>.025||
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
  /** Short urgent window for a NEW card that lies on the mat (hand released, rest test running) and has no name yet: the first read must not wait for the idle pacing. Each card has URGENT_MS in total, spent only while it settles. */
  let urgentActive=false;
  const urgentTick=(at:number)=>{
    let urgent=false;
    for(const t of tracks){
      // A finished read that waits for the rest test still needs the next samples soon (fast devices only: others keep the ordinary pacing).
      if(t.view.removed||t.view.state!=='candidate'||t.view.cardId||t.read&&!(pacer.fast&&t.read.result&&!t.read.error))continue;
      const settling=!!t.rest&&t.rest.samples>0&&t.rest.planeOk;
      if(!settling){t.urgentTickAt=undefined;continue;}
      t.urgentLeft??=URGENT_MS;
      if(t.urgentTickAt!==undefined)t.urgentLeft-=Math.min(500,Math.max(0,at-t.urgentTickAt));
      t.urgentTickAt=at;
      if(t.urgentLeft>0)urgent=true;
    }
    return urgentActive=urgent;
  };
  /** Work that a still frame cannot finish: it keeps detector passes coming (in budget). A stuck candidate or flip counts for some seconds only. */
  const pacingPending=(at:number,evidence:FieldAnalysis)=>settlingNow()||heldReader.hasVisibleCard()||tracks.some(t=>!t.view.removed&&t.view.state!=='dismissed'&&(t.needsRead||!!t.read||nameRetryDue(t,at)&&at-lastFullDetectionAt>=CPU_FULL_SCAN_MS&&!blurHold&&!handNear(evidence,t.view.card)||(t.fullMisses??0)>0||t.view.state==='candidate'&&at-t.view.firstSeen<8000||(t.face?.pendingAt!==undefined&&at-t.face.pendingAt<8000)||t.view.state==='identified'&&at-lastSceneChangeAt<8000&&(t.view.faceDown!==(t.view.card.kind==='face-down')||!!t.rest&&!t.rest.ok)))||[...pilePresence.values()].some(p=>p.present&&p.misses>0&&p.misses<3)||[...twinMisses.values()].some(m=>m.misses<2);
  let sampleIntervalMs=0;
  const fieldActivityWindow=()=>Math.max(FIELD_ACTIVITY_WINDOW_MS,1.5*sampleIntervalMs);
  async function tick() {
    if(disposed||inFlight)return;
    if(hidden()){status='hidden';metrics.skipped++;interruptWindow();notify();return;}
    const urgent=urgentTick(now()),busy=idle(urgent),tracked=tracks.some(t=>t.view.state==='identified'&&!t.view.removed),empty=!tracks.some(t=>!t.view.removed);
    if(busy&&empty){status='busy';metrics.skipped++;interruptWindow();notify();return;}
    const pileBurst=()=>[...piles.values()].some(p=>!p.down&&now()-p.firstSeen<1500);
    const faceBurst=pileBurst()||tracks.some(t=>t.face?.pendingAt!==undefined&&now()-t.face.pendingAt<1500);
    // Quiet empty fields need fewer background scans, which can block arrivals.
    // Keep a bounded retry so a stationary card recovers from a detector miss.
    const light=busy||(!heldReader.hasVisibleCard()&&!faceBurst&&(tracked||empty)&&!reading&&!tracks.some(t=>t.needsRead||t.read||t.view.state==='candidate')&&
      now()-lastDetectionAt<(empty&&!tracks.length&&!piles.size&&!suppressed.length?Math.max(2000,metrics.intervalMs):metrics.intervalMs));
    const generation=epoch;inFlight=true;const start=now();let detectorRan=false,detectorEndedAt:number|undefined,detectorWasMoving=false,priorityPass=false,detectorDebt:boolean|'urgent'=true,zoomMs=0,current:FieldFrame|undefined,detectFrame:FieldFrame|undefined;
    try {
      const captureAt=now(),sample=await options.buffer.sample({maxAgeMs:pacedStill?200:30,...(urgent?{urgent:true}:{})}),captureMs=now()-captureAt;current=sample.frame;
      if(generation!==epoch||disposed)return;
      for(const read of zoneReads.slice())if(sample.at-read.frameAt>ZONE_READ_MS)dropZoneRead(read);
      if(sample.at<=lastFrameAt){metrics.skipped++;return;}
      lastFrameAt=sample.at;
      const maxGap=Math.max(1000,metrics.intervalMs*1.8),gap=sample.at-previousAt;
      if(gap>maxGap){interruptWindow(light,true);zoomDeckContactSince=undefined;}
      if(gap>0&&gap<=maxGap&&Number.isFinite(gap))sampleIntervalMs=gap;
      previousAt=sample.at;
      const evidence=analyze(current,sample.at,calibration?.corners);latestEvidence=evidence;latestEvidenceFrame=current;
      // Keep only the small startup appearance sampler. A late detector box on
      // unchanged mat print is still startup background, not a new arrival.
      if(setGuards.startup&&!startupAppearance)startupAppearance=createFieldAnalyzer({downsampleRGBA:true})(current).appearance;
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
        removalBlurred=removalSharpBase>0&&sharpNow<removalSharpBase*BLUR_RATIO;
        // A close-up or exposure change alters whole-frame contrast. A tracked
        // card with sharp, unchanged texture independently proves focus on return.
        if(removalBlurred&&tracks.some(t=>!t.view.removed&&t.view.state==='identified'&&
          !handNear(evidence,t.view.card)&&evidence.motion(t.view.card)<=.025&&evidence.sharpness(t.view.card)>=SHARP_LIMIT&&
          lookRefs(t).some(look=>!clearFieldBackground(look,evidence.halo?.(t.view.card))&&matchesLook(t,evidence.appearance?.(t.view.card),look)))){
          removalSharpBase=sharpNow;removalBlurred=false;
        }
        if(!removalBlurred)removalSharpBase=removalSharpBase<=0?sharpNow:sharpNow>removalSharpBase?removalSharpBase*.7+sharpNow*.3:removalSharpBase*.97+sharpNow*.03;
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
      // Both backends follow scene changes, with periodic full scans for cards
      // below the motion noise floor and burst room for pending placements.
      const scene=evidence.scene,liveCards=tracks.some(t=>!t.view.removed);
      pacing=!!scene;
      const urgentScan=scanRequested||scanFollowUp;
      const sceneMoving=pacing&&scene!.moving>0,sceneDirty=pacing&&scene!.sinceMark>0;
      if(sceneMoving)pacer.changed(sample.at);if(sceneMoving||sceneDirty)lastSceneChangeAt=sample.at;
      const pacedPending=pacing&&(forcePass||pacingPending(sample.at,evidence)),handOnly=sceneMoving&&!pacedPending;
      pacedStill=pacing&&!sceneMoving&&!sceneDirty&&!pacedPending;
      // Paced: a still scene waits for the slow timer. A changed one takes one full pass as soon as it stops moving, so the
      // detector always has the final scene. A settling card (rest test, read, removal check) needs samples soon, so it takes
      // the burst room too; while a hand moves, passes run in budget.
      const pacedFullEvery=pacedStill?pacer.stillEvery(sample.at,liveCards):urgent||sceneDirty&&!sceneMoving||pacedPending&&!sceneMoving?0:Math.max(CPU_FULL_SCAN_MS,Math.min(1500,Math.max(ema,metrics.detectorMs)*2));
      const fullEvery=pacing?pacedFullEvery:options.recognizer.detectorBackend==='webgpu'?Math.max(FULL_SCAN_MS,Math.min(1500,Math.max(ema,metrics.detectorMs)/.5)):Math.max(CPU_FULL_SCAN_MS,Math.min(1500,Math.max(ema,metrics.detectorMs)/budget));
      let pacingDecision=pacing?pacer.check(sample.at,handOnly,sceneMoving,urgent):'ready';
      const periodicFullDue=(pacing||liveCards||twinMisses.size>0)&&sample.at-lastFullDetectionAt>=fullEvery;
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
      // Sample cells before the detector budget can skip this tick. Motion
      // alone counts here: still skin, including on the mat, cannot renew it.
      for(const cell of cameraCells){
        const {zone}=cell;
        if(publicPile(zone)||zone==='EXTRA'){
          if(evidence.motion(cellQuad(cell))>.025){
            pileTouches.set(zone,sample.at);
            if(zone==='EXTRA')extraTouchedAt=sample.at;
            else lastFieldActivityAtByZone[zone]=sample.at;
          }
        }else if(calibration&&fieldSlot(zone)){
          const box=cellQuad(cell);
          if(visibleShare(box.quad)>=MIN_VISIBLE&&evidence.motion(box)>.025)lastFieldActivityAtByZone[zone]=sample.at;
        }
      }
      for(const t of tracks)if(publicPile(t.view.zone)&&!t.view.removed&&evidence.motion(t.view.card)>.025){
        pileTouches.set(t.view.zone,sample.at);
        // Check the pile card itself. A shadow can mark its unchanged print
        // as skin, and motion beside the pile can trip the wider probe.
        if(evidence.edgeGrip?.(t.view.card)==='grip'||
          handOver(evidence,artBox(t.view.card))&&!sameFieldAppearance(t.prevArt,t.curArt))pileContacts.set(t.view.zone,sample.at);
      }
      for(const zone of ['GY','BANISHED'] as const){if(pileCellClear(evidence,zone))pileClear.set(zone,pileClear.get(zone)??sample.at);else pileClear.delete(zone);}
      // Deck identity stays private. Its motion still supplies a destination
      // for a field card whose own footprint becomes clear in this window.
      const deck=piles.get('DECK');
      if(deck&&evidence.motion(deck.card)>.025)deckTouchedAt=sample.at;
      const deckBox=options.zoomSets?(deck?.card??cellOf('DECK')):undefined;
      if(deckBox){
        const grip=evidence.edgeGrip?.(deckBox)==='grip',contact=grip||handOver(evidence,artBox(deckBox));
        if(contact)zoomDeckContactSince??=sample.at;else zoomDeckContactSince=undefined;
        // An arm sweeping over a stationary Deck can briefly obscure its top.
        // A sustained grip or contact, or a clear mat under the pile, is stronger evidence.
        const unobstructed=!handNear(evidence,deckBox)&&!removalHold(deckBox),moving=evidence.motion(deckBox)>.025;
        const look=deck&&unobstructed?evidence.appearance?.(deckBox):undefined;
        const clear=!!look&&!moving&&(cellEmpty(evidence,'DECK',false)||clearFieldBackground(look,evidence.halo?.(deckBox)));
        if(contact&&sample.at-(zoomDeckContactSince??sample.at)>=DECK_CONTACT_MS||clear&&!zoomDeckGone)zoomDeckAt=sample.at;
        if(deck&&unobstructed)zoomDeckGone=clear;
      }
      // Deck/Extra piles are kept by pixels on every sample (CPU mode has few detector passes, and a motion crop
      // elsewhere never sees them): the spot still shows the pile, or a hand or arm is over it. Only a long absence
      // of both (or Scan field) takes a pile off the board.
      for(const [zone,pile] of piles){
        const look=evidence.appearance?.(pile.card);
        const empty=(pile.down||pile.card.blind)&&cellEmpty(evidence,zone);
        // The same pile footprint can change substantially as a hand moves
        // the stack under a glare spot. Retain a verified stack with a
        // contrasting centre while a fresh detector outline is unavailable.
        const contrasting=calibration&&pile.down&&sleeveOnMat(centreLook(look),evidence.halo?.(pile.card));
        if(!empty&&(contrasting||sameFieldAppearance(pile.look,look))||handNear(evidence,pile.card)||evidence.motion(pile.card)>.025||removalHold(pile.card))pile.keptAt=sample.at;
        else if(sample.at-pile.keptAt>PILE_GONE_MS){
          piles.delete(zone);
          if(zone==='DECK'&&options.zoomSets&&!zoomDeckGone){zoomDeckAt=sample.at;zoomDeckGone=true;}
        }
      }
      const difference=evidence.motionRegion,localizedDifference=!!difference&&difference.w*difference.h>=.001&&difference.w*difference.h<=.35;
      if(difference)lastMotionAt=sample.at;
      if(difference)recentMotion={region:difference,at:sample.at,since:recentMotion&&sample.at-recentMotion.at<=250?recentMotion.since:sample.at};
      for(const t of [...tracks]){
        if(t.announced&&sourceMisses.has(t)&&(removalBlurred||blurHold||handOver(evidence,t.announced)||evidence.motion(t.announced)>.06))sourceMisses.delete(t);
        observeContact(t,t.view.card,evidence,sample.at);
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
      const cells=options.zoomSets?fieldCells():[];
      zoomPendingZones.clear();zoomDeparturePending.clear();
      const zoomCandidates:{zone:FieldZone;box:DetectedQuad;since:number;attemptedAt:number;priority:number;look:number[];centre:number[];emptyMatLook?:number[];owner?:InternalTrack;nameCheck?:InternalTrack}[]=[];
      const slowZoomDevice=device.cores<=4||metrics.detectorMs>=ZOOM_SLOW_MS||pacer.priorityCost>=ZOOM_SLOW_MS;
      let zoomSettling=false;
      const localFlipCandidates:{zone:FieldZone;box:DetectedQuad;since:number;owner:InternalTrack}[]=[];
      const known=cells.length?options.getKnownCards?.()??[]:[];
      const liveFront=(t:InternalTrack)=>!t.view.removed&&t.view.state==='identified'&&!t.view.faceDown;
      const pendingRead=(t:InternalTrack)=>!t.view.removed&&t.view.state==='candidate'&&t.view.card.kind==='face-up'&&
        (t.read||!t.missed&&(t.placeholder||t.needsRead));
      const overlapsFront=(c:DetectedQuad,owner?:InternalTrack)=>tracks.some(t=>t!==owner&&(liveFront(t)||pendingRead(t))&&
        quadIou(t.view.card,c)>.1);
      for(const cell of cells){
        const zone=cell.zone;
        const nameCandidate=options.backgroundReread!==false&&fieldSlot(zone)&&tracks.find(t=>
          t.view.zone===zone&&(t.view.state==='candidate'||t.view.state==='prompt'&&!!t.nameRetry&&t.nameRetry.attempts<NAME_RETRY_ATTEMPTS)&&!t.view.removed&&!t.view.faceDown&&!t.view.cardId&&!t.nameZoomed&&
          !t.userDismissed&&!t.promptOnly&&!t.identityCheck&&t.view.card.kind==='face-up'&&
          t.view.card.confidence>=.5&&!t.view.card.partial&&!t.view.card.covered);
        if(!nameCandidate&&!setFollowUpZone(zone))continue;
        const box=cellQuad(cell);
        if(visibleShare(box.quad)<MIN_VISIBLE||!canZoomCell(current,box)){clearEmptyZoom(zoomCells.get(zone));continue;}
        const state=zoomCells.get(zone)??{};
        zoomCells.set(zone,state);
        // A tracked front blocks ordinary discovery zooms, including when
        // its whole-frame outline never clears the face gate. Take one fresh
        // crop of that spot after the card's own footprint has been quiet.
        if(nameCandidate){
          const q=nameCandidate.view.card,at=sample.at,look=evidence.appearance?.(q);
          if(at-nameCandidate.view.lastSeen>CANDIDATE_EXPIRE_MS||busy||removalHold(q)||handNear(evidence,q)||
            evidence.motion(q)>.025||!planeVerdict(q).ok||overlapsFront(q,nameCandidate)||
            !look?.length||clearFieldBackground(look,evidence.halo?.(q))){
            nameCandidate.nameRest=undefined;
          }else{
            const previous=nameCandidate.nameRest;
            if(!previous||!sameContactBox(previous.card,q)||!sameFieldAppearance(previous.look,look))
              nameCandidate.nameRest={card:structuredClone(q),look,since:at};
            const since=nameCandidate.nameRest!.since;
            const due=nameCandidate.view.state==='candidate'||nameRetryDue(nameCandidate,at);
            if(due&&at-since>=NAME_ZOOM_DELAY_MS&&!reading&&!scanRequested&&scanSweep===0&&!stackStillThere(zone,evidence,box)){
              zoomCandidates.push({zone,box,since,attemptedAt:state.attemptedAt??-Infinity,priority:1,look,centre:[],nameCheck:nameCandidate});
              continue;
            }
          }
        }
        if(!setFollowUpZone(zone))continue;
        const at=sample.at,motion=evidence.motion(box),moving=motion>.025;
        const here=tracks.filter(t=>t.view.zone===zone||t.announcedZone===zone);
        const departed=here.filter(t=>t.view.removed&&at-departureAt(t.view)<=FIELD_SET_RETURN_MS);
        const pendingFront=here.some(pendingRead),liveFronts=here.filter(liveFront);
        const front=pendingFront||liveFronts.length>0;
        const occupied=here.some(t=>!t.view.removed&&t.view.state==='identified')||
          known.some(k=>k.zone===zone&&!departed.some(t=>t.view.id===k.id||t.binding?.id===k.id));
        const forced=!front&&!occupied&&departed.some(t=>t.view.removedAt!==undefined&&(zoomCheckedAt.get(zone)??-Infinity)<=t.view.removedAt);
        if(forced){zoomPendingZones.add(zone);zoomDeparturePending.add(zone);}
        let contact=handContact(evidence,box);
        // For a possible in-place flip, judge nearby skin at the last card
        // outline. The wider cell ring can reach the table beyond the mat.
        const source=[...liveFronts,...departed].find(t=>!t.view.faceDown&&t.announcedZone===zone)?.announced;
        let near=contact||handNear(evidence,source??box);
        if(near&&!source&&!occupied&&!moving&&zone.startsWith('S')){
          // A still sleeve's edges can locate the contact check within the
          // cell. The eventual detector outline must also clear this check.
          const quad=flatSleeveQuad(box,evidence);
          const sleeve=quad&&{...box,quad};
          if(sleeve&&planeVerdict(sleeve).ok&&!handNear(evidence,sleeve)&&evidence.motion(sleeve)<=.025)contact=near=false;
        }
        if(contact){
          state.handAt=at;
          state.emptyZooms=state.missedLook=undefined;
        }
        if(moving)state.motionAt=at;
        const blocked=busy||near||removalHold(box);
        if(blocked||motion>.01||occupied||front||departed.length)clearEmptyZoom(state);
        if(blocked||moving){state.settle=state.waitingAt=undefined;continue;}
        const look=evidence.appearance?.(box),halo=evidence.halo?.(box),base=emptyLooks.get(zone);
        const unlike=unlikeMat(base,look,halo),empty=!unlike&&(sameFieldAppearance(base?.look,look)||clearFieldBackground(look,halo));
        if(state.emptyZoom&&(empty||!sameZoomLook(state.emptyZoom.look,look)))clearEmptyZoom(state);
        if(!look?.length){state.settle=undefined;continue;}
        if(!state.settle||!sameZoomLook(state.settle.look,look))state.settle={look,since:at};
        if(empty)stackLooks.delete(zone);
        const {since}=state.settle;
        // This window only accumulates on clean, still samples after contact clears.
        const settled=at-since>=REST_MS;
        const activityAt=Math.max(state.handAt??-Infinity,state.motionAt??-Infinity);
        const canCheck=!scanRequested&&scanSweep===0&&at>=(state.retryAt??-Infinity);
        const freshChange=at-activityAt<CELL_CHANGE_HOLD_MS&&!sameZoomLook(state.checkedLook,look);
        const requestZoom=(centre:number[],priority:number,emptyMatLook?:number[],owner?:InternalTrack)=>{
          zoomCandidates.push({zone,box,since,attemptedAt:state.attemptedAt??-Infinity,priority,look,centre,emptyMatLook,owner});
        };
        if(front){
          // A live front keeps its detector outline. A witnessed, flat sleeve
          // replacing its own pixels can confirm an in-place flip without a zoom.
          const owner=liveFronts.length===1?liveFronts[0]:undefined;
          if(owner?.announced&&bound(owner)&&!owner.under&&!pendingFront&&!empty&&settled&&scanSweep===0&&!scanRequested&&
            at-activityAt<SET_FOLLOW_UP_WINDOW_MS&&
            !matchesLook(owner,evidence.appearance?.(owner.announced))){
            localFlipCandidates.push({zone,box,since,owner});
            const centre=centreLook(look);
            if(centre&&freshChange&&canCheck)requestZoom(centre,1,undefined,owner);
          }
          continue;
        }
        if(empty&&settled){
          state.missedLook=undefined;
          state.checkedLook=undefined;
          if(forced)completeCellCheck(zone);
        }
        if(empty){state.waitingAt=undefined;continue;}
        const centre=centreLook(look);
        if(!centre)continue;
        if(occupied){
          // A Set being revealed can yield a front in the same crop.
          const back=here.find(t=>!t.view.removed&&bound(t)&&t.view.faceDown);
          if(back&&freshChange&&settled&&canCheck&&!matchesLook(back,evidence.appearance?.(back.announced??back.view.card)))
            requestZoom(centre,1);
          continue;
        }
        if(sameZoomLook(state.missedLook,centre)){
          if(forced&&settled)completeCellCheck(zone);
          state.waitingAt=undefined;continue;
        }
        // A changing halo alone can make a still patch of mat look different
        // after exposure correction. Check the centre against the mat as well.
        const changed=base?.look.length?unlike&&medianGap(centreLook(base.look),centre)>=PILE_SLEEVE_GAP:
          at-activityAt<SET_FOLLOW_UP_WINDOW_MS&&
          !sameZoomLook(centreLook(startupAppearance?.(box)),centre)&&sleeveOnMat(centre,halo);
        const sleeve=changed&&(departed.length>0||zoomSleeveLook(centre));
        if(!sleeve&&!freshChange||stackStillThere(zone,evidence,box)){
          state.waitingAt=undefined;continue;
        }
        // Cap speculative retries from drifting pixels. A departure still gets checked.
        if(!forced&&state.emptyZooms?.length===ZOOM_MISS_LIMIT&&at-state.emptyZooms[0]<ZOOM_MISS_WINDOW_MS)continue;
        if(departed.length)zoomPendingZones.add(zone);
        if(!canCheck||!forced&&(at-zoomDeckAt<ZOOM_DECK_HOLD_MS||sameZoomLook(state.checkedLook,look)))continue;
        state.waitingAt??=at;
        if(settled)requestZoom(centre,forced?0:departed.length?1:2,sleeve&&zone.startsWith('S')&&!departed.length?look:undefined);
        else if(sleeve&&slowZoomDevice&&at-state.waitingAt<REST_MS)zoomSettling=true;
      }
      // Coalesce pending zones into one full pass. A fresh Set witness or a
      // partial blind sleeve count can request the next confirming pass.
      const followUpDue=sample.at-lastFullDetectionAt>=250,setFollowUps=new Set<FieldZone>();
      if(pacing&&!busy&&followUpDue&&(urgent?pacer.check(sample.at,handOnly,sceneMoving):pacingDecision)!=='rest'){
        const request=(zone:FieldZone,box:DetectedQuad,since:number)=>{
          const previous=setFollowUpAt.get(zone)??-Infinity;
          if(sample.at-previous>=SET_FOLLOW_UP_MS&&previous<=since&&!removalHold(box)&&!handNear(evidence,box)&&evidence.motion(box)<=.025)setFollowUps.add(zone);
        };
        for(const t of tracks){
          const {zone,card,removed,state}=t.view;
          const pendingSet=state==='candidate'&&card.kind==='face-down'&&(t.rest?.ok||t.view.setEvidence?.positive);
          if(!setFollowUpZone(zone)||state!=='identified'&&!pendingSet)continue;
          // A moving sample can reset face hysteresis while a recently
          // detected Set still needs a fresh outline to resume confirmation.
          const since=removed?t.view.removedAt:pendingSet?t.rest?.since??t.view.firstSeen:t.face?.pendingAt??t.face?.transitionAt;
          if(since===undefined||sample.at-since>=SET_FOLLOW_UP_WINDOW_MS||
            removed&&lastFullDetectionAt>since&&!handZones.has(zone))continue;
          request(zone,card,since);
        }
        for(const zone of blindZones){
          const scans=blindScans.get(zone)??0;
          if(scans>0&&scans<SET_STEADY_SCANS){const box=cellOf(zone);if(box)request(zone,box,sample.at);}
        }
      }
      const setFollowUp=setFollowUps.size>0;
      // Give an overdue full scan the next available detector slot when
      // it competes with a cell zoom. Keep the regular detector budget.
      const zoomWork=zoomSettling||zoomCandidates.length>0;
      const overdueForZoom=slowZoomDevice&&zoomWork&&sample.at-lastFullDetectionAt>ZOOM_FULL_WAIT_MS;
      const fullBeforeZoom=overdueForZoom&&pacingDecision==='ready';
      const manualFullDue=scanRequested||scanFollowUp&&followUpDue;
      const zoneDue=zoneReads.some(read=>sample.at>read.frameAt&&sample.at-read.frameAt<=ZONE_READ_MS);
      const regularDue=()=>!busy&&(manualFullDue||(periodicFullDue||overdueForZoom||zoneDue)&&pacingDecision==='ready');
      let regularFullDue=regularDue(),fullDue=regularFullDue||setFollowUp;
      // A clear footprint with no motion elsewhere is a departure, not a
      // transfer. Sample it at camera cadence even on a slow CPU. Motion outside
      // the old quad still runs detection so field/pile transfers keep their ref.
      const checkingCells=zoomWork||localFlipCandidates.length>0;
      if(zoomSettling) pacedStill=false;
      if(!checkingCells&&!fullDue&&!reading&&tracks.some(t=>!t.view.removed&&t.clearCandidate&&sample.at-(t.clearCandidateAt??sample.at)<650&&(evidence.motionOutside?.(t.view.card)??1)<=.004&&(!recentMotion||sample.at-recentMotion.at>650||(()=>{const b=boundsOf(t.view.card.quad),r=recentMotion.region;return r.x>=b.x-b.w*.2&&r.y>=b.y-b.h*.2&&r.x+r.w<=b.x+b.w*1.2&&r.y+r.h<=b.y+b.h*1.2;})()))&&
        !tracks.some(t=>!t.view.removed&&t.view.state==='candidate')){status='watching';debugPath('clear-mat check',sample.at);return;}
      if(!checkingCells&&!busy&&!reading&&!fullDue&&confirmPoses(evidence,sample.at,current.width,current.height)){status='watching';debugPath('pose confirm',sample.at);return;}
      const trackedMotion=!busy&&tracks.some(t=>t.view.state==='identified'&&(t.view.removed?(evidence.motionOutside?.(t.view.card)??evidence.motion(mat))>.004:evidence.motion(t.view.card)>.025||(t.identityAppearance?.length&&!matchesLook(t,evidence.appearance?.(t.view.card)))));
      if(!checkingCells&&(pacing&&pacedStill&&!fullDue||light&&!fullDue&&!trackedMotion&&(busy||!pacing&&!localizedDifference&&evidence.motion(mat)<=.004))) {
        if(!busy&&periodicFullDue&&pacingDecision==='budget')budgetWaitAt=sample.at;
        debugPath(busy?'skip (busy)':'skip (quiet)',sample.at);
        // Keep cached clicks fresh during input pressure and long detector gaps.
        // Pixel evidence can retain an outline, but only the detector restores one.
        if(busy)interruptWindow(true,true);status=busy?'busy':'watching';metrics.skipped++;
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
        ((t.read.result.candidates[0]?.score??0)>=.84||closedRead(t.read.result)||t.read.nativeFront&&sample.at-t.read.at<=1500&&sureName(t.read.result)&&readHolds(t,t.view.card))&&sample.at-t.view.lastSeen<=1500&&(readHolds(t,t.view.card)||evidence.motion(t.view.card)<=.025&&
        sameFieldAppearance(t.read.appearance,evidence.appearance?.(t.view.card))));
      // A tiny appearance patch can match the mat after a moving card leaves.
      // Only a new detector result can confirm a candidate on clear background.
      const cachedTracks=tracks.filter(t=>t.view.state!=='candidate'||t.view.card.kind!=='face-down'||!clearFieldBackground(evidence.appearance?.(t.view.card),evidence.halo?.(t.view.card)));
      // Leave a bounded confirmation window after inference returns. Its input
      // timestamp includes the model's own wait; it is not the result's age.
      const confirmationAge=Math.max(450,Math.min(1000,metrics.detectorMs+250));
      const detectionDoneAt=lastDetectionAt+metrics.detectorMs;
      const freshOutline=(t:InternalTrack)=>sample.at-t.view.lastSeen<450+metrics.detectorMs;
      // A fresh, pixel-verified sleeve can finish its face samples while the detector
      // rests, including when motion elsewhere blocks whole-field confirmation.
      const localSets=new Set(pacing&&now()-detectionDoneAt<confirmationAge?cachedTracks.filter(t=>{
        const q=t.view.card;
        if(q.kind!=='face-down'||q.kept||q.partial||q.covered||t.view.state!=='candidate'||t.view.removed||t.missed||
          !t.view.setEvidence?.positive||!freshOutline(t)||removalHold(q)||handNear(evidence,q)||evidence.motion(q)>.025)return false;
        const look=evidence.appearance?.(q);
        if(!sameFieldAppearance(t.setBackLook,look)||medianGap(t.setBackLook,look)>SET_BRIDGE_LOOK)return false;
        const box=cellOf(t.view.zone);
        return !!box&&unlikeMat(emptyLooks.get(t.view.zone),evidence.appearance?.(box),evidence.halo?.(box));
      }):[]);
      // A fresh front settles from its own pixels. Activity elsewhere must not
      // spend another detector pass or postpone a hand-release confirmation.
      const localFronts=new Set(cachedTracks.filter(t=>{
        const q=t.view.card;
        if(t.view.state!=='candidate'||t.missed||t.view.removed||t.promptOnly||q.kind!=='face-up'||q.confidence<.8||q.partial||q.covered||
          now()-Math.max(detectionDoneAt,t.setRealAt??-Infinity)>=confirmationAge||!freshOutline(t)||blurHold||handNear(evidence,q)||evidence.motion(q)>.025||!planeVerdict(q).ok||
          !sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(q))||
          isCovered(q,cachedTracks.filter(o=>!o.view.removed&&quadIou(q,o.view.card)>.1).map(o=>o.view.card)))return false;
        const crop=evidence.crop?.(q),front=crop?classifyFaceState(crop):undefined;
        return front?.state==='up'&&front.confidence>=.8;
      }));
      // A recently seen front of an existing Set can settle locally while hands
      // move elsewhere. Keep the detector's budget and require fresh front pixels.
      const recentReveals=new Set(cachedTracks.filter(t=>{
        const q=t.view.card;
        if(!(bound(t)&&t.view.faceDown||t.view.state==='candidate'&&t.binding?.faceDown)||t.view.removed||!fieldSlot(t.view.zone)||q.kind!=='face-up'||sample.at>(t.face?.revealUntil??-Infinity)||
          blurHold||handNear(evidence,q)||evidence.motion(q)>.025||!planeVerdict(q).ok||isCovered(q,cachedTracks.filter(o=>!o.view.removed).map(o=>o.view.card)))return false;
        const crop=evidence.crop?.(q),front=crop?classifyFaceState(crop):undefined;
        return front?.state==='up'&&front.confidence>=.8;
      }));
      const faceSamples=cachedTracks.some(t=>t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined||t.read?.result||t.view.state==='candidate'&&t.newOutline||t.view.state==='identified'&&(t.view.faceDown!==(t.view.card.kind==='face-down')||t.moveAt!==undefined))&&now()-detectionDoneAt<confirmationAge&&
        cachedTracks.every(t=>t.view.removed||t.missed&&!t.view.visible&&!t.read||t.view.state==='candidate'&&!t.view.visible&&!t.read&&t.face?.pendingAt===undefined||freshOutline(t)&&!t.view.card.partial&&!t.view.card.covered&&evidence.motion(t.view.card)<=.025&&
          sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(t.view.card)))&&evidence.motion(mat)<=.004;
      const cardAspect=(c:DetectedQuad)=>{
        const quarterTurn=fieldQuarterTurn(calibration,current!.width/current!.height);
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
      let detected:DetectedQuad[],region:FractionalBox|undefined,rawOutlines:DetectedQuad[]=[];
      const checkedCells=new Map<DetectedQuad,{zone:FieldZone;since:number;crop:RGBAImage;observation:FaceStateResult;measured?:ReturnType<typeof measureSetEvidence>;owner?:InternalTrack}>();
      for(const {zone,box,since,owner} of localFlipCandidates){
        const edges=flatSleeveQuad(box,evidence),old=owner.announced!;
        // A remembered Monster Zone outline may be under a stack or on bare
        // mat after a pickup. Require fresh sleeve edges there.
        if(!edges&&zone.startsWith('M'))continue;
        const c:DetectedQuad={quad:edges??old.quad,kind:'face-down',confidence:.3,partial:false,blind:true};
        if(!cardAspect(c)||!planeVerdict(c).ok||quadIou(owner.announced!,c)<.5||
          handNear(evidence,c)||evidence.motion(c)>.025||overlapsFront(c,owner)||stackFootprint(c,zone,evidence,box))continue;
        const whole=evidence.crop?.(c);
        if(!whole)continue;
        const wholeFace=classifyFaceState(whole);
        if(wholeFace.state==='up')continue;
        const crop=!edges&&wholeFace.state==='unknown'?evidence.crop?.(sleeveInterior(c))??whole:whole;
        const observation=crop===whole?wholeFace:classifyFaceState(crop);
        const pixels=evidence.appearance?.(c),ring=evidence.halo?.(c);
        if(!edges&&!sleeveOnMat(pixels,ring))continue;
        const measured=measureSetEvidence(crop,c,observation,setMemory,true,false,true);
        if(observation.state!=='up'&&measured.evidence.positive)checkedCells.set(c,{zone,since,crop,observation,measured,owner});
      }
      zoomCandidates.sort((a,b)=>a.priority-b.priority||a.attemptedAt-b.attemptedAt||a.since-b.since);
      let zoomRan=false;
      const nextZoom=fullBeforeZoom||checkedCells.size?undefined:zoomCandidates[0];
      if(nextZoom&&!pacer.canSpendPriority(now()))budgetWaitAt=sample.at;
      else if(nextZoom){
        const {zone,box,since,look,centre,emptyMatLook,owner,nameCheck}=nextZoom;
        const state=zoomCells.get(zone)!;
        zoomRan=true;
        if(nameCheck)nameCheck.nameZoomed=true;
        else {state.attemptedAt=sample.at;state.retryAt=sample.at+ZOOM_RETRY_MS;}
        const zoomStart=now();
        let cellOutlines:DetectedQuad[]|undefined;
        try {cellOutlines=await detectZoomedCell(current,box,options.recognizer);}
        catch(cause){if(!nameCheck)state.retryAt=now()+ZOOM_RETRY_MS;warnOnce('zoom',cause instanceof Error?cause.message:String(cause),cause);}
        finally {
          const end=now(),cost=end-zoomStart;
          zoomMs+=cost;
          pacer.spendPriority(cost,end);metrics.zoomMs=zoomMs;
        }
        if(generation!==epoch||disposed)return;
        if(cellOutlines&&!nameCheck){
          completeCellCheck(zone);
          state.checkedLook=look;
          state.missedLook=centre;
          if(!cellOutlines.length&&emptyMatLook)state.emptyZoom={look:emptyMatLook,passes:0};
        }
        const zoomOutlines=cellOutlines??[];
        for(const c of zoomOutlines){
          if(nameCheck&&(c.kind!=='face-up'||quadIou(nameCheck.view.card,c)<.65||overlapsFront(c,nameCheck)))continue;
          if(c.confidence<.4||c.partial||c.covered||isCovered(c,zoomOutlines)||!cardAspect(c)||!planeVerdict(c).ok||
            zoneCellAt(onMat(fieldCenter(c),calibration),cells)?.zone!==zone||handNear(evidence,c)||removalHold(c)||evidence.motion(c)>.025||
            heldReader.claims(c,sample.at,stableMs))continue;
          const sizeLimit=Math.min(.95,(restSize??.8)*1.1);
          const g=matRestGeometry(c,calibration!,options.format);
          if(!g||g.cellShare<.6||g.size>sizeLimit)continue;
          const pixels=evidence.appearance?.(c),ring=evidence.halo?.(c);
          if(clearFieldBackground(pixels,ring))continue;
          let crop=evidence.crop?.(c);
          if(!crop)continue;
          let observation=classifyFaceState(crop);
          if(c.kind==='face-up'){
            if(c.confidence<.7||observation.state!=='up'||observation.confidence<.8)continue;
            if(nameCheck){
              const result=nameCheck.read?.result;
              if(!sureName(result)||weakSidewaysRead(result,nameCheck.view.position)||!readHolds(nameCheck,c)){
                invalidateRead(nameCheck);
                if(nameCheck.view.state==='candidate')nameCheck.needsRead=true;
              }
              note(nameCheck,'unnamed front: fresh cell crop');
            }else state.missedLook=undefined;
            const restSince=nameCheck&&!sameContactBox(nameCheck.nameRest!.card,c)?sample.at:since;
            checkedCells.set(c,{zone,since:restSince,crop,observation,owner:nameCheck});break;
          }
          if(overlapsFront(c,owner)||owner&&quadIou(owner.announced!,c)<.5||stackFootprint(c,zone,evidence,box))continue;
          if(observation.state==='up')continue;
          const flat=plainSleeve(pixels,ring,centreLook(emptyLooks.get(zone)?.look));
          let measured=measureSetEvidence(crop,c,observation,setMemory,sleeveOnMat(pixels,ring),false,flat);
          if(observation.state==='unknown'&&!measured.evidence.positive){
            // Glare or the mat border can enter the detector crop. Retry the
            // pixel check on independently measured sleeve edges.
            const boundary=flatSleeveQuad(box,evidence),outline=boundary?{...c,quad:boundary}:undefined;
            const edged=!!outline&&quadIou(c,outline)>=.6&&cardAspect(outline);
            const sleeve=edged?outline:sleeveInterior(c);
            const tight=evidence.crop?.(sleeve);
            if(!tight)continue;
            const face=classifyFaceState(tight);
            if(face.state==='up')continue;
            measured=measureSetEvidence(tight,c,face,setMemory,edged||flat,false,true);
            if(face.state!=='down'&&!measured.evidence.positive)continue;
            crop=tight;observation=face;
          }
          measured.evidence={...measured.evidence,positive:true,basis:'zoom'};
          state.missedLook=undefined;
          checkedCells.set(c,{zone,since,crop,observation,measured,owner});break;
        }
        if(cellOutlines&&!nameCheck&&state.missedLook){
          const misses=state.emptyZooms??=[];
          if(misses.length===ZOOM_MISS_LIMIT)misses.shift();
          misses.push(sample.at);
        }
      }
      // Zoom and the regular detector share a budget. Recheck after a zoom
      // spends tokens, including when it found no back to use this tick.
      if(pacing&&zoomMs>0){
        pacingDecision=pacer.check(now(),handOnly,sceneMoving,urgent);
        regularFullDue=regularDue();
        fullDue=regularFullDue||setFollowUp;
      }
      const unsampledBacks=new Set<InternalTrack>();
      // A sure read on a held outline commits now; a due full pass waits one tick.
      if(checkedCells.size||readyRead||!regularFullDue&&(faceSamples||recentReveals.size>0||localFronts.size>0||localSets.size>0)){
        debugPath('cached outlines',sample.at);
        // Retain only outlines whose current pixels still agree. A new outline
        // or changed/occluded pixels must go through detection as usual.
        // The outline's detector age is bounded above, independently of the
        // physical track's age (a moving draw may have created it earlier).
        // A local front's confirmation cannot advance an unrelated new back.
        // Its own detector scans, or the whole-field clean window, own that Set.
        detected=cachedTracks.filter(t=>{
          if(t.view.state==='candidate'&&t.view.card.kind==='face-down'&&!t.binding&&!faceSamples&&!localSets.has(t)){unsampledBacks.add(t);return false;}
          return true;
        }).filter(t=>localFronts.has(t)||localSets.has(t)||recentReveals.has(t)||!t.view.removed&&(t.read?.result&&readHolds(t,t.view.card))||!t.view.removed&&(t.view.visible||t.read||t.face?.pendingAt!==undefined||t.face?.transitionAt!==undefined||t.newOutline&&faceSamples&&freshOutline(t)&&!t.view.card.partial&&!t.view.card.covered||t.view.state==='identified'&&t.view.faceDown!==(t.view.card.kind==='face-down'))&&evidence.motion(t.view.card)<=.025&&
          sameFieldAppearance(t.face?.outlineAppearance??t.read?.appearance??t.appearance,evidence.appearance?.(t.view.card))).map(t=>structuredClone(t.view.card));
        if(checkedCells.size){
          detected=detected.filter(c=>![...checkedCells.keys()].some(checked=>quadIou(checked,c)>.1));
          detected.push(...checkedCells.keys());
          debugPath(zoomRan?'detector (zoomed cell)':'local Set flip',sample.at);
          debug={at:sample.at,path:debugTick,full:false,detections:[],reasons:{},...(lastPileScores?{pileScores:lastPileScores}:{})};
        }
      }else{
      // An actual zoom owns its tick. A refused zoom leaves the detector free.
      if(zoomRan||zoomSettling&&!nextZoom&&!fullBeforeZoom){
        status='watching';debugPath(zoomRan?'detector (zoom miss)':'cell settling',sample.at);return;
      }
      // A requested second pass must actually be a separate sample window.
      // Otherwise a 170 ms pass spends the follow-up before the 250 ms minimum.
      if(scanFollowUp&&!scanRequested&&!followUpDue)return;
      if(!fullDue&&pixelBurst()&&sample.at-lastDetectionAt<(!pacing&&options.recognizer.detectorBackend==='webgpu'?Math.max(100,metrics.intervalMs):100))return;
      if(!urgentScan&&!setFollowUp&&pacingDecision!=='ready'){
        debugPath(pacingDecision==='budget'?'budget wait':'detector rest',sample.at);
        if(pacingDecision==='budget'&&!handOnly)budgetWaitAt=sample.at;
        return;
      }
      detectorRan=true;detectorWasMoving=!!sceneMoving;
      priorityPass=setFollowUp&&!regularFullDue;
      detectorDebt=priorityPass?false:urgent&&!urgentScan?'urgent':true;
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
      // A dim mat is always dark: rescue only live tracks, on measured shadow or at most every 3 s.
      const shadowPass=shadowShare>=.03||sample.at-lastShadowPassAt>=SHADOW_PASS_EVERY_MS||options.recognizer.detectorBackend!=='webgpu'&&(urgentScan||scanSweep>0);
      const detectOpts=(r?:FractionalBox,allowShadow=shadowPass)=>r||keep.length||pileQuads.length||slotQuads.length?{shadowKeep:keepOutlines(true),...(allowShadow?{}:{shadowPass:false}),...(r?{region:r}:{}),...(keep.length?{keep}:{}),...(pileQuads.length?{piles:pileQuads.map(p=>p.quad)}:{}),...(slotQuads.length?{cells:slotQuads}:{})}:undefined;
      detected=await scanning(()=>options.recognizer.detectCards(detectFrame!,detectOpts(region)));
      if((options.recognizer.detectorTimingsMs?.shadowPasses??0)>0)lastShadowPassAt=sample.at;
      // A crop changes the detector's context. In particular, a plain sleeve
      // may be found only in the full frame. A missed crop must not add the
      // entire periodic full-scan delay to first sight or a flip.
      const unexplainedDifference=recentMotion&&sample.at-recentMotion.at<=250&&!detected.some(c=>
        overlapFraction(boundsOf(c.quad),recentMotion!.region)>=.12&&!tracks.some(t=>bound(t)&&quadIou(t.view.card,c)>=.84&&distance(t.view.card,c)<.012&&
          t.view.faceDown===(c.kind==='face-down')&&evidence.motion(c)<=.025&&matchesLook(t,evidence.appearance?.(c))));
      if(region&&(!detected.length||detected.some(c=>c.partial)||unexplainedDifference)){
        closeFieldFrame(detectFrame);detectFrame=await clone(current);
        detected=await scanning(()=>options.recognizer.detectCards(detectFrame!,detectOpts()));region=undefined;
        if((options.recognizer.detectorTimingsMs?.shadowPasses??0)>0)lastShadowPassAt=sample.at;
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
      if(!region&&calibration){
        const blind=blindSleeves(evidence,detected,cardAspect,sample.at);detected.push(...blind);
        // Scan field counts a pixel pile outline like a decoded stack outline.
        if(scanSweep>0)for(const c of blind)if(c.pile){const zone=mapFieldZone(c,calibration,[],options.format).zone;if(deckZone(zone)&&!scanPiles.has(zone))scanPiles.set(zone,structuredClone(c));}
      }
      // Scan field runs two full passes back to back: two misses remove a card at once.
      if(!region){for(const zone of setFollowUps)setFollowUpAt.set(zone,sample.at);lastFullDetectionAt=sample.at;forcePass=false;evidence.scene?.mark();if(scanRequested)scanFollowUp=true;else scanFollowUp=false;scanRequested=false;}
      // "Out of view is gone" for piles: a GY, Banished, Deck or Extra cell with
      // no outline in 2 full scans in a row, and no hand over it, is missing.
      if(!region&&calibration)for(const cell of cameraCells)if(['GY','BANISHED','DECK','EXTRA'].includes(cell.zone)){
        const box=cellQuad(cell);
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
      debugPath(region?'detector (motion crop)':priorityPass?'detector (Set follow-up)':fullDue?'detector (periodic full)':'detector (full)',sample.at);
      debug={at:sample.at,path:debugTick,full:!region,region,detections:[],reasons:{},...(lastPileScores=pileScores&&Object.keys(pileScores).length?pileScores:region?lastPileScores:undefined)?{pileScores:lastPileScores}:{}};
      detectorEndedAt=now();metrics.detectorMs=detectorEndedAt-detectStart;lastDetectionAt=sample.at;
      }
      if(generation!==epoch||disposed)return;
      const fieldWaiting=tracks.some(t=>!t.view.removed&&(t.needsRead||t.view.state==='candidate'&&!t.read));
      const held=heldReader.observe(detected,current,evidence,sample.at,calibration,options.format,!!reading||busy||lastReadHeld&&fieldWaiting,tracks.map(t=>t.view),
        c=>calibration?planeVerdict(c):undefined,look=>!!look?.length&&tracks.some(t=>bound(t)&&!t.view.removed&&!t.view.faceDown&&fieldSlot(t.view.zone)&&sameRotatedFieldAppearance(t.identityAppearance,look)));
      if(held.read){lastReadHeld=true;reading=held.read.catch(()=>{metrics.errors++;}).finally(()=>{reading=undefined;wake();});}
      detected=detected.filter(card=>!held.cards.includes(card));
      const zoneCards=new Map<DetectedQuad,ZoneInstantRead>();
      for(const read of [...zoneReads]){
        if(!zoneEnabled()||sample.at-read.frameAt>ZONE_READ_MS||!zoneEligible(read.zone)||zoneInstant?.movedSince(read.zone,read.frameAt)){
          dropZoneRead(read);continue;
        }
        if(sample.at<=read.frameAt)continue;
        const cell=zoneOutline(read.zone);
        if(!cell||blurHold||handNear(evidence,cell)||evidence.motion(cell)>.025||!sameZoneLook(read.look,zoneLook(current,cell.quad))){
          dropZoneRead(read);continue;
        }
        const fresh=detected.filter(c=>detectorRan||checkedCells.has(c));
        if(!detectorRan&&!fresh.length)continue;
        const here=fresh.filter(c=>mapFieldZone(c,calibration,fresh,options.format).zone===read.zone);
        if(region&&!here.length)continue; // This motion crop may not have scanned the zone.
        const c=here.length===1?here[0]:undefined;
        if(!c||c.kind!=='face-up'||c.confidence<.7||c.partial||c.kept||c.cell||!cardAspect(c)||quadIou(cell,c)<.4||
          c.covered||isCovered(c,detected)||!planeVerdict(c).ok||handNear(evidence,c)||evidence.motion(c)>.025){
          dropZoneRead(read);continue;
        }
        zoneReads.splice(zoneReads.indexOf(read),1);
        zoneCards.set(c,read);
      }

      const frontOutline=(c:DetectedQuad)=>c.kind==='face-up'&&c.confidence>=.5&&!c.partial&&cardAspect(c);
      const outlines=detected.filter(c=>c.quad.length===4&&c.quad.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y))).slice(0,60);
      if(detectorRan&&!region){
        startupBoxes??=[...rawOutlines,...outlines].map(c=>setMatQuad(c,calibration).quad);
        for(const r of setMemory.ignored){
          const spot:DetectedQuad={quad:r.quad.map(p=>calibration?fieldMatPoint(p,calibration):p),kind:'face-down',confidence:1,partial:false};
          if(outlines.some(c=>sameSetRegion(r.quad,setMatQuad(c,calibration).quad))||handNear(evidence,spot)||removalHold(spot)||evidence.motion(spot)>.025)r.missingAt=undefined;
          else {r.missingAt??=sample.at;if(!r.clear&&sample.at-r.missingAt>=500){r.clear=true;options.onSetMemoryChange?.();}}
        }
      }
      const cards=outlines.filter(c=>{
        const zone=mapFieldZone(c,calibration,[],options.format).zone;
        if(deckZone(zone))return false;
        if(!options.zoomSets||!setFollowUpZone(zone)||c.kind!=='face-down'||c.partial||handNear(evidence,c)||evidence.motion(c)>.025)return true;
        const settled=tracks.find(t=>!t.view.removed&&t.view.zone===zone&&t.view.faceDown&&t.view.setEvidence?.decision==='committed'&&quadIou(t.view.card,c)>=.5);
        return !!settled&&medianGap(settled.identityAppearance,evidence.appearance?.(c))<=SET_BRIDGE_LOOK||!stackFootprint(c,zone,evidence);
      });
      if(!reading)for(const t of tracks.filter(t=>!held.cards.some(c=>quadIou(c,t.view.card)>.3))){
        const c=t.view.card,pixels=evidence.appearance?.(c);
        if(contactWait.has(t)||!t.previewEligible||t.view.state!=='candidate'||!restOk(t)||t.view.removed||t.promptOnly||sample.at-t.view.lastSeen>500||c.confidence<.7||c.partial||c.covered||
          (evidence.motion(c)>.025||evidence.occluded?.(c)||!sameFieldAppearance(t.appearance,pixels))&&!artStill(t,c)||
          !sharpOk(t,evidence.sharpness(c),sample.at))continue;
        const crop=evidence.crop?.(c);if(!crop)continue;
        const observation=classifyFaceState(crop,{detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined});
        if(observation.state!=='up')continue;
        if(zonePreviews.get(t.view.zone)?.track!==t&&!t.placeholder&&!t.binding&&!(setGuards.positiveBack&&t.view.setEvidence&&!t.view.setEvidence.positive)&&!['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)){
          t.placeholder=true;t.placeholderId=t.view.id;t.view.faceDown=false;t.halo=evidence.halo?.(c);
          stage(t,'placeholder');
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
        // A plain white sleeve leaves the pixel classifier undecided: three still back-class samples with no front are a back.
        pile.backs=clean&&c.kind==='face-down'&&observation.state==='unknown'?pile.backs+1:observation.state==='unknown'&&!clean?pile.backs:0;
        pile.down=pile.gate.update(observation,sample.at).state==='down'||pile.backs>=3||pile.down&&!(observation.state==='up'&&observation.confidence>=.8);
        const pixels=evidence.appearance?.(c);
        if(clean&&!handNear(evidence,c)||!pile.look){pile.look=pixels;pile.card=c;}
        pile.keptAt=sample.at;
        if(zone==='DECK'&&(evidence.motion(c)>.025||pile.appearance?.length&&!sameFieldAppearance(pile.appearance,pixels)||
          !piles.has(zone)&&tracks.some(t=>!t.view.removed&&(t.missed||t.clearCandidate))))deckTouchedAt=sample.at;
        pile.appearance=pixels;pile.at=sample.at;piles.set(zone,pile);
      }
      metrics.samples++;status='watching';error=undefined;
      // Expire departures before matching, including after a long hidden pause.
      for(let i=tracks.length-1;i>=0;i--)if(tracks[i].view.removed&&tracks[i].view.state==='identified'&&sample.at-departureAt(tracks[i].view)>30000)tracks.splice(i,1);
      const appearances=new Map(cards.map(c=>[c,evidence.appearance?.(c)]));
      const appearance=(c:DetectedQuad)=>appearances.get(c);
      const matched=new Map<InternalTrack,DetectedQuad>(),taken=new Set<DetectedQuad>();
      // A settled flip was checked against its owner's announced footprint.
      // The last detector outline may have followed the card during the lift.
      for(const c of cards){
        const owner=checkedCells.get(c)?.owner;
        if(owner&&!owner.view.removed){matched.set(owner,c);taken.add(c);}
      }
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
      // An unread pile top is split from the card on it only when something landed (motion or a hand since it was seen), the look differs a lot
      // (glare, a reflection or a patch shift stay under that) and the same new look rests for two samples in a row.
      const pileSplit=new Set<InternalTrack>();
      for(const t of tracks){
        if(pileCandidate(t)&&t.observations>=1&&(t.lastResult||t.read&&!t.read.error&&!t.read.moving)){t.pileSighted=true;if(!t.pileDisturbed)t.pileLook=t.read?.appearance??t.appearance;}
        if(unreadPileTop(t)&&(evidence.motion(t.view.card)>.025||handNear(evidence,t.view.card)))t.pileDisturbed=true;
        const look=t.pileLook,c=t.pileDisturbed&&unreadPileTop(t)?cards.find(o=>o.kind==='face-up'&&o.confidence>=.7&&!o.partial&&quadIou(o,t.view.card)>.35&&evidence.motion(o)<=.025&&!handNear(evidence,o)&&!removalBlurred&&!blurHold):undefined,pixels=c?appearance(c):undefined;
        if(!c||!look?.length||!pixels?.length||fieldAppearanceDistance(look,pixels)<.025||sameRotatedFieldAppearance(look,pixels)||sameShadedFieldAppearance(look,pixels)){t.pileSplit=undefined;continue;}
        t.pileSplit=t.pileSplit&&sameFieldAppearance(t.pileSplit.look,pixels)?{look:pixels,n:t.pileSplit.n+1}:{look:pixels,n:1};
        if(t.pileSplit.n>=2)pileSplit.add(t);
      }
      const lookBlocked=(t:InternalTrack,c:DetectedQuad)=>(!!t.under||c.kind==='face-down'&&tracks.some(o=>o.under===t.view.id&&!!o.view.cardId&&!o.view.faceDown))&&bound(t)&&!followsAppearance(t,c)||(fieldSlot(t.view.zone)&&bound(t)||publicPile(t.view.zone)&&(t.view.state==='identified'||t.view.state==='prompt'))&&!t.view.faceDown&&!!t.identityAppearance?.length&&c.kind==='face-up'&&
        (t.under!==undefined||evidence.motion(c)<=.025&&c.confidence>=.7&&!c.partial&&!removalBlurred&&!blurHold)&&
        !sameRotatedFieldAppearance(t.identityAppearance,appearance(c))&&!sameShadedFieldAppearance(t.identityAppearance,appearance(c))||
        // An unread pile top is not renamed by a different card that landed on it (pileSplit); that card is the next send, and the covered top below keeps its own entry.
        pileSplit.has(t)&&c.kind==='face-up'&&c.confidence>=.7&&!c.partial;
      const pairs=tracks.flatMap(t=>cards.filter(c=>{
        const zoom=checkedCells.get(c);
        return !zoom||c.kind==='face-up'||zoom.zone===t.view.zone&&(!zoom.owner||zoom.owner===t);
      }).map(c=>{
        const a=boundsOf(t.view.card.quad),b=boundsOf(c.quad),ratio=(a.w*a.h)/(b.w*b.h||1);
        const overlap=quadIou(t.view.card,c),d=distance(t.view.card,c);
        // A light tick may hide changed pixels without a detector miss. Preserve
        // that physical ref at the same spot; the changed path below rereads it.
        const sameSpot=overlap>=.84&&d<.012;
        const returningSource=t.view.removed&&bound(t)&&!!t.view.cardId&&fieldSlot(t.announcedZone??t.view.zone)&&
          distance(t.announced??t.view.card,c)<=.04&&planeVerdict(c).ok&&!handNear(evidence,c)&&
          options.getKnownCards?.().some(k=>k.id===t.view.id&&k.cardId===t.view.cardId);
        const needsLook=!bound(t)&&t.view.state==='identified'&&t.view.card.kind==='face-up'&&!sameSpot&&(d>.02||overlap<.84||t.missed);
        const looks=c.kind==='face-up'&&((!t.identityAppearance?.length&&overlap>=.84&&d<.012)||sameFieldAppearance(t.identityAppearance,appearance(c)));
        return {t,c,score:overlap+(1-d)*.1+(c.confidence>=.7?2:0),eligible:!lookBlocked(t,c)&&follows(t,c)&&ratio>.35&&ratio<2.85&&(overlap>=.12||d<.16)&&(!t.view.removed||((returningSource||t.view.state==='dismissed'||t.restoredAt!==undefined||sample.at-t.view.lastSeen<=2500)&&!handNear(evidence,c)&&t.view.card.kind===c.kind&&(c.kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&(bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(c)):sameFieldAppearance(t.identityAppearance,appearance(c)))))&&(!needsLook||looks)&&(!bound(t)||!["GY","BANISHED"].includes(t.view.zone)||followsAppearance(t,c))&&(!(bound(t)&&(overlap<.12||t.missed)&&d>.04)||clearOldSpot(t,c))};
      })).filter(p=>p.eligible&&!(detectorRan&&!region&&p.t.view.state==='identified'&&!p.t.view.removed&&fieldSlot(p.t.view.zone)&&ghostOutline(p.t,p.c,evidence))).sort((a,b)=>b.score-a.score);
      for(const {t,c} of pairs)if(!matched.has(t)&&!taken.has(c)){matched.set(t,c);taken.add(c);}
      // A single recently hidden instance and a single new outline can be followed
      // across the mat. Multiple unmatched cards remain ambiguous and are not guessed.
      const incoming=cards.filter(c=>!taken.has(c));
      const lost=tracks.filter(t=>!matched.has(t)&&(t.view.state==='identified'||t.prompted)&&(t.view.removed?
        (t.view.state==='dismissed'||t.restoredAt!==undefined||sample.at-t.view.lastSeen<=2500)&&incoming.length===1&&t.view.card.kind===incoming[0].kind&&(incoming[0].kind==='face-up'||t.prompted&&t.view.state==='dismissed')&&(bound(t)?sameRotatedFieldAppearance(t.identityAppearance,appearance(incoming[0])):sameFieldAppearance(t.identityAppearance,appearance(incoming[0]))):
        sample.at-t.view.lastSeen<=Math.max(2500,removalMs))).filter(t=>pileCanLeave(t)&&(incoming.length!==1||followsAppearance(t,incoming[0])&&follows(t,incoming[0])));
      if(lost.length===1&&incoming.length===1&&!(incoming[0].kind==='face-down'&&checkedCells.has(incoming[0]))) {
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
      for(const t of tracks)if((bound(t)||(t.view.state==='identified'||t.view.state==='prompt')&&!!t.identityAppearance?.length||unreadPileTop(t))&&['GY','BANISHED'].includes(t.view.zone)&&!matched.has(t)&&
        cards.some(c=>mapFieldZone(c,calibration,[],options.format).zone===t.view.zone&&quadIou(c,t.view.card)>.35)){
        // Two quick sends: a top covered before its read finished still counts. It becomes an entry (named when the last read
        // was sure, else an unnamed card the player names with one tap); the web side writes it under the new top.
        if(unreadPileTop(t)){
          const result=t.read?.result??t.lastResult;
          t.identityAppearance=t.pileLook??t.read?.appearance??t.appearance;t.identityEmbedding=result?.identityEmbedding;t.view.state='prompt';t.view.visible=true;t.askAnyway=true;
          emit('prompt',t,{...(result?{result:{...result,candidates:result.candidates.slice(0,5)}}:{}),latencyMs:metrics.latencyMs,reason:'pile'});t.askAnyway=undefined;
        }
        t.view.visible=false;t.view.removed=true;t.pose=undefined;t.read=undefined;t.needsRead=false;t.best=undefined;note(t,'covered by a newer pile top');
      }
      const pileRead=(c:DetectedQuad)=>c.confidence>=.4&&['GY','BANISHED'].includes(mapFieldZone(c,calibration,cards,options.format).zone)&&tracks.some(t=>bound(t)&&!matched.has(t));
      const skipped=new Map<DetectedQuad,string>();
      // Every unmatched card-shaped outline starts a track, including a front
      // the detector scores lower under coloured light. Reads still decide identity.
      for(const c of cards){
        if(taken.has(c))continue;
        if(c.kind==='face-down'&&checkedCells.has(c)&&tracks.some(t=>t.view.state==='identified'&&!t.view.removed&&t.view.zone===checkedCells.get(c)!.zone))continue;
        if(handNear(evidence,c)&&tracks.some(t=>bound(t)&&t.view.removed&&followsAppearance(t,c))){
          skipped.set(c,'lifted field card');continue;
        }
        const question=tracks.find(t=>t.promptOnly==='card-presence'&&t.view.state==='prompt'&&!matched.has(t)&&sameSetRegion(setMatQuad(t.view.card,calibration).quad,setMatQuad(c,calibration).quad));
        if(question){matched.set(question,c);taken.add(c);continue;}
        if(c.kept){skipped.set(c,'kept outline (known card only)');continue;}
        if(tooBig(c)){skipped.set(c,'larger than two zones');continue;}
        if(!(c.confidence>=.7||backOutline(c)||pileRead(c)||frontOutline(c))){skipped.set(c,`low score ${c.confidence.toFixed(2)}`);continue;}
        if(tracks.filter(t=>!t.view.removed&&t.view.setEvidence?.decision!=='ignored'&&t.view.setEvidence?.decision!=='not-a-card').length>=maxTracks){skipped.set(c,'max tracks');continue;}
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
        // Undo suppression is also a player choice; unchanged evidence must stay quiet.
        if(t.promptOnly==='suppressed')t.userDismissed=true;
        t.appearance=appearance(c);
        const probed=recentMotion&&sample.at-recentMotion.at<=1500&&overlapFraction(boundsOf(c.quad),recentMotion.region)>=.12;
        const instant=zoneCards.get(c);
        beginTiming(t,instant?instant.since:probed?recentMotion!.since:sample.at);if(probed&&!instant)stage(t,'probe',recentMotion!.since);stage(t,'firstOutline',sample.at);
        if(instant&&!trusted){
          // Only a detected outline can carry the instant read into rest, face and placement checks.
          const preview=zonePreviews.get(instant.zone);
          if(preview?.read===instant)preview.track=t;
          const art=evidence.appearance?.(artBox(c));
          t.read={nativeFront:true,sharp:evidence.sharpness(c),at:instant.frameAt,appearance:t.appearance?.slice(),card:structuredClone(c),art,result:instant.result};t.needsRead=false;
          for(const [name,at] of Object.entries(instant.stages))stage(t,name,at);
          if(t.timing){t.timing.durationsMs.readMs=(instant.stages.zoneRead??instant.readAt)-instant.readAt;Object.assign(t.timing.durationsMs,instant.result.timingsMs);t.timing.reader=instant.result.reader;t.timing.notes={source:'instant-zone',tier:instant.result.tier};}
          if(t.timing){
            t.timing.stagesMs.detectorWait=Math.max(0,(detectorEndedAt??now())-instant.stages.zoneRead);
            t.timing.stagesMs.restGate=Math.max(0,instant.stages.zoneEvent-instant.since);
            addWait(t,'read',instant.stages.zoneRead-instant.readAt);
          }
          stage(t,'searchDone',instant.stages.zoneRead);note(t,'instant zone read');
        }
        if(startupBoxes?.some(q=>sameSetRegion(q,setMatQuad(c,calibration).quad)))startupTracks.add(t);
        tracks.push(t);matched.set(t,c);note(t,'new outline');
      }
      // Grid check: resting cards whose centres lie in a gap between cells or outside the grid, in 3 full passes (>= 250 ms apart) in a row.
      if(detectorRan&&!region&&calibration&&sample.at-gridOffAt>=250){
        let gap=0,outside=0,loose=0;const cells=fieldCells(),b=fieldZoneBounds(calibration,options.format),followed=new Set(matched.values());
        for(const c of cards){
          if(c.kept||c.partial||c.covered||c.confidence<.7||evidence.motion(c)>.025||handNear(evidence,c)||!planeVerdict(c).ok||tooBig(c))continue;
          const m=onMat(fieldCenter(c),calibration);
          if(m.x<b.minX-.012||m.x>b.maxX+.012||m.y<b.minY||m.y>b.maxY)outside++;
          else if(!zoneCellAt(m,cells))gap++;
          // A resting card inside a zone that nothing follows and nothing skipped (a skip, "max tracks" or a card off the grid, is not one a scan can fix).
          else if(!followed.has(c)&&!skipped.has(c))loose++;
        }
        untracked=loose;gridOffAt=sample.at;gridOffPasses=gap+outside>=2?gridOffPasses+1:0;gridShift={gap,outside,suspect:gridOffPasses>=3};
      }
      if((detectorRan||checkedCells.size)&&debug){
        const owners=new Map([...matched].map(([t,c])=>[c,t]));
        debug.detections=outlines.map(c=>{const zone=mapFieldZone(c,calibration,[],options.format).zone,owner=owners.get(c);
          const gap=!!calibration&&!zoneCellAt(onMat(fieldCenter(c),calibration),fieldCells());
          return {quad:structuredClone(c.quad),kind:c.kind,confidence:c.confidence,zone,use:checkedCells.has(c)?checkedCells.get(c)!.owner&&c.kind==='face-down'?'local Set flip':'zoomed cell':deckZone(zone)?'deck pile':owner?`track ${owner.view.id.slice(-4)}`:skipped.get(c)??'not used',...(gap?{gap}:{})};});
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
        if(seen||removalBlurred||blurHold||evidence.motion(mat)>.004||localizedDifference||sample.at-emptyPassAt>Math.max(1000,2*fullEvery,pacing?4*Math.max(ema,metrics.detectorMs):0)){emptySince=undefined;emptyPasses=0;}
        if(!seen&&!removalBlurred&&!blurHold&&evidence.motion(mat)<=.004&&!localizedDifference){emptySince??=sample.at;emptyPasses++;emptyPassAt=sample.at;}else emptyPassAt=-Infinity;
        if(emptySince!==undefined&&emptyPasses>=3&&sample.at-emptySince>=EMPTY_MAT_MS){
          // A hand resting on a card is not an empty spot: its pixels must read as clear mat.
          const clearSpot=(t:InternalTrack)=>{const pixels=evidence.background?.(t.view.card)??evidence.appearance?.(t.view.card);
            return !removalHold(t.view.card)&&!shadedKeeps(t,evidence)&&!evidence.occluded?.(t.view.card)&&!sameFieldAppearance(t.identityAppearance??t.appearance,pixels)&&clearFieldBackground(pixels,evidence.halo?.(t.view.card));};
          for(const t of tracks)if(!t.view.removed&&fieldZone(t.view.zone)&&clearSpot(t)){
            t.view.removed=true;t.view.removedFrameAt=emptySince;t.view.visible=false;t.missed=true;t.read=undefined;t.needsRead=false;t.best=undefined;resetAbsence(t);
            if(t.view.state==='identified'||t.placeholder)emit('removed',t,{reason:'empty'});
            if(t.view.state!=='identified'){t.softDismiss=t.view.state==='candidate';t.view.state='dismissed';}
          }
          for(const k of options.getKnownCards?.()??[])if(k.zone!=='HAND'&&fieldZone(k.zone)&&!tracks.some(t=>t.view.id===k.id||t.binding?.id===k.id)){
            const card=k.card??mat,position=k.position??'attack';
            const ghost:InternalTrack={view:{id:k.id,card,zone:k.zone,position,faceDown:!!k.faceDown,cardId:k.cardId,state:'identified',firstSeen:sample.at,lastSeen:sample.at,removed:true,removedFrameAt:emptySince,visible:false},
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
          if(own.some(t=>sample.at-departureAt(t.view)<3000))continue;
          const cell=cells.find(c=>c.zone===k.zone);if(!cell)continue;
          const box=cellQuad(cell),cellBounds=boundsOf(box.quad);
          const seen=outlines.some(c=>!tooBig(c)&&planeVerdict(c).ok&&(mapFieldZone(c,calibration,outlines,options.format).zone===k.zone||overlapFraction(boundsOf(c.quad),cellBounds)>=.5));
          const covered=handNear(evidence,box)||evidence.motion(box)>.06;
          if(seen||covered){twinMisses.delete(k.id);missingTwins.delete(k.id);continue;}
          if(removalBlurred||blurHold){twinMisses.delete(k.id);continue;}
          const miss=twinMisses.get(k.id)??{misses:0,at:sample.at,emits:0};miss.misses++;twinMisses.set(k.id,miss);
          if(miss.misses<2||sample.at-miss.at<250)continue;
          missingTwins.add(k.id);
          // Event retries: at most twice, 3 s apart (the re-sync and Scan field also remove it).
          if(removalHold(box)||miss.emits>=2||miss.emittedAt!==undefined&&sample.at-miss.emittedAt<3000)continue;
          miss.emits++;miss.emittedAt=sample.at;
          const old=own[0];
          if(old){old.view.removed=true;old.view.removedFrameAt??=miss.at;old.view.visible=false;note(old,`no outline on ${k.zone} in ${miss.misses} full scans`);emit('removed',old,{reason:'empty'});continue;}
          const card=k.card??box,position=k.position??'attack';
          const ghost:InternalTrack={view:{id:k.id,card,zone:k.zone,position,faceDown:!!k.faceDown,cardId:k.cardId,state:'identified',firstSeen:sample.at,lastSeen:sample.at,removed:true,removedFrameAt:miss.at,visible:false},
            anchor:card,missed:true,stableSince:NaN,observations:0,missingSamples:0,kind:card.kind,position,needsRead:false,resolvedAt:sample.at};
          note(ghost,`no outline on ${k.zone} in ${miss.misses} full scans`);tracks.push(ghost);emit('removed',ghost,{reason:'empty'});
        }
      }
      if(detectorRan&&!region&&calibration){
        // Empty-mat baseline per zone cell: learned in three full scans in a row with nothing in or over the cell.
        const known=options.getKnownCards?.()??[],boxes=[...rawOutlines,...held.cards];
        for(const cell of fieldCells()){
          const zone=cell.zone,box=cellQuad(cell),b=boundsOf(box.quad),look=evidence.appearance?.(box),e=emptyLooks.get(zone);
          const setZone=setFollowUpZone(zone),zoom=setZone?zoomCells.get(zone):undefined;
          // A card rests in this cell while the cell still shows its "empty" look: that baseline was learned over an undetected card.
          if(e?.look.length&&tracks.some(t=>!t.view.removed&&t.view.zone===zone&&t.view.state==='identified'&&matched.has(t)&&!!t.rest?.ok)&&sameFieldAppearance(e.look,look)&&medianGap(centreLook(e.look),centreLook(look))<PILE_SLEEVE_GAP){emptyLooks.delete(zone);continue;}
          const occupied=boxes.some(c=>overlapFraction(boundsOf(c.quad),b)>=.2)||tracks.some(t=>!t.view.removed&&(t.view.zone===zone||overlapFraction(boundsOf(t.view.card.quad),b)>=.2))||
            known.some(k=>k.zone===zone)||deckZone(zone as FieldZone)&&piles.has(zone as 'DECK'|'EXTRA');
          // A Deck/Extra baseline is learned only while the cell looks like the mat ring around it: a stack the detector never boxed must not become the "empty mat" (it would then read as an empty cell the moment it leaves).
          const ring=evidence.halo?.(box);
          if(occupied||!look?.length||blurHold||evidence.motion(box)>.01||removalHold(box)||handNear(evidence,box)||deckZone(zone as FieldZone)&&sleeveOnMat(look,ring)){
            clearEmptyZoom(zoom);if(e){e.pending=undefined;e.passes=0;}continue;
          }
          // A Set cell that still contrasts with its ring needs an empty zoom
          // followed by clean full scans with the same look and no sleeve edges.
          const unlike=!!e?.look.length&&/^(S[1-5]|DECK|EXTRA)$/.test(zone)&&unlikeMat(e,look,ring);
          const needsZoom=unlike&&options.zoomSets&&setZone&&sleeveOnMat(look,ring);
          const confirmation=needsZoom?zoom?.emptyZoom:undefined;
          const sleeve=blindShape.has(zone)||setZone&&blindSleevesSeen.has(zone);
          if(unlike&&(needsZoom?sleeve||!confirmation:blindShape.has(zone)||(blindScans.get(zone)??0)<SET_STEADY_SCANS+2)){
            if(sleeve)clearEmptyZoom(zoom);
            e!.pending=undefined;e!.passes=0;continue;
          }
          const next:NonNullable<ReturnType<typeof emptyLooks.get>>=e??{look:[],passes:0};
          if(confirmation){next.pending=look;next.passes=++confirmation.passes;}
          else if(next.pending&&sameFieldAppearance(next.pending,look))next.passes++;else{next.pending=look;next.passes=1;}
          if(next.passes>=3){next.look=look;next.halo=ring?.length&&ring.length%3===0?medianColour(ring):undefined;if(sameFieldAppearance(evidence.settledAppearance?.(box),look))next.appearance=evidence.appearance;}
          emptyLooks.set(zone,next);
        }
      }
      const genuineUncover=(c:DetectedQuad)=>!c.kept&&!c.cell&&!c.covered&&!c.partial&&c.confidence>=.7;
      for(const [bottom,c]of matched)if(bottom.under&&bound(bottom)&&genuineUncover(c)&&followsAppearance(bottom,c)&&!handOver(evidence,c)&&planeVerdict(c).ok){
        const top=tracks.find(t=>t.view.id===bottom.under);if(top&&!exposedTops.has(top))exposedTops.set(top,{bottom:bottom.view.id,since:sample.at,scans:0});
      }
      for(const [top,proof]of exposedTops){
        const bottom=tracks.find(t=>t.view.id===proof.bottom),c=bottom&&matched.get(bottom);
        if(top.view.removed||matched.has(top)||!bottom||!c||!genuineUncover(c)||!followsAppearance(bottom,c)){exposedTops.delete(top);continue;}
        if(detectorRan&&!region&&!handOver(evidence,c)&&!removalHold(c)&&planeVerdict(c).ok&&evidence.motion(c)<=.025){
          proof.scans++;
          if(proof.scans>=2&&sample.at-proof.since>=250){
            top.under=undefined;delete top.view.under;top.view.removed=true;top.view.removedFrameAt=proof.since;top.view.visible=false;
            note(top,'known bottom reappeared: the top left the stack');emit('removed',top,{uncoveredRef:proof.bottom});exposedTops.delete(top);
          }
        }
      }
      // Hysteresis may keep an enlarged, low-score outline of a covered card. Its last published resting box owns
      // the footprint; the kept outline cannot prove that the covered card is visible on top again.
      const stackTracks=tracks.map(t=>{
        const c=matched.get(t)??t.view.card;
        return (c.kept||c.cell||c.covered)&&t.announced?{...t.view,card:t.announced,zone:t.announcedZone??t.view.zone}:t.view;
      });
      const {covers,waiting:stackWaiting}=fieldStackCovers({
        exposed:new Set([...exposedTops.keys()].map(t=>t.view.id)),tracks:stackTracks,outlines:new Map([...matched].filter(([,c])=>!c.kept&&!c.cell&&!c.covered).map(([t,c])=>[t.view.id,c])),
        confirmed:new Set(tracks.filter(t=>t.view.state==='identified'||t.placeholder).map(t=>t.view.id)),at:sample.at,
        settled:(id,c)=>{const t=tracks.find(t=>t.view.id===id);return !!t&&planeVerdict(c).ok&&evidence.motion(c)<=.025&&
          (t.view.state==='identified'||!!t.rest?.ok&&sample.at-t.stableSince>=300);},
        held:c=>handOver(evidence,c)||removalHold(c),
        empty:t=>{const base=emptyLooks.get(t.zone),before=base?.appearance?.(t.card),after=evidence.appearance?.(t.card);
          return !removalBlurred&&!blurHold&&!handOver(evidence,t.card)&&evidence.motion(t.card)<=.025&&
            // The shift-tolerant match calls a flat sleeve on flat mat "the same": a Spell/Trap spot still far from its learned mat tone is not empty.
            !(/^S[1-5]$/.test(t.zone)&&base?.look.length&&unlikeMat(base,after,evidence.halo?.(t.card)))&&
            (before?.length?sameFieldAppearance(before,after):cellEmpty(evidence,t.zone));},
      });
      const stackMonsters=(t:InternalTrack,c:DetectedQuad)=>{
        const ids=new Set(fieldStackUnder(t.view.id,tracks.map(o=>o.view)));
        for(const o of tracks)if(o!==t&&!matched.has(o)&&(quadIou(o.view.card,c)>=.4||stackWaiting.has(o.view.id)))ids.add(o.view.id);
        return [...ids].filter(id=>{const o=tracks.find(o=>o.view.id===id);return o?.view.state==='identified'&&!o.view.removed&&!!o.view.cardId&&!o.view.faceDown&&/^(M[1-5]|EMZ[12])$/.test(o.view.zone);});
      };
      for(const [id,top]of covers){const t=tracks.find(t=>t.view.id===id);if(t&&t.under!==top){
        const remembered=stackTracks.find(track=>track.id===id);if(remembered)t.view.card=remembered.card;
        t.under=top;t.view.under=top;t.view.visible=false;note(t,`under ${top.slice(-4)} (board memory)`);emit('covered',t,{coverRef:top});
      }}
      for(const [t,c] of matched)if(!c.kept&&!c.cell&&c.confidence>=.7&&!c.partial&&!c.covered&&!handNear(evidence,c)&&evidence.motion(c)<=.025)t.realLook=appearance(c);
      // Scan field is authoritative: after its two fresh full passes, every field track with no box on the mat plane in
      // either pass goes when it is a phantom, or when its spot shows the empty mat (any face, with or without a read).
      // Deck/Extra piles follow the same two passes: a stack outline puts the pile on the board, an empty cell takes it off.
      if(detectorRan&&!region&&scanSweep>0){
        for(const [t,c] of matched)if((planeVerdict(c).ok||!!t.restQuad&&!c.kept&&!c.cell)&&!ghostOutline(t,c,evidence))t.scanHit=true;
        // A back in a field zone is evidence for the board's face check when both passes show it, unless a front in that zone still looks like itself.
        const backsNow=new Set<FieldZone>();
        for(const c of cards){
          if(c.kind!=='face-down'||c.partial||c.covered||!planeVerdict(c).ok||evidence.motion(c)>.025||handNear(evidence,c)||removalHold(c)||!cardAspect(c))continue;
          const zone=mapFieldZone(c,calibration,cards,options.format).zone,look=evidence.appearance?.(c);
          if(!fieldSlot(zone)||oversizedSet(c,zone)||cellEmpty(evidence,zone)||!sleeveOnMat(look,evidence.halo?.(c))||stackFootprint(c,zone,evidence))continue;
          const crop=evidence.crop?.(c),observation=crop?classifyFaceState(crop):{state:'unknown' as const,confidence:0};if(observation.state==='up')continue;
          if(setGuards.ignore&&setMemory.ignored.some(r=>(r.source!=='startup'||setGuards.startup)&&sameSetRegion(r.quad,setMatQuad(c,calibration).quad)))continue;
          if(setGuards.positiveBack&&!measureSetEvidence(crop,c,observation,setMemory,true,false,!!c.blind).evidence.positive)continue;
          if(!tracks.some(t=>!t.view.removed&&t.view.zone===zone&&!t.view.faceDown&&bound(t)&&matchesLook(t,look)))backsNow.add(zone);
        }
        for(const zone of backsNow)scanBacks.set(zone,(scanBacks.get(zone)??0)+1);
        if(--scanSweep===0){
          lastScanOffFrame=[];lastScanAt=sample.at;lastScanBacks=[...scanBacks].filter(([,passes])=>passes>=2).map(([zone])=>zone);scanBacks.clear();
          for(const t of [...tracks]){
            if(t.view.removed||t.scanHit||t.under||!fieldZone(t.view.zone))continue;
            const phantom=!plausible(t)&&!t.restQuad,spot=plausible(t)?t.view.card:t.restQuad??t.view.card,box=cellOf(t.view.zone);
            if(!phantom){
              if(removalHold(spot)||handNear(evidence,spot)||!!box&&handNear(evidence,box)){note(t,'Scan field: a hand is over its spot');continue;}
              if(visibleShare((box??spot).quad)<MIN_VISIBLE){note(t,'Scan field: its spot lies mostly outside the frame');if(!lastScanOffFrame.includes(t.view.zone))lastScanOffFrame.push(t.view.zone);continue;}
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
            }else if(pile&&box&&!handNear(evidence,box)&&(cellEmpty(evidence,zone)||clearFieldBackground(evidence.appearance?.(box),evidence.halo?.(box)))){
              piles.delete(zone);
              if(zone==='DECK'&&options.zoomSets&&!zoomDeckGone){zoomDeckAt=sample.at;zoomDeckGone=true;}
            }
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
      // New, clean front outlines own an available read slot before rechecks.
      for(const [track,card] of matched)if(newRead(track)&&track.needsRead&&!track.read&&
        sample.at-track.view.firstSeen<URGENT_MS&&card.kind==='face-up'&&card.confidence>=.7&&!card.partial&&!card.covered&&
        !handNear(evidence,card)&&evidence.motion(card)<=.025&&planeVerdict(card).ok)arrivalReads.add(track);
      const reconnected=new Set<InternalTrack>();
      for(const t of [...tracks]) {
        let c=covers.has(t.view.id)?undefined:matched.get(t);
        // A fresh zoom can match a candidate whose old outline was omitted.
        if(reconnected.has(t)||unsampledBacks.has(t)&&!(c&&checkedCells.has(c)))continue;
        t.setBridged=false;
        // Tracking a lifted outline must not move its source check into the hand.
        const source=t.announced;
        if(bound(t)&&!t.view.removed&&!covers.has(t.view.id)&&![...covers.values()].includes(t.view.id)&&source&&fieldSlot(t.announcedZone??t.view.zone)&&
          distance(source,c??t.view.card)>.04){
          if(detectorRan&&!region){
            const sourceLook=evidence.appearance?.(source);
            const occupied=cards.some(q=>quadIou(q,source)>=.5&&planeVerdict(q).ok&&
              lookRefs(t).some(look=>sameRotatedFieldAppearance(look,appearance(q))||sameShadedFieldAppearance(look,appearance(q))));
            if(removalBlurred||blurHold||handOver(evidence,source)||evidence.motion(source)>.06||occupied||
              lookRefs(t).some(look=>sameRotatedFieldAppearance(look,sourceLook)||sameShadedFieldAppearance(look,sourceLook))){sourceMisses.delete(t);}
            else{
              const old=sourceMisses.get(t),miss=old&&quadIou(old.quad,source)>=.84?{...old,count:old.count+1}:{quad:structuredClone(source),count:1,at:sample.at};
              sourceMisses.set(t,miss);
              if(miss.count<DEPARTURE_SCANS)scanFollowUp=true;
              else if(sample.at-miss.at>=250){
                t.view.card=structuredClone(source);t.view.zone=t.announcedZone??t.view.zone;
                t.view.removed=true;t.view.removedFrameAt=miss.at;t.view.visible=false;t.pose=undefined;
                sourceMisses.delete(t);note(t,'published source is clear in three sharp scans');emit('removed',t);continue;
              }
            }
          }
        }else sourceMisses.delete(t);
        if(!c&&checkedCells.size)continue;
        if(!c&&!t.view.removed&&t.view.state==='identified'&&stackLooks.size&&stackStillThere(t.view.zone,evidence)){
          t.view.visible=false;t.fullMisses=0;t.fullMissAt=undefined;resetAbsence(t);
          note(t,'known card covered by a stack footprint');continue;
        }
        if(c&&detectorRan&&bound(t)&&t.view.faceDown&&fieldSlot(t.view.zone)&&c.kind==='face-up'&&c.confidence>=.7&&!c.kept&&!c.cell&&!c.partial&&!c.covered){
          (t.face??={gate:trackFaceGate()}).revealUntil=sample.at+1500;
        }
        if(!c) {
          // A still, hand-free back with positive Set evidence flickers in the detector (score .4-.55: one hit in ~8 scans).
          // For up to SET_BRIDGE_MS its last outline stands in for the missed hit, while its pixels still match the back
          // seen at the last hit and still differ from the mat around them (a lifted card leaves mat, which also looks "same" to a
          // flat sleeve). A moved, covered or lifted card takes the ordinary miss path below.
          const last=t.view.card;
          if(detectorRan&&!region&&setGuards.positiveBack&&t.view.state==='candidate'&&!t.binding&&!t.view.removed&&last.kind==='face-down'&&
            t.setPositiveAt!==undefined&&sample.at-t.setPositiveAt<=SET_BRIDGE_MS&&sample.at-(t.setRealAt??-Infinity)<=SET_BRIDGE_MS&&
            !handNear(evidence,last)&&evidence.motion(last)<=.025&&!removalHold(last)&&!last.partial&&!last.covered&&
            sleeveOnMat(evidence.appearance?.(last),evidence.halo?.(last))&&!clearFieldBackground(evidence.appearance?.(last),evidence.halo?.(last))&&
            sameFieldAppearance(t.setBackLook,evidence.appearance?.(last))&&
            // A dark printed zone box also passes the checks above: its raw colour must stay the back's (no shift) and not be the zone's learned empty look.
            medianGap(t.setBackLook,evidence.appearance?.(last))<=SET_BRIDGE_LOOK&&!(emptyLooks.get(t.view.zone)?.look.length&&medianGap(emptyLooks.get(t.view.zone)!.look,evidence.appearance?.(last))<PILE_SLEEVE_GAP)){
            setWait.delete(t);c=structuredClone(last);t.setBridged=true;note(t,'detector missed: still back kept');
          }
        }
        if(!c) {
          t.setDownScans=0;
          interruptContact(t);
          t.previewEligible=false;
          resetFace(t);
          t.view.visible=false;delete t.view.restSince;delete t.view.pixelsDown;
          invalidateRead(t);
          t.missed=true;t.best=undefined;t.stableSince=NaN;t.observations=0;if(!t.view.removed&&detectorRan)note(t,'no detector outline this scan');
          if(detectorRan&&!region){
            t.frontScans=0;
            if(t.view.state==='dismissed'){
              // An outline over the old spot still counts even if association rejected it.
              if(cards.some(c=>quadIou(c,t.view.card)>=.1))t.dismissedMissAt=undefined;
              else t.dismissedMissAt??=sample.at;
              if(t.dismissedMissAt!==undefined&&sample.at-t.dismissedMissAt>=DISMISSED_EXPIRE_MS){expireCandidate(t,'dismissed track expired: no outline in full scans');continue;}
            }
          }
          // Under: no outline of its own, and the outline of another live card lies over its spot. Kept, hidden, never sent to the hand.
          if(!t.view.removed&&fieldSlot(t.view.zone)&&(t.view.state==='identified'||t.placeholder)){
            if(covers.has(t.view.id)){
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
            const phantom=!plausible(t),back=t.view.faceDown&&t.view.setEvidence?.decision==='committed';
            const spot=back?t.announced??t.view.card:t.view.card;
            const box=back?cellOf(t.view.zone):undefined;
            const handInCell=!!box&&(evidence.touched?.(box)??0)>EXPOSED_MAT_CONTACT_MAX;
            const look=evidence.appearance?.(spot),ring=evidence.halo?.(spot),sleeve=back&&sleeveOnMat(look,ring);
            const nearBack=sleeve&&medianGap(t.identityAppearance,look)<=SET_BRIDGE_LOOK;
            // A clean match to the learned mat can disambiguate stationary skin
            // pixels around a missing sleeve. Its own contrasting colour must be gone.
            const vacant=back&&!handInCell&&!sleeve&&!removalHold(spot)&&evidence.motion(spot)<=.01&&
              medianGap(t.identityAppearance,look)>SET_BRIDGE_LOOK&&cellEmpty(evidence,t.view.zone,false);
            const empty=!phantom&&(vacant||cellEmpty(evidence,t.view.zone)),weak=phantom||empty;
            const spotSeen=detected.some(d=>quadIou(d,t.view.card)>=.1&&planeVerdict(d).ok&&follows(t,d)&&!ghostOutline(t,d,evidence)),
              handOn=handInCell||!vacant&&handOver(evidence,t.view.card);
            // Relative, not absolute: pixels that still look like this card mean a detector miss. A Set
            // counts too when its sleeve differs from the mat (a white sleeve whose score dropped is still there).
            const sameLook=lookRefs(t).some(l=>matchesLook(t,look,l));
            const stillLooks=!weak&&((back?nearBack||sleeve&&sameLook:(t.view.card.kind==='face-up'||sleeveOnMat(t.identityAppearance,t.halo))&&sameLook)||shadedKeeps(t,evidence));
            // Display a previously committed Set while the sharp, unobscured
            // spot still looks like its sleeve. Only a detector hit refreshes lastSeen.
            if(stillLooks&&nearBack&&
              !handNear(evidence,t.view.card)&&!removalHold(t.view.card)&&evidence.motion(t.view.card)<=.025&&
              matchesLook(t,look))t.view.visible=true;
            // A committed back can lose both its outline and its previous
            // look under glare. The Spell/Trap source still needs clear mat.
            const needsVacancy=options.zoomSets&&back&&!weak&&/^S[1-5]$/.test(t.view.zone)&&
              !clearFieldBackground(look,ring);
            if(removalBlurred||blurHold){t.fullMisses=0;t.fullMissAt=undefined;note(t,shadowNote());}
            else if(spotSeen||handOn||stillLooks||needsVacancy||!weak&&evidence.motion(t.view.card)>.06){t.fullMisses=0;t.fullMissAt=undefined;note(t,spotSeen?'an outline still covers its spot':handOn?'a hand is over its spot':stillLooks?'its spot still looks like the card':needsVacancy?'its Set spot is not clear mat':'its spot is moving');}
            else{
              t.fullMissAt??=sample.at;t.fullMisses=(t.fullMisses??0)+1;
              const pendingNew=tracks.some(o=>o!==t&&!o.view.removed&&o.view.state==='candidate'&&o.read&&!o.read.result&&sample.at-o.view.firstSeen<2500&&couldBeSource(t,o,evidence));
              // One verification burst per disappearance uses the existing scan
              // follow-up (charged by the pacer). Do not lose a clear, sharp
              // source window while waiting for the next periodic pass.
              if(bound(t)&&!pendingNew&&t.fullMisses<DEPARTURE_SCANS&&
                (!departureChecks.has(t)||t.fullMisses>1)){departureChecks.add(t);scanFollowUp=true;}
              // A hand can hold a sleeve low enough to hide the old front but
              // high enough to prevent a new outline. Let that cell settle
              // before publishing a detector-only departure.
              const changingCell=options.zoomSets&&!weak&&!back&&bound(t)&&!!t.announced&&setFollowUpZone(t.view.zone)&&
                (contactWait.has(t)||sample.at-(lastFieldActivityAtByZone[t.view.zone]??-Infinity)<=CELL_CHANGE_HOLD_MS)&&
                sample.at-t.fullMissAt<CELL_CHANGE_HOLD_MS;
              // Two separate scans (>= 250 ms apart), not two passes of one burst.
              if(changingCell)note(t,'waiting for the changed cell to settle');
              else if(removalHold(t.view.card)&&t.fullMisses<DEPARTURE_SCANS)note(t,shadowNote());
              else if(t.fullMisses>=2&&sample.at-t.fullMissAt>=250&&!stackWaiting.has(t.view.id)&&(!pendingNew||weak)){
                note(t,`${phantom?'phantom (no box on the mat plane)':empty?'its cell shows the empty mat':'no outline'} in ${t.fullMisses} full passes over ${Math.round(sample.at-t.fullMissAt)} ms`);
                t.view.removed=true;t.view.removedFrameAt=t.fullMissAt;t.restoredAt=undefined;t.fullMisses=0;t.fullMissAt=undefined;emit('removed',t,phantom?{reason:'phantom'}:empty?{reason:'empty'}:{});
                // A candidate lost from view is dismissed softly: it reads again when it shows again.
                if(t.view.state!=='identified'){t.softDismiss=t.view.state==='candidate';t.view.state='dismissed';}
              }
            }
          }
          // A candidate (never confirmed) with no outline for 1.5 s, or a huge box, expires.
          if(detectorRan&&!t.view.removed&&t.view.state==='candidate'&&!t.binding&&(sample.at-t.view.lastSeen>(handNear(evidence,t.view.card)?CANDIDATE_ARM_MS:CANDIDATE_EXPIRE_MS)||tooBig(t.view.card)))expireCandidate(t,'candidate expired: no outline');
          // The lightweight observation above already checked clear mat.
          continue;
        }
        const zoom=checkedCells.get(c);
        t.fullMisses=0;t.fullMissAt=undefined;if((detectorRan||zoom)&&!t.setBridged)t.setRealAt=sample.at;
        if(c.confidence>=.7&&!c.kept&&!c.cell&&matchesLook(t,evidence.appearance?.(c)))departureChecks.delete(t);
        if(t.view.state==='candidate'&&tooBig(c)){expireCandidate(t,'candidate expired: outline larger than two zones');continue;}
        if(detectorRan)t.dismissedMissAt=undefined;
        if(detectorRan&&!region){
          if(t.view.state==='dismissed'&&c.kind==='face-up'&&c.confidence>=.6&&!c.partial&&!c.covered&&fieldZone(t.view.zone)&&!t.userDismissed&&(t.rearms??0)<MAX_REARMS){
            t.frontScans=(t.frontScans??0)+1;
            if(t.frontScans>=2){
              const reason=t.promptOnly;t.rearms=(t.rearms??0)+1;rearm(t,`detector front ${c.confidence.toFixed(2)} in ${t.frontScans} full scans`);
              // Retrying recognition still respects spread and restored-ref guards.
              if(reason==='spread'&&!laidOut||reason==='reappeared')t.promptOnly=reason;
            }
          }else t.frontScans=0;
        }
        t.previewEligible=c.confidence>=.7&&!c.partial&&!c.covered&&!isCovered(c,cards)&&!cards.some(other=>other!==c&&quadIou(c,other)>0);
        proposePose(t,c,cards,evidence,sample.at,current.width,current.height);
        if(t.under){note(t,'seen again on top');t.under=undefined;delete t.view.under;}
        if(t.view.removed){delete t.view.removedAt;delete t.view.removedFrameAt;delete t.view.emptyProofAt;}
        t.reappeared ||= t.view.removed;t.missed=false;t.view.removed=false;resetAbsence(t);if(!t.setBridged)t.view.lastSeen=sample.at;t.view.card=c;
        // A hand moves. Skin-coloured pixels that stay still on a still, confident outline for HAND_WAIT_MS are
        // the card's own print (an orange frame or warm art read as skin under a locked, darker exposure or white
        // balance): they stop blocking the face gate and the read, so a clearly seen card is never held for ever.
        if(!(evidence.occluded?.(c)||evidence.occluded?.(artBox(c)))||evidence.motion(c)>.025||c.confidence<.7||c.partial||c.covered){t.stillSkinAt=undefined;t.stillSkin=false;}
        else {t.stillSkinAt??=sample.at;const was=t.stillSkin;t.stillSkin=sample.at-t.stillSkinAt>=HAND_WAIT_MS;if(t.stillSkin&&!was)note(t,`still skin-coloured pixels for ${Math.round(sample.at-t.stillSkinAt)} ms; not a hand`);}
        observeRest(t,c,evidence,sample.at,zoom?.since??zoneCards.get(c)?.since);
        // The cell check already timed rest and hand release on camera samples.
        // The matched outline below still checks for contact at its own edges.
        if(zoom)contactWait.delete(t);
        observeContact(t,c,evidence,sample.at,true);
        handTiming(t,contactWait.has(t)||t.handWaitAt!==undefined&&!t.stillSkin&&(evidence.touched?.(c)??0)>HAND_CONTACT_MAX,sample.at);
        if(t.rest?.ok&&t.rest.since!==undefined)t.view.restSince=t.rest.since;else delete t.view.restSince;
        // Uncalibrated ordering is assigned at settlement, then kept until the card actually moves.
        if(calibration||t.view.state==='candidate'||distance(t.anchor,c)>.02)t.view.zone=settledZone(t,c,cards);
        const position=fieldOrientation(c,current.width,current.height,calibration);
        if(t.view.state==='identified'&&t.announced){
          const moved=distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position;
          if(moved)t.moveAt??=sample.at;else t.moveAt=undefined;
        }
        if(!t.timing)beginTiming(t,t.view.firstSeen);if(detectorRan)count(t,'detects');if(detectorEndedAt!==undefined)stage(t,'detectorDone',detectorEndedAt);if(t.timing){t.timing.durationsMs.detector=metrics.detectorMs;for(const [key,value] of Object.entries(options.recognizer.detectorTimingsMs??{}))t.timing.durationsMs[`detector.${key}`]=value;}stage(t,'tracker');if(t.timing)t.timing.durationsMs.capture=captureMs;
        // A reused outline is not in this scan's appearance map: read its pixels directly.
        const pixels=t.setBridged?evidence.appearance?.(c):appearance(c);
        if(t.identityAppearance?.length&&matchesLook(t,pixels))t.lookUpright=upright(c);
        const publicIdentity=bound(t)&&!t.view.faceDown?options.getKnownCards?.().find(k=>k.id===t.view.id&&!k.faceDown)?.cardId:undefined;
        if(t.awaitingName&&publicIdentity===t.awaitingName.next)t.awaitingName=undefined;
        if(publicIdentity&&publicIdentity!==t.view.cardId&&publicIdentity!==t.awaitingName?.previous){t.nameRetry=undefined;t.view.nameCandidates=undefined;t.read=undefined;t.needsRead=false;if(t.face)t.face.setCardId=undefined;gallery.remember(t.identityEmbedding,publicIdentity);t.view.cardId=publicIdentity;t.view.bestMatch=undefined;}

        // Pending face changes always sample fresh card pixels; settled faces can reuse their evidence.
        const faceState=t.face??={gate:trackFaceGate(),setCardId:t.binding?.faceDown?t.binding.cardId:undefined};
        // The latest detector's appearance validates a new outline or changed
        // face without overwriting identity or re-running inference.
        // A white/art sleeve can retain the detector's front class. Its fresh
        // outline still supports pixel confirmation when the bound face changes.
        if((t.view.state==='candidate'||t.view.faceDown!==(c.kind==='face-down')||bound(t)&&!matchesLook(t,pixels))&&c.confidence>=.4&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,cards)){faceState.transitionAt??=sample.at;faceState.outlineAppearance=pixels;}
        // Bound cards need fresh face pixels in either direction, even when a
        // plain sleeve has a weak/wrong detector class. New fronts keep .7.
        // A weak back (a white sleeve can score .20) counts too: a plain sleeve at rest for a while, with no hand, blur or moving shadow on it.
        const weakBack=c.kind==='face-down'&&!!t.rest?.ok&&sample.at-(t.rest.since??sample.at)>=WEAK_BACK_REST_MS&&!c.partial&&cardAspect(c)&&!handNear(evidence,c)&&!removalHold(c)&&plainSleeve(pixels,evidence.halo?.(c),/^S[1-5]$/.test(t.view.zone)?emptyLooks.get(t.view.zone)?.look:undefined);
        const boundOutline=(c.confidence>=.4||weakBack)&&cardAspect(c)&&!!(t.setRecovery||t.binding?.faceDown||bound(t));
        // Slightly touching detector edges are neighbours, not a hand fan. Keep
        // the existing .1 overlap tolerance for strong new fronts throughout admission.
        const faceCards=t.view.state==='candidate'&&c.kind==='face-up'&&c.confidence>=.8&&planeVerdict(c).ok?cards.filter(other=>other===c||quadIou(c,other)>.1):cards;
        // A new front needs only a still art window, not N stable detector passes.
        const freshFront=t.view.state==='candidate'&&c.kind==='face-up'&&!c.partial&&!c.covered&&!isCovered(c,faceCards)&&(c.confidence>=.7||frontOutline(c))&&artStill(t,c);
        const faceClean=freshFront||(c.confidence>=.7||backOutline(c)&&cardAspect(c)||boundOutline||!!zoom||frontOutline(c))&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,faceCards)&&
          // Neighbours that only touch (IoU <= .1) and light flicker (<= .06) do not make it unclean.
          !cards.some(other=>other!==c&&quadIou(c,other)>.1)&&evidence.motion(c)<=.06&&(!!zoom||quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012);
        const cachedFace=faceState.sample;
        const reuseFace=faceClean&&t.view.state==='identified'&&!t.needsRead&&(!t.read||!!t.read.result)&&faceState.pendingAt===undefined&&faceState.transitionAt===undefined&&
          t.view.faceDown===(c.kind==='face-down')&&!!cachedFace&&cachedFace.reference===faceState.reference&&cachedFace?.observation.state!=='unknown'&&
          evidence.motion(c)<=.004&&quadIou(cachedFace.card,c)>=.98&&sameFieldAppearance(cachedFace.look,pixels);
        const crop=faceClean&&!reuseFace?(zoom?.crop??evidence.crop?.(c)):undefined;
        let observation=zoom?.observation??(reuseFace?cachedFace!.observation:crop?classifyFaceState(crop,{reference:faceState.reference,detectorFaceDownScore:c.kind==='face-down'?c.confidence:undefined}):{state:'unknown' as const,confidence:0});
        if(setGuards.positiveBack&&fieldSlot(t.view.zone)&&c.kind==='face-up'&&observation.state==='down'&&
          !measureSetEvidence(crop,c,observation,setMemory,sleeveOnMat(pixels,evidence.halo?.(c)),false,!!c.blind).evidence.positive){
          // Conflicting face evidence waits for the ordinary front reader, never a Set timeout.
          observation={state:'unknown',confidence:0};
        }
        if(crop)faceState.sample={look:pixels?.slice()??[],card:structuredClone(c),observation,reference:faceState.reference};
        if(!t.view.cardId&&fieldSlot(t.view.zone)){
          const glare=crop&&c.kind==='face-up'&&!c.kept&&observation.state!=='down'&&restOk(t)&&!handNear(evidence,c)&&!handContact(evidence,c)?sampleFieldGlare(crop,sample.at):undefined;
          if(glare){
            const previous=glareSamples.get(t);
            const candidates=t.read?.result?fieldGlareChoices(t.read.result):previous?.revision===t.view.revision?previous?.candidates:undefined;
            glareSamples.set(t,{...glare,revision:t.view.revision,candidates});
          }else if(!reuseFace)glareSamples.delete(t);
        }
        if(observation.state==='down')t.view.pixelsDown=true;else delete t.view.pixelsDown;
        const knownFace=bound(t)&&c.kind===t.kind&&t.view.faceDown===(c.kind==='face-down')&&matchesLook(t,pixels)&&
          (c.confidence>=.4||weakBack)&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,faceCards)&&evidence.motion(c)<=.025;
        // Existing identity/face evidence wins before new-Set admission. A noisy crop of the same front
        // must not clear its name and ask whether an already represented card exists.
        const admittingSet=!knownFace&&fieldSlot(t.view.zone)&&(c.kind==='face-down'||observation.state==='down')&&(t.view.state!=='identified'||!t.view.faceDown);
        if(admittingSet&&faceClean&&evidence.motion(c)<=.025&&!handNear(evidence,c)&&stackFootprint(c,t.view.zone,evidence)){
          resetFace(t);t.view.visible=false;t.best=undefined;
          if(t.announced)t.view.card=t.announced;
          note(t,'Set waits: stack footprint');continue;
        }
        const ignored=setGuards.ignore?setMemory.ignored.find(r=>(r.source!=='startup'||setGuards.startup)&&sameSetRegion(r.quad,setMatQuad(c,calibration).quad)):undefined;
        if(admittingSet||ignored){
          const stillBack=detectorRan&&c.kind==='face-down'&&observation.state==='down'&&observation.confidence>=.8&&cardAspect(c)&&!c.partial&&!c.covered&&!handNear(evidence,c)&&evidence.motion(c)<=.025;
          if(detectorRan&&!t.setBridged)t.setDownScans=stillBack?(t.setDownScans??0)+1:0;
          const measured=faceClean&&zoom?.measured?zoom.measured:measureSetEvidence(crop,c,observation,setMemory,sleeveOnMat(pixels,evidence.halo?.(c)),(t.setDownScans??0)>=SET_STEADY_SCANS,!!c.blind);
          if(measured.evidence.positive&&(detectorRan||zoom)&&!t.setBridged){t.setPositiveAt=sample.at;t.setBackLook=pixels?.slice();}
          t.view.setEvidence={...measured.evidence,decision:t.view.setEvidence?.decision??'waiting'};setLooks.set(t,measured.look);
          if(faceClean&&restOk(t)&&t.view.setEvidence.decision==='waiting'&&!setObserved.has(t)){setObserved.add(t);setDecision(t,'waiting');}
          if(ignored){
            const different=measured.look.length>0&&(!ignored.look.length||setLookDistance(ignored.look,measured.look)>.08);
            const positive=measured.evidence.positive||observation.state==='up'&&observation.confidence>=.8;
            if(ignored.clear&&different&&positive){
              setMemory.ignored.splice(setMemory.ignored.indexOf(ignored),1);options.onSetMemoryChange?.();
              if(t.view.state==='dismissed'){rearm(t,'a different card replaced the ignored object');t.view.faceDown=c.kind==='face-down';}
            }else{
              if(t.view.setEvidence.decision!=='ignored'&&t.view.setEvidence.decision!=='not-a-card')setDecision(t,'ignored');
              t.view.state='dismissed';t.view.visible=false;t.userDismissed=true;t.needsRead=false;t.read=undefined;t.best=undefined;note(t,'ignored object region');continue;
            }
          }
          if(admittingSet&&setGuards.positiveBack&&faceClean&&measured.evidence.positive&&(observation.state!=='up'||measured.evidence.basis==='known-back'))observation={state:'down',confidence:Math.max(.8,observation.confidence)};
        }
        // A sideways back in a spell/trap cell is not a field Set pose. Hand fans can rest flat here,
        // even with no skin contact. Keep new candidates private until they turn upright or enter a monster cell.
        if(setGuards.handRelease&&admittingSet&&t.view.state==='candidate'&&!t.binding&&t.resolvedAt===undefined&&
          /^(S[1-5]|FIELD)$/.test(t.view.zone)&&position==='defense'&&
          fieldOrientation(c,current.width,current.height)===(fieldQuarterTurn(calibration,current.width/current.height)?'attack':'defense')){
          t.best=undefined;invalidateRead(t);t.view.visible=false;
          note(t,'Set waits: sideways back in a spell/trap cell');continue;
        }
        const contact=contactWait.get(t);
        if(contact){
          // Real back/front pixels identify a card, not whether the player has put it down.
          // A long, uninterrupted still hold may ask. Released cards settle silently; moving boxes never ask.
          const ready=faceClean&&planeVerdict(c).ok&&evidence.motion(c)<=.025;
          faceState.gate.update(observation,sample.at);
          (faceState.setGate??=trackSetFaceGate()).update(observation,sample.at);
          t.best=undefined;invalidateRead(t);t.view.visible=t.promptOnly==='card-presence'&&ready;
          if(ready&&contact.state==='still-held'&&contact.samples>=2&&sample.at-contact.since>=HAND_CONTACT_PROMPT_MS&&setGuards.prompt&&!t.prompted){
            const measured=t.view.setEvidence??measureSetEvidence(crop,c,observation,setMemory).evidence;
            if(!measured.positive&&unchangedStartup(t,c,evidence)){t.view.setEvidence=measured;rejectObject(t,'ignored');continue;}
            handPrompts.add(t);t.view.faceDown=true;t.view.cardId=undefined;t.view.state='prompt';t.view.visible=true;
            t.needsRead=false;t.promptOnly='card-presence';t.askAnyway=true;
            t.view.setEvidence??=measureSetEvidence(crop,c,observation,setMemory).evidence;
            setDecision(t,'prompted');emit('prompt',t,{reason:'card-presence'});
          }
          note(t,gripWait.has(t)?'placement waits for release of opposite edge grip':`placement waits for hand release (contact ${Math.round((evidence.touched?.(c)??0)*100)}%)`);continue;
        }
        if(handPrompts.has(t)){
          handPrompts.delete(t);
          if(t.promptOnly==='card-presence'){t.view.state='candidate';t.view.faceDown=c.kind==='face-down';t.promptOnly=undefined;t.prompted=false;t.needsRead=true;}
        }

        // Coloured light can leave the pixel classifier undecided on a real
        // front. A steady, confident detector front then overrides a stale
        // face-down state; a confident pixel back still keeps the Set.
        if(crop&&observation.state==='unknown'&&c.kind==='face-up'&&c.confidence>=.8&&t.view.faceDown&&(bound(t)||t.binding?.faceDown)){
          t.upSince??=sample.at;if(sample.at-t.upSince>=500)observation={...observation,state:'up',confidence:c.confidence};
        }else t.upSince=undefined;
        if(t.prompted&&observation.state==='down'&&!t.view.faceDown&&t.view.state==='prompt'){t.nameRetry=undefined;t.view.nameCandidates=undefined;t.view.state='dismissed';t.view.revision=(t.view.revision??0)+1;t.read=undefined;t.needsRead=false;}
        // A native cell check already witnessed two clean, resting samples
        // and a positive front. Keep the detector-only face wait for other boxes.
        const checkedFront=!!zoom&&c.kind==='face-up'&&faceClean&&restOk(t)&&observation.state==='up'&&!blurHold;
        const nativeScore=checkedFront?sharpness(zoom.crop):0;
        const sharpFront=nativeScore>=SHARP_LIMIT;
        // The Reading card shows as soon as the card rests face-up on the mat; only the read itself waits for a sharp crop.
        // Publish geometry before identity inference; never invent an identity
        // or a public front while face-state evidence is still ambiguous.
        if(zonePreviews.get(t.view.zone)?.track!==t&&!t.placeholder&&!t.binding&&!t.promptOnly&&!(setGuards.positiveBack&&t.view.setEvidence&&!t.view.setEvidence.positive)&&t.view.state==='candidate'&&restOk(t)&&faceClean&&observation.state==='up'&&!blurHold&&
          !['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone)) {
          t.placeholder=true;t.placeholderId=t.view.id;t.view.faceDown=false;t.view.visible=true;t.halo=evidence.halo?.(c);
          stage(t,'placeholder');
          emit('reading',t,{latencyMs:now()-t.view.firstSeen});
        }
        // A due background read can use a fresh, clean front sample without
        // waiting for the face gate to build its whole streak again after idle.
        const retry=t.nameRetry;
        if(retry&&!reading&&nameRetryDue(t,sample.at)&&c.kind==='face-up'&&restOk(t)&&faceClean&&observation.state==='up'&&!blurHold&&
          (checkedFront&&zoom.owner===t||sameContactBox(t.anchor,c))&&evidence.motion(c)<=.025&&!handNear(evidence,c)&&
          !tracks.some(other=>other!==t&&other.needsRead&&other.view.state==='candidate')&&(sharpFront||sharpOk(t,evidence.sharpness(c),sample.at))){
          retry.attempts++;retry.nextAt=now()+NAME_RETRY_MIN_MS*2**retry.attempts;
          t.needsRead=true;t.appearance=pixels;
          if(sharpFront)t.lastSharp=nativeScore;
          await startRead(t,current,c,crop,sample.at,generation,checkedFront);t.best=undefined;
        }
        // Speculate on the first sharp front while the face gate settles. Any
        // subsequent motion invalidates the result without restarting the worker.
        if(faceClean&&observation.state==='up'&&(sharpFront||sharpOk(t,evidence.sharpness(c),sample.at))&&(t.needsRead||t.view.faceDown)&&!t.read&&!reading&&!(t.view.state==='candidate'&&t.rest?.hard)) {
          t.needsRead=true;t.appearance=pixels;t.halo=evidence.halo?.(c);
          if(sharpFront)t.lastSharp=nativeScore;
          await startRead(t,current,c,crop,sample.at,generation,checkedFront,zoom?.owner===t);
        }
        // Retry once if the hand changed the crop, or a low match came from before the card settled.
        if(t.read?.result&&!t.read.verifyOnly&&t.read.result.tier!=='sure'&&!t.rereadEarly&&t.view.state==='candidate'&&!t.promptOnly&&t.read.appearance?.length&&
          (!sameFieldAppearance(t.read.appearance,pixels)||t.read.result.tier==='low match'&&readBeforeRest(t,t.read))&&faceClean&&observation.state==='up'&&sharpOk(t,evidence.sharpness(c),sample.at)&&!reading){
          t.rereadEarly=true;t.read=undefined;t.needsRead=true;t.appearance=pixels;note(t,'early read not sure; reading again');
          await startRead(t,current,c,crop,sample.at,generation);
        }
        // A sure read of a still, detector-front outline is itself front evidence (its read
        // started from an 'up' pixel sample); do not wait for another face sample.
        const sureFront=(observation.state==='up'||t.view.state==='candidate'&&c.kind==='face-up'&&c.confidence>=.7&&readHolds(t,c))&&t.read?.result?.tier==='sure'&&(t.read.confidentDeck||(t.read.result.candidates[0]?.score??0)>=.84)&&
          !t.read.result.quality.fallback&&!t.read.result.quality.covered&&!t.read.result.quality.partial&&!t.read.result.quality.faceDown&&
          (sameFieldAppearance(t.read.appearance,pixels)||readHolds(t,c));
        // A full pass may replace the zoom outline during the read. Its
        // ambiguous crop cannot erase the fresh native front if the art holds.
        const nativeSure=observation.state!=='down'&&t.read?.nativeFront&&sample.at-t.read.at<=1500&&
          c.kind==='face-up'&&faceClean&&restOk(t)&&!blurHold&&sureName(t.read.result)&&readHolds(t,c);
        const gatedFace=faceState.gate.update(observation,sample.at);
        const setFace=(faceState.setGate??=trackSetFaceGate()).update(observation,sample.at);
        // Two fresh clean samples reject a moving draw, without waiting for the
        // full face window. Existing cards retain their normal flip hysteresis.
        const sureBack=t.view.state==='candidate'&&t.resolvedAt===undefined&&!t.binding&&!t.prompted&&
          faceClean&&c.kind==='face-down'&&c.confidence>=.7&&setFace.state==='down';
        const checkedBack=!!zoom?.measured&&faceClean&&restOk(t)&&t.view.setEvidence?.positive&&observation.state!=='up';
        let face=knownFace?{state:t.view.faceDown?'down' as const:'up' as const,confidence:1}:checkedBack?{state:'down' as const,confidence:Math.max(.8,observation.confidence)}:nativeSure?{state:'up' as const,confidence:c.confidence}:sureFront||sureBack||checkedFront?observation:gatedFace;
        // The Graveyard holds no face-down cards: pixels alone never turn a detector front there into a back.
        const graveFront=t.view.zone==='GY'&&!knownFace&&c.kind==='face-up';
        if(graveFront&&face.state==='down')face={state:'unknown',confidence:0};
        // The face gate never waits for ever: after 600 ms a confident detector
        // front (>= .8) decides, unless the pixels clearly show a back.
        if(face.state==='unknown'&&c.kind==='face-up'&&c.confidence>=.8&&!c.partial&&(observation.state!=='down'||graveFront)&&!blocks(t,c)){
          t.faceWaitAt??=sample.at;if(sample.at-t.faceWaitAt>=(t.view.zone==='GY'?PILE_FACE_WAIT_MS:600)){face={state:'up',confidence:c.confidence};note(t,`face gate timed out after ${Math.round(sample.at-t.faceWaitAt)} ms; detector front ${c.confidence.toFixed(2)}`);}
        }else if(face.state!=='unknown'||c.kind!=='face-up')t.faceWaitAt=undefined;
        // Legacy timeout for the comparison switch and non-field observations. Field Sets with the guard ON
        // require positive crop evidence below; elapsed time alone never makes their pixels a back.
        const backCase=c.kind==='face-down'&&cardAspect(c)&&!c.partial&&!c.covered&&!blocks(t,c)&&!isCovered(c,faceCards)&&evidence.motion(c)<=.025&&observation.state!=='up'&&
          (bound(t)&&!t.view.faceDown&&(c.confidence>=.4||weakBack)&&!handNear(evidence,c)&&!removalHold(c)&&!matchesLook(t,pixels)||t.view.state==='candidate'&&!t.binding&&!t.prompted&&backOutline(c)&&fieldSlot(t.view.zone));
        if(face.state==='unknown'&&backCase&&(!setGuards.positiveBack||!admittingSet)){
          t.backWaitAt??=sample.at;if(sample.at-t.backWaitAt>=600){face={state:'down',confidence:Math.max(.8,c.confidence)};note(t,`face gate timed out after ${Math.round(sample.at-t.backWaitAt)} ms; detector back ${c.confidence.toFixed(2)}`);}
        }else t.backWaitAt=undefined;
        if(admittingSet&&setGuards.positiveBack&&!t.view.setEvidence?.positive&&observation.state!=='up'){
          // No public Set or Reading placeholder is created while presence is uncertain.
          if(restOk(t)&&faceClean){
            if(!setWait.has(t))setWait.set(t,sample.at);
            if(sample.at-setWait.get(t)!>=600){
              if(!t.prompted&&setGuards.startup&&t.resolvedAt===undefined&&!t.binding&&(startupTracks.has(t)||unchangedStartup(t,c,evidence))){rejectObject(t,'ignored');continue;}
              if(setGuards.prompt&&!t.prompted){if(t.resolvedAt!==undefined)t.binding={id:t.view.id,zone:t.view.zone,cardId:t.view.cardId,faceDown:false};t.view.faceDown=true;t.view.cardId=undefined;t.view.state='prompt';t.view.visible=true;t.needsRead=false;t.read=undefined;t.best=undefined;t.promptOnly='card-presence';t.askAnyway=true;setDecision(t,'prompted');emit('prompt',t,{reason:'card-presence'});}
            }
          }else setWait.delete(t);
          if(t.promptOnly==='card-presence')t.view.visible=faceClean&&restOk(t);
          if(!faceClean){t.anchor=c;t.stableSince=NaN;t.observations=0;}
          note(t,'Set needs positive back evidence');continue;
        }
        if(admittingSet&&t.promptOnly==='card-presence'&&t.view.setEvidence?.positive){t.view.state='candidate';t.promptOnly=undefined;t.prompted=false;}
        if(face.state==='unknown'){
          if(observation.state!=='unknown')faceState.pendingAt??=sample.at;else faceState.pendingAt=undefined;
          t.view.visible=false;t.pose=undefined;t.best=undefined;note(t,`face gate waiting (pixels: ${observation.state}${faceClean?'':', outline not clean'})`);
          if((observation.state!=='up'||!sameFieldAppearance(t.read?.appearance,pixels))&&!readHolds(t,c))invalidateRead(t);
          if(!faceClean){t.anchor=c;t.stableSince=NaN;t.observations=0;}
          continue;
        }
        if(face.state==='down'&&fieldSlot(t.view.zone)&&(t.view.state!=='identified'||!t.view.faceDown)&&oversizedSet(c,t.view.zone)){
          if(t.view.state==='candidate')expireCandidate(t,'Set outline is larger than one card');
          else {t.view.visible=false;note(t,'Set outline is larger than one card');}
          continue;
        }
        faceState.pendingAt=undefined;faceState.transitionAt=undefined;faceState.outlineAppearance=undefined;stage(t,'faceState');
        c.kind=face.state==='down'?'face-down':'face-up';
        const faceChanged=t.view.faceDown!==(face.state==='down');
        const revealRead=faceChanged&&face.state==='up'&&t.read&&sameFieldAppearance(t.read.appearance,pixels)?t.read:undefined;
        if(faceChanged){t.nameZoomed=false;t.nameRest=undefined;t.nameRetry=undefined;t.view.nameCandidates=undefined;t.prompted=false;t.rereadEarly=false;if(!revealRead)invalidateRead(t);t.view.revision=(t.view.revision??0)+1;t.best=undefined;t.pose=undefined;t.identityCheck=undefined;}
        if(face.state==='down'&&t.view.state==='candidate'&&stackMonsters(t,c).length>=2){
          if(restOk(t)&&faceClean&&!t.prompted){t.view.faceDown=false;t.view.visible=true;t.view.state='prompt';t.needsRead=false;
            note(t,'unread top over known monsters: ask, never Set a material');emit('prompt',t,{reason:'uncertain'});}
          continue;
        }
        if(face.state==='down'){
          if(t.promptOnly==='suppressed'){t.view.state='dismissed';t.prompted=true;t.needsRead=false;t.best=undefined;continue;}
          // A new back is a Set only once it rests on the mat (never a card held up, an arm or a box across two cells).
          if(t.view.state!=='identified'&&!restOk(t)){t.view.visible=false;note(t,`Set waits: ${t.rest?.text??'not resting yet'}`);continue;}
          if(!t.view.faceDown&&t.view.cardId)faceState.setCardId=t.view.cardId;
          t.view.cardId=undefined;t.read=undefined;t.needsRead=false;t.identityCheck=undefined;
          // A brief vacancy shows the card was lifted. A settled back in the
          // same cell can still be that card returning.
          const returnedAt=now(),known=options.getKnownCards?.()??[];
          const back=t.view.state==='candidate'&&!t.binding&&t.resolvedAt===undefined&&fieldSlot(t.view.zone)?tracks.filter(o=>{
            const {id,removed,removedAt,zone}=o.view;
            if(o===t||!removed||removedAt===undefined||o.view.state!=='identified'||o.under||zone!==t.view.zone||
              returnedAt-removedAt>FIELD_SET_RETURN_MS||known.some(k=>k.zone===zone&&k.id!==id)||!known.some(k=>k.id===id&&(k.zone===zone||k.zone==='HAND')))return false;
            const cardId=o.view.cardId??o.face?.setCardId??known.find(k=>k.id===id)?.cardId;
            return !cardId||heldReader.lastReadAt(cardId)<removedAt&&!tracks.some(other=>publicPile(other.view.zone)&&other.view.cardId===cardId&&other.view.lastSeen>=removedAt);
          }).sort((a,b)=>b.view.removedAt!-a.view.removedAt!)[0]:undefined;
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
            t.realLook=undefined;t.identityAppearance=pixels;t.appearance=pixels;t.kind=c.kind;t.anchor=c;t.stableSince=sample.at;t.observations=3;
            t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.best=undefined;t.halo=evidence.halo?.(c);
            if(t.view.setEvidence){setDecision(t,'committed',setGuards.positiveBack?undefined:'legacy');if(t.view.setEvidence.positive){rememberSetBack(setMemory,setLooks.get(t)??[]);options.onSetMemoryChange?.();}}
            if(placed){metrics.placements++;t.selfSetAt=sample.at;emit('placed',t);}
            else {const origin=back?{removedAt:back.view.removedAt}:undefined;if(faceChanged||binding?.faceDown===false)emit('flipped',t,origin);if(binding)emit('moved',t,origin);}
            continue;
          }
        }else if(faceChanged){
          const binding=options.getKnownCards?.().find(k=>k.id===t.view.id)??(t.resolvedAt!==undefined?{id:t.view.id,zone:t.view.zone}:t.binding);
          t.binding=binding?{...binding,faceDown:true}:undefined;
          t.view.cardId=undefined;t.view.faceDown=false;t.view.state='candidate';t.read=revealRead;t.needsRead=!revealRead;
          // This read belongs to the fresh front quad, including its rotation.
          // Retaining the back's pose would invalidate it below and embed twice.
          t.identityAppearance=undefined;t.realLook=undefined;t.promptOnly=undefined;t.kind=c.kind;t.anchor=c;t.position=position;t.view.position=position;t.stableSince=sample.at-stableMs;t.observations=3;
        }

        if(t.identityCheck&&sameFieldAppearance(t.identityAppearance,pixels)&&t.kind===c.kind&&evidence.motion(c)<=.025&&!c.covered&&!c.partial&&!isCovered(c,faceCards))restoreIdentity(t,pixels);
        const appearanceChanged=t.read?.appearance?.length&&pixels&&!sameFieldAppearance(t.read.appearance,pixels)&&!readHolds(t,c);
        const changedKind=(t.view.state==='prompt'||t.view.state==='dismissed')&&t.view.faceDown!==(c.kind==='face-down');
        const changedLook=(t.view.state==='prompt'||t.view.state==='dismissed'||(t.view.state==='identified'&&Boolean(t.view.cardId||!t.view.faceDown)&&c.kind==='face-up'))&&t.identityAppearance?.length&&pixels&&!sameFieldAppearance(t.identityAppearance,pixels);
        if(t.prompted&&changedKind){t.view.state='dismissed';t.view.revision=(t.view.revision??0)+1;t.read=undefined;t.needsRead=false;t.best=undefined;}
        const changed=!t.prompted&&!bound(t)&&(changedKind||changedLook)&&evidence.motion(c)<=.025&&!c.covered&&!c.partial;
        if(changed){t.nameZoomed=false;t.nameRest=undefined;t.nameRetry=undefined;t.moveAt=undefined;t.identityCheck??={state:t.view.state,cardId:t.view.cardId,result:t.lastResult,reason:t.promptOnly,strongSamples:0};invalidateRead(t);t.view.revision=(t.view.revision??0)+1;t.view.cardId=undefined;t.view.state='candidate';t.view.visible=false;t.needsRead=true;t.promptOnly='changed';t.stableSince=sample.at;t.observations=0;t.best=undefined;}
        // A card under this one (its stale outline) is not a fanned spread.
        if(t.view.state==='candidate'&&!t.promptOnly&&faceCards.some(other=>other!==c&&quadIou(c,other)>0&&!tracks.some(o=>o!==t&&(o.under||lookBlocked(o,c))&&quadIou(o.view.card,other)>.9)))t.promptOnly='spread';
        const sizes=tracks.filter(other=>other!==t&&other.view.state==='identified'&&!other.view.removed).map(other=>{const b=boundsOf(other.view.card.quad);return b.w*b.h;}).sort((a,b)=>a-b),size=boundsOf(c.quad);
        if(sizes.length&&size.w*size.h>sizes[Math.floor(sizes.length/2)]*1.8)t.promptOnly??='uncertain';
        const confident=c.confidence>=.7||backOutline(c)&&cardAspect(c)||boundOutline||frontOutline(c)||c.confidence>=.4&&['GY','BANISHED'].includes(t.view.zone)&&(t.view.state==='candidate'||bound(t)&&sameRotatedFieldAppearance(t.identityAppearance,pixels));
        const clean=!appearanceChanged&&confident&&!c.partial&&!c.covered&&!isCovered(c,faceCards)&&(evidence.motion(c)<=.025||freshFront||readHolds(t,c));
        if(t.identityCheck){if(!clean)t.identityCheck.strongSamples=0;else if(fieldAppearanceDistance(t.identityAppearance,pixels)>=.025)t.identityCheck.strongSamples++;}
        const earlyHolds=!!t.early&&quadIou(t.early.card,c)>=.3&&evidence.motion(artBox(t.early.card))<=.06&&!blocks(t,artBox(t.early.card))&&sameFieldAppearance(t.early.art,evidence.appearance?.(artBox(t.early.card)));
        t.view.visible=!changed&&(!t.identityAppearance?.length||c.kind!=='face-up'||matchesLook(t,pixels))&&(evidence.motion(c)<=.025||earlyHolds)&&(t.view.state==='identified'||t.view.state==='prompt')&&confident&&!c.partial&&!c.covered&&!isCovered(c,faceCards);
        if(clean&&!t.appearance?.length)t.appearance=pixels;
        const still=quadIou(t.anchor,c)>=.84&&distance(t.anchor,c)<.012&&t.kind===c.kind&&t.position===position;
        if(!clean||!still||!Number.isFinite(t.stableSince)) {
          if((!clean||!still)&&!readHolds(t,c))invalidateRead(t);
          t.anchor=c;t.stableSince=clean?sample.at:NaN;if(!still){t.sharpPeak=undefined;t.sharpLearned=false;}t.observations=0;t.best=undefined;t.kind=c.kind;t.position=position;
        }
        // Show earlier: a sure first read whose art pixels still hold names the
        // card now, while a hand or the outline still settles. A confirm read
        // follows once the card is clean and still; it corrects in place.
        const sure=t.read?.result,earlyNow=!clean&&!!sure&&sure.tier==='sure'&&(sure.candidates[0]?.score??0)>=.84&&!sure.quality.fallback&&!sure.quality.covered&&!sure.quality.partial&&!sure.quality.faceDown&&
          t.view.state==='candidate'&&restOk(t)&&!t.binding&&!t.promptOnly&&!t.identityCheck&&!t.view.faceDown&&c.kind==='face-up'&&confident&&!c.partial&&!['DECK','EXTRA','GY','BANISHED'].includes(t.view.zone)&&readHolds(t,c)&&sample.at>t.read!.at;
        if(!clean&&!earlyNow){note(t,t.read?'read waits for a still, clean outline':'outline not still/clean');hold(t,'still');continue;}
        if(clean&&t.early&&t.view.state==='identified'&&!t.read&&!reading&&t.observations>=1&&still){t.early=undefined;t.confirming=true;t.needsRead=true;}
        t.observations++;stage(t,'stable');
        const score=evidence.sharpness(c),scoreOk=sharpOk(t,score,sample.at);
        const vote=t.read?.voting;
        if(vote && vote.length<4 && restOk(t) && clean && still && !blurHold && !handNear(evidence,c) && !handContact(evidence,c) && sameFieldAppearance(t.read?.art,evidence.appearance?.(artBox(c))) && sample.at-(vote.at(-1)?.at??t.read!.at)>=NAME_VOTE_SAMPLE_MS) {
          const voteCrop=evidence.crop?.(c);
          if(voteCrop) {
            const frame=await clone(current);
            if(generation===epoch&&!disposed&&t.read?.voting===vote)vote.push({frame,score:sharpness(voteCrop)*(1-glareMask(voteCrop).share),at:sample.at});
            else closeFieldFrame(frame);
          }
        }
        // One sample per card per settle, never in a blurred frame or while the card moves.
        if(clean&&!blurHold&&still&&!t.sharpLearned&&c.kind==='face-up'&&observation.state==='up'&&!handNear(evidence,c)){t.sharpLearned=true;learnCropSharpness(score);}
        if((!t.best||score>t.best.score)&&!(t.view.state==='candidate'&&c.kind==='face-up'&&handBlocks(t,evidence.touched?.(c))))t.best={frame:current,card:structuredClone(c),score,crop};
        const movingKnown=t.view.state==='identified'&&!t.needsRead&&t.view.faceDown===(c.kind==='face-down');
        // A finished sure read from sharper pixels is still usable while
        // its physical card and art hold, even if this frame is slightly soft.
        const sureSharpRead=(sureFront||nativeSure)&&restOk(t)&&!blurHold&&(t.read?.sharp??0)>=SHARP_LIMIT;
        if(movingKnown?(t.observations<2||sample.at-t.stableSince<100):!(scoreOk||sureSharpRead)){if(!movingKnown)hold(t,'sharp');continue;}
        const wasFaceDown=t.view.faceDown;
        t.view.faceDown=c.kind==='face-down';t.view.position=position;
        if(t.reappeared&&restOk(t)&&!gripWait.has(t)&&!handContact(evidence,c)){if(t.view.state==='identified')emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;t.reappeared=false;}
        if(t.view.state==='identified') {
          t.pose=undefined;
          if(t.announced&&restOk(t)&&!gripWait.has(t)&&!handContact(evidence,c)&&(quadIou(t.announced,c)<.7||distance(t.announced,c)>.02||t.announcedZone!==t.view.zone||t.announcedPosition!==position)){
            emit('moved',t);t.announced=c;t.announcedZone=t.view.zone;t.announcedPosition=position;t.moveAt=undefined;
          }
          if(wasFaceDown!==t.view.faceDown){emit('flipped',t);t.needsRead=!t.view.faceDown&&!t.view.cardId;if(t.needsRead)t.identityAppearance=undefined;}
        }
        t.halo=evidence.halo?.(c);t.appearance=pixels;
        // A read of a new card is used only while the card rests on the mat: a card held above it goes to the held path.
        if((t.view.state==='candidate'||t.read?.background)&&t.read&&(t.read.result||t.read.error)&&!restOk(t)){note(t,`read waits: ${t.rest?.text??'not resting yet'}`);continue;}
        if(t.read&&(t.read.result||t.read.error)&&sample.at>t.read.at) {
          const pending=t.read,weakSideways=(t.view.state==='candidate'||!!t.read.background)&&weakSidewaysRead(pending.result,position);
          const result=pending.result&&(weakSideways||pending.verifyOnly&&!sureName(pending.result))?{...pending.result,tier:'low match' as const}:pending.result;
          t.read=undefined;
          if(weakSideways)note(t,`sideways read below ${SIDEWAYS_NAME_MIN}: ask, do not name`);
          if(pending.background){
            if(!restOk(t)||!still||blurHold||handNear(evidence,c)||handContact(evidence,c)){t.needsRead=false;t.best=undefined;continue;}
            // A background attempt may settle a question only with a sure, unflagged name.
            if(!sureName(result)){t.needsRead=false;t.best=undefined;continue;}
            if(t.view.state==='identified'){
              t.nameRetry=undefined;t.prompted=false;t.view.nameCandidates=undefined;t.view.bestMatch=undefined;
              t.awaitingName={previous:t.view.cardId,next:result!.candidates[0].cardId};
              t.view.cardId=result!.candidates[0].cardId;t.identityAppearance=pixels;t.identityEmbedding=result?.identityEmbedding;t.latestEmbedding=t.identityEmbedding;t.lastResult=result;
              emit('placed',t,{result});continue;
            }
            t.nameRetry=undefined;t.prompted=false;
          }
          metrics.latencyMs=now()-t.view.firstSeen;
          // An early read can include a hand at the card edge. If it is not sure and
          // the card itself has changed since (the hand left), read once more
          // rather than ask the player.
          if(result&&result.tier!=='sure'&&!pending.verifyOnly&&!t.rereadEarly&&t.view.state==='candidate'&&pending.appearance?.length&&
            (!sameFieldAppearance(pending.appearance,pixels)||result.tier==='low match'&&readBeforeRest(t,pending))){
            t.rereadEarly=true;t.needsRead=true;t.best={frame:current,card:structuredClone(c),score,crop:evidence.crop?.(c)};note(t,'early read not sure; reading again');
            if(!reading){await startRead(t,current,c,t.best.crop,sample.at,generation);t.best=undefined;}continue;
          }
          // Context narrows the question, never the automatic identity threshold for a new stack top.
          if(t.view.state==='candidate'&&result?.tier!=='sure'&&stackMonsters(t,c).length>=2){
            t.needsRead=false;t.view.state='prompt';t.view.visible=true;t.view.faceDown=false;t.identityAppearance=pixels;
            note(t,'unread stack top: ask for identity');emit('prompt',t,{result,reason:'uncertain'});continue;
          }
          const safe=result&&result.tier!=='low match'&&result.candidates[0]&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&result.candidates[0].cardId!==options.profile.cardBack.cardId;
          const tentative=options.placeUnsure&&t.view.state==='candidate'&&!t.binding&&!t.promptOnly&&!t.identityCheck&&!pending.background&&!pending.verifyOnly&&restOk(t)&&still&&!blurHold&&!handNear(evidence,c)&&!handContact(evidence,c)&&fieldSlot(t.view.zone)&&result?.tier==='low match'?unsureNameCandidates(result,options.profile.cardBack.cardId):undefined;
          if(tentative){t.view.nameCandidates=tentative;t.nameRetry={attempts:0,nextAt:now()+NAME_RETRY_MIN_MS};}
          let winner=safe?result!.candidates[0].cardId:tentative?.[0].cardId;
          const lockedRef=t.view.faceDown&&!t.binding?undefined:lockFor(t.binding?.id??t.view.id),locked=lockHolds(lockedRef,result,pixels)?lockedRef:undefined;
          if(result&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown&&pending.crop)faceState.front=pending.crop;
          // A failed reveal must neither restore private identity nor publish an unnamed front.
          if(t.binding?.faceDown&&!safe&&!locked){
            // The first clean front can still be soft just after the turn.
            // Try one fresh frame before asking; identity admission stays unchanged.
            if(!t.rereadEarly&&result?.tier==='low match'&&result.candidates[0]&&!result.quality.fallback&&!result.quality.covered&&!result.quality.partial&&!result.quality.faceDown){
              t.rereadEarly=true;t.needsRead=true;note(t,'weak reveal; retrying a fresh front');continue;
            }
            t.needsRead=false;t.identityAppearance=pixels;t.view.visible=true;t.best=undefined;t.view.state='prompt';emit('prompt',t,{result,reason:pending.error?'recognition-error':'uncertain'});continue;
          }
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
            // A read that is not sure and came from a soft crop (below the full limit) never replaces a known name: ask the player.
            if(result?.tier!=='sure'&&(pending.sharp??SHARP_LIMIT)<SHARP_LIMIT){t.view.state='prompt';emit('prompt',t,{...(result?{result:{...result,candidates:result.candidates.slice(0,5)}}:{}),latencyMs:metrics.latencyMs,reason:'changed'});continue;}
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
            if(remembered.kind==='hold'||!remembered.cardId){t.view.state='dismissed';t.userDismissed=remembered.kind==='match'&&!remembered.cardId;t.prompted=true;t.identityAppearance=pixels;t.best=undefined;continue;}
            winner=remembered.cardId;
          }
          // A locked card is never re-guessed: a lower or equal read keeps its name.
          if(locked&&winner!==locked.cardId&&!beatsLock(locked,result)){winner=locked.cardId;note(t,'identity locked');}
          if(tentative&&winner!==tentative[0].cardId){t.view.nameCandidates=undefined;t.nameRetry=undefined;}
          const deck=options.getPriors?.()?.decklist;
          const inDeck=!!winner&&!!deck?.some(id=>String(id)===winner)&&!result?.quality.notInDecklist;
          const pile=['GY','BANISHED','DECK','EXTRA'].includes(t.view.zone);
          // Follow physical lifts. Pile history needs touch or top-change evidence;
          // an unchanged top remains a separate copy from a new field outline.
          const known=options.getKnownCards?.();
          // A new outline on top of a confirmed card that reads as that card (glare, shadow, a turn to the other battle
          // position) is that card: it takes the outline back. No new ref, no "placed".
          const lies=(o:InternalTrack)=>{const a=boundsOf(o.view.card.quad),b=boundsOf(c.quad),cx=a.x+a.w/2,cy=a.y+a.h/2;return cx>=b.x&&cx<=b.x+b.w&&cy>=b.y&&cy<=b.y+b.h;};
          const beneath=t.newOutline&&!t.binding?tracks.find(o=>o!==t&&bound(o)&&!o.view.removed&&fieldSlot(o.view.zone)&&
            (!o.view.visible&&(o.under===t.view.id||!matched.has(o)&&lies(o))||
              !!winner&&winner===o.view.cardId&&o.view.zone===t.view.zone&&quadIou(o.announced??o.view.card,c)>=.7)):undefined;
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
              face:readyReplacement&&shiftedSet.face?{...shiftedSet.face,setCardId:undefined}:{gate:trackFaceGate()},resolvedAt:undefined,binding:undefined,placeholder:false,placeholderId:undefined,newOutline:!readyReplacement,setRecovery:!readyReplacement,read:undefined,best:undefined,
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
        t.lastSharp=best.score;
        await startRead(t,best.frame,best.card,best.crop,sample.at,generation);t.best=undefined;
      }
      // A card never stays on Identifying. A new card that showed the reading cue (or began a read) and still has no name after
      // IDENTIFY_DEADLINE_MS asks the player, whatever held it back (soft frames, a colour cast, a changing look, a read nobody consumed).
      for(const t of tracks){
        if(t.view.state!=='candidate'||t.view.removed||t.binding||t.identityCheck||t.promptOnly==='suppressed'||!(t.placeholder||t.read)||!fieldSlot(t.view.zone)||!restOk(t)){t.identifyingSince=undefined;continue;}
        t.identifyingSince??=sample.at;
        // Reads run one at a time, so a queued card waits for the others too; a hand on the card waits for the hand.
        if(handNear(evidence,t.view.card))continue;
        if(sample.at-t.view.lastSeen>500||sample.at-t.identifyingSince<IDENTIFY_DEADLINE_MS*(reading?2:1))continue;
        // Never sharp enough to read (soft camera): the first such card keeps its Reading card for 3 deadlines and raises ONE camera hint per sitting; any other card, or that card after 3 deadlines, is asked as usual.
        if(!t.read&&!t.lastResult&&t.lastSharp!==undefined&&t.lastSharp<sharpLimit()&&(!softHinted||softTrack===t)&&sample.at-t.identifyingSince<3*IDENTIFY_DEADLINE_MS){if(!softHinted){softHinted=true;softCamera=true;softTrack=t;}continue;}
        const result=t.read?.result??t.lastResult;
        // A look the player already dismissed stays quiet; any other gallery answer still asks, remembered name first.
        const answer=gallery.resolve(result?.identityEmbedding);
        const look=t.read?.appearance??t.appearance;
        t.read=undefined;t.needsRead=false;t.best=undefined;t.identifyingSince=undefined;
        if(answer.kind==='match'&&!answer.cardId){t.prompted=true;t.userDismissed=true;t.view.state='dismissed';note(t,'still identifying; the player dismissed this look');continue;}
        let shown=result?{...result,candidates:result.candidates.slice(0,5)}:undefined;
        if(shown&&answer.kind==='match'&&answer.cardId){const known=shown.candidates.find(c=>c.cardId===answer.cardId);shown={...shown,candidates:[{cardId:answer.cardId,score:known?.score??shown.candidates[0]?.score??0,prior:'remembered'},...shown.candidates.filter(c=>c.cardId!==answer.cardId)].slice(0,5)};}
        t.identityAppearance=look;t.identityEmbedding=result?.identityEmbedding;t.askAnyway=true;
        t.view.state='prompt';t.view.visible=true;note(t,'still identifying; asking the player');
        emit('prompt',t,{...(shown?{result:shown}:{}),latencyMs:metrics.latencyMs,reason:t.promptOnly??'uncertain'});t.askAnyway=undefined;
      }
      restPrev=restNext;restNext=[];
      if(tracks.some(t=>t.best?.frame===current)){retained.add(current);current=undefined;}
      // Release stale candidates (longer while a hand is over the cell); dismissed tracks expire only after full detector passes above.
      for(let i=tracks.length-1;i>=0;i--)if(tracks[i].view.state==='candidate'&&!tracks[i].prompted&&sample.at-tracks[i].view.lastSeen>(handNear(evidence,tracks[i].view.card)?CANDIDATE_ARM_MS:3000))tracks.splice(i,1);
      // Keep recent departures for Undo/reappearance without consuming live slots.
      const retired=tracks.filter(t=>t.view.removed&&t.view.state==='identified').sort((a,b)=>departureAt(b.view)-departureAt(a.view));
      for(const t of retired.filter((t,i)=>i>=maxTracks||sample.at-departureAt(t.view)>30000))tracks.splice(tracks.indexOf(t),1);
      pruneFrames();
    } catch(cause) {
      if(generation===epoch&&!disposed){error=cause instanceof Error?cause.message:String(cause);if(/Waiting for (a camera frame|the own camera buffer)/.test(error)){status='starting';error=undefined;}else{status='error';metrics.errors++;warnOnce('tick',error,cause);}interruptWindow();}
    } finally {
      if(detectFrame)closeFieldFrame(detectFrame);if(current)closeFieldFrame(current);
      const elapsed=Math.max(0,now()-start);
      // Startup/model downloads and occasional recognition are not the continuous detector load.
      // Cheap cached pixel samples are not detector measurements. Mixing them
      // into the EMA makes idle scans run too often and blocks the next arrival.
      const regularMs=Math.max(0,elapsed-zoomMs);
      if(detectorRan||zoomMs>0)ema=ema?ema*.8+elapsed*.2:elapsed;
      // A bounded placement burst takes priority over the idle CPU budget. With
      // a 100 ms detector, a 20% budget otherwise stretches each confirmation
      // to 500+ ms and defeats the 1–2 second identification target.
      const settling=settlingNow();
      if(priorityPass)metrics.priorityPassMs=regularMs;
      if(detectorRan&&pacing)pacer.spend(regularMs,now(),detectorWasMoving,detectorDebt);
      // GPU inference leaves the CPU free; still leave room for input/rendering
      // and back off with detector load. Unknown providers keep the WASM guard.
      const gpu=options.recognizer.detectorBackend==='webgpu',scanBudget=gpu&&options.cpuBudget===undefined ? .5 : budget;
      const interval=Math.max(gpu?66:250,Math.min(5000,ema/scanBudget));
      metrics.intervalMs=pacing?pacer.gap(now()):settling?(gpu?Math.max(100,interval):100):interval;metrics.dutyPercent=pacing?pacer.duty(now()):Math.min(100,100*ema/metrics.intervalMs);
      if(pacing)guarded=now()-budgetWaitAt<2000;else if(metrics.intervalMs>650)guarded=true;else if(metrics.intervalMs<450)guarded=false;
      if(status==='watching'||status==='budget')status=guarded?'budget':'watching';
      for(const {read,track} of zonePreviews.values()){
        if(!zoneEnabled()||now()-read.frameAt>ZONE_READ_MS||zoneInstant?.movedSince(read.zone,read.frameAt)||
          track&&(!tracks.includes(track)||track.missed||track.view.removed||track.view.zone!==read.zone||track.promptOnly||
            (track.view.state==='candidate'?track.read?.result!==read.result:track.view.cardId!==read.result.candidates[0]?.cardId))||
          !track&&!zoneReads.includes(read))dropZoneRead(read);
      }
      arrivalReads.clear();inFlight=false;notify();
    }
  }
  function schedule() {if(!active)return;clearTimeout(timer);timer=setTimeout(async()=>{const start=now();await tick();if(!active)return;if(wakeQueued){wakeQueued=false;schedule();return;}const wanted=pacing?pacer.tickMs(pacedStill?'still':pixelBurst()||urgentActive?'burst':'active'):Math.min(pixelBurst()?33:66,metrics.intervalMs);scheduleAfter(Math.max(0,wanted-(now()-start)));},0);}
  function scheduleAfter(delay:number) {if(!active)return;const asked=now(),wasHidden=hidden();timer=setTimeout(()=>{if(!wasHidden&&!hidden())pacer.late(now()-asked-delay);schedule();},delay);}
  function stop() {active=false;epoch++;zoneOff=true;zoneInstant?.stop();resetZoneReads();heldReader.reset();clearTimeout(timer);interruptWindow();piles.clear();status='stopped';notify();}
  return {
    tick,
    /** Diagnostics and tests: one grey camera frame into the instant zone path. The host loop does this itself on a timer. */
    pushZoneFrame(frame:GrayFrame,at=now()){zoneInstant??=makeZoneInstant();zoneInstant?.push(frame,at);},
    zoneInstantStats(){return zoneInstant?.stats();},
    finishInstantPreview(id:string){
      for(const {read,track} of zonePreviews.values())if(track?.view.id===id){dropZoneRead(read);notify();break;}
    },
    start() {
      if(active||disposed)return;active=true;status=options.recognizer.prepare?'starting':'watching';notify();zoneOff=false;zoneInstant??=makeZoneInstant();zoneInstant?.start();
      if(options.recognizer.prepare) {
        const generation=epoch;
        void options.recognizer.prepare(preparation()).then(()=>{if(generation===epoch&&!disposed&&active){status='watching';schedule();notify();}}).catch(cause=>{if(generation===epoch&&!disposed){active=false;status='error';error=cause instanceof Error?cause.message:String(cause);metrics.errors++;warnOnce('prepare',error,cause);notify();}});
      }else schedule();
    },
    stop,
    /** Shared blur measure: last whole-frame sharpness, and whether removals hold for blur now. */
    frameSharpness(){return {value:sharpNow,baseline:sharpBase,ratio:sharpBase>0?sharpNow/sharpBase:1};},
    isBlurred(){return blurHold;},
    /** The camera lock, anti-glare or exposure changed: learn the sharpness and shadow baselines again from the next frames. */
    resetBaselines(){lastFieldActivityAtByZone={};exposedTops.clear();startupAppearance=undefined;emptyLooks.clear();blindScans.clear();blindShape.clear();blindMisses.clear();blindZones.clear();blindSleevesSeen.clear();handZones.clear();blindCountAt.clear();setFollowUpAt.clear();zoomCells.clear();zoomPendingZones.clear();zoomDeparturePending.clear();zoomCheckedAt.clear();stackLooks.clear();zoomDeckAt=-Infinity;zoomDeckGone=false;zoomDeckContactSince=undefined;pileClear.clear();pileContacts.clear();shadowCells=undefined;sharpBase=0;removalSharpBase=0;removalBlurred=false;cropBase=0;cropSamples=0;for(const t of tracks){t.sharpPeak=undefined;t.sharpLearned=false;t.readCache=undefined;}sharpNow=0;blurredAt=-Infinity;blurHold=false;blurSince=undefined;shadowMovedAt=-Infinity;shadowHold=false;shadowShare=0;analyze.reset?.();notify();},
    dispose(){stop();zoneInstant?.dispose();disposed=true;for(const t of tracks){t.best=undefined;t.face=undefined;}pruneFrames();listeners.clear();updates.clear();},
    subscribe(listener:(event:FieldEvent)=>void){listeners.add(listener);return()=>{listeners.delete(listener);};},
    subscribeState(listener:()=>void){updates.add(listener);return()=>{updates.delete(listener);};},
    getSnapshot({includeMissingSetLooks=false}:{includeMissingSetLooks?:boolean}={}):FieldSnapshot{
      const stableBlindSleeves=[...blindSleevesSeen].filter(([zone,{look}])=>{
        const box=cellOf(zone),evidence=latestEvidence;
        if((blindScans.get(zone)??0)<1||!box||!evidence||removalHold(box)||handNear(evidence,box)||evidence.motion(box)>.025)return false;
        const current=evidence.appearance?.(box);
        return medianGap(look,current)<=SET_BRIDGE_LOOK&&sameFieldAppearance(look,current);
      });
      const at=now(),trackViews=tracks.map(t=>{
        const track=copy(t.view),sample=glareSamples.get(t);
        const glare=sample&&sample.revision===track.revision&&!t.identityCheck&&t.promptOnly!=='suppressed'?fieldGlareNotice(track,sample,at,sample.candidates):undefined;
        return glare?{...track,glare}:track;
      });
      return {
      ...(zonePreviews.size&&zoneEnabled()?{instantPreviews:[...zonePreviews.values()].flatMap(({read,track})=>
        at-read.frameAt<=ZONE_READ_MS&&!zoneInstant?.movedSince(read.zone,read.frameAt)?
          [{id:track?.view.id??`instant-${read.zone}-${read.frameAt}`,zone:read.zone,cardId:read.result.candidates[0].cardId}]:[])}:{}),
      lastFieldActivityAtByZone:{...lastFieldActivityAtByZone},
      fieldActivityWindowMs:fieldActivityWindow(),
      fieldActive:Object.values(lastFieldActivityAtByZone).some(at=>now()-at<=fieldActivityWindow()),
      ...(zoomCheckedAt.size?{zoomCheckedAt:Object.fromEntries(zoomCheckedAt)}:{}),
      ...(zoomDeparturePending.size?{zoomDeparturePending:[...zoomDeparturePending]}:{}),
      ...(includeMissingSetLooks?{missingSetLooks:tracks.flatMap(t=>{
        if(t.view.removed||!t.view.faceDown||!bound(t)||!setFollowUpZone(t.view.zone))return [];
        const evidence=latestEvidence;if(!evidence)return [];
        const spot=t.announced??t.view.card,look=evidence.appearance?.(spot),old=t.setBackLook??t.identityAppearance;
        return handNear(evidence,spot)||!!old?.length&&!!look?.length&&(!sameFieldAppearance(old,look)||medianGap(old,look)>SET_BRIDGE_LOOK)?[t.view.id]:[];
      })}:{}),
      ...(softCamera?{softCamera:true}:{}),held:heldReader.snapshot(),...(lastMotionAt!==undefined?{lastMotionAt}:{}),...(untracked?{untracked}:{}),...(gridShift?{gridShift:{...gridShift}}:{}),blur:{sharpness:sharpNow,ratio:removalSharpBase>0?sharpNow/removalSharpBase:1,hold:removalBlurred||blurHold,limit:sharpLimit()},shadow:{share:shadowShare,hold:shadowHold},missingTwins:[...missingTwins],blindZones:[...blindZones],...(zoomPendingZones.size?{zoomPendingZones:[...zoomPendingZones]}:{}),blindSleeveAt:Object.fromEntries(stableBlindSleeves.map(([zone,{at}])=>[zone,at])),
      blindSleeveSince:Object.fromEntries(stableBlindSleeves.map(([zone,{since}])=>[zone,since])),handZones:[...handZones],missingPiles:[...pilePresence].flatMap(([zone,p])=>p.present||deckZone(zone)&&piles.get(zone)?.down?[]:[zone]),pileTouchedAt:Object.fromEntries([...pileTouches].filter(([zone])=>publicPile(zone))),pileContactAt:Object.fromEntries(pileContacts),...(Number.isFinite(deckTouchedAt)||Number.isFinite(extraTouchedAt)?{deckTouchedAt:{...(Number.isFinite(deckTouchedAt)?{DECK:deckTouchedAt}:{}),...(Number.isFinite(extraTouchedAt)?{EXTRA:extraTouchedAt}:{})}}:{}),pileClearSince:Object.fromEntries(pileClear),lastFullAt:Number.isFinite(lastFullDetectionAt)?lastFullDetectionAt:undefined,...(Number.isFinite(lastScanAt)?{lastScanAt,lastScanBacks:[...lastScanBacks],lastScanOffFrame:[...lastScanOffFrame]}:{}),status,tracks:trackViews,piles:[...piles].flatMap(([zone,pile])=>pile.down&&now()-pile.keptAt<=PILE_GONE_MS?[{zone,card:structuredClone(pile.card)}]:[]),metrics:{...metrics},error,
      debug:{at:debugAt,path:debugTick,full:debug?.full??false,region:debug?.region,detections:debug?.detections??[],...(debug?.pileScores?{pileScores:debug.pileScores}:{}),reasons:Object.fromEntries(tracks.map(t=>[t.view.id,`${t.rest?.text?`${t.rest.text} · `:''}${t.read?'reading identity · ':''}${t.promptOnly?`prompt only (${t.promptOnly}) · `:''}${t.reason??''}${t.view.setEvidence?` · Set ${JSON.stringify(t.view.setEvidence)}`:''}${t.lastResult?.prior?` · prior: ${t.lastResult.prior}`:''}`]))}};},
    setCalibration(value?:FieldCalibration){resetZoneReads();lastFieldActivityAtByZone={};exposedTops.clear();calibration=value;cameraCells=readCells();cellQuads=new WeakMap();gridOffPasses=0;gridShift=undefined;untracked=0;heldReader.reset();if(status!=='starting')epoch++;interruptWindow();piles.clear();emptyLooks.clear();blindScans.clear();blindShape.clear();blindMisses.clear();blindZones.clear();blindSleevesSeen.clear();handZones.clear();blindCountAt.clear();setFollowUpAt.clear();zoomCells.clear();zoomPendingZones.clear();zoomDeparturePending.clear();zoomCheckedAt.clear();stackLooks.clear();zoomDeckAt=-Infinity;zoomDeckGone=false;zoomDeckContactSince=undefined;pileClear.clear();pileContacts.clear();restSize=undefined;restSizes.clear();for(const t of tracks){t.prompted=false;t.view.revision=(t.view.revision??0)+1;t.view.zone=mapFieldZone(t.view.card,calibration,[],options.format).zone;t.announcedZone=undefined;}notify();},
    confirm(id:string,cardId?:string,ref?:string,human=true){const lock=locks.get(id);if(ref&&lock&&(!cardId||lock.cardId===cardId)&&!locks.has(ref))locks.set(ref,lock);const t=tracks.find(t=>t.view.id===id);if(human&&cardId)for(const key of [id,ref])if(key)locks.set(key,{cardId,score:Infinity,at:now(),embedding:t?.latestEmbedding??t?.identityEmbedding,look:t?.identityAppearance?.slice()});if(t){if(human){t.nameRetry=undefined;t.view.nameCandidates=undefined;}if(human&&t.promptOnly==='card-presence'){rememberSetBack(setMemory,setLooks.get(t)??[]);options.onSetMemoryChange?.();}t.awaitingName=undefined;t.prompted=false;t.setRecovery=false;t.pose=undefined;t.read=undefined;const other=tracks.find(other=>other!==t&&other.view.id===ref);if(other&&(other.view.removed||!other.view.visible))tracks.splice(tracks.indexOf(other),1);if(ref&&!tracks.some(other=>other!==t&&other.view.id===ref))t.view.id=ref;t.view.visible=!t.missed;for(let i=suppressed.length-1;i>=0;i--)if(sameFieldAppearance(suppressed[i].appearance,t.appearance)||quadIou(suppressed[i].card,t.view.card)>.5)suppressed.splice(i,1);if((human||ref&&ref!==id)&&!t.view.faceDown&&t.face&&cardId!==t.face.setCardId)t.face.setCardId=undefined;if(!t.view.faceDown&&cardId&&!t.view.nameCandidates)gallery.remember(t.latestEmbedding,cardId);t.view.cardId=t.view.faceDown?undefined:cardId;if(!t.view.faceDown&&cardId&&t.face?.front)t.face.reference={crop:t.face.front,embedding:t.latestEmbedding};t.realLook=undefined;t.identityAppearance=t.appearance?.slice();t.identityEmbedding=t.latestEmbedding;t.identityCheck=undefined;t.resolvedAt=now();t.promptOnly=undefined;t.binding=undefined;t.view.state='identified';t.needsRead=false;t.announced=t.view.card;t.announcedZone=t.view.zone;t.announcedPosition=t.view.position;t.moveAt=undefined;t.best=undefined;pruneFrames();notify();}},
    setGuards(value:Partial<SetGuards>){const next={...DEFAULT_SET_GUARDS,...value};if(next.positiveBack===setGuards.positiveBack&&next.prompt===setGuards.prompt&&next.ignore===setGuards.ignore&&next.startup===setGuards.startup&&next.handRelease===setGuards.handRelease)return;setGuards=next;for(const t of tracks)if((t.view.state==='dismissed'||t.promptOnly==='card-presence')&&t.view.setEvidence){rearm(t,'Set safeguards changed');}notify();},
    acceptSet(id:string){const t=tracks.find(t=>t.view.id===id);if(!t||t.promptOnly!=='card-presence'||t.view.removed||!t.view.visible)return false;
      const heldChoice=handPrompts.has(t)&&!t.missed&&now()-t.view.lastSeen<=500&&planeVerdict(t.view.card).ok&&(latestEvidence?.motion(t.view.card)??1)<=.025;
      if(handPrompts.has(t)?!heldChoice:!restOk(t))return false;setDecision(t,'committed','player');return true;},
    notACard(id:string){let t=tracks.find(t=>t.view.id===id);if(!t){const known=options.getKnownCards?.().find(k=>k.id===id),card=known?.card??(known?cellOf(known.zone):undefined);if(!known||!card||known.zone==='HAND')return;t={view:{id,card,zone:known.zone,faceDown:true,position:'attack',state:'dismissed',firstSeen:now(),lastSeen:now(),removed:false},anchor:card,missed:false,stableSince:now(),observations:0,missingSamples:0,kind:'face-down',position:'attack',needsRead:false};tracks.push(t);}t.view.setEvidence??={detector:t.view.card.confidence,pixel:'unknown',pixelConfidence:0,sd:null,backDistance:null,positive:false,basis:'none',decision:'waiting'};rejectObject(t,'not-a-card');t.view.revision=(t.view.revision??0)+1;notify();},
    dismiss(id:string){const t=tracks.find(t=>t.view.id===id);if(t){t.nameRetry=undefined;t.userDismissed=true;t.softDismiss=false;t.pose=undefined;t.read=undefined;if(t.view.state!=='identified')gallery.remember(t.latestEmbedding);t.prompted=true;if(t.view.removed)t.restoredAt=now();t.resolvedAt=now();t.identityCheck=undefined;t.identityEmbedding=t.latestEmbedding;if(t.view.state!=='identified')t.view.state='dismissed';t.needsRead=false;t.best=undefined;pruneFrames();notify();}},
    /** "Scan field": the next sample runs a full-frame detector pass at once. `gentle` (automatic scans) keeps every player dismissal quiet. */
    // Every dismissed card in view reads again, including player dismissals. The shared
    // gallery persists its cleared unnamed entries through its change callback.
    scanNow({gentle=false}:{gentle?:boolean}={}){if(!gentle)gallery.clearDismissed();scanSweep=2;lastScanAt=-Infinity;lastScanBacks=[];lastScanOffFrame=[];scanBacks.clear();scanPiles.clear();scanPileSeen.clear();for(const t of tracks){t.scanHit=false;t.nameZoomed=false;t.nameRest=undefined;if(t.view.state==='dismissed'&&!t.view.removed){if(gentle&&t.userDismissed)continue;t.rearms=0;rearm(t,'Scan field');}else if(t.view.state==='candidate'&&!t.read){t.needsRead=true;t.unsureReads=0;t.handWaitAt=undefined;t.faceWaitAt=undefined;}}for(const miss of twinMisses.values()){miss.emits=0;miss.emittedAt=undefined;}scanRequested=true;wake();},
    forget(id:string){const i=tracks.findIndex(t=>t.view.id===id);if(i>=0){suppressed.push({card:tracks[i].view.card,appearance:tracks[i].identityAppearance??tracks[i].appearance,halo:tracks[i].halo,samples:0});if(suppressed.length>maxTracks)suppressed.shift();tracks.splice(i,1);}pruneFrames();notify();},
  };
}
export type FieldWatcher=ReturnType<typeof createFieldWatcher>;

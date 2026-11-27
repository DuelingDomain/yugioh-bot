"use client";
import { recognitionPriorsFor, registeredDeckPasscodes } from "@/lib/remote/recognition-priors";

import {useCallback,useEffect,useMemo,useRef,useState,type RefObject} from 'react';
import {catalogCardId,fieldCenter,onMat,fieldGlareChoices,fieldZoneLocation,fieldStackUnder,yugioh,type HeldCardEvent,type HeldUnsureEvent,type FieldEvent,type FieldSnapshot,type FieldTrack,type FieldZone,type KnownFieldCard,type FieldCalibration,fieldPacerDevice,FIELD_ACTIVITY_WINDOW_MS,FIELD_SET_RETURN_MS} from '@yugidraft/vision';
import {useSendHealth} from '@/lib/remote/send-health-store';
import {markVideoOfferShown,readVideoChoice,VIDEO_OFFER_MS,videoOfferShown} from '@/lib/remote/video-rate';
import {createSlowWatch,isWeakDevice,markTapOfferShown,noteTapReason,readTapChoice,saveTapChoice,tapOfferShown,TAP_OFFER_MS,type TapChoice} from '@/lib/remote/tap-offer';
import {isTournamentTable,readTournamentMode,saveTournamentMode,stateMode,ownDetectionMode,type TournamentMode,type TournamentModeReason} from '@/lib/remote/tournament-detection';
import {RemoteDuelError,remoteActivationLimit,remoteActivationNotice,remoteHandActivationDecision,remoteHandReadDecision,remotePhysicalSlot,REMOTE_HAND_SUGGESTION_EVENT,recentFieldDeparture,REMOTE_UNREAD_PILE_MS,type RemoteRoom,type RemoteSummonKind,type RemoteUndoEntry,type TwinCard} from '@yugidraft/shared/remote';
import {laneOf,PILE_LANES} from '@/lib/remote/room-mutations';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {NOT_A_CARD_EVENT} from '@/lib/remote/set-card-diagnostics';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {e2eFieldHook} from '@/lib/remote/e2e-field-hook';
import {changedPile,PILE_NEAR_MS,PILE_ACTION_CAP_MS,PILE_CONTACT_LEAD_MS,fieldPositionMatches,applyFieldFaceFlip,fieldFaceProposal,fieldSetMove,fieldStrongBack,fieldTwinPosition,fieldDepartureProposal,fieldGyDepartureProposal,fieldNamedBanish,fieldDepartureStillMissing,fieldPileEvidence,fieldPileTrackEvidence,fieldLeaveLabel,FIELD_LEAVE_DESTINATIONS,heldFieldReadPending,fieldPlacementProposals,fieldEvidenceMatches,simultaneousFieldCopies,applyVerifiedFieldMutation,StaleFieldPlacementError,observedFieldZone,staleFieldOccupant,retryFieldMutation} from '@/lib/remote/field-proposals';
import {OutageGaveUpError,onOutageEnd,outageDown} from '@/lib/remote/outage';
import {createFieldFaceCheck,type FieldFaceFix} from '@/lib/remote/field-face';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {givenSpotHolds,type GivenSpot} from '@/lib/remote/given-hold';
import {onManualMove,requestManualZone} from '@/lib/remote/manual-moves';
import {correctionsFor,cameraCorrectionBlocked} from '@/lib/remote/manual-corrections';
import {createChangedZones} from '@/lib/remote/changed-zones';
import {createQuietCheck,quietCheckEnabled} from '@/lib/remote/quiet-check';
import {projectFieldZone,tokenInCell,freeFieldZones,fieldCandidateFitsZone,hardFieldZone,isFieldSpell,zoneMoveLabel,equipSourceOnField,becomesTrapMonster,nearestFreeMonsterZone,fieldZoneLabel} from '@/lib/remote/field-legality';
import {bindFieldTiming,markFieldTiming,bindBackTiming,fieldCameraStamp,playerStamp} from '@/lib/remote/field-timing';
import {behaviourOf} from '@/lib/remote/card-behaviour';
import {saveLocalFieldDiagnostic} from '@/lib/remote/field-diagnostics';
import {ownFieldResources,detectCards,prepareOwnReader,readerBusy} from './ui/recognizer';
import {RecognitionBadge,RecordingBadge} from './ui/recognition-setting';
import {useTestRecording,type RecordingCalibration} from './ui/use-test-recording';
import {useRecognitionBackend,gpuLossReason} from './ui/recognition-backend';
import {useVideoHub} from './ui/video-hub';
import type {RescanReply} from '@/lib/remote/video-protocol';
import {cardCode,sameObservedCard,deckIdsOf,facingSeat,hasExtraZones,mirrorEmz,placedTwin} from './ui/model';
import {proxyAtLanding,proxyClashLabel} from './ui/placement';
import {FieldCalibrationControl} from './field-calibration';
import {NOTIFY_OPEN_EVENT} from './ui/notify-dock';
import {publishZoneGrid,clearZoneGrid,defaultSideFor,fieldDebugEnabled,publishFieldDebug,publishMissingPiles,publishFieldScan} from '@/lib/remote/zone-grid';
import {publishScanAdvice,clearScanAdvice,scanReason,type ScanAdvice} from '@/lib/remote/scan-advice';
import {clipAction} from '@/lib/remote/clip-capture';
import {nextFieldGhosts,setFieldGhosts,blockGhostCell,newGhostState} from '@/lib/remote/field-ghosts';
import {FieldWatcherUI} from './field-watcher-ui';
import {serverNow} from './ui/api';
import {cardFailed,cardInfo,loadCards,useCardInfo} from './ui/catalog';
import {holdFieldLatencyLog} from '@/lib/remote/field-profile';
import {fieldSummonKind,fieldSummonMaterials,fieldSummonMinimum,fieldSummonNotice,heldStackStillStacked,fieldKeepsMonsterStack,fieldStackXyzCandidates,SUMMON_WINDOW_MS,SUMMON_RECENT_MS,type FieldVanish} from '@/lib/remote/field-summons';
import {distinctFieldQuads,fieldCellEvidence,fieldDepartureHasBack,fieldDepartureActivityAt,fieldDepartureDeadline,fieldEmptyProofs,fieldFlipDepartureWait,fieldEvidenceMismatch,fieldSureSetRead,fieldSureSetReveal,fieldSetRebind,fieldSetReturn,fieldSetSlide,fieldSetSlideDeadline,fieldSetSlidePending,fieldSetSlidePileActivity,recentCommittedSet,xyzAttachTargets,type FieldCellEvidence} from '@/lib/remote/field-proposals';

const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
/** A removed field card goes to the hand this long after the watcher's removal (it may still flip back or be a material). */
const DEPARTURE_WAIT_MS=600,PILE_DEPARTURE_CAP_MS=1600;
/** A face-up camera placement waits at most this long for the card's facts (type, level). The name is known already; the zone-rule effect fixes a hard-rule row once the facts arrive. */
const FACTS_WAIT_MS=300;
/** A Spell/Trap placement and the abstain-and-reload of a card whose facts are still loading wait at most this long for the facts. The card catalog's own lookup deadline is 10 s; no placement may wait for it. */
const SPELL_FACTS_WAIT_MS=1000,SLOW_FACTS_CAP_MS=1000;
/** `lookup`, or an earlier end after `ms`. Never rejects. */
function cappedFacts(lookup:Promise<void>,ms:number):Promise<void> {
  let timer:ReturnType<typeof setTimeout>|undefined;
  return Promise.race([lookup.catch(()=>undefined),new Promise<void>(resolve=>{timer=setTimeout(resolve,ms);})]).finally(()=>clearTimeout(timer));
}
/** The reader's frame class of a Main Deck card that lies in its own row (a non-Extra monster in a Monster Zone, a Spell/Trap in a Spell & Trap Zone). It needs no facts first: the zone-rule effect fixes a hard-rule row once the facts arrive. Pendulum, Field Spells, Trap Monsters and Extra Deck frames keep the wait. */
const mainDeckOwnRow=(frameClass:string|undefined,zone:string)=>/^M[1-5]$/.test(zone)&&['Normal','Effect','Ritual'].includes(frameClass??'')||/^S[1-5]$/.test(zone)&&['Spell','Trap'].includes(frameClass??'');
/** The empty-cell proof can come well after the card left. A new pile card is judged from when the card was last seen (contact alone still from the removal), but never from more than this long before the proof. */
const PILE_LEFT_LOOKBACK_MS=4000;
const departureSince=(sourceAt:number,lastSeen:number|undefined)=>lastSeen===undefined?sourceAt:Math.max(Math.min(sourceAt,lastSeen),sourceAt-PILE_LEFT_LOOKBACK_MS);
const pileActivity=(snap:FieldSnapshot|undefined)=>({
  GY:Math.max(snap?.pileContactAt?.GY??-Infinity,snap?.pileTouchedAt?.GY??-Infinity),
  BANISHED:Math.max(snap?.pileContactAt?.BANISHED??-Infinity,snap?.pileTouchedAt?.BANISHED??-Infinity),
});
const pileNear=(activity:Partial<ReturnType<typeof pileActivity>>|undefined,since:number)=>
  Object.values(activity??{}).some(at=>at!==undefined&&at>=since-PILE_NEAR_MS);
/** Prefer GY when the hand made contact with both piles. */
const contactedPile=(snap:FieldSnapshot|undefined,sourceAt:number):'GY'|'BANISHED'|undefined=>{
  return (['GY','BANISHED'] as const).find(zone=>(snap?.pileContactAt?.[zone]??-Infinity)>=sourceAt-PILE_CONTACT_LEAD_MS);
};
const fieldActivityWindow=(snap:FieldSnapshot|undefined)=>Math.max(FIELD_ACTIVITY_WINDOW_MS,1.5*(snap?.metrics?.intervalMs??0));
const FLIP_POLL_MS=250;
const publicField=(zone:string)=>['monster','extra-monster','spell-trap','field','pendulum'].includes(zone);
/** A card the camera sent from the field to the hand, a pile or the Extra Deck still owns its field origin. */
const leftField=(c:TwinCard,at:number,spot:{zone:string;slot?:number})=>!!c.departedFrom&&publicField(c.departedFrom.zone)&&(c.zone==='hand'||!!c.departedFrom.auto&&['graveyard','banished','extra'].includes(c.zone)&&
  // A card sent to a pile by the rules is the same copy only for 30 s, and (on the field) only for the same zone and slot.
  c.departedFrom.at!==undefined&&at-c.departedFrom.at>=0&&at-c.departedFrom.at<=30_000&&(!publicField(spot.zone)||c.departedFrom.zone===spot.zone&&remotePhysicalSlot(spot.zone,c.departedFrom.slot)===remotePhysicalSlot(spot.zone,spot.slot)));
const sameFieldSlot=(a:TwinCard,b:TwinCard)=>publicField(a.zone)&&a.zone===b.zone&&(a.zone==='field'||(a.slot!==undefined&&a.slot===b.slot));
const piles=new Set<FieldZone>(['GY','BANISHED','DECK','EXTRA']);
const orderedPiles=[['GY','graveyard'],['BANISHED','banished']] as const;
type PublicPile=(typeof orderedPiles)[number][1];
type PileCell=(typeof orderedPiles)[number][0];
const observedPile=(zone:string)=>orderedPiles.find(([physical])=>physical===zone)?.[1];
const mainSlotPattern=/^[MS][1-5]$/;
const physicalZonePattern=/^(?:M[1-5]|S[1-5]|EMZ[12]|FIELD)$/;
/** Maximum interval between a pile change and its matching destination. */
const PILE_EXIT_MS=10_000;
const PILE_REVEAL_WAIT_MS=1000,PILE_REVEAL_RECHECK_MS=200;
const recentPileEvidence=(at:number,when:number|undefined)=>when!==undefined&&Math.abs(at-when)<=PILE_EXIT_MS;
/** How long a card shown from the hand stays linked to the play that follows it (field or pile placement, one Undo). */
const HAND_ACTIVATION_MS=10_000;
/** A notice shows 5 s; one with Undo shows at least 8 s, and at most this many notices stack (the newest on top). */
const NOTICE_MS=5000,UNDO_NOTICE_MS=8000,NOTICE_STACK=3;
type KeptNotice={key:string;text:string;undoId:string;left:number};
type UndoLink={ids:string[];/** The pile track that follows the departed card, restored to its stand-in by Undo. */rebind?:{trackId:string;ref:string;adoptedRef:string}};
/** An Equip effect on this field makes a monster in a Spell & Trap Zone plausible (an Equip Card). */
const equipSourceOn=(twins:readonly TwinCard[])=>equipSourceOnField(twins,c=>cardInfo(cardCode(c)));
/** The slow-camera hint shows once per page load. */
let lowLightHintShown=false;
function readPhysicalZones(key:string):Map<string,FieldZone> {
  try {
    const value=JSON.parse(sessionStorage.getItem(key)??'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))return new Map(Object.entries(value).filter((pair):pair is [string,FieldZone]=>typeof pair[1]==='string'&&physicalZonePattern.test(pair[1])));
  }catch{/* Storage is optional; current-camera reservations still work in memory. */}
  return new Map();
}
type Entry={cardId:string;passcode:number;name:string;frameClass?:string};
type FieldMutation=(proposal:Parameters<RoomMutation>[0],key?:string,evidence?:FieldEvent,pileTrack?:FieldTrack,verify?:()=>boolean)=>ReturnType<RoomMutation>;
/** Camera proof that a departed card lies on a pile: an unread stand-in the board holds, or a pile track the board has no card for yet. */
type PileSeen=NonNullable<ReturnType<typeof fieldPileEvidence>>|NonNullable<ReturnType<typeof fieldPileTrackEvidence>>;
type Departure={ref:string;name:string;zone:string;pile?:PublicPile;banishedTrack?:string;/** Face-down: only a banished card (Banish face-down). */down?:boolean};
const destinations=FIELD_LEAVE_DESTINATIONS;
const handFirst=[...destinations.filter(d=>d.zone==='hand'),...destinations.filter(d=>d.zone!=='hand')];
/**
 * A card the camera lost from the field goes to the hand at once (after the removal check), never guessed onto a pile: it goes to the
 * GY, banished or banished face-down only when the camera sees it arrive there. An UNREAD pile card the camera shows within LATE_PILE_MS
 * after the move still counts for that card (it moves hand to pile, the stand-in goes). A NAMED pile read is matched by the server for REMOTE_NAMED_PILE_READ_MS (30 s). With two cards waiting the player picks one.
 */
const LATE_PILE_MS=REMOTE_UNREAD_PILE_MS;
/** Where a camera departure can still be a summon material (the server accepts these for 30 s). */
const summonable=(zone:string)=>['hand','graveyard','banished','extra'].includes(zone);
/** Owner evidence, table mutations and UI remain isolated from the feed reader. */
export function AutoFieldWatcher({room,transaction,diagnosticsAllowed=false,dock,reviewingPile,onOpenPile}:{
  room:RemoteRoom;transaction:RoomTransaction;diagnosticsAllowed?:boolean;dock?:HTMLElement|null;
  reviewingPile?:RefObject<PublicPile|null>;onOpenPile?(zone:PublicPile):void;
}) {
  const hub=useVideoHub(),seat=room.mySeat,source=hub.sourceFor(seat);
  const phone=hub.phones.find(p=>p.seat===seat&&p.paired);
  const ownsSource=!!source&&(source.local||!!phone&&phone.mode!=='scan');
  const cameraKey=phone?`phone:${phone.id}`:hub.cameraId;
  const current=useRef({room,active:false});
  if(current.current.room.slug!==room.slug||room.lastSeq>=current.current.room.lastSeq)current.current.room=room;
  current.current.active=ownsSource&&hub.cameraOn;
  const deckKey=deckIdsOf(room,seat).join(',');
  // The per-action latency log (field-profile.ts) records every action type only while the diagnostics switch is on; it is off for everyone else.
  useEffect(()=>diagnosticsAllowed?holdFieldLatencyLog():undefined,[diagnosticsAllowed]);
  useEffect(()=>{
    if(!ownsSource||!hub.cameraOn)return;
    void prepareOwnReader(recognitionPriorsFor(current.current.room,seat)).catch(()=>undefined);
  },[room.slug,seat,ownsSource,hub.cameraOn,deckKey]);
  const enabledRef=useRef(true),calibrationBusy=useRef(false),tracks=useRef<FieldTrack[]>([]);
  const manual=useRef(new Map<string,{zone:string;slot?:number;position?:string}>());
  const entries=useRef(new Map<string,Entry>()),bindings=useRef(new Map<string,string>()),published=useRef(''),lastMessage=useRef<ReturnType<typeof fieldTrackMessage>>({type:'field.tracks',cards:[]});
  const previousBoard=useRef({seq:room.lastSeq,zones:new Map<string,string>()});
  if(e2eFieldHook&&typeof window!=='undefined')Object.assign(window,{__e2eField:{entries,handle:(e:FieldEvent)=>handle(e),live:()=>live(),watching:()=>!!watch.getSnapshot()}});
  const physicalKey=`dd-field-physical:v1:${room.guildId}:${room.slug}:${seat}`,physical=useRef<{key:string;zones:Map<string,FieldZone>}|null>(null);
  if(physical.current?.key!==physicalKey)physical.current={key:physicalKey,zones:readPhysicalZones(physicalKey)};
  const [host,setHost]=useState<HTMLElement|null>(null),[prompts,setPrompts]=useState<FieldEvent[]>([]),[calibrating,setCalibrating]=useState(false);
  const video=host?.querySelector('video')??null;
  const [captureSize,setCaptureSize]=useState<{width:number;height:number}>();
  useEffect(()=>{
    if(!video){setCaptureSize(undefined);return;}
    const update=()=>{if(video.videoWidth&&video.videoHeight)setCaptureSize({width:video.videoWidth,height:video.videoHeight});};
    update();video.addEventListener('loadedmetadata',update);video.addEventListener('resize',update);
    return()=>{video.removeEventListener('loadedmetadata',update);video.removeEventListener('resize',update);};
  },[video,source]);
  const lastWriteError=useRef('');
  const recognition=useRecognitionBackend();
  // Test recording (REMOTE_RECORD_USERS, decided by the server): saves this table camera for offline recognition tests.
  const recordingCalibration=useRef<RecordingCalibration|undefined>(undefined);
  const recording=useTestRecording({enabled:!!room.recordingEnabled&&ownsSource&&hub.cameraOn&&room.status==='active'&&!room.state.ended,slug:room.slug,video,backend:recognition.backend??undefined,calibrationRef:recordingCalibration});
  const debugBackend=()=>{const loss=gpuLossReason();return `${recognition.backend==='webgpu'?'GPU':recognition.backend?'CPU':'reader'}${recognition.note?` (${recognition.note})`:''}${loss?` · GPU lost ${new Date(loss.at).toLocaleTimeString()}: ${loss.reason}`:''}`;};
  const newRefs=useRef(new WeakMap<FieldEvent,string>()),heldSetSightings=useRef(new Map<number,number>());
  // The timer has a track snapshot. Keep the last recognition evidence per cell for its revision.
  const faceReads=useRef(new Map<FieldZone,FieldEvent>());
  const prompted=useRef(new Set<string>()),placeholders=useRef(new Map<string,string>()),readerRemovals=useRef(new Set<string>());
  const pileOrigins=useRef(new Map<string,{cardId:number;ref:string}>());
  // Summon window: monsters that left the field (watcher time) and Extra Deck summons placed moments ago.
  const separatedStackCards=useRef(new Set<string>());
  /** Cards placed before their facts arrived: the summon check runs when the facts do (see the zone-rule effect). */
  const lateSummons=useRef(new Map<string,{code:number;name:string;at:number;trackId:string}>());
  const vanishes=useRef<FieldVanish[]>([]),summons=useRef(new Map<string,{kind:RemoteSummonKind;name:string;rating?:number;at:number;count:number;pending:string[];trackId:string}>());
  // Stacks the glue holds back (a card moved on top of another card): the summon window decides, then the default applies.
  // stackKept: a stack whose default the player undid; the camera leaves it alone while it stays stacked.
  const heldStacks=useRef(new Set<string>()),stackKept=useRef(new Set<string>()),stackTimers=useRef(new Set<ReturnType<typeof setTimeout>>()),undoChain=useRef(new Map<string,UndoLink>()),watchStartedAt=useRef(performance.now());
  useEffect(()=>{separatedStackCards.current.clear();vanishes.current=[];summons.current.clear();heldStacks.current.clear();stackKept.current.clear();watchStartedAt.current=performance.now();},[room.slug,seat,source]);
  useEffect(()=>()=>{for(const timer of stackTimers.current)clearTimeout(timer);stackTimers.current.clear();},[]);
  /**
   * A new pile card needs entry evidence (not a restart re-read): the camera ran 2 s, and a hand was over that pile up to
   * 10 s before it showed (or still is), or a sure read differs from the current top (the top's look changed).
   */
  const pileEntry=(track:Pick<FieldTrack,'zone'|'firstSeen'>,differs=false)=>{
    const snap=watch.getSnapshot?.();
    const touched=snap?.pileTouchedAt?.[track.zone as PileCell];
    return snap?.fannedPiles?.includes(track.zone as PileCell)||track.firstSeen-watchStartedAt.current>2000&&(differs||touched!==undefined&&touched>=track.firstSeen-PILE_EXIT_MS&&touched<=track.firstSeen+1000);
  };
  /** True while the camera has this twin out of view (by its ref or a bound track id). */
  const outOfView=(ref:string)=>watch.isRemoved(ref)||watch.getTracks().some(t=>t.removed&&(bindings.current.get(t.id)??t.id)===ref);
  /** Twin refs of the cards under this track (the whole stack), bottom first. */
  const stackUnder=(trackId:string)=>fieldStackUnder(trackId,watch.getTracks()).map(id=>bindings.current.get(id)??id);
  const missingCopies=useRef(new Map<string,number>()),mergedCopies=useRef(new Map<string,number>()),repairingCopies=useRef(false);
  calibrationBusy.current=calibrating;
  const [failedUpdate,setFailedUpdate]=useState<{work:(act:RoomMutation)=>Promise<void>;event?:FieldEvent;humanChoice?:boolean}|null>(null);
  /** Key + final proposal of every write a work item made, in order. The Retry button runs the same work again and reuses them, so a write whose reply was lost is not applied twice. */
  const workKeys=useRef(new WeakMap<object,{sig:string;key:string;proposal:Parameters<RoomMutation>[0]}[]>());
  /** A card the camera sees in a cell that holds a token: nothing is placed until the player removes the token or picks another zone. */
  /** The Remove token click: the placement that follows chains its Undo to this removal, so one Undo restores both. */
  /** Face-down cards on a token's cell: the physical cell maps to the zone the player chose. The token stays. */
  // The zone a player chose for one observed card whose physical cell holds a token. Keyed by track, so a later card in that cell is asked again.
  const tokenAway=useRef(new Map<string,{cell:FieldZone;zone:FieldZone}>());
  const tokenUndo=useRef<{trackId:string;actionId:string}>(undefined);
  /** The last card held up and shown to the table. If it is then played, the placement joins it (one notice, one Undo). */
  const handActivation=useRef<{cardId:number;actionId:string;at:number}>(undefined);
  /** A held card the camera could not name: the best few to pick from (one tap), or "not an activation". */
  const [heldPick,setHeldPick]=useState<{id:string;options:{cardId:number;name:string}[]}|null>(null);
  /** A plain monster that stands in a Spell & Trap Zone: Move / Keep. `rowKept` holds the refs the player kept there. */
  const [rowPrompts,setRowPrompts]=useState<{ref:string;name:string}[]>([]),rowKept=useRef(new Set<string>());
  const [tokenPrompt,setTokenPrompt]=useState<{event:FieldEvent;token:TwinCard;zone:FieldZone;name:string;facts?:ReturnType<typeof cardInfo>;choosing?:boolean}|null>(null);
  const [proxyClashes,setProxyClashes]=useState<{event:FieldEvent;zone:FieldZone;proxy:TwinCard;holder:number}[]>([]);
  const proxyBlockedTracks=useRef(new Map<string,FieldZone>());
  const proxyMarkers=useRef(new Set<string>());
  const proxyPrompt=proxyClashes[0];
  useEffect(()=>{proxyBlockedTracks.current.clear();proxyMarkers.current.clear();setProxyClashes([]);},[room.slug,seat,source]);
  /** One link per Undo-able action: the earlier actions that Undo takes back with it. A newer notice never overwrites an older link. */
  const setChain=(after:string,link:UndoLink)=>{const map=undoChain.current;map.delete(after);map.set(after,link);if(map.size>40)map.delete(map.keys().next().value!);};
  const [kept,setKept]=useState<KeptNotice[]>([]),[noticeHeld,setNoticeHeld]=useState(false);
  /** The notice on screen and when it came up; a new notice pushes an Undo notice that still has time into `kept`. */
  const shownNotice=useRef<{text:string;undoId:string}|null>(null),noticeLeft=useRef(0),noticeKey=useRef(''),settledUndo=useRef(new Set<string>());
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false),[recovery,setRecovery]=useState<StaleFieldPlacementError|null>(null);
  const heldTimers=useRef(new Map<string,ReturnType<typeof setInterval>>()),departureTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  /** Keep a dismissed or resolved reveal quiet until the pile top changes or the camera sees it again. */
  const promptedPileTops=useRef(new Map<PileCell,string>());
  useEffect(()=>()=>promptedPileTops.current.clear(),[room.slug,seat]);
  /** Monsters out of view during the departure wait (track id): an Extra Deck summon in that window takes them as materials. */
  const pileWrites=useRef(new Map<string,number>());
  const pendingLeft=useRef(new Map<string,FieldVanish>()),leaveStarted=useRef(new Map<string,number>()),pendingDepartures=useRef(new Map<string,{event:FieldEvent;origin:Pick<TwinCard,'ref'|'zone'|'slot'>;pileWorked?:boolean;/** The pile a hand last had contact with since the removal. */pile?:'GY'|'BANISHED';unresolved?:true}>()),settlingDepartures=useRef(new Set<string>()),lateDefaults=useRef(new Map<string,{at:number;lastSeen:number;cardId?:string;/** The default rule sent it to the Graveyard: it waits for its own pile track, or a Banished one. */pile?:true}>()),lateBusy=useRef(false);
  useEffect(()=>()=>{pileWrites.current.clear();heldSetSightings.current.clear();pendingDepartures.current.clear();settlingDepartures.current.clear();lateDefaults.current.clear();for(const timer of heldTimers.current.values())clearInterval(timer);heldTimers.current.clear();for(const timer of departureTimers.current.values())clearTimeout(timer);departureTimers.current.clear();pendingLeft.current.clear();},[room.slug,seat,source]);
  const choiceClosed=useRef(new Set<string>());
  const [leaveChoice,setLeaveChoice]=useState<{twinRef:string;zone:'graveyard'|'banished';faceUp:boolean;options:{ref:string;name:string}[]}|null>(null),[departure,setDepartureState]=useState<Departure|null>(null),departureRef=useRef<Departure|null>(null);
  // Grid check: when the card type contradicts the camera row for 2+ cards in 2 minutes, the zones are
  // probably shifted by one row. One hint per table and seat.
  // 'placed' events seen while auto-placement was off: held by the sync hold (placed when it ends), or dropped (debug line).
  const syncHoldRef=useRef(false),heldPlaced=useRef({deferred:0,dropped:0});
  /** The time of the last automatic Scan field. */
  const autoScanAt=useRef(-Infinity);
  const rowFixes=useRef(new Map<string,number>()),[shiftHint,setShiftHint]=useState(false),shiftHinted=useRef(false);
  useEffect(()=>{rowFixes.current.clear();shiftHinted.current=false;setShiftHint(false);rowKept.current.clear();setRowPrompts([]);},[room.slug,seat]);
  const noteRowFix=(ref:string)=>{
    const at=performance.now();rowFixes.current.set(ref,at);
    for(const [key,when] of rowFixes.current)if(at-when>120_000)rowFixes.current.delete(key);
    if(rowFixes.current.size>=2&&!shiftHinted.current){shiftHinted.current=true;setShiftHint(true);}
  };
  useEffect(()=>setRecovery(null),[room.slug,seat]);
  const setDeparture=(value:Departure|null)=>{departureRef.current=value;setDepartureState(value);};
  const askDeparture=(ref:string,name:string,banishedTrack?:string)=>{
    setDeparture({ref,name,zone:'pending',banishedTrack});setNotice(`${name} left the field · choose destination`);setUndoId('');
  };
  const fieldDepartureMissing=(value:Departure)=>outOfView(value.ref)||
    (!!value.banishedTrack&&watch.getTrack(value.banishedTrack)?.zone==='BANISHED');
  // A monster the camera took off the field can go under an Xyz Monster (hint order: Xyz that attach cards first); not once it is on a pile.
  const departed=departure?room.state.seats[seat].twin.find(c=>c.ref===departure.ref):undefined;
  const attachTargets=departed&&!departed.token&&['monster','extra-monster'].includes(departed.departedFrom?.zone??departed.zone)&&['hand','monster','extra-monster'].includes(departed.zone)?xyzAttachTargets(room.state.seats,c=>cardInfo(cardCode(c)),departed.ref):[];
  useEffect(()=>{setHost(document.querySelector<HTMLElement>(`[data-testid="feed-box-${seat}"]`));setPrompts([]);prompted.current.clear();previousBoard.current={seq:room.lastSeq,zones:new Map()};bindings.current.clear();faceReads.current.clear();},[room.slug,seat,source]);
  useEffect(()=>{placeholders.current.clear();readerRemovals.current.clear();pileOrigins.current.clear();},[room.slug,seat,source]);
  const savePhysical=()=>{try{sessionStorage.setItem(physical.current!.key,JSON.stringify(Object.fromEntries(physical.current!.zones)));}catch{/* Memory-only fallback. */}};
  const forgetPhysical=(ref:string)=>{if(physical.current!.zones.delete(ref))savePhysical();};
  const prunePhysical=()=>{const refs=new Set(current.current.room.state.seats[seat].twin.map(c=>c.ref));let changed=false;for(const ref of physical.current!.zones.keys())if(!refs.has(ref)){physical.current!.zones.delete(ref);changed=true;}if(changed)savePhysical();};
  const rememberPhysical=(ref:string,zone:FieldZone)=>{if(physicalZonePattern.test(zone)&&current.current.room.state.seats[seat].twin.some(c=>c.ref===ref&&publicField(c.zone))&&physical.current!.zones.get(ref)!==zone){physical.current!.zones.set(ref,zone);savePhysical();}};
  // A physical hint reserves a ref only. Omitting the quad forces a fresh identity read.
  const knownZone=(card:TwinCard)=>publicField(card.zone)?physical.current!.zones.get(card.ref)??observedFieldZone(room.slug,seat,card.ref)??toZone(card.zone,card.slot):toZone(card.zone,card.slot);
  const fieldOriginSpot=(card:TwinCard)=>{
    const origin=card.departedFrom;
    if(origin&&publicField(origin.zone))return physical.current!.zones.get(card.ref)??observedFieldZone(room.slug,seat,card.ref)??toZone(origin.zone,origin.slot);
  };
  const seenOffField=(card:TwinCard,removedAt:number)=>{
    const code=cardCode(card);
    return code!==undefined&&(heldSetSightings.current.get(code)??-Infinity)>=removedAt||watch.getTracks().some(t=>piles.has(t.zone)&&t.lastSeen>=removedAt&&
      ((bindings.current.get(t.id)??t.id)===card.ref||code!==undefined&&!!t.cardId&&(catalogCardId(entries.current.get(t.cardId))??Number(t.cardId))===code));
  };
  const reboundSetOrigin=(card:TwinCard|undefined,event:FieldEvent)=>{
    const removedAt=event.removedAt;
    if(removedAt===undefined||event.track.lastSeen<removedAt)return;
    const origin=card?.departedFrom,zone=event.track.zone,age=performance.now()-removedAt;
    if(!card||card.zone!=='hand'||card.ownerSeat!==undefined||card.token||!origin?.auto||age<0||age>FIELD_SET_RETURN_MS||fieldOriginSpot(card)!==zone||
      seenOffField(card,removedAt))return;
    if(current.current.room.state.seats[seat].twin.some(c=>c.ref!==card.ref&&publicField(c.zone)&&knownZone(c)===zone))return;
    return origin;
  };
  const newRefFor=(event:FieldEvent)=>{
    const ref=newRefs.current.get(event)??`fw-${crypto.randomUUID()}`;
    newRefs.current.set(event,ref);return ref;
  };
  const freshZoomBack=(event:FieldEvent,track:FieldTrack)=>track.zone===event.track.zone&&track.faceDown&&track.visible&&
    !track.under&&track.restSince!==undefined&&!track.card.partial&&!track.card.covered&&
    (fieldCellEvidence(event)?.basis==='zoom'||track.setEvidence?.basis==='zoom'&&track.setEvidence.decision==='committed');
  const setBackFor=(track:FieldTrack,id=track.id,zoomBack=false)=>{
    const returned=fieldSetReturn({track:{...track,id},twins:current.current.room.state.seats[seat].twin,tracks:watch.getTracks(),
      owns:t=>bindings.current.get(t.id)??t.id,events:current.current.room.events??[],seat,at:serverNow(),now:performance.now(),
      pileTouched:pileActivity(watch.getSnapshot?.()),seenOffField,zoomBack,zoneOf:card=>publicField(card.zone)?knownZone(card):undefined});
    // A published Hand action is visible. A later cross-slot back starts its own ref.
    return returned?.kind==='move'?undefined:returned;
  };
  const slideInput=(track:FieldTrack,snap=watch.getSnapshot?.())=>({track,twins:current.current.room.state.seats[seat].twin,tracks:snap?.tracks??watch.getTracks(),
    owns:(t:FieldTrack)=>bindings.current.get(t.id)??t.id,zoneOf:(card:TwinCard)=>publicField(card.zone)?knownZone(card):undefined,now:performance.now(),
    pileTouched:fieldSetSlidePileActivity(snap),blindSleeveSince:snap?.blindSleeveSince,
    lastFieldActivityAtByZone:snap?.lastFieldActivityAtByZone,seenOffField});
  const slideFor=(track:FieldTrack,snap=watch.getSnapshot?.())=>fieldSetSlide(slideInput(track,snap));
  const linkedSlide=(event:FieldEvent,snap:FieldSnapshot|undefined,forHandVeto=false)=>
    snap?.tracks.find(t=>{
      const input=slideInput(t,snap);
      // An unconfirmed pile touch cannot justify writing Hand when a back is resting in another cell.
      const slide=fieldSetSlide(input)??(forHandVeto&&(t.state==='identified'||t.restSince!==undefined)?
        fieldSetSlide({...input,pileTouched:undefined}):undefined);
      return slide?.from.id===event.track.id;
    });
  const slideWait=(event:FieldEvent,snap=watch.getSnapshot?.(),now=performance.now())=>{
    const removedAt=event.removedAt;
    if(!snap||removedAt===undefined)return 0;
    const activityAt=fieldDepartureActivityAt(event.track.zone,snap);
    const linked=linkedSlide(event,snap);
    if(!linked)return 0;
    const sleeveAt=snap.blindSleeveSince?.[linked.zone];
    const until=fieldSetSlideDeadline(event,removedAt,sleeveAt!==undefined,
      sleeveAt===undefined?activityAt:Math.max(activityAt,linked.firstSeen));
    return Math.max(0,until-now);
  };
  const departurePileEvidence=(event:FieldEvent,snap=watch.getSnapshot?.())=>{
    const twins=current.current.room.state.seats[seat].twin;
    const owns=(t:FieldTrack)=>bindings.current.get(t.id)??t.id;
    const card=twins.find(c=>c.ref===owns(event.track)),code=card&&cardCode(card);
    const cardId=event.track.cardId??(code?String(code):undefined);
    const observed=snap?.tracks??watch.getTracks();
    const proof={twins,tracks:observed,lastSeen:event.track.lastSeen,owns,cardId,pileContactAt:snap?.pileContactAt};
    const competing=[...pendingDepartures.current.values()].filter(p=>
      Math.abs((p.event.removedAt??p.event.track.lastSeen)-(event.removedAt??event.track.lastSeen))<=PILE_DEPARTURE_CAP_MS);
    if(competing.length<=1&&!pendingDepartures.current.get(event.track.id)?.unresolved)return fieldPileEvidence(proof)??fieldPileTrackEvidence(proof);
    if(!cardId||competing.some(p=>p.event.track.id!==event.track.id&&
      (p.event.track.cardId===cardId||code!==undefined&&twins.some(c=>c.ref===p.origin.ref&&cardCode(c)===code))))return;
    return fieldPileTrackEvidence({...proof,tracks:observed.filter(t=>t.cardId===cardId)});
  };
  /** A named monster (catalog type, else the reader's frame class). Unnamed or unknown: not sure, so false. */
  const pileCardIsMonster=(t:FieldTrack,twin?:TwinCard)=>{
    const entry=t.cardId?entries.current.get(t.cardId):undefined,code=twin?cardCode(twin):entry?.passcode??(t.cardId?Number(t.cardId):undefined);
    const type=cardInfo(code)?.type;
    if(type)return /monster/i.test(type);
    return !!entry?.frameClass&&!/^(spell|trap)/i.test(entry.frameClass);
  };
  const activeDeparturePile=(snap:FieldSnapshot|undefined,sourceAt:number,now:number,activityWindow:number)=>
    Object.values(fieldSetSlidePileActivity(snap)).some(at=>at>=sourceAt-Math.min(activityWindow,PILE_NEAR_MS)&&at<=now&&now-at<=activityWindow);
  const cancelDeparture=(id:string)=>{
    clearTimeout(departureTimers.current.get(id));departureTimers.current.delete(id);
    pendingLeft.current.delete(id);leaveStarted.current.delete(id);pendingDepartures.current.delete(id);settlingDepartures.current.delete(id);
  };
  const projectObserved=(track:Pick<FieldTrack,'id'|'zone'|'faceDown'>,twins:readonly TwinCard[],card:TwinCard|undefined,facts:ReturnType<typeof cardInfo>,wasHidden=false):ReturnType<typeof projectFieldZone>=>{
    // Turning a bound card over retains its virtual destination until it physically moves.
    const saved=card&&(track.faceDown||!card.faceUp||wasHidden)&&knownZone(card)===track.zone?toZone(card.zone,card.slot):undefined;
    const away=tokenAway.current.get(track.id),chosen=away?.cell===track.zone?away.zone:undefined;
    if(track.faceDown||!isFieldSpell(facts)){
      if(chosen)return {zone:chosen,label:''};
      if(saved)return {zone:saved,label:''};
    }
    return projectFieldZone({zone:track.zone,facts,twins,ref:card?.ref,faceDown:track.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,equipSource:equipSourceOn(twins),equipped:!!card?.equippedTo});
  };
  const pileOrders=(pile:PublicPile)=>current.current.room.events?.filter(({action})=>(action.type==='pile.order'||action.type==='pile.set')&&action.seat===seat&&action.zone===pile)??[];
  const watcherTime=(at:number)=>performance.now()+(at-serverNow());
  const displacedAt=(pile:PublicPile,ref:string)=>pileOrders(pile).flatMap(({at,action})=>
    action.type==='pile.order'&&action.source==='auto'&&action.cardRefs.at(-2)===ref?[watcherTime(at)]:[]);
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{
    if(c.token||c.ownerSeat!==undefined||[...placeholders.current.values()].includes(c.ref))return [];
    const zone=c.zone==='hand'?'HAND' as const:knownZone(c);
    if(!zone)return [];
    const pile=observedPile(zone),displaced=pile?displacedAt(pile,c.ref):[];
    return [{id:c.ref,zone,cardId:c.faceUp||c.publicIdentity||['deck','hand','extra'].includes(c.zone)?String(cardCode(c)??''):undefined,
      faceDown:!c.faceUp,position:c.position,...(displaced.length?{pileDisplacedAt:displaced}:{})}];
  });
  const offer=(event:FieldEvent)=>{
    const key=`${event.track.id}:${event.track.revision??0}`;
    if(event.track.faceDown&&event.reason!=='card-presence'||prompted.current.has(key))return;
    if(observedPile(event.track.zone)){
      const entry=pileGuess(event),cardId=catalogCardId(entry);
      const origin=entry&&pilePromptSource(event,event.track,entry,current.current.room.state.seats[seat]);
      if(cardId&&origin?.ref)pileOrigins.current.set(key,{cardId,ref:origin.ref});
      if(pileOrigins.current.size>16)pileOrigins.current.delete(pileOrigins.current.keys().next().value!);
    }
    // React may replay state updaters. Reserve once outside the pure updater.
    prompted.current.add(key);setPrompts(list=>[...list.slice(-5),event]);
  };
  const live=()=>current.current.active&&enabledRef.current&&current.current.room.status==='active'&&!current.current.room.state.ended&&!current.current.room.state.seats[seat].eliminated;
  const reviewing=(event?:FieldEvent)=>!!reviewingPile?.current&&observedPile(event?.track.zone??'')===reviewingPile.current;
  /** A card the player moved by hand keeps its place while the real card stays where the camera last saw it. */
  const keepsManual=(ref:string,location:{zone:string;slot?:number},position?:string)=>{
    if(correctionsFor(current.current.room,seat).has(ref))return true;
    const kept=manual.current.get(ref);if(!kept)return false;
    if(kept.zone===location.zone&&kept.slot===location.slot&&kept.position===position)return true;
    manual.current.delete(ref);return false;
  };
  useEffect(()=>onManualMove(move=>{
    if(move.slug!==current.current.room.slug||move.seat!==seat)return;
    const id=[...bindings.current.entries()].find(([,ref])=>ref===move.ref)?.[0]??move.ref;
    const track=watch.getTrack(id);
    if(track?.visible&&!track.removed&&track.state==='identified')manual.current.set(move.ref,{...fieldZoneLocation(track.zone),position:track.position});
    else manual.current.delete(move.ref);
  }),[seat]);
  useEffect(()=>{manual.current.clear();},[room.slug,seat]);
  /** The player's Undo owns the cards it touched: the camera does not redo the change until the real card moves. */
  /** Keep restored cards and keep re-sync from recreating a Set whose return was undone. */
  const undoKept=useRef(new Set<string>());
  /** The face check. It also keeps the refs whose face the player set (flip, Undo): the board keeps that face until the real card turns. Only Scan field overrules. */
  const face=useRef(createFieldFaceCheck());
  useEffect(()=>{undoKept.current.clear();face.current.clear();},[room.slug,seat]);
  const holdFace=(ref:string)=>{const id=[...bindings.current.entries()].find(([,bound])=>bound===ref)?.[0]??ref,track=watch.getTrack(id);face.current.hold(ref,track&&!track.removed?track.faceDown:undefined);};
  const holdForPlayer=(ref:string)=>{
    holdFace(ref);
    const id=[...bindings.current.entries()].find(([,bound])=>bound===ref)?.[0]??ref,track=watch.getTrack(id);
    if(track?.visible&&!track.removed)manual.current.set(ref,{...fieldZoneLocation(track.zone),position:track.position});
    else undoKept.current.add(ref);
  };
  const holdReplacedFieldCards=(before:readonly TwinCard[],after:readonly TwinCard[])=>{
    const field=after.find(c=>c.zone==='field');
    if(!field||before.some(c=>c.zone==='field'&&c.ref===field.ref))return;
    for(const old of before){
      if(old.zone!=='field'||!after.some(c=>c.ref===old.ref&&c.zone==='graveyard'))continue;
      const track=watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===old.ref);
      if(track&&!track.removed&&!piles.has(track.zone))manual.current.set(old.ref,{...fieldZoneLocation(track.zone),position:track.position});
    }
  };
  /** A monster a Tribute (Nibiru) sent to this Graveyard: the real card stays on the mat until the player moves it, so the camera keeps its place and does not add it again. */
  const holdTributedCards=(before:readonly TwinCard[],after:readonly TwinCard[])=>{
    for(const old of before){
      if(old.zone!=='monster'&&old.zone!=='extra-monster')continue;
      if(!after.some(c=>c.ref===old.ref&&c.zone==='graveyard'))continue;
      const track=watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===old.ref);
      if(track&&!track.removed&&!piles.has(track.zone))manual.current.set(old.ref,{...fieldZoneLocation(track.zone),position:track.position});
    }
  };
  const previousTwins=useRef(room.state.seats[seat].twin);
  useEffect(()=>{
    const twins=room.state.seats[seat].twin;
    holdReplacedFieldCards(previousTwins.current,twins);
    holdTributedCards(previousTwins.current,twins);
    rememberGiven(previousTwins.current);
    previousTwins.current=twins;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.state,seat]);
  /** My card an opponent holds as a proxy: its paper card leaves my zone or stays on the mat, and the camera does nothing about it. Read from the live state, so a reload, a take back, an Undo and a return to my Graveyard all end it. */
  const givenCopy=(ref:string)=>{for(const [i,s] of current.current.room.state.seats.entries()){if(i===seat)continue;const c=s.twin.find(c=>c.ref===ref&&c.ownerSeat===seat);if(c)return c;}};
  const givenAway=(ref:string)=>!!givenCopy(ref);
  /** The same card by identity: the camera may start a new track (a new ref) for the paper card that stays on my mat. The mat spot and card id of each given card are kept while it is given, and a track of that card on that spot is held too, until the paper card leaves it (see `givenSpotHolds`). */
  const givenSpots=useRef(new Map<string,GivenSpot>());
  const rememberGiven=(before:readonly TwinCard[])=>{
    const given=new Map<string,TwinCard>();
    current.current.room.state.seats.forEach((s,i)=>{if(i!==seat)for(const c of s.twin)if(c.ownerSeat===seat)given.set(c.ref,c);});
    for(const ref of givenSpots.current.keys())if(!given.has(ref))givenSpots.current.delete(ref);
    for(const [ref,card] of given){
      if(givenSpots.current.has(ref))continue;
      const mine=before.find(c=>c.ref===ref),zone=mine&&publicField(mine.zone)?knownZone(mine):physical.current!.zones.get(ref)??observedFieldZone(room.slug,seat,ref);
      const code=cardCode(card)??(mine&&cardCode(mine))??card.ownerIdentity?.cardId;
      if(zone&&/^(M[1-5]|S[1-5]|EMZ[12]|FIELD)$/.test(zone))givenSpots.current.set(ref,{zone,cardId:code?String(code):undefined,at:performance.now()});
    }
  };
  /** True for a track of my given card: the same ref, or the same card (an unread track counts) on the mat spot where it was given. */
  const givenHold=(track:Pick<FieldTrack,'id'|'zone'|'cardId'|'faceDown'>)=>{
    if(givenAway(bindings.current.get(track.id)??track.id))return true;
    return givenSpotHolds(givenSpots.current,track,givenCopy,zone=>fieldEmptyProofs(watch.getSnapshot?.())?.[zone as FieldZone]);
  };
  const undoCards=useRef(new Map<string,Pick<RemoteUndoEntry,'action'|'cards'>>()),undoSeq=useRef<number|null>(null);
  useEffect(()=>{undoCards.current.clear();undoSeq.current=null;},[room.slug,seat]);
  useEffect(()=>{
    for(const entry of room.state.undoHistory??[])undoCards.current.set(entry.actionId,{action:entry.action,cards:entry.cards});
    const events=room.events??[],newest=events.reduce((n,e)=>Math.max(n,e.seq),0);
    if(undoSeq.current===null){undoSeq.current=newest;return;}
    for(const e of events){
      if(e.seq<=undoSeq.current)continue;
      if((e.action.type==='twin.flip'||e.action.type==='twin.move'&&e.action.faceUp!==undefined)&&e.action.seat===seat&&e.action.source!=='auto'){holdFace(e.action.cardRef);continue;}
      if(e.action.type==='twin.control'&&e.action.toSeat===seat){holdForPlayer(e.action.cardRef);continue;}
      if(e.action.type!=='undo')continue;
      const targetId=e.action.targetActionId,entry=undoCards.current.get(targetId);
      const action=entry?.action??events.find(x=>x.id===targetId||(x.action as {idempotencyKey?:string}).idempotencyKey===targetId)?.action;
      // The card goes back to its hand ref. The camera can still show its retired Set ref.
      if(action?.type==='twin.move'&&action.seat===seat&&action.setRef)undoKept.current.add(action.setRef);
      // Fallback when the entry was never seen (action and Undo in one update): the refs the action names.
      const target=action as Record<string,unknown>|undefined;
      const named=target?[target.cardRef,(target.card as {ref?:string}|undefined)?.ref,...(Array.isArray(target.cardRefs)?target.cardRefs:[]),target.keepRef,target.removeRef].filter((ref):ref is string=>typeof ref==='string').map(ref=>`${String(target.seat??seat)}:${ref}`):[];
      for(const qualified of entry?.cards??named){
        const at=qualified.indexOf(':');if(Number(qualified.slice(0,at))===seat)holdForPlayer(qualified.slice(at+1));
      }
    }
    undoSeq.current=Math.max(undoSeq.current,newest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.events,room.state.undoHistory,seat]);
  function trackForChoice(event:FieldEvent,track=watch.getTrack(event.track.id)) {
    if(!event.track.glare)return track;
    const chosen=event.track.glare.candidates[0]?.cardId,passcode=catalogCardId(chosen?entries.current.get(chosen):undefined);
    if(!passcode||!registeredDeckPasscodes(current.current.room,seat).includes(passcode)||!track?.glare||(!track.visible&&track.state!=='candidate'))return;
    const latest=track.glare.candidates.length?track.glare.candidates:fieldGlareChoices(event.result);
    if(latest.some(c=>c.cardId===chosen))return track;
  }
  /** Every cell and every card a board-wide check can touch. */
  const BOARD_ZONES=[...[1,2,3,4,5].flatMap(n=>[`M${n}`,`S${n}`]),'EMZ1','EMZ2','FIELD','GY','BANISHED'];
  const boardLanes=()=>laneOf([...current.current.room.state.seats[seat].twin.filter(c=>publicField(c.zone)||['graveyard','banished'].includes(c.zone)).map(c=>c.ref),...watch.getTracks().map(t=>bindings.current.get(t.id)??t.id)],BOARD_ZONES);
  /** The cards and cells an event touches. */
  const fieldLanes=(event?:FieldEvent):string[]|undefined=>{
    if(!event)return undefined;
    const twins=current.current.room.state.seats[seat].twin,track=event.track;
    const topRef=event.coverRef?bindings.current.get(event.coverRef)??event.coverRef:undefined;
    const ids=[track.id,bindings.current.get(track.id),event.bindRef,event.fromRef,event.replacesRef,event.coverRef,topRef,event.uncoveredRef,event.previousId];
    const held=twins.find(c=>ids.includes(c.ref)),heldZone=held&&knownZone(held);
    const zones:(string|undefined)[]=[track.zone,heldZone];
    // An attach: the Xyz on top, its pending materials, and the Xyz a lifted material belongs to.
    ids.push(...(topRef?summons.current.get(topRef)?.pending??[]:[]),held?.materialOf);
    // The projected cell of a card seen in another cell (a Spell seen in M3 goes to S3).
    const entry=track.cardId?entries.current.get(track.cardId):undefined;
    const code=entry?.passcode??(track.cardId?Number(track.cardId):undefined),facts=cardInfo(code);
    const identity=entry&&{cardId:catalogCardId(entry),name:entry.name};
    const replacement=held&&!track.faceDown&&identity&&differentKnownSet(held,identity);
    if(replacement)ids.push(...twins.filter(c=>sameObservedCard(c,identity)).map(c=>c.ref));
    if(facts&&(['placed','moved'].includes(event.type)||replacement)&&publicField(fieldZoneLocation(track.zone).zone))
      zones.push(projectObserved(track,twins.filter(c=>c.ref!==held?.ref),replacement?undefined:held,facts).zone);
    // An Extra Deck monster in a Monster Zone takes its materials: the ones that just left and the ones under it.
    if(facts&&event.type==='placed'&&/^(M[1-5]|EMZ[12])$/.test(track.zone)&&fieldSummonKind(facts))
      ids.push(...vanishes.current.map(v=>v.ref),...[...pendingLeft.current.values()].map(v=>v.ref),...stackUnder(track.id));
    // A departure from a field cell (a removal, a move, or the release of a stale occupant) can end in a pile.
    const stale=['placed','moved'].includes(event.type)?staleFieldOccupant(twins,watch.getTracks().map(t=>({...t,id:bindings.current.get(t.id)??t.id})),track.zone,held?.ref??track.id):undefined;
    if(stale)ids.push(stale.ref);
    if(stale||event.type!=='flipped'&&held&&publicField(held.zone))zones.push(...PILE_LANES);
    if(identity)for(const [zone,pile] of orderedPiles)if(zone!==track.zone&&twins.some(c=>c.zone===pile&&sameObservedCard(c,identity)))zones.push(zone);
    return laneOf(ids,zones);
  };
  /** `quiet`: a background board re-sync. A failed write is logged only (no notice, no Retry banner); it is tried again next cycle. */
  function queue(work:(act:FieldMutation)=>Promise<void>,event?:FieldEvent,humanChoice=false,quiet=false,lanes?:string[]) {
    console.info('[remote field] queued',event?.type,event?.track.id,event?.track.revision);
    markFieldTiming(event?.timing,'queued');
    const kept=workKeys.current.get(work)??[];workKeys.current.set(work,kept);let step=0;
    return transaction(async(latest,act)=>{
      current.current.room=latest;markFieldTiming(event?.timing,'dequeued');
      console.info('[remote field] dequeued',event?.type,event?.track.id,latest.lastSeq);
      const queuedEvent=event;
      const apply:FieldMutation=async (input,idempotencyKey,event=queuedEvent,pileTrack=event?.track,verify)=>{
        const {cam:_cam,...bare}=input,sig=JSON.stringify(bare),slot=step++,saved=idempotencyKey===undefined&&kept[slot]?.sig===sig?kept[slot]:undefined;
        const actionId=idempotencyKey??saved?.key??crypto.randomUUID();
        // A Trap that the camera sees go from S/T to a Monster Zone is a Trap Monster: it keeps its S/T zone.
        let proposal=input;if(input.type==='twin.move'&&input.faceUp!==false&&input.trapMonster===undefined){const moving=current.current.room.state.seats[seat].twin.find(c=>c.ref===input.cardRef);if(becomesTrapMonster(moving,cardInfo(moving&&cardCode(moving)),input.zone))proposal={...input,trapMonster:true};}
        const observedAt=event&&event.type!=='removed'?event.track.lastSeen:performance.now();
        if(!proposal.cam)proposal={...proposal,cam:humanChoice?fieldCameraStamp(event?.timing,'player',event?.reason==='card-presence'?'set-card':'prompt-choice',observedAt):fieldCameraStamp(event?.timing,'camera',proposal.type==='undo'?'auto-undo':undefined,observedAt)};
        const setEvidence=pileTrack?.setEvidence??event?.track.setEvidence;
        if(setEvidence&&proposal.cam)proposal={...proposal,cam:{...proposal.cam,set:setEvidence}};
        if(proposal.cam?.by==='camera'&&pileTrack&&(pileTrack.zone==='GY'||pileTrack.zone==='BANISHED')){
          const centre=onMat(fieldCenter(pileTrack.card),watch.calibration);
          if(Number.isFinite(centre.x)&&Number.isFinite(centre.y))proposal={...proposal,cam:{...proposal.cam,cell:{centre,zone:pileTrack.zone}}};
        }
        if(humanChoice&&proposal.type==='card.identified')proposal={...proposal,source:'click'};
        if(humanChoice&&(proposal.type==='twin.place'&&cardCode(proposal.card)||proposal.type==='twin.flip'&&proposal.cardId))proposal={...proposal,confirmIdentity:true};
        // A Retry of this work reuses the saved key AND the saved proposal (its stamp too): the server compares a repeated key field by field.
        if(saved)proposal=saved.proposal;else if(idempotencyKey===undefined)kept[slot]={sig,key:actionId,proposal};
        bindFieldTiming(actionId,current.current.room.slug,event?.timing);
        const before=current.current.room.state.seats[seat].twin;
        const move=proposal.type==='twin.move'?proposal:undefined;
        const setReturn=event?.track.faceDown&&move?.faceUp===false&&publicField(move.zone)&&
          before.some(c=>c.ref===move.cardRef&&c.zone==='hand')?move:undefined;
        const stillValid=()=>{
          if(cameraCorrectionBlocked(current.current.room,proposal))return false;
          const review=reviewingPile?.current;
          if(review&&proposal.cam?.by==='camera'&&(reviewing(event)||'zone' in proposal&&proposal.zone===review||
            'cardRef' in proposal&&before.some(card=>card.ref===proposal.cardRef&&card.zone===review)))return false;
          if(proposal.type==='undo')return true;
          if(!live()||verify?.()===false)return false;
          if(proposal.type==='twin.move'&&proposal.zone==='banished'&&proposal.cam?.by==='camera'&&pileTrack&&pileTrack!==event?.track){
            const receiving=watch.getTrack(pileTrack.id);
            if(!receiving||receiving.zone!=='BANISHED'||receiving.removed||!receiving.visible||receiving.restSince!==pileTrack.restSince||
              receiving.cardId!==pileTrack.cardId||receiving.faceDown!==pileTrack.faceDown||receiving.faceDown&&receiving.setEvidence?.decision!=='committed')return false;
          }
          if(!event)return true;
          // A write that waited (facts, a retry) stops when its card was given away in the meantime.
          if(givenHold(event.track))return false;
          if(event.type==='removed')return watch.isRemoved(event.track.id)&&
            (proposal.type!=='twin.move'||proposal.zone!=='hand'||!linkedSlide(event,watch.getSnapshot?.(),true));
          if(event.type==='placed'&&proposal.type==='twin.flip'&&!proposal.faceUp&&
            proposal.cardRef!==(bindings.current.get(event.track.id)??event.track.id)){
            const observed=watch.getTrack(event.track.id);
            if(!observed||observed.zone!==event.track.zone||setBackFor(observed,event.track.id,freshZoomBack(event,observed))?.card.ref!==proposal.cardRef)return false;
          }
          if(setReturn&&fieldSetRebind(event)){
            const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===setReturn.cardRef),origin=reboundSetOrigin(card,event);
            if(!origin||origin.zone!==setReturn.zone||origin.slot!==setReturn.slot)return false;
          }else if(setReturn&&event.type==='placed'&&event.track.faceDown){
            const observed=watch.getTrack(event.track.id);
            if(!observed||setBackFor(observed)?.card.ref!==setReturn.cardRef)return false;
          }else if(event.type==='placed'&&proposal.type==='twin.move'&&proposal.physicalZoneChanged&&
            proposal.cardRef!==(bindings.current.get(event.track.id)??event.bindRef??event.track.id)){
            const observed=watch.getTrack(event.track.id);
            if(!observed||observed.zone!==event.track.zone||slideFor(observed)?.card.ref!==proposal.cardRef)return false;
          }
          const observed=trackForChoice(event);
          if(event.type==='moved'&&(observed?.zone!==event.track.zone||observed.position!==event.track.position))return false;
          if(event.type==='flipped'&&!event.track.faceDown&&observed?.zone!==event.track.zone)return false;
          return fieldEvidenceMatches(event,observed,humanChoice,!!setReturn&&fieldSetRebind(event));
        };
        console.info('[remote field] write',proposal.type,actionId);markFieldTiming(event?.timing,'mutation',{actionId});
        let updated=await retryFieldMutation(act,proposal,actionId,stillValid,error=>{const text=error instanceof Error?error.message:String(error);console.warn('[remote field] save failed',proposal.type,text);lastWriteError.current=`${new Date().toLocaleTimeString()} ${text}`;markFieldTiming(event?.timing,'writeFailed',{type:proposal.type});if(!quiet)setNotice(text);},{quiet});
        console.info('[remote field] write result',proposal.type,updated?.lastSeq??'not saved');
        if(!updated)return null;
        current.current.room=updated;holdReplacedFieldCards(before,updated.state.seats[seat].twin);prunePhysical();
        // A camera write without an event may be obsolete or may have kept a confirmed name.
        if(proposal.cam?.by==='camera'&&['twin.place','twin.move','twin.flip','twin.remove','card.identified'].includes(proposal.type)&&
          !updated.events.some(e=>e.id===actionId)){
          if(proposal.type==='card.identified'&&proposal.source==='auto'){
            const ref=proposal.cardRef;
            const confirmed=updated.state.seats[seat].twin.some(c=>c.ref===ref&&c.identityConfirmed);
            if(confirmed&&stillValid())return updated;
          }
          return null;
        }
        // A successful automatic write proves that detection resumed, even if the startup mode announcement was missed.
        if(live()&&proposal.cam?.by==='camera'&&'source' in proposal&&proposal.source==='auto'&&stateMode(updated.state,seat)==='manual'){
          try{
            const announced=await act({type:'detection.mode',actorSeat:seat,mode:'auto',reason:'start',cam:fieldCameraStamp(undefined,'camera','detection-mode')});
            if(announced){updated=announced;current.current.room=announced;}
          }catch(error){console.info('[remote field] detection mode update failed',error);}
        }
        return updated;
      };
      await work(apply);console.info('[remote field] flushed',event?.type,event?.track.id,current.current.room.lastSeq);workKeys.current.delete(work);setFailedUpdate(previous=>previous?.work===work?null:previous);
    },lanes??fieldLanes(event)).catch(error=>{if(error instanceof RemoteDuelError&&error.code==='ACTIVATION_LIMIT'){setNotice(error.message);return;}console.error('[remote field] update failed',error);if(quiet)return;if(error instanceof StaleFieldPlacementError)setRecovery(error);else{setFailedUpdate({work,event,humanChoice});setNotice(error instanceof Error?error.message:'Could not save the field update. Use Retry field update.');}});
  }
  /** A button the player pressed: its writes carry `by:'player'` and the control's name (evidence only). The stamp is made once per write, before the retries. */
  function queueHuman(ui:string,work:(act:RoomMutation)=>Promise<void>,event?:FieldEvent) {
    return queue(act=>work((proposal,key)=>act(proposal.cam?proposal:{...proposal,cam:playerStamp(ui)},key)),event);
  }
  const differentKnownSet=(card:TwinCard,identity:{cardId?:number;name?:string})=>
    !card.faceUp&&!card.token&&card.ownerSeat===undefined&&(publicField(card.zone)||card.departedFrom?.auto)&&
    !!(cardCode(card)||card.name)&&!sameObservedCard(card,identity);
  function resolveExisting(event:FieldEvent,track:FieldTrack,entry:Entry|undefined,twins:readonly TwinCard[]) {
    const differentSet=(card:TwinCard)=>!track.faceDown&&!!entry&&differentKnownSet(card,{cardId:catalogCardId(entry),name:entry.name});
    const reusable=(card:TwinCard)=>{
      if(card.ownerSeat!==undefined||differentSet(card))return false;
      const source=orderedPiles.find(([,zone])=>card.zone===zone);
      if(source){
        const [zone,pile]=source;
        if(track.zone===zone)return true;
        return event.fromRef===card.ref&&!track.faceDown&&!!entry&&!!pileCopy([card],entry)&&
          pileExitCandidate(track,card,zone,pile,twins,watch.getSnapshot?.());
      }
      return publicField(card.zone)||['deck','hand','extra'].includes(card.zone)||leftField(card,serverNow(),fieldZoneLocation(track.zone));
    };
    let existing=twins.find(c=>c.ref===track.id&&reusable(c)&&(!track.faceDown||c.zone!=='hand'));
    // A read can inherit a reserved ref while a different card takes its cell.
    // Follow the newly read identity when the old named card was elsewhere.
    const readFacts=entry&&cardInfo(catalogCardId(entry));
    if(existing?.faceUp&&entry&&cardCode(existing)&&event.type!=='prompt'&&publicField(existing.zone)&&
      !sameObservedCard(existing,{cardId:catalogCardId(entry),name:entry.name})&&
      (knownZone(existing)!==track.zone||existing.zone==='field'&&track.zone!=='FIELD'&&readFacts&&!isFieldSpell(readFacts)))existing=undefined;
    // An unread arriving top may be covered before its read finishes. A later
    // named top in that pile owns its own ref when it has a different identity.
    if(existing&&(track.zone==='GY'||track.zone==='BANISHED')&&bindings.current.has(event.track.id)&&
      (existing.zone==='graveyard'||existing.zone==='banished')&&entry&&cardCode(existing)&&
      !sameObservedCard(existing,{cardId:catalogCardId(entry),name:entry.name}))existing=undefined;
    const sameSlot=(c:typeof twins[number])=>knownZone(c)===track.zone;
    const owns=(t:FieldTrack,ref:string)=>(bindings.current.get(t.id)??t.id)===ref;
    if(!existing&&event.type==='prompt'){
      // Explicit confirmation may correct the old twin at this physical spot,
      // including a reserved restart ref whose identity has not been trusted.
      const bound=twins.find(c=>c.ref===event.bindRef&&reusable(c));
      if(bound&&tracks.current.some(t=>t.id!==event.track.id&&owns(t,bound.ref)&&t.visible&&!t.removed)){return {existing,blocked:true};}
      // The physical card can move while its prompt waits; keep its reservation.
      existing=bound??twins.find(c=>publicField(c.zone)&&reusable(c)&&sameSlot(c)&&!tracks.current.some(t=>owns(t,c.ref)&&t.visible&&!t.removed));
    }
    if(existing&&entry&&!publicField(existing.zone)&&publicField(fieldZoneLocation(track.zone).zone)&&
      !twins.some(c=>['graveyard','banished'].includes(c.zone)&&!leftField(c,serverNow(),fieldZoneLocation(track.zone))&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name}))){
      // Reader reservations are inferred. An absent field owner takes priority
      // over a private ref unless a second current physical copy is witnessed.
      for(const copy of twins.filter(c=>c.ownerSeat===undefined&&(publicField(c.zone)||leftField(c,serverNow(),fieldZoneLocation(track.zone)))&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name})).sort((a,b)=>Number(publicField(b.zone))-Number(publicField(a.zone)))){
        if(copy.ref===existing.ref)continue;
        const cached=tracks.current.find(t=>t.id!==event.track.id&&owns(t,copy.ref));
        const other=watch.getTrack(copy.ref)??(cached?watch.getTrack(cached.id):undefined);
        if(other&&simultaneousFieldCopies(track,other,true))continue;
        if(other?.visible&&!other.removed)return {existing:undefined,blocked:true};
        existing=copy;break;
      }
    }
    if(!existing&&entry){
      const copies=twins.filter(c=>reusable(c)&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name})).sort((a,b)=>Number(publicField(b.zone))*4+Number(!!b.departedFrom)*2+Number(recentFieldDeparture(b,serverNow()))-Number(publicField(a.zone))*4-Number(!!a.departedFrom)*2-Number(recentFieldDeparture(a,serverNow())));
      for(const copy of copies){
        const cached=tracks.current.find(t=>t.id!==event.track.id&&owns(t,copy.ref));
        // Events precede the React snapshot render. Both witnesses must be read
        // from the running watcher, rather than comparing a new frame to stale UI.
        const other=watch.getTrack(copy.ref)??(cached?watch.getTrack(cached.id):undefined);
        if(other&&simultaneousFieldCopies(track,other,true))continue;
        // A live field card or a recent lift owns this read.
        // An unmatched visible outline is insufficient proof for another twin.
        if(other?.visible&&!other.removed)return {existing,blocked:true};
        existing=copy;break;
      }
    }
    return {existing,blocked:false};
  }
  const pileCopy=(members:readonly TwinCard[],entry:Entry)=>members.filter(c=>c.faceUp&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name})).at(-1);
  function pilePromptSource(event:FieldEvent,track:FieldTrack,entry:Entry,player:RemoteRoom['state']['seats'][number]) {
    const identity={cardId:catalogCardId(entry),name:entry.name};
    const remembered=pileOrigins.current.get(`${track.id}:${track.revision??0}`);
    const {existing,blocked}=watch.enabled?resolveExisting(event,{...track,id:bindings.current.get(track.id)??track.id,cardId:entry.cardId},entry,
      player.twin.filter(card=>card.zone!==observedPile(track.zone))):{
        existing:remembered?.cardId===identity.cardId?player.twin.find(card=>card.ref===remembered?.ref):undefined,blocked:false,
      };
    if(!blocked&&existing&&!existing.token&&existing.ownerSeat===undefined&&(existing.zone==='hand'||publicField(existing.zone))&&sameObservedCard(existing,identity))
      return {ref:existing.ref,label:existing.zone==='hand'?'hand':knownZone(existing)??'field'};
    if(identity.cardId&&player.knownHand?.some(card=>card.cardId===identity.cardId))return {ref:undefined,label:'hand'};
  }
  const pileGuess=(event:FieldEvent)=>entries.current.get(event.result?.candidates[0]?.cardId??event.track.cardId??'');
  type PileDestination=Pick<FieldTrack,'zone'|'faceDown'|'firstSeen'|'restSince'>;
  const pileExitAt=(track:PileDestination)=>track.restSince??track.firstSeen;
  const pileOutOfView=(snap:FieldSnapshot|undefined,zone:PileCell,at:number)=>
    recentPileEvidence(at,snap?.pileClearSince?.[zone])||recentPileEvidence(at,snap?.pileReturnedAt?.[zone]);
  const pileDisplaced=(track:PileDestination,pile:PublicPile,ref:string)=>displacedAt(pile,ref).some(at=>recentPileEvidence(pileExitAt(track),at));
  function pileExitCandidate(track:PileDestination,card:TwinCard,zone:PileCell,pile:PublicPile,twins:readonly TwinCard[],snap:FieldSnapshot|undefined) {
    return pileOutOfView(snap,zone,pileExitAt(track))||twins.filter(c=>c.zone===pile).at(-1)===card||pileDisplaced(track,pile,card.ref);
  }
  /** Match a settled destination to a card whose source shows a change. */
  function pileExit(track:PileDestination,entry:Entry|undefined,twins:readonly TwinCard[]):TwinCard|undefined {
    if(!entry||track.faceDown)return;
    const snap=watch.getSnapshot?.();if(!snap)return;
    for(const [zone,pile] of orderedPiles){
      if(track.zone===zone)continue;
      const visible=snap.tracks.filter(t=>t.zone===zone&&t.visible&&!t.removed);
      const at=pileExitAt(track),out=pileOutOfView(snap,zone,at);
      const members=twins.filter(c=>c.zone===pile),top=members.at(-1);
      const copy=pileCopy(members.filter(c=>!visible.some(t=>(bindings.current.get(t.id)??t.id)===c.ref)&&
        (out||c===top||pileDisplaced(track,pile,c.ref))),entry);
      if(!copy)continue;
      const changed=!fannedPile(snap,zone)&&visible.some(t=>!t.faceDown&&t.state==='identified'&&!!t.cardId&&t.cardId!==String(cardCode(copy)??'')&&recentPileEvidence(at,t.firstSeen));
      if(out||changed||pileDisplaced(track,pile,copy.ref))return copy;
    }
  }
  const pileVisible=(snap:FieldSnapshot,zone:PileCell,since:number)=>
    !snap.missingPiles?.includes(zone)&&snap.pileClearSince?.[zone]===undefined&&(snap.pileReturnedAt?.[zone]??-Infinity)<since;
  const fannedPile=(snap:FieldSnapshot|undefined,zone:PileCell)=>snap?.fannedPiles?.includes(zone)||
    (snap?.tracks??watch.getTracks()).filter(t=>t.zone===zone&&t.visible&&!t.removed).length>1;
  const presentInFan=(card:TwinCard,track:FieldTrack)=>watch.getTracks().some(other=>
    other.id!==track.id&&other.zone===track.zone&&other.visible&&!other.removed&&Math.abs(track.lastSeen-other.lastSeen)<=500&&
    (bindings.current.get(other.id)??other.id)===card.ref);
  const pileDepartureStillMissing=(value:Departure,card:TwinCard)=>card.zone===value.pile&&
    !watch.getTracks().some(t=>t.visible&&!t.removed&&(bindings.current.get(t.id)??t.id)===value.ref);
  function offerPileDeparture(track:FieldTrack,lower:TwinCard,upper:readonly TwinCard[],zone:PileCell,pile:PublicPile) {
    const key=`pile-reveal:${zone}`;
    const retryUntil=performance.now()+PILE_EXIT_MS;
    clearTimeout(departureTimers.current.get(key));
    const check=()=>{
      departureTimers.current.delete(key);
      const snap=watch.getSnapshot?.();
      if(!live()||!snap||!pileVisible(snap,zone,track.firstSeen)||fannedPile(snap,zone)||departureRef.current)return;
      const twins=current.current.room.state.seats[seat].twin;
      const top=twins.filter(c=>c.zone===pile).at(-1);
      if(!top||promptedPileTops.current.get(zone)===top.ref)return;
      const currentLower=twins.find(c=>c.ref===lower.ref&&c.zone===pile);
      const visible=snap.tracks.filter(t=>t.visible&&!t.removed);
      const refOf=(t:FieldTrack)=>bindings.current.get(t.id)??t.id;
      if(!currentLower||!visible.some(t=>t.zone===zone&&t.firstSeen===track.firstSeen&&refOf(t)===lower.ref))return;
      const outside=visible.filter(t=>t.zone!==zone&&t.lastSeen>=track.firstSeen);
      const stillAbove=twins.slice(twins.indexOf(currentLower)+1);
      const missing=upper.find(c=>stillAbove.some(t=>t.ref===c.ref&&t.zone===pile)&&
        !visible.some(t=>refOf(t)===c.ref)&&
        !outside.some(t=>t.cardId&&t.cardId===String(cardCode(c)??'')&&!twins.some(twin=>twin.ref===refOf(t))));
      if(!missing)return;
      const now=performance.now();
      // A hand or an unread destination can delay the field move past the first reveal check.
      if(now-pileActivity(snap)[zone]<PILE_REVEAL_WAIT_MS||outside.some(t=>!t.cardId&&(t.state==='candidate'||t.state==='prompt'))){
        if(now<retryUntil)departureTimers.current.set(key,setTimeout(check,PILE_REVEAL_RECHECK_MS));
        return;
      }
      const name=missing.name??cardInfo(cardCode(missing))?.name??'Card';
      promptedPileTops.current.set(zone,top.ref);
      setDeparture({ref:missing.ref,name,zone:'pending',pile});
      setUndoId('');setNotice(`${name} left the ${pile==='graveyard'?'Graveyard':'banished pile'} · choose destination`);
    };
    departureTimers.current.set(key,setTimeout(check,PILE_REVEAL_WAIT_MS));
  }
  /** True when a token holds the cell: ask the player (one click to remove it, e.g. after a Tribute Summon) and place nothing. */
  function tokenClash(event:FieldEvent,zone:FieldZone,twins:readonly TwinCard[],name:string|undefined,facts?:ReturnType<typeof cardInfo>) {
    const token=tokenInCell(twins,zone);if(!token)return false;
    setTokenPrompt(prompt=>prompt?.event.track.id===event.track.id&&prompt.token.ref===token.ref?prompt:{event,token,zone,name:name??'the card',facts});
    return true;
  }
  function proxyAt(zone:FieldZone,exceptRef?:string) {
    const room=current.current.room, seats=room.state.seats,land=fieldZoneLocation(zone);
    const extra=hasExtraZones(room.format?.id??room.state.deckChecks.format.id);
    const own=proxyAtLanding(seats[seat].twin,land,extra,exceptRef);
    if(own)return {proxy:own,holder:seat};
    if(land.zone!=='extra-monster'||!land.slot)return;
    const other=facingSeat(seat,seats.length);
    if(other===null)return;
    const proxy=proxyAtLanding(seats[other].twin,{...land,slot:mirrorEmz(land.slot)},extra,exceptRef);
    if(proxy)return {proxy,holder:other};
  }
  // A marker stays out of the twin while its track stays in the observed cell.
  const isProxyMarker=(track:Pick<FieldTrack,'id'|'zone'>)=>proxyMarkers.current.has(track.id)&&proxyBlockedTracks.current.get(track.id)===track.zone;
  function proxyClash(event:FieldEvent,zone=event.track.zone) {
    if(isProxyMarker(event.track))return true;
    const occupant=proxyAt(zone,bindings.current.get(event.track.id)??event.track.id);
    if(!occupant)return false;
    proxyBlockedTracks.current.set(event.track.id,event.track.zone);
    setProxyClashes(list=>{
      const previous=list.find(p=>p.event.track.id===event.track.id);
      if(previous?.proxy.ref===occupant.proxy.ref&&previous.zone===zone&&previous.event.track.zone===event.track.zone&&previous.event.track.revision===event.track.revision&&previous.event.type===event.type)return list;
      const clash={event,zone,...occupant};
      return previous?list.map(p=>p===previous?clash:p):[...list,clash];
    });
    return true;
  }
  function leaveProxyMarker(id:string) {
    proxyMarkers.current.add(id);
    setProxyClashes(list=>list.filter(p=>p.event.track.id!==id));
    setPrompts(list=>list.filter(p=>p.track.id!==id));
  }
  function replaceProxy(clash:NonNullable<typeof proxyPrompt>) {
    const {event,zone,proxy,holder}=clash;
    const stillClashing=()=>{
      const observed=trackForChoice(event);
      const occupant=proxyAt(zone);
      return observed?.zone===event.track.zone&&fieldEvidenceMatches(event,observed,event.type==='prompt')&&occupant?.proxy.ref===proxy.ref&&occupant.holder===holder;
    };
    setPending(true);
    void queue(async act=>{
      const updated=await act({type:'twin.remove',actorSeat:seat,seat:holder,cardRef:proxy.ref,cam:playerStamp('replace-proxy')},undefined,event,undefined,stillClashing);
      if(!updated)return;
      // A manual removal normally holds its cell against the camera. This one invites the detected card into it.
      correctionsFor(updated,holder).release(proxy.ref);
      setProxyClashes(list=>list.filter(p=>p!==clash));
      setNotice('Proxy removed · Undo');setUndoId(updated.state.undo?.actionId??'');
      handle(event);
    },event).finally(()=>setPending(false));
  }
  function abstain(event:FieldEvent,message:string) {
    if(watch.getTrack(event.track.id)?.state==='prompt')offer({...event,type:'prompt',reason:'uncertain'});
    setNotice(message);
  }
  function faceReadFor(track:FieldTrack) {
    const read=faceReads.current.get(track.zone);
    if(read?.track.id===track.id&&read.track.revision===track.revision&&read.track.cardId===track.cardId)return read.result;
  }
  async function removePlaceholder(id:string,act:RoomMutation,retired=false) {
    const ref=placeholders.current.get(id);if(!ref)return true;
    const track=watch.getTrack(id);
    if(retired&&track&&!track.removed&&track.state!=='dismissed')return false;
    const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
    // A manual identification owns the twin now; never delete that correction.
    if(card&&cardCode(card)){placeholders.current.delete(id);bindings.current.set(id,ref);return true;}
    // This intermediate removal belongs to the reader, so the room update
    // must not forget and suppress the live track before its identity is saved.
    readerRemovals.current.add(ref);
    try{if(card&&!await act({type:'twin.remove',source:'auto',actorSeat:seat,seat,cardRef:ref,...(retired?{}:{cam:fieldCameraStamp(undefined,'camera','replace-placeholder',track?.lastSeen??performance.now())})})){readerRemovals.current.delete(ref);return false;}}
    catch(error){readerRemovals.current.delete(ref);throw error;}
    if(retired&&!correctionsFor(current.current.room,seat).has(ref))watch.forget(id);
    placeholders.current.delete(id);bindings.current.delete(id);return true;
  }
  async function showPlaceholder(event:FieldEvent,act:RoomMutation) {
    console.info('[remote field] placeholder',event.track.id,event.track.zone);
    const observed=watch.getTrack(event.track.id);
    if(!live()||!fieldEvidenceMatches(event,observed)||isProxyMarker(observed!)||placeholders.current.has(event.track.id))return;
    const location=fieldZoneLocation(observed!.zone),twins=current.current.room.state.seats[seat].twin;
    if(piles.has(observed!.zone)||proxyAt(observed!.zone)||twins.some(c=>c.zone===location.zone&&c.slot===location.slot))return;
    // A projected card still owns its physical camera cell as well.
    if(twins.some(c=>c.faceUp&&cardCode(c)&&knownZone(c)===observed!.zone))return;
    const proposal=fieldPlacementProposals({track:{...observed!,cardId:undefined},seat})[0];if(!proposal||proposal.type!=='twin.place')return;
    const updated=await act(proposal);if(!updated)return;
    const saved=updated.state.seats[seat].twin.find(c=>c.zone===location.zone&&c.slot===location.slot);if(!saved)return;
    placeholders.current.set(event.track.id,saved.ref);bindings.current.set(event.track.id,saved.ref);
    const after=watch.getTrack(event.track.id);
    if(!after||after.removed||after.revision!==event.track.revision)await removePlaceholder(event.track.id,act,!after||after.removed);
  }
  async function apply(event:FieldEvent,act:RoomMutation,chosen?:string,attempt=0,slideUntil?:number,factsWaited=false) {
    if(givenHold(event.track)||reviewing(event))return;
    console.info('[remote field] identify',event.track.id,chosen??event.track.cardId,event.track.zone,event.type);
    const humanChoice=event.type==='prompt'&&(!!chosen||event.reason==='card-presence');
    const matchesEvidence=(track:FieldTrack|undefined)=>fieldEvidenceMatches(event,trackForChoice(event,track),humanChoice);
    const mutate=(proposal:Parameters<typeof applyVerifiedFieldMutation>[3])=>applyVerifiedFieldMutation(event,()=>trackForChoice(event),act,proposal,humanChoice);
    // Nothing is written yet: a card that is moving or covered defers its identification.
    const defer=(observed:FieldTrack|undefined)=>{
      console.warn('[remote field] identification deferred',event.track.id,observed?.state,observed?.visible,observed?.revision,attempt,fieldEvidenceMismatch(event,observed,humanChoice)??'moved or covered');
      if(chosen){setNotice('Card is moving or covered. Keep it still, then choose again.');return;}
      // A hand passing over the card hides it for a moment. Retry the same
      // evidence quietly; a changed card brings its own fresh event.
      if((event.type!=='flipped'||event.track.faceDown)&&live()&&observed&&!observed.removed&&attempt<6&&(observed.revision??0)===(event.track.revision??0)&&observed.cardId===event.track.cardId)
        setTimeout(()=>{void queue(next=>apply(event,next,undefined,attempt+1,slideUntil,factsWaited),event);},200);
    };
    const observed=watch.getTrack(event.track.id);
    if(!live()||!matchesEvidence(observed)){defer(observed);return;}
    if(proxyClash(event,observed!.zone))return;
    let track={...observed!,id:bindings.current.get(event.track.id)??event.track.id,...(chosen?{cardId:chosen,faceDown:false}:{})};
    const entry=track.cardId?entries.current.get(track.cardId):undefined;
    let twins=current.current.room.state.seats[seat].twin;
    const code=entry?catalogCardId(entry):undefined;
    const replacedSet=!track.faceDown&&entry&&!piles.has(track.zone)?twins.find(c=>
      (c.ref===track.id||humanChoice&&c.ref===event.bindRef)&&publicField(c.zone)&&differentKnownSet(c,{cardId:code,name:entry.name})):undefined;
    const replacementRead=replacedSet?(event.result??faceReadFor(observed!)):undefined;
    if(replacedSet&&!humanChoice&&(event.track.zone!==track.zone||!fieldSureSetRead(track,replacementRead)))return;
    if(replacedSet&&watch.getTracks().some(t=>t.id!==event.track.id&&t.visible&&!t.removed&&(bindings.current.get(t.id)??t.id)===replacedSet.ref)){
      abstain(event,'Another physical card owns this ref. Check the field.');return;
    }
    if(replacedSet&&!humanChoice&&event.type!=='flipped'&&
      (face.current.held(replacedSet.ref)||!face.current.allows(replacedSet.ref,performance.now())))return;
    const facts=cardInfo(code), fieldSpell=!track.faceDown&&isFieldSpell(facts);
    const held=handActivation.current;
    const fromActivation=held&&code===held.cardId&&performance.now()-held.at<HAND_ACTIVATION_MS?held.actionId:undefined;
    const physicalCell=fieldZoneLocation(track.zone);
    if(!humanChoice&&!piles.has(track.zone)&&twins.some(c=>c.ref===track.id&&c.zone==='graveyard')&&keepsManual(track.id,physicalCell,track.position))return;
    // A catalog-sure reveal can still carry Best match when it is outside the
    // deck list. A mismatched Set already passed the same read check above.
    if(!humanChoice&&!track.faceDown&&track.bestMatch&&track.restSince!==undefined&&twins.some(c=>
      publicField(c.zone)&&c.zone===physicalCell.zone&&c.slot===physicalCell.slot&&(cardCode(c)||!c.faceUp||c.token)&&
      c.ref!==replacedSet?.ref&&
      !fieldSureSetReveal(event,track,c)))return;
    let existing=twins.find(c=>c.ref===track.id);
    let location=fieldZoneLocation(track.zone);
    if(!track.faceDown&&!entry)throw new Error('Card details are unavailable. Use Retry field update.');
    const pile=observedPile(track.zone);
    const sureTop=!!pile&&(event.result?fieldSureSetRead(track,event.result):!track.bestMatch&&track.restSince!==undefined);
    const knownOrigin=pile&&(twins.find(c=>c.ref===(event.fromRef??track.id))??pileExit(track,entry,twins));
    if(pile&&entry&&!track.faceDown&&(!knownOrigin||knownOrigin.zone===pile)){
      const zone=track.zone as PileCell,members=twins.filter(c=>c.zone===pile);
      const snap=watch.getSnapshot?.(),fanned=fannedPile(snap,zone);
      const matching=pileCopy(fanned?members.filter(c=>!presentInFan(c,observed!)):members,entry),top=members.at(-1);
      if(matching){
        if(sureTop&&matching===top)promptedPileTops.current.delete(zone);
        const oldTopVisible=(snap?.tracks??watch.getTracks()).some(t=>t.id!==event.track.id&&t.zone===zone&&t.visible&&!t.removed&&(bindings.current.get(t.id)??t.id)===top?.ref);
        const lastOrder=pileOrders(pile).at(-1);
        const manualOrder=lastOrder&&(lastOrder.action.type==='pile.set'||lastOrder.action.type==='pile.order'&&lastOrder.action.source!=='auto');
        if(matching!==top&&!oldTopVisible&&!fanned){
          if(humanChoice||track.pileReturn&&sureTop&&(!manualOrder||track.firstSeen>watcherTime(lastOrder.at))){
            const cardRefs=[...members.filter(c=>c!==matching).map(c=>c.ref),matching.ref];
            const updated=await mutate({type:'pile.order',source:'auto',actorSeat:seat,seat,zone:pile,cardRefs});
            if(!updated)return;
            setUndoId(updated.state.undo?.actionId??'');
          }else if(!track.pileReturn&&sureTop&&snap&&pileVisible(snap,zone,track.firstSeen)&&(!manualOrder||track.firstSeen>watcherTime(lastOrder.at))){
            offerPileDeparture(track,matching,members.slice(members.indexOf(matching)+1).reverse(),zone,pile);
          }
        }
        bindings.current.set(event.track.id,matching.ref);watch.confirm(event.track.id,track.cardId,matching.ref,humanChoice);
        return;
      }
    }
    if(['DECK','EXTRA'].includes(track.zone)){
      const resolved=resolveExisting(event,track,entry,twins);
      if(resolved.blocked||!resolved.existing)return;
      const moved=await act({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:resolved.existing.ref,...location,position:fieldTwinPosition(track)});
      if(moved){bindings.current.set(event.track.id,resolved.existing.ref);watch.confirm(event.track.id,track.cardId,resolved.existing.ref,event.type==='prompt');}
      return;
    }
    const placeholderRef=placeholders.current.get(event.track.id),manual=twins.find(c=>c.ref===placeholderRef&&cardCode(c));
    if(manual){
      placeholders.current.delete(event.track.id);bindings.current.set(event.track.id,manual.ref);
      if(!chosen){watch.confirm(event.track.id,String(cardCode(manual)),manual.ref);return;}
    }
    // A textured back already has its visual Set. Adopt that ref atomically;
    // deleting/replacing it would flicker and add spurious Undo entries.
    const setPlaceholder=twins.find(c=>c.ref===placeholderRef&&!c.faceUp);
    if(track.faceDown&&setPlaceholder){
      if(setPlaceholder.zone!==location.zone||setPlaceholder.slot!==location.slot||setPlaceholder.position!==fieldTwinPosition(track)){
        const updated=await mutate({type:'twin.move',actorSeat:seat,seat,cardRef:setPlaceholder.ref,...location,position:fieldTwinPosition(track)});if(!updated)return;
      }
      placeholders.current.delete(event.track.id);bindings.current.set(event.track.id,setPlaceholder.ref);
      watch.confirm(event.track.id,undefined,setPlaceholder.ref,false);rememberPhysical(setPlaceholder.ref,track.zone);return;
    }
    // Reserve the visual cue until catalog loading and duplicate checks finish.
    twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    track={...track,id:bindings.current.get(event.track.id)??event.track.id};
    const resolved=resolveExisting(event,track,entry,twins);
    if(resolved.blocked){abstain(event,'Another physical card owns this ref. Check the field.');return;}
    existing=resolved.existing??pileExit(track,entry,twins);
    if(existing)track={...track,id:existing.ref};
    else if(twins.some(c=>c.ref===track.id))track={...track,id:newRefFor(event)};
    const placementRef=track.id;
    const noFacts=!!code&&!track.faceDown&&!cardInfo(code)&&!cardFailed(code);
    // First pass: wait for the facts (abstain and reload). After SLOW_FACTS_CAP_MS (`factsWaited`) the facts may still be missing: the placement goes on with the observed zone and the zone-rule effect corrects it once they arrive.
    const slowFacts=!factsWaited&&noFacts,lateFacts=slowFacts||factsWaited&&noFacts;
    const latest=watch.getTrack(event.track.id);if(!live()||!matchesEvidence(latest)){defer(latest);return;}
    // Keep the reserved physical ref while refreshing geometry and occupancy after I/O.
    track={...latest!,id:existing?.ref??placementRef,...(chosen?{cardId:chosen,faceDown:false}:{})};
    twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    const freshBinding=resolveExisting(event,track,entry,twins);
    if(freshBinding.blocked){abstain(event,'Another physical card owns this ref. Check the field.');return;}
    // An Xyz material the player put in the GY / banished pile (a detach cost): detach it, never a second copy.
    const material=['GY','BANISHED'].includes(track.zone)?twins.find(c=>c.zone==='material'&&!!c.materialOf&&(c.ref===track.id||c.ref===bindings.current.get(event.track.id)||c.ref===event.bindRef)):undefined;
    if(material){
      const updated=await act({type:'twin.detach',actorSeat:seat,seat,cardRef:material.materialOf!,materialRef:material.ref,zone:track.zone==='GY'?'graveyard':'banished'});
      if(updated){bindings.current.set(event.track.id,material.ref);watch.confirm(event.track.id,track.cardId,material.ref,false);setNotice(`${material.name??'Material'} detached · auto`);setUndoId(updated.state.undo?.actionId??'');}
      return;
    }
    existing=freshBinding.existing??pileExit(track,entry,twins);
    if(!humanChoice&&existing&&publicField(existing.zone)&&track.zone==='BANISHED'&&
      !fieldNamedBanish(event,track,twins,t=>bindings.current.get(t.id)??t.id,watch.getTracks())){
      askDeparture(existing.ref,existing.faceUp?existing.name??'Card':'Card',event.track.id);return;
    }
    if(!piles.has(track.zone)&&!track.faceDown&&(!existing?.faceUp||!publicField(existing.zone))){
      const notice=remoteActivationNotice(current.current.room.state,seat,facts&&remoteActivationLimit(facts.name,facts.effectText),fromActivation);
      if(notice){setNotice(notice);return;}
    }
    // The named front replaces the bound Set. Project its placement with
    // that cell freed, then save the old card's departure before placing it.
    if(replacedSet)twins=twins.filter(c=>c.ref!==replacedSet.ref);
    // A back that settles where a known card just left is that card Set again: turned over in place, back from the hand, or slid to another zone.
    const canReturn=!existing&&track.faceDown&&event.type==='placed'&&!chosen&&!humanChoice&&!piles.has(track.zone);
    const snap=canReturn?watch.getSnapshot?.({includeMissingSetLooks:true}):undefined;
    const slideInputNow=canReturn?slideInput(latest!,snap):undefined;
    const slide=slideInputNow?fieldSetSlide(slideInputNow):undefined;
    if(slideInputNow&&!slide&&fieldSetSlidePending(slideInputNow,snap)){
      const now=slideInputNow.now,until=slideUntil??Math.min(now+1000,(track.restSince??track.firstSeen)+1750);
      if(until>now){
        // Release the serial write queue while the source's next sample settles.
        setTimeout(()=>{if(live())void queue(next=>apply(event,next,chosen,attempt,until,factsWaited),event);},Math.min(FLIP_POLL_MS,until-now));
        return;
      }
    }
    const setBack=slide?{kind:'move' as const,card:slide.card}:canReturn?setBackFor(track,event.track.id,freshZoomBack(event,track)):undefined;
    if(setBack){
      const card=setBack.card;
      // A rule-projected card can hold the virtual cell while the camera sees that card elsewhere.
      const target=slide?projectObserved(track,twins,card,undefined).zone:setBack.kind==='flip'?toZone(card.zone,card.slot):track.zone;
      if(!target)return;
      const cell=fieldZoneLocation(target);
      // The same guards as the face check and a placement: a held card, a quiet card, an Undo'd or hand-corrected card is left alone.
      if(undoKept.current.has(card.ref)||keepsManual(card.ref,cell,fieldTwinPosition(track))||setBack.kind==='flip'&&(face.current.held(card.ref)||!face.current.allows(card.ref,performance.now())))return;
      const proposal=setBack.kind==='flip'?fieldFaceProposal(card,track,seat):{type:'twin.move' as const,source:'auto' as const,actorSeat:seat,seat,cardRef:card.ref,...(slide?{physicalZoneChanged:true as const}:{}),zone:cell.zone,...(cell.slot?{slot:cell.slot}:{}),faceUp:false,position:fieldTwinPosition(track)};
      if(!proposal)return;
      setPending(true);
      try{
        const updated=await mutate(proposal);
        if(!updated)return;
        if(slide)cancelDeparture(slide.from.id);
        if(departureRef.current?.ref===card.ref)setDeparture(null);
        if(setBack.kind==='flip')face.current.flipped(card.ref,performance.now());
        placeholders.current.delete(event.track.id);
        bindings.current.set(event.track.id,card.ref);watch.confirm(event.track.id,undefined,card.ref,false);
        rememberPhysical(card.ref,track.zone);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
        setNotice(`Set card ${setBack.kind==='flip'?'turned over':setBack.kind==='return'?'put back':'moved'} · auto`);setUndoId(updated.state.undo?.actionId??'');
      }finally{setPending(false);}
      return;
    }
    // Settle only the name of an admitted unsure card. Its location and materials keep their own actions.
    if(existing?.nameCandidates&&!track.nameCandidates&&event.result?.tier==='sure'&&entry&&!chosen&&publicField(existing.zone)&&existing.faceUp){
      const code=catalogCardId(entry),ref=existing.ref;if(!code)return;
      const updated=await mutate({type:'card.identified',actorSeat:seat,seat,cardRef:ref,cardId:code,name:entry.name,source:'auto',nameCandidates:null,bestMatch:false,zone:existing.zone,...(existing.slot?{slot:existing.slot}:{})});
      const saved=updated?.state.seats[seat].twin.find(card=>card.ref===ref);
      if(updated&&saved&&cardCode(saved)===code){bindings.current.set(event.track.id,saved.ref);watch.confirm(event.track.id,track.cardId,saved.ref,false);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));setNotice(`${entry.name} identified · auto`);setUndoId(updated.state.undo?.actionId??'');}
      return;
    }
    // A revive: the same card lies in the GY/banished pile and a hand was just over that pile. Let the pile settle
    // (at most ~1 s) and check its cell again before this becomes a new copy. No prompt.
    if(!existing&&!track.faceDown&&entry&&!piles.has(track.zone)&&attempt<3){
      const touched=watch.getSnapshot?.()?.pileTouchedAt;
      const settling=([['GY','graveyard'],['BANISHED','banished']] as const).some(([zone,pileZone])=>performance.now()-(touched?.[zone]??-Infinity)<1000&&!!pileCopy(twins.filter(c=>c.zone===pileZone),entry));
      if(settling){setTimeout(()=>{if(live())void queue(next=>apply(event,next,chosen,attempt+1,undefined,factsWaited),event,humanChoice);},200);return;}
    }
    if(existing)track={...track,id:existing.ref};
    else if(twins.some(c=>c.ref===track.id))track={...track,id:newRefFor(event)};
    // A pile card the camera re-reads after a restart (or with no hand over the pile) is the current top, not a new card.
    const pileTop=['GY','BANISHED'].includes(track.zone)?twins.filter(c=>c.zone===location.zone).at(-1):undefined;
    if(observedPile(track.zone)&&!humanChoice&&!existing&&(track.pileReturn&&!!pileTop&&!sureTop||!pileEntry(track,!!code&&sureTop&&!!pileTop&&cardCode(pileTop)!==code))){
      const top=pileTop;
      if(top){bindings.current.set(event.track.id,top.ref);watch.confirm(event.track.id,top.faceUp&&cardCode(top)===code?track.cardId:undefined,top.ref,false);}
      return;
    }
    // Extra Deck summon: the monsters under this card or that left the field in the window are its materials.
    const summonType=(!existing||!publicField(existing.zone))&&!track.faceDown&&code?fieldSummonKind(cardInfo(code)):undefined;
    const materialRefs=summonType&&/^(M[1-5]|EMZ[12])$/.test(track.zone)?fieldSummonMaterials({kind:summonType.kind,rating:summonType.rating,covered:stackUnder(event.track.id),vanished:vanishes.current,pending:[...pendingLeft.current.values()],firstSeen:track.firstSeen,twins,removed:outOfView,now:serverNow(),separated:separatedStackCards.current}):undefined;
    const summon=summonType&&materialRefs?{kind:summonType.kind,materialRefs}:undefined;
    if(fieldSpell&&proxyClash(event,'FIELD'))return;
    const stale=staleFieldOccupant(twins,watch.getTracks().map(track=>({...track,id:bindings.current.get(track.id)??track.id})),track.zone,existing?.ref??track.id);
    // Release a slot only for a card that lands in it: a Trap seen in M4 goes to the Spell/Trap row and leaves the M4 twin alone.
    // Facts still missing after the cap: a card in the monster row is placed in its observed cell, the zone-rule effect corrects it later.
    const claimsSlot=!fieldSpell&&stale&&(factsWaited&&!facts&&/^(M[1-5]|EMZ[12])$/.test(track.zone)||projectObserved(track,twins.filter(c=>c.ref!==stale.ref),existing,facts).zone===track.zone);
    const needsSummonFacts=!existing&&/^M[1-5]$/.test(track.zone)&&/^(fusion|synchro|xyz|link)/i.test(entry?.frameClass??'');
    if(slowFacts&&(stale||track.zone.startsWith('EMZ')||needsSummonFacts)){
      // The retry runs when the facts arrive, or after SLOW_FACTS_CAP_MS at the latest (a failed or slow lookup used to leave the action waiting for the 10 s lookup deadline, or for a later read). Then it goes on with the observed zone, as for a card whose lookup failed.
      if(code)void cappedFacts(loadCards([code]),SLOW_FACTS_CAP_MS).then(()=>{
        if(live()&&matchesEvidence(watch.getTrack(event.track.id)))void queue(next=>apply(event,next,chosen,attempt,undefined,true),event,humanChoice);
      });
      abstain(event,'Check zone? Card details are still loading.');return;
    }
    if(stale&&claimsSlot&&!summon?.materialRefs.includes(stale.ref)){
      const trackBefore=watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===stale.ref);
      const absentAt=trackBefore?.lastSeen??missingSince.current.get(stale.ref)??performance.now();
      missingSince.current.set(stale.ref,absentAt);
      const proofAt=trackBefore?.emptyProofAt??fieldEmptyProofs(watch.getSnapshot?.())?.[knownZone(stale)??track.zone];
      const waitUntil=proofAt===undefined?absentAt+2000:proofAt+DEPARTURE_WAIT_MS;
      if(performance.now()<waitUntil){
        const key=`stale:${event.track.id}`;
        // The latest apply replaces the wait: a player who corrects a choice during it keeps the correction.
        const waiting=departureTimers.current.get(key);if(waiting)clearTimeout(waiting);
        departureTimers.current.set(key,setTimeout(()=>{
          departureTimers.current.delete(key);if(live())void queue(act=>apply(event,act,chosen,attempt,undefined,factsWaited),event,humanChoice);
        },Math.max(1,waitUntil-performance.now())));
        return;
      }
      const pending=[...pendingDepartures.current.values()].find(({origin})=>origin.ref===stale.ref);
      if(pending){
        if(pending.unresolved)return;
        const key=`stale:${event.track.id}`;
        if(!departureTimers.current.has(key))departureTimers.current.set(key,setTimeout(()=>{
          departureTimers.current.delete(key);if(live())void queue(act=>apply(event,act,chosen,attempt,undefined,factsWaited),event,humanChoice);
        },200));
        return;
      }
      const departure=fieldDepartureProposal(stale,seat,undefined,cardInfo(cardCode(stale)));
      if(!departure||!await act(departure))return;
      // The departure counts as a vanish too: the summon that follows can still take this monster as a material.
      if(summonable(departure.zone)&&stale.faceUp&&['monster','extra-monster'].includes(stale.zone))vanishes.current=[...vanishes.current.filter(v=>v.ref!==stale.ref),{ref:stale.ref,at:absentAt}].slice(-10);
      twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id)&&c.ref!==replacedSet?.ref);
    }
    // Keep the observed cell while facts load. The zone-rule effect rechecks the same ref.
    const projected=lateFacts&&!facts&&(!existing||knownZone(existing)!==track.zone)?{zone:track.zone,label:''}:
      projectObserved(track,twins,existing,facts);
    if(!projected.zone){abstain(event,projected.reason??'Choose a legal zone manually.');return;}
    if(proxyClash(event,projected.zone)||tokenClash(event,projected.zone,twins,entry?.name,entry?cardInfo(catalogCardId(entry)):undefined))return;
    const physicalAtSave={zone:track.zone,position:track.position};
    track={...track,zone:projected.zone};location=fieldZoneLocation(projected.zone);
    if(!fieldSpell&&!piles.has(track.zone)&&twins.some(c=>c.ref!==existing?.ref&&!summon?.materialRefs.includes(c.ref)&&c.zone===location.zone&&c.slot===location.slot)) {abstain(event,'This zone is occupied. Choose a free zone.');return;}
    // The reader already placed this physical card. Identify it in place rather
    // than removing and recreating it while the next camera event is queued.
    const readingCard=current.current.room.state.seats[seat].twin.find(c=>c.ref===placeholderRef);
    let placeReadingCard=false;
    if(!existing&&!track.faceDown&&entry&&readingCard?.faceUp&&publicField(readingCard.zone)){
      placeReadingCard=!!fromActivation||readingCard.zone!==location.zone||readingCard.slot!==location.slot;
      existing=readingCard;track={...track,id:readingCard.ref};
    }
    setPending(true);
    try {
      if(existing?.ref!==placeholderRef&&!await removePlaceholder(event.track.id,act))return;
      if(replacedSet){
        const departure=fieldDepartureProposal(replacedSet,seat);
        const front=watch.getTrack(event.track.id);
        if(!humanChoice&&(!front||front.zone!==event.track.zone||!fieldSureSetRead(front,replacementRead)))return;
        if(!departure||!await mutate(departure))return;
      }
      let updated:RemoteRoom|null=null;
      const originReturn=!!existing&&['deck','hand','extra','graveyard','banished'].includes(existing.zone)&&existing.zone!==location.zone;
      const atomicReveal=!!existing&&!originReturn&&!existing.faceUp&&!track.faceDown&&!!entry;
      const matchingMove=existing?.faceUp&&!track.faceDown&&entry&&(publicField(existing.zone)||!summon&&['graveyard','banished'].includes(existing.zone))&&
        sameObservedCard(existing,{cardId:code,name:entry.name})&&(existing.zone!==location.zone||existing.slot!==location.slot);
      const setMove=existing&&!originReturn&&(existing.faceUp||existing.publicIdentity)
        ?fieldSetMove(existing,track,seat,physicalAtSave.zone!==knownZone(existing)):undefined;
      if(matchingMove&&existing){
        if(!humanChoice&&keepsManual(existing.ref,location,track.position))return;
        updated=await mutate({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:existing.ref,...location,
          position:fieldTwinPosition(track),...(piles.has(track.zone)?{faceUp:true,confirmed:true}:{})});if(!updated)return;
      }else if(existing&&!originReturn&&existing.faceUp===track.faceDown){
        // No write now: the player holds this face, the card is in its quiet time, or an Xyz Monster has no clear back. The face check comes back to it.
        if(!chosen&&(face.current.held(existing.ref)||!face.current.allows(existing.ref,performance.now()))||track.faceDown&&existing.materials?.length&&!fieldStrongBack(track))return;
        updated=await mutate(setMove ?? {type:'twin.flip',source:'auto',actorSeat:seat,seat,cardRef:existing.ref,faceUp:!track.faceDown,position:fieldTwinPosition(track),...(atomicReveal?{cardId:catalogCardId(entry!),name:entry!.name,bestMatch:track.bestMatch}:{})});if(!updated)return;
        face.current.flipped(existing.ref,performance.now());
      }else if(setMove&&existing&&(humanChoice||!keepsManual(existing.ref,location,track.position))){
        updated=await mutate(setMove);if(!updated)return;
      }
      // The resolver has just required a distinct, same-frame witness for every
      // existing copy. Undo's clock estimate rounds HTTP Date up; evidence must
      // use its lower bound so the server never sees a future camera sample.
      const copyCount=code?twins.filter(c=>{
        if(!sameObservedCard(c,{cardId:code,name:entry?.name}))return false;
        if(pile&&c.zone===pile&&fannedPile(watch.getSnapshot?.(),track.zone as PileCell))return presentInFan(c,latest!);
        if(!publicField(c.zone))return false;
        const other=watch.getTrack(c.ref)??tracks.current.find(t=>(bindings.current.get(t.id)??t.id)===c.ref);
        return !!other&&simultaneousFieldCopies(track,other,true);
      }).length:0;
      const copyProof=!existing&&copyCount?{simultaneousQuads:copyCount+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-track.lastSeen))}:undefined;
      const choices=track.nameCandidates?.map(candidate=>{const named=entries.current.get(candidate.cardId);if(!named)throw new Error('Candidate names are still loading. Retry the field update.');const code=catalogCardId(named);if(!code)throw new Error('Candidate identity is unavailable. Retry the field update.');return {cardId:code,name:named.name,score:candidate.score};});
      const nameCandidates=choices??(existing?.nameCandidates?null:undefined);
      for(const proposal of atomicReveal||matchingMove?[]:fieldPlacementProposals({track,seat,nameCandidates,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing&&!originReturn&&!placeReadingCard,fromRef:originReturn?existing!.ref:undefined,copyProof,summon})){
        // The camera row was not legal for this card type: the log line says so ("Trap → S3"). No prompt.
        updated=await mutate(proposal.type==='twin.place'?{...proposal,...(projected.moved?{zoneRule:projected.moved}:{}),
          ...(fromActivation&&!track.faceDown&&!piles.has(track.zone)?{fromActivation}:{}),
          ...(!existing&&track.faceDown&&publicField(proposal.zone)?{anotherCopy:true}:{})}:proposal);if(!updated){if(matchesEvidence(watch.getTrack(event.track.id)))offer({...event,type:'prompt',reason:'recognition-error'});return;}
        if(proposal.type==='twin.place'){
          const canonical=placedTwin(updated.state.seats[seat].twin,{...proposal.card,zone:proposal.zone});
          if(!canonical)throw new Error('Camera placement was not returned in its slot');
          if(canonical.ref!==track.id){existing=twins.find(c=>c.ref===canonical.ref)??canonical;track={...track,id:canonical.ref};}
          bindings.current.set(event.track.id,canonical.ref);
          if(proposal.zone==='graveyard'||proposal.zone==='banished')pileWrites.current.set(canonical.ref,performance.now());
          // Count only the materials the server took (it skips cards that changed since the read).
          const after=updated.state.seats[seat].twin,usedRefs=(summon?.materialRefs??[]).filter(ref=>{const c=after.find(t=>t.ref===ref);return summon!.kind==='xyz'?c?.materialOf===canonical.ref:c?.zone==='graveyard';});
          if(lateFacts&&!cardInfo(code!)&&code)lateSummons.current.set(canonical.ref,{code,name:entry?.name??'Card',at:performance.now(),trackId:event.track.id});
          if(summonType)summons.current.set(canonical.ref,{kind:summonType.kind,name:entry?.name??'Card',rating:summonType.rating,at:performance.now(),count:usedRefs.length,pending:[],trackId:event.track.id});
          if(summon){const used=new Set(usedRefs);vanishes.current=vanishes.current.filter(v=>!used.has(v.ref));for(const ref of usedRefs)stackKept.current.delete(ref);for(const [trackId,v] of pendingLeft.current)if(used.has(v.ref)){const timer=departureTimers.current.get(trackId);if(timer)clearTimeout(timer);departureTimers.current.delete(trackId);pendingLeft.current.delete(trackId);}}
        }
      }
      const currentTarget=()=>{
        const observed=watch.getTrack(event.track.id);if(!live()||!matchesEvidence(observed))return;
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(item=>item.ref===track.id);if(!card)return;
        const targetCode=!observed!.faceDown&&card.identityConfirmed?cardCode(card)??code:code,targetFacts=cardInfo(targetCode);
        // After a place made without facts (slowFacts), the observed zone is the target; the zone-rule effect corrects it once the facts arrive.
        const target=lateFacts&&!targetFacts?{zone:observed!.zone,label:''} as ReturnType<typeof projectFieldZone>:projectObserved(observed!,twins,card,targetFacts,!!existing&&!existing.faceUp);
        if(!target.zone){abstain(event,target.reason??'Choose a legal zone manually.');return;}
        if(proxyClash(event,target.zone)||tokenClash(event,target.zone,twins,targetCode===code?entry?.name:card.name,targetFacts))return;
        return {observed:observed!,card,location:fieldZoneLocation(target.zone),position:fieldTwinPosition({...observed!,zone:target.zone})};
      };
      const matches=(target:NonNullable<ReturnType<typeof currentTarget>>)=>target.card.zone===target.location.zone&&target.card.slot===target.location.slot&&fieldPositionMatches(target.location.zone,target.card.position,target.position);
      let target=currentTarget();if(!target)return;
      if(!matches(target)&&!(existing&&!humanChoice&&keepsManual(existing.ref,fieldZoneLocation(target.observed.zone),target.observed.position))){
        const physicallyMoved=target.observed.zone!==physicalAtSave.zone||target.observed.position!==physicalAtSave.position;
        const initialCorrection=!!existing&&(humanChoice||!keepsManual(existing.ref,location,track.position))&&(existing.zone!==location.zone||existing.slot!==location.slot||!fieldPositionMatches(location.zone,existing.position,fieldTwinPosition(track)));
        if(!physicallyMoved&&!initialCorrection){setNotice('The placement changed. Check this card.');return;}
        // A genuine move is separate from the atomic placement and keeps its ref.
        updated=await mutate({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:target.card.ref,...target.location,position:target.position});
        if(!updated)return;
        target=currentTarget();if(!target)return;
        if(!matches(target)){setNotice('The card is still moving. Confirm it once settled.');return;}
      }
      if(!matchesEvidence(watch.getTrack(event.track.id)))return;
      placeholders.current.delete(event.track.id);
      bindings.current.set(event.track.id,target.card.ref);
      const savedCode=cardCode(target.card),ignoredName=!track.faceDown&&savedCode!==code;
      if(ignoredName&&(!target.card.identityConfirmed||!savedCode))return;
      // Reapply the player's confirmation to stop retries for the discarded guess.
      watch.confirm(event.track.id,ignoredName?String(savedCode):track.cardId,target.card.ref,ignoredName||event.type==='prompt');
      proxyBlockedTracks.current.delete(event.track.id);
      // The departed card may return on a track with its original board ref.
      if(event.track.id!==target.card.ref&&!watch.getTrack(event.track.id)&&
        current.current.room.state.seats[seat].twin.some(c=>c.ref===event.track.id))bindings.current.delete(event.track.id);
      rememberPhysical(target.card.ref,target.observed.zone);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
      const wasLeaving=departureRef.current?.ref===target.card.ref;setDeparture(null);
      if(ignoredName)return;
      const materialName=(ref:string)=>{const c=current.current.room.state.seats[seat].twin.find(t=>t.ref===ref);return c?.name??entries.current.get(watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===ref)?.cardId??'')?.name??'Card';};
      // Turning a board card over is no news: the table's Undo covers it. Only an uncertain read asks for a look.
      if(existing&&!originReturn&&(track.faceDown||atomicReveal&&!track.bestMatch)){if(wasLeaving)setNotice('');if(projected.moved||projected.shiftTo)noteRowFix(target.card.ref);return;}
      setNotice(summon?`${fieldSummonNotice(summon.kind,entry?.name??'Card',summon.materialRefs.map(materialName))} · auto`:`${track.bestMatch?'Best match · ':''}${track.faceDown?'Face-down card':entry?.name} placed${projected.moved?` · ${projected.moved}`:''} · auto`);setUndoId(updated?.state.undo?.actionId??'');
      if(tokenUndo.current?.trackId===event.track.id&&updated?.state.undo?.actionId){setChain(updated.state.undo.actionId,{ids:[tokenUndo.current.actionId]});tokenUndo.current=undefined;}
      // The card was held up and shown first: the placement joins that activation, so one notice and one Undo cover both.
      const activated=handActivation.current,placedId=updated?.state.undo?.actionId;
      if(activated&&placedId&&!summon&&entry&&!['monster','extra-monster'].includes(location.zone)&&catalogCardId(entry)===activated.cardId&&performance.now()-activated.at<HAND_ACTIVATION_MS&&!undoChain.current.has(placedId)){
        handActivation.current=undefined;setChain(placedId,{ids:[activated.actionId]});
        setNotice(`${entry.name} activated from hand, then placed · auto`);
      }
      if(projected.moved||projected.shiftTo)noteRowFix(target.card.ref);
      // A monster that stays in a Spell & Trap Zone is asked about once: the player knows if it is equipped or placed by a card.
      if(projected.shiftTo&&projected.zone?.startsWith('S')&&!rowKept.current.has(target.card.ref))setRowPrompts(list=>list.some(p=>p.ref===target.card.ref)?list:[...list,{ref:target.card.ref,name:entry?.name??'Monster'}]);
    }finally{setPending(false);}
  }
  /** A held Spell or Trap is shown as an activation. A monster only when its script has a hand quick effect: any other monster held up is about to be summoned or added, so it keeps the one-tap suggestion. Unknown card data means not activatable. */
  const heldActivatable=(cardId:number)=>{const frame=cardInfo(cardId)?.frameType;if(frame===undefined)return false;if(/^(spell|trap)/.test(frame))return true;return !/^(normal|fusion|synchro|xyz|link|token)/.test(frame)&&!!behaviourOf(cardId)?.handQuick;};
  /** One held card, named by the camera (sure, lifted) or picked by the player: shown to the table at once, never placed on the field. */
  async function commitHeld(act:RoomMutation,cardId:number,name:string,id:string,readAt:number,key:string) {
    // The card type must be known before the decision: an unloaded card is never "activatable".
    await loadCards([cardId]);
    if(!live()||watch.getTracks().some(t=>t.visible&&!t.removed&&t.cardId&&(entries.current.get(t.cardId)?.passcode??Number(t.cardId))===cardId))return;
    const decision=remoteHandActivationDecision(current.current.room.state,seat,{cardId,id,at:serverNow()},{fieldReadPending:heldFieldReadPending(watch.getTracks(),readAt),activatable:heldActivatable(cardId)});
    if(!decision)return;
    if(decision.type==='hand.suggest'){
      window.dispatchEvent(new CustomEvent(REMOTE_HAND_SUGGESTION_EVENT,{detail:{...decision,slug:current.current.room.slug,name}}));
      setNotice(`Add ${name} to hand?`);return;
    }
    const facts=cardInfo(cardId);
    const notice=decision.type==='effect.activated'&&facts&&remoteActivationNotice(current.current.room.state,seat,remoteActivationLimit(facts.name,facts.effectText));
    if(notice){setNotice(notice);return;}
    const updated=await act(decision,key.slice(0,100));
    const actionId=updated?.state.undo?.actionId;
    if(!updated||!actionId)return;
    if(decision.type==='effect.activated'){
      handActivation.current={cardId,actionId,at:performance.now()};
      // Later plays of another copy do not join this one once its window is over.
      setTimeout(()=>{if(handActivation.current?.actionId===actionId)handActivation.current=undefined;},HAND_ACTIVATION_MS);
    }
    setNotice(decision.type==='effect.activated'?`${name} activated from hand · auto`:`${name} added to hand · auto`);setUndoId(actionId);
  }
  function handleHeld(event:HeldCardEvent) {
    const entry=entries.current.get(event.cardId),cardId=entry?catalogCardId(entry):Number(event.cardId);
    if(typeof cardId!=='number'||!Number.isSafeInteger(cardId)||cardId<=0)return;
    const readAt=event.at-performance.timeOrigin;
    for(const [code,at] of heldSetSightings.current)if(readAt-at>FIELD_SET_RETURN_MS)heldSetSightings.current.delete(code);
    heldSetSightings.current.set(cardId,Math.max(readAt,heldSetSightings.current.get(cardId)??-Infinity));
    if(heldTimers.current.has(event.id))return;
    if(!event.lifted){
      // Fingers on a flat card can be a slow placement or a discard: never a public activation. The old path waits for the episode
      // to end and for no field play to follow, then adds the card to the hand or only suggests it.
      let endedAt:number|undefined;
      const timer=setInterval(()=>{
        if(!live()){clearInterval(timer);heldTimers.current.delete(event.id);return;}
        const stillHeld=watch.getSnapshot()?.held?.some(t=>t.id===event.id&&t.visible);
        if(stillHeld){endedAt=undefined;return;}
        endedAt??=performance.now();
        if(performance.now()-endedAt<800)return;
        if(heldFieldReadPending(watch.getTracks(),readAt)&&performance.now()-endedAt<5000)return;
        clearInterval(timer);heldTimers.current.delete(event.id);
        void queue(async act=>{
          if(!live()||watch.getTracks().some(t=>t.visible&&!t.removed&&t.cardId&&
            (entries.current.get(t.cardId)?.passcode??Number(t.cardId))===cardId))return;
          const decision=remoteHandReadDecision(current.current.room.state,seat,{cardId,id:event.id,at:serverNow()},heldFieldReadPending(watch.getTracks(),readAt));
          if(!decision)return;
          if(decision.type==='hand.suggest'){
            window.dispatchEvent(new CustomEvent(REMOTE_HAND_SUGGESTION_EVENT,{detail:{...decision,slug:current.current.room.slug,name:entry?.name??'Card'}}));
            setNotice(`Add ${entry?.name??'card'} to hand?`);return;
          }
          const updated=await act(decision,event.id.slice(0,100));
          if(updated){setNotice(`${entry?.name??'Card'} added to hand · auto`);setUndoId(updated.state.undo?.actionId??'');}
        });
      },100);
      heldTimers.current.set(event.id,timer);
      return;
    }
    // A lifted card shows at once while it is still in the hand (not after the episode). Only a field read waiting on the same spot goes first.
    const startedAt=performance.now();
    const timer=setInterval(()=>{
      if(!live()){clearInterval(timer);heldTimers.current.delete(event.id);return;}
      if(heldFieldReadPending(watch.getTracks(),readAt)&&performance.now()-startedAt<5000)return;
      clearInterval(timer);heldTimers.current.delete(event.id);
      void queue(act=>commitHeld(act,cardId,entry?.name??'Card',event.id,readAt,event.id));
    },100);
    heldTimers.current.set(event.id,timer);
  }
  /** After the last try: the top candidates for one tap. A wrong automatic card is worse than a tap. */
  function handleHeldUnsure(event:HeldUnsureEvent) {
    if(!live()||!event.lifted)return;
    const options=event.candidates.flatMap(c=>{const entry=entries.current.get(c.cardId),cardId=entry?catalogCardId(entry):undefined;return entry&&cardId?[{cardId,name:entry.name}]:[];}).slice(0,3);
    if(!options.length)return;
    void loadCards(options.map(o=>o.cardId));
    setHeldPick({id:event.id,options});
  }
  // The 10 s start when the pick is on screen (a notice with Undo shows first).
  useEffect(()=>{if(!heldPick||notice)return;const timer=setTimeout(()=>setHeldPick(null),10_000);return()=>clearTimeout(timer);},[heldPick,notice]);
  function fieldFacts(event:FieldEvent,chosen?:string):Promise<void>|undefined {
    const track=event.track,id=chosen??track.cardId,entry=id?entries.current.get(id):undefined;
    const code=entry&&catalogCardId(entry);
    if(!code||track.faceDown&&!chosen||cardInfo(code)||cardFailed(code))return;
    const lookup=loadCards([code]);
    void lookup.then(()=>{if(cardInfo(code)&&live())setFactsTick(n=>n+1);});
    if(piles.has(track.zone))return;
    // Type and activation text must be available before a Spell/Trap can take a field slot.
    if(/^(spell|trap)/i.test(entry.frameClass??'')&&(event.type==='placed'||event.type==='moved'||chosen))return cappedFacts(lookup,SPELL_FACTS_WAIT_MS);
    if(event.type!=='placed'&&event.type!=='moved'&&!chosen)return;
    const twins=current.current.room.state.seats[seat].twin,ref=bindings.current.get(track.id)??track.id;
    const bound=twins.find(c=>c.ref===ref||chosen&&c.ref===event.bindRef);
    if(bound&&publicField(bound.zone)&&knownZone(bound)===track.zone&&!bound.faceUp)return;
    const location=fieldZoneLocation(track.zone);
    const occupied=twins.some(c=>c.ref!==ref&&c.zone===location.zone&&c.slot===location.slot);
    const extra=/^(fusion|synchro|xyz|link)/i.test(entry.frameClass??'');
    const summon=extra&&/^M[1-5]$/.test(track.zone);
    const ruleNeedsFacts=track.zone.startsWith('EMZ')||(!bound&&(occupied||summon))||
      !!entry.frameClass&&!mainDeckOwnRow(entry.frameClass,track.zone)&&!summon;
    if(!ruleNeedsFacts)return;
    return cappedFacts(lookup,FACTS_WAIT_MS);
  }
  function handle(event:FieldEvent,departureOrigin?:Pick<TwinCard,'ref'|'zone'|'slot'>,factsStarted=false,moveRetry=0) {
    if(reviewing(event))return;
    if(!factsStarted&&event.result&&event.track.state==='identified'&&!event.track.faceDown)faceReads.current.set(event.track.zone,event);
    const {id,zone}=event.track,observed=watch.getTrack(id);
    const observedRef=bindings.current.get(id)??id;
    if(event.type==='removed'){
      proxyBlockedTracks.current.delete(id);proxyMarkers.current.delete(id);
    }else if(proxyMarkers.current.has(id)&&(!observed||observed.removed||!isProxyMarker(observed)))proxyMarkers.current.delete(id);
    if(isProxyMarker(event.track)){cancelDeparture(id);return;}
    if(givenHold(event.track))return;
    if(!factsStarted&&live()&&event.type!=='removed'){
      const waiting=fieldFacts(event);
      if(waiting){void waiting.then(()=>{if(live())handle(event,departureOrigin,true);});return;}
    }
    // A removal retry from the old cell cannot take a Set that already moved with this ref.
    if(event.type==='removed'){
      const boundCell=physical.current!.zones.get(observedRef);
      if(boundCell&&boundCell!==event.track.zone&&current.current.room.state.seats[seat].twin.some(c=>c.ref===observedRef&&publicField(c.zone)))return;
    }
    if(event.type==='removed'&&event.uncoveredRef){
      separatedStackCards.current.add(observedRef);
      for(const summon of summons.current.values())if(summon.kind==='xyz')summon.pending=summon.pending.filter(ref=>ref!==observedRef);
    }
    else if(['placed','moved','covered'].includes(event.type))separatedStackCards.current.delete(observedRef);
    observeCorrections([...watch.getTracks().filter(t=>t.id!==event.track.id),event.track]);
    if(event.type==='reading'&&live()){
      restingReads.current.set(event.track.id,event);
      publishReadings();
    }else if(['placed','prompt','removed'].includes(event.type)){
      restingReads.current.delete(event.track.id);publishReadings();
    }
    if(event.type==='placed'&&!live()){if(syncHoldRef.current)heldPlaced.current.deferred++;else heldPlaced.current.dropped++;}
    if(event.type!=='removed'){
      cancelDeparture(event.track.id);
    }
    // A phantom: no card box on the mat plane ever backed this track (an arm, a box across two cells). Its unnamed card is
    // taken back off the board, never sent to the hand. A named front still leaves through the usual departure.
    if(event.type==='removed'&&event.reason==='phantom'&&!placeholders.current.has(event.track.id)){
      const ref=bindings.current.get(event.track.id)??event.track.id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(card&&publicField(card.zone)&&!(card.faceUp&&cardCode(card))){
        void queue(async act=>{
          const latest=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
          if(!live()||!latest||!publicField(latest.zone)||undoKept.current.has(ref)||!watch.isRemoved(event.track.id))return;
          const updated=await act({type:'twin.remove',source:'auto',actorSeat:seat,seat,cardRef:ref});
          if(updated&&!updated.state.seats[seat].twin.some(c=>c.ref===ref)){watch.forget(event.track.id);setNotice(`${latest.faceUp?'Unread card':'Face-down card'} removed: nothing on the mat there · auto`);setUndoId(updated.state.undo?.actionId??'');}
        },event);
        return;
      }
    }
    // Give a departure one destination window before publishing its first move.
    if(event.type==='removed'&&!departureOrigin&&!placeholders.current.has(event.track.id)){
      const ref=bindings.current.get(event.track.id)??event.track.id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(!card||!publicField(card.zone))return;
      const origin={ref:card.ref,zone:card.zone,slot:card.slot};
      if(departureTimers.current.has(event.track.id)||pendingDepartures.current.get(event.track.id)?.unresolved)return;
      if(card.faceUp&&['monster','extra-monster'].includes(card.zone))pendingLeft.current.set(event.track.id,{ref:card.ref,at:event.track.lastSeen});
      // A short wait lets a flip or a summon claim the removed card first.
      const id=event.track.id,started=performance.now(),fire=()=>{departureTimers.current.delete(id);if(live()&&watch.isRemoved(id))handle(event,origin);else{pendingLeft.current.delete(id);pendingDepartures.current.delete(id);}};
      const pending:NonNullable<ReturnType<typeof pendingDepartures.current.get>>={event,origin,pileWorked:false};
      leaveStarted.current.set(id,started);pendingDepartures.current.set(id,pending);
      const zone=event.track.zone,removedAt=event.removedAt??started;
      const firstMiss=event.track.removedFrameAt??removedAt;
      const proofAt=fieldCellEvidence(event)?.emptyProofAt;
      const committedBack=event.track.faceDown&&event.track.setEvidence?.decision==='committed';
      const arm=(wait:number)=>departureTimers.current.set(id,setTimeout(()=>{
        if(!live()||!watch.isRemoved(id)){cancelDeparture(id);return;}
        const snap=watch.getSnapshot?.(),now=performance.now();
        if(!fieldDepartureHasBack(event,snap)&&departurePileEvidence(event,snap)){fire();return;}
        const activityAt=fieldDepartureActivityAt(zone,snap);
        const activityWindow=fieldActivityWindow(snap);
        const sourceAt=proofAt??removedAt;
        const hardEnd=sourceAt+PILE_DEPARTURE_CAP_MS;
        const sourceQuietAt=now-activityAt<=activityWindow?Math.max(sourceAt,activityAt):sourceAt;
        const waitUntil=Math.min(hardEnd,sourceQuietAt+DEPARTURE_WAIT_MS);
        const pileNow=activeDeparturePile(snap,sourceAt,now,activityWindow);
        if(pending.pile!=='GY')pending.pile=contactedPile(snap,sourceAt)??pending.pile;
        pending.pileWorked=pileNow||pending.pileWorked&&
          Object.values(fieldSetSlidePileActivity(snap)).some(at=>at>=sourceAt-Math.min(activityWindow,PILE_NEAR_MS));
        // A hand still working a pile settles the card first (several cards can go in one carry): wait for the hand, never prompt.
        const pileLeft=pileNow?sourceAt+PILE_ACTION_CAP_MS-now:0;
        const linkedWait=slideWait(event,snap,now);
        const flipLeft=proofAt===undefined?fieldFlipDepartureWait(event,snap,removedAt,now,card.faceUp):0;
        // Empty proof clears the source cell, but a Set may still be settling elsewhere in its row.
        let slideLeft=0;
        if(!card.faceUp&&event.removedAt!==undefined&&snap&&mainSlotPattern.test(zone)){
          const sleeveAt=Math.max(-Infinity,...Object.entries(snap.blindSleeveAt??{}).flatMap(([cell,at])=>
            cell!==zone&&cell[0]===zone[0]&&mainSlotPattern.test(cell)&&at>=firstMiss?[snap.blindSleeveSince?.[cell as FieldZone]??at]:[]));
          const otherSleeve=sleeveAt>=firstMiss;
          // A nearby pile touch must not cut short the time for a Set to settle in its row.
          if(committedBack||activityAt>firstMiss||otherSleeve||proofAt===undefined&&
            !snap.blindZones?.includes(zone)&&!pileNear(fieldSetSlidePileActivity(snap),firstMiss)){
            slideLeft=fieldSetSlideDeadline(event,removedAt,otherSleeve,Math.max(activityAt,sleeveAt))-now;
          }
        }
        const remaining=Math.max(waitUntil-now,pending.pileWorked?hardEnd-now:0,pileLeft>0?FLIP_POLL_MS:0,linkedWait,flipLeft,slideLeft);
        if(remaining>0){arm(Math.min(FLIP_POLL_MS,remaining));return;}
        // A credible back in the source cell is still a board card. Its flip
        // or the next actual removal will settle it, even on older trackers.
        if(fieldDepartureHasBack(event,snap)){
          cancelDeparture(id);return;
        }
        fire();
      },wait));
      arm(Math.max(0,(proofAt??removedAt)+DEPARTURE_WAIT_MS-started));
      return;
    }
    console.info('[remote field] evidence',event.type,event.track.id,event.track.zone,event.track.revision,event.result?.tier,JSON.stringify(event.result?.quality),event.reason);
    markFieldTiming(event.timing,'watcher',{type:event.type});
    const ref=bindings.current.get(event.track.id)??event.track.id;
    if(event.track.faceDown||current.current.room.state.seats[seat].twin.some(card=>card.ref===ref&&!card.faceUp))bindBackTiming(ref,event.timing);
    if(event.track.faceDown){
      const ref=bindings.current.get(event.track.id)??event.track.id;
      const message={...lastMessage.current,cards:lastMessage.current.cards.filter(c=>c.ref!==ref)};
      lastMessage.current=message;published.current=JSON.stringify(message);hub.publishFieldTracks(message);
    }
    if(diagnosticsAllowed&&(event.type==='prompt'||(event.type==='placed'&&event.track.bestMatch)))void saveLocalFieldDiagnostic(event,entries.current);
    const heldIntoPile=(zone==='GY'||zone==='BANISHED')&&observed?.zone===zone&&
      (event.type==='moved'||event.type==='placed'||event.type==='prompt')&&proxyBlockedTracks.current.delete(id);
    if(live()&&['placed','moved','flipped','prompt'].includes(event.type)){
      const observed=trackForChoice(event);
      if(observed?.zone===event.track.zone&&fieldEvidenceMatches(event,observed,event.type==='prompt')&&proxyClash(event)){
        if(event.type==='prompt')offer(event);
        return;
      }
    }
    if(event.type==='prompt'){
      if(event.reason==='recognition-error')setNotice('Card recognition failed. Keep the card still and choose its card, or use the feed reader.');
      if(event.reason==='pile'&&event.result?.tier==='sure'&&['GY','BANISHED'].includes(event.track.zone))void queue(act=>apply(event,act),event);
      else{
        // A new pile top that cannot be read still counts: push an unnamed card now; the player names it from the prompt or the pile.
        if(['GY','BANISHED'].includes(event.track.zone))void queue(async act=>{
          const observed=watch.getTrack(event.track.id);
          if(!live()||observed?.zone!==event.track.zone||!fieldEvidenceMatches(event,observed))return;
          const player=current.current.room.state.seats[seat],twins=player.twin,ref=bindings.current.get(event.track.id)??event.track.id;
          const guess=pileGuess(event);
          if(guess&&pilePromptSource(event,observed,guess,player))return;
          if(twins.some(c=>c.ref===ref))return;
          const zone=event.track.zone==='GY'?'graveyard':'banished';
          const top=twins.filter(c=>c.zone===zone).at(-1),departure=top?.departedFrom;
          const move=top&&departure?.auto?current.current.room.events.filter(({at,action})=>
            at===departure.at&&action.type==='twin.move'&&action.seat===seat&&action.cardRef===top.ref&&action.zone===zone).at(-1)?.action:undefined;
          const stamp=move?.type==='twin.move'?move.cam:undefined;
          // The field departure can save while the camera is still reading the same card in the pile.
          // Compare the first outline with that move's camera times, before treating the hand touch as another arrival.
          const firstSeen=Math.round(performance.timeOrigin+event.track.firstSeen);
          const overlapsMove=stamp?.seenAt!==undefined&&firstSeen>=stamp.seenAt-1000&&firstSeen<=stamp.sentAt;
          if(top&&(event.bindRef===top.ref||overlapsMove)){bindings.current.set(event.track.id,top.ref);return;}
          if(top&&event.track.pileReturn&&!fannedPile(watch.getSnapshot?.(),event.track.zone as PileCell))return;
          if(!pileEntry(event.track)){if(top)bindings.current.set(event.track.id,top.ref);return;}
          // A card that was just shown from the hand and then reaches a pile unread is that card: name it, so the hand count stays exact.
          const active=handActivation.current,mine=current.current.room.state.seats[seat];
          // Only while the shown card is still in the known hand (a field play already took it out) and no field departure is waiting.
          const shown=active&&performance.now()-active.at<HAND_ACTIVATION_MS&&mine.knownHand?.some(c=>c.cardId===active.cardId)&&pendingDepartures.current.size+lateDefaults.current.size===0?active:undefined;
          const place=(named:boolean)=>act({type:'twin.place',source:'auto',actorSeat:seat,seat,zone,card:{ref,faceUp:true,position:'attack',...(named&&shown?{cardId:shown.cardId}:{})}});
          const inPile=(state:{seats:{twin:readonly {ref:string;zone:string}[]}[]})=>state.seats[seat].twin.filter(c=>c.zone===zone).length;
          const before=inPile(current.current.room.state);
          let updated=await place(true);
          const linked=!!shown&&!!updated&&updated.state.seats[seat].twin.some(c=>c.ref===ref&&c.zone===zone);
          // The named place can merge into a departed copy (no card added) or move another copy into this pile (one more card, a different ref).
          // Only when the pile did not grow is the pile card placed again unnamed, as before hand activation, so the pile count stays exact.
          const grew=!!updated&&inPile(updated.state)>before;
          if(shown&&!linked){
            handActivation.current=undefined;
            if(updated&&!grew)updated=await place(false)??updated;
          }
          if(updated){
            bindings.current.set(event.track.id,ref);pileWrites.current.set(ref,performance.now());
            const pileId=updated.state.undo?.actionId;
            if(linked&&pileId){handActivation.current=undefined;setChain(pileId,{ids:[shown.actionId]});setNotice(`${cardInfo(shown.cardId)?.name??'Card'} activated from hand, then sent to the ${zone==='graveyard'?'GY':'banished pile'} · auto`);}
            else if(updated.state.seats[seat].twin.some(c=>c.ref===ref&&c.zone===zone))setNotice(`Unknown card added to the ${zone==='graveyard'?'GY':'banished pile'} · name it`);
            setUndoId(pileId??'');
          }
        },event);
        offer(event);
      }
      return;
    }
    void queue(async act=>{
      if(live()&&event.type!=='removed'&&event.type!=='reading'&&event.type!=='covered'){
        const observed=trackForChoice(event);
        if(observed?.zone===event.track.zone&&fieldEvidenceMatches(event,observed)&&proxyClash(event))return;
      }
      if(event.previousId&&!await removePlaceholder(event.previousId,act))return;
      // The watcher placed a provisional Set that was really a card lifted from
      // a pile: drop that unnamed back before the pile ref moves to its slot.
      if(event.type==='moved'&&event.replacesRef){
        const setRef=bindings.current.get(event.replacesRef)??event.replacesRef,provisional=current.current.room.state.seats[seat].twin.find(c=>c.ref===setRef);
        if(provisional&&!provisional.faceUp&&!cardCode(provisional)&&publicField(provisional.zone)&&!await act({type:'twin.remove',source:'auto',actorSeat:seat,seat,cardRef:provisional.ref}))return;
      }
      if(event.type==='reading'){await showPlaceholder(event,act);return;}
      if(event.type==='removed'&&placeholders.current.has(event.track.id)){await removePlaceholder(event.track.id,act,true);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));return;}
      if(event.type==='placed'){await apply(event,act);return;}
      const ref=bindings.current.get(event.track.id)??event.track.id;
      // The camera sees this card again: an earlier Undo no longer keeps it.
      if(event.type==='moved')undoKept.current.delete(ref);
      // Back on the field: it is no longer a vanished material candidate.
      if(event.type==='moved')vanishes.current=vanishes.current.filter(v=>v.ref!==ref);
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(!live())return;
      if(!card){
        // A card held at a proxy may have no twin yet. Its first move to a free cell or tracked pile is its first placement.
        if(event.type==='moved'&&(heldIntoPile||!piles.has(zone)&&proxyBlockedTracks.current.has(id)))await apply(event,act);
        return;
      }
      if(card.zone==='hand'&&fieldSetRebind(event)){
        const zone=event.track.zone,origin=reboundSetOrigin(card,event);
        const track=watch.getTrack(event.track.id);
        if(!origin||!track||!fieldEvidenceMatches(event,track,false,true)||keepsManual(ref,fieldZoneLocation(zone),track.position))return;
        const position=fieldTwinPosition({...track,zone:toZone(origin.zone,origin.slot)??zone});
        // Restore the same instance and its Hand count in one move.
        const updated=await act({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:ref,zone:origin.zone,slot:origin.slot,faceUp:false,position});
        if(updated){
          rememberPhysical(ref,zone);
          if(departureRef.current?.ref===ref)setDeparture(null);
          setNotice('Set card put back · auto');setUndoId(updated.state.undo?.actionId??'');
        }
        return;
      }
      // An Xyz material belongs to its Xyz: the camera seeing it (the Xyz lifted for a moment) changes nothing,
      // unless it went to the GY / banished pile (a detach cost): then it is detached there, once.
      if(card.zone==='material'){
        if(event.type==='moved'&&['GY','BANISHED'].includes(event.track.zone)&&card.materialOf){
          const updated=await act({type:'twin.detach',actorSeat:seat,seat,cardRef:card.materialOf,materialRef:card.ref,zone:event.track.zone==='GY'?'graveyard':'banished'});
          if(updated){setNotice(`${card.name??'Material'} detached · auto`);setUndoId(updated.state.undo?.actionId??'');}
        }
        return;
      }
      if(event.type==='covered'){
        // A monster slid under an Xyz placed moments ago: it becomes a material.
        const topRef=event.coverRef?bindings.current.get(event.coverRef)??event.coverRef:undefined,s=topRef?summons.current.get(topRef):undefined;
        const twins=current.current.room.state.seats[seat].twin,top=twins.find(c=>c.ref===topRef);
        // An Xyz Monster that just came out (its summon window), or any face-up Xyz on the field (an effect that attaches a card).
        const summoning=!!s&&s.kind==='xyz'&&performance.now()-s.at<=SUMMON_WINDOW_MS;
        if(!top||!summoning&&!/\bxyz\b/i.test(cardInfo(cardCode(top))?.type??'')||!['monster','extra-monster'].includes(top.zone)||!top.faceUp||!card.faceUp||!['monster','extra-monster'].includes(card.zone))return;
        const attached=await act({type:'twin.attach',actorSeat:seat,seat,cardRef:top.ref,kind:'xyz',materialRefs:[card.ref]});
        if(attached){if(summoning)s!.count++;setNotice(summoning?`${fieldSummonNotice('xyz',s!.name,[card.ref])} · auto`:`${card.name??'Card'} → under ${top.name??'Xyz'} · auto`);setUndoId(attached.state.undo?.actionId??'');}
        return;
      }
      if(event.type==='removed') {
        const forget=()=>cancelDeparture(event.track.id);
        if(!watch.isRemoved(event.track.id)&&!watch.isRemoved(card.ref)){forget();return;}
        if(undoKept.current.has(card.ref)||!fieldDepartureStillMissing(card,departureOrigin??card,watch.getTracks().map(t=>({...t,id:bindings.current.get(t.id)??t.id})))){forget();return;}
        const snap=watch.getSnapshot?.();
        if(fieldDepartureHasBack(event,snap)){forget();return;}
        // The candidate may have appeared since the departure entered the write queue.
        if(slideWait(event)>0){settlingDepartures.current.delete(event.track.id);handle(event);return;}
        const monster=card.faceUp&&['monster','extra-monster'].includes(card.zone);
        // A unique receiving top settles the destination before the first write.
        const wasPublic=publicField(card.zone);
        const seen:PileSeen|undefined=wasPublic?departurePileEvidence(event,snap):undefined;
        const defaultProposal=fieldDepartureProposal(card,seat,seen?{zone:seen.zone,faceUp:seen.faceUp}:undefined,cardInfo(cardCode(card)));if(!defaultProposal){forget();return;}
        const name=defaultProposal.name??(card.faceUp?entries.current.get(event.track.cardId??'')?.name:undefined)??'Card';
        const now=performance.now(),proof=fieldCellEvidence(event);
        const sourceAt=proof?.emptyProofAt??event.removedAt??now;
        const pending=pendingDepartures.current.get(event.track.id);
        // A concurrent GY change can settle a Hand default. Banished contact alone needs a player choice.
        const slidSet=!card.faceUp&&linkedSlide(event,snap,true);
        const handDefault=!seen&&defaultProposal.zone==='hand'&&event.removedAt!==undefined;
        const since=departureSince(sourceAt,event.track.lastSeen),seatTwins=current.current.room.state.seats[seat].twin;
        const changed=wasPublic&&!seen&&!slidSet?changedPile(snap,sourceAt,since,seatTwins,t=>bindings.current.get(t.id)??t.id,
          ref=>pileWrites.current.get(ref),pileCardIsMonster,serverNow()-(now-sourceAt)):undefined;
        const hint=proof?.destinationHint;
        const pileZone=seen||slidSet?undefined:pending?.pile==='GY'||hint==='GY'?'GY':changed?.zone??pending?.pile??(hint==='BANISHED'?hint:undefined);
        const toGy=handDefault&&pileZone==='GY'&&!(changed?.zone==='GY'&&changed.ask);
        const proposal=toGy?fieldGyDepartureProposal(defaultProposal):defaultProposal;
        // A card landed on a pile after this one was last seen, but the camera cannot tie the two: never guess the hand, the player picks.
        const pileArrival=!!changed?.ask||seatTwins.some(c=>c.ref!==card.ref&&['graveyard','banished'].includes(c.zone)&&(pileWrites.current.get(c.ref)??-Infinity)>=since);
        if(pileZone==='BANISHED'||handDefault&&!toGy&&(slidSet||pileArrival||pending?.pileWorked||activeDeparturePile(snap,sourceAt,now,fieldActivityWindow(snap)))){
          if(pending)pending.unresolved=true;
          settlingDepartures.current.delete(event.track.id);pendingLeft.current.delete(event.track.id);
          askDeparture(card.ref,name);return;
        }
        forget();
        let updated=await act({...proposal,...(card.faceUp?{name}:{})},undefined,event,receivingTrack(seen)),undoTarget=updated?.state.undo?.actionId??'';
        if(updated&&seen)pileWrites.current.set(card.ref,performance.now());
        if(updated&&seen){const adopted=await adoptPileCard(act,seen,card.ref,undoTarget);if(adopted){updated=adopted.state;undoTarget=adopted.undoTarget;}}
        else if(updated&&wasPublic&&proposal.zone!=='hand')lateDefaults.current.set(card.ref,{at:performance.now(),lastSeen:event.track.lastSeen,cardId:event.track.cardId,...(proposal.zone==='graveyard'?{pile:true as const}:{})});
        if(!live()||!watch.isRemoved(card.ref))return;
        setDeparture({ref:card.ref,name,zone:updated?proposal.zone:'pending',...(proposal.faceUp===false&&proposal.zone==='banished'?{down:true}:{})});
        setNotice(`${name} ${proposal.zone==='deck'?'returned to Deck':'left the field'}${seen?' · seen on camera':''} · ${updated?'auto':'update failed'}`);setUndoId(updated?undoTarget:'');
        // Summon window: a monster that leaves the field (default: to the hand) can be a material of a summon just before or after it.
        if(updated&&monster&&summonable(proposal.zone)){
          const at=event.track.lastSeen;vanishes.current=[...vanishes.current.filter(v=>v.ref!==card.ref&&Math.abs(v.at-at)<=2*SUMMON_WINDOW_MS),{ref:card.ref,at}].slice(-10);
          // After the summon: only while it still has fewer materials than the minimum, and for an Xyz only a card that lay
          // over the Xyz's spot. A summon that was undone (its card is gone) is forgotten.
          const nowAt=performance.now(),twinsNow=current.current.room.state.seats[seat].twin;
          for(const [topRef] of summons.current)if(!twinsNow.some(c=>c.ref===topRef&&['monster','extra-monster'].includes(c.zone)))summons.current.delete(topRef);
          const recent=[...summons.current].filter(([,s])=>{
            if(nowAt-s.at>SUMMON_WINDOW_MS||s.count+s.pending.length>=fieldSummonMinimum(s.kind)||s.kind==='xyz'&&separatedStackCards.current.has(card.ref))return false;
            const box=watch.getTrack(s.trackId)?.card.quad;return s.kind!=='xyz'||!!box&&!distinctFieldQuads(box,event.track.card.quad);
          }).sort((a,b)=>b[1].at-a[1].at)[0];
          if(recent){
            const [topRef,s]=recent;s.pending.push(card.ref);
            if(s.count+s.pending.length>=fieldSummonMinimum(s.kind)){
              const refs=[...s.pending];s.pending=[];
              const attached=await act({type:'twin.attach',actorSeat:seat,seat,cardRef:topRef,kind:s.kind,materialRefs:refs});
              if(attached){s.count+=refs.length;vanishes.current=vanishes.current.filter(v=>!refs.includes(v.ref));setDeparture(null);setNotice(`${fieldSummonNotice(s.kind,s.name,refs.map(ref=>attached.state.seats[seat].twin.find(c=>c.ref===ref)?.name??'Card'))} · auto`);setUndoId(attached.state.undo?.actionId??'');}
            }
          }
        }
        return;
      }
      if(event.type==='moved') {
        const fromPublicPile=orderedPiles.some(([,zone])=>card.zone===zone);
        if(fromPublicPile||event.track.zone==='EXTRA'||!publicField(card.zone)&&!recentFieldDeparture(card,serverNow())){await apply(event,act);return;}
        const observed=watch.getTrack(event.track.id)??watch.getTrack(ref);
        if(!observed||observed.removed||observed.state!=='identified')return;
        if(!observed.visible){
          // A newer frame can temporarily hide the settled move before its queued write.
          if(event.track.visible&&!event.track.faceDown&&event.track.cardId&&moveRetry<3)setTimeout(()=>{
            const latest=watch.getTrack(event.track.id)??watch.getTrack(ref);
            if(live()&&latest&&!latest.removed&&latest.state==='identified'&&!latest.faceDown&&
              latest.zone===event.track.zone&&latest.cardId===event.track.cardId&&(latest.revision??0)===(event.track.revision??0))
              handle(event,undefined,true,moveRetry+1);
          },150);
          return;
        }
        if(keepsManual(card.ref,fieldZoneLocation(observed.zone),observed.position))return;
        const code=cardCode(card),facts=cardInfo(code),twinsNow=current.current.room.state.seats[seat].twin;
        if(observed.zone==='BANISHED'&&!fieldNamedBanish(event,observed,twinsNow,t=>bindings.current.get(t.id)??t.id,watch.getTracks())){
          askDeparture(card.ref,card.faceUp?card.name??'Card':'Card',event.track.id);return;
        }
        const read=observed.cardId?entries.current.get(observed.cardId):undefined;
        if(read&&code&&card.faceUp&&!observed.faceDown&&knownZone(card)!==observed.zone&&
          !sameObservedCard(card,{cardId:catalogCardId(read),name:read.name})){await apply(event,act);return;}
        if(!card.faceUp&&!observed.faceDown&&(isFieldSpell(facts)||read&&differentKnownSet(card,{cardId:catalogCardId(read),name:read.name}))){await apply(event,act);return;}
        const observedLocation=fieldZoneLocation(observed.zone),frame=entries.current.get(observed.cardId??'')?.frameClass;
        const followGeometry=code&&!facts&&!cardFailed(code)&&mainDeckOwnRow(frame,observed.zone)&&
          !twinsNow.some(c=>c.ref!==card.ref&&c.zone===observedLocation.zone&&c.slot===observedLocation.slot);
        const projected=followGeometry?{zone:knownZone(card)===observed.zone?toZone(card.zone,card.slot):observed.zone,label:''}:
          projectObserved(observed,twinsNow,card,facts);
        if(!projected.zone){
          if(code&&!facts&&!cardFailed(code))void loadCards([code]).then(()=>{
            if(cardInfo(code)&&live()&&fieldEvidenceMatches(event,watch.getTrack(event.track.id)))handle(event,undefined,true);
          });
          setNotice(projected.reason??'Choose a legal zone manually.');return;
        }
        if(proxyClash(event,observed.zone)||proxyClash(event,projected.zone)||tokenClash(event,projected.zone,current.current.room.state.seats[seat].twin,card.name,cardInfo(code)))return;
        const location=fieldZoneLocation(projected.zone);
        if(keepsManual(card.ref,location,observed.position))return;
        const under=stackUnder(event.track.id);
        if(under.length&&!publicField(card.zone)&&fieldSummonKind(cardInfo(code))){await apply(event,act);return;}
        const stacked=!isFieldSpell(facts)&&current.current.room.state.seats[seat].twin.find(c=>c.ref!==card.ref&&under.includes(c.ref)&&c.zone===location.zone&&c.slot===location.slot);
        if(stacked){
          if(fieldKeepsMonsterStack(card,stacked)){
            if(!heldStacks.current.has(card.ref)){heldStacks.current.add(card.ref);setNotice('Known monsters stacked · waiting for the top card');}
            return;
          }
          // Wait for a summon (it takes both cards). With no summon in the window, the default: the card under it leaves
          // (to the hand, with Undo) and this card moves to the zone. A stack whose default was undone stays as it is.
          if(stackKept.current.has(card.ref))return;
          if(!heldStacks.current.has(card.ref)){
            heldStacks.current.add(card.ref);setNotice('Card placed on top of another card · waiting for a summon');
            const trackId=event.track.id,zone=projected.zone;
            const timer=setTimeout(()=>{stackTimers.current.delete(timer);void queue(async next=>{
              heldStacks.current.delete(card.ref);
              // Check the camera again: the top card may have moved back, or an Xyz may lie on the stack now.
              const twins=current.current.room.state.seats[seat].twin,mover=twins.find(c=>c.ref===card.ref),below=twins.find(c=>c.ref===stacked.ref),live_=watch.getTrack(trackId);
              if(!live()||!mover||!publicField(mover.zone)||!live_||!heldStackStillStacked({mover:live_,zone,under:stackUnder(trackId),below,location}))return;
              const name=below!.faceUp?below!.name??'Card':'Card',departure=fieldDepartureProposal(below!,seat,undefined,cardInfo(cardCode(below!)));if(!departure)return;
              const left=await next({...departure,...(below!.faceUp?{name}:{})});if(!left)return;
              if(below!.faceUp)vanishes.current=[...vanishes.current.filter(v=>v.ref!==below!.ref),{ref:below!.ref,at:live_.lastSeen}].slice(-10);
              const moved=await next({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:mover.ref,...location,position:fieldTwinPosition(live_)});
              // One Undo puts both back: the top card's move first, then the card under it.
              const leftId=left.state.undo?.actionId??'',movedId=moved?.state.undo?.actionId??'';
              setChain(movedId,{ids:moved&&leftId?[leftId]:[]});setDeparture(null);
              setNotice(`${name} → ${fieldLeaveLabel(departure.zone,departure.faceUp)} (covered)${moved?'':' · move failed'} · Undo`);setUndoId(moved?movedId:leftId);
              stackKept.current.add(mover.ref);
            },event);},SUMMON_WINDOW_MS);
            stackTimers.current.add(timer);
          }
          return;
        }
        stackKept.current.delete(card.ref);
        const targetTrack={...observed,zone:projected.zone},position=fieldTwinPosition(targetTrack);
        const setMove=card.faceUp||card.publicIdentity?fieldSetMove(card,targetTrack,seat,observed.zone!==knownZone(card)):undefined;
        if(card.faceUp&&setMove){await apply(event,act);return;}
        if(setMove||card.zone!==location.zone||card.slot!==location.slot||!fieldPositionMatches(location.zone,card.position,position)){
          const updated=await act(setMove ?? {type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,...location,position});
          if(!updated)return;
          if(departureRef.current?.ref===card.ref){setDeparture(null);setNotice('');}
        }
        const after=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!live()||!fieldEvidenceMatches(event,after))return;
        const twins=current.current.room.state.seats[seat].twin,persisted=twins.find(c=>c.ref===card.ref);if(!persisted)return;
        const target=followGeometry&&!cardInfo(code)?projected:projectObserved(after!,twins,persisted,cardInfo(code));
        if(target.zone){const latest=fieldZoneLocation(target.zone);if(persisted.zone===latest.zone&&persisted.slot===latest.slot&&fieldPositionMatches(latest.zone,persisted.position,fieldTwinPosition({...after!,zone:target.zone})))rememberPhysical(card.ref,after!.zone);}
      }else if(event.type==='flipped'&&event.track.faceDown)await apply(event,act);
    },event);
    if(event.type==='flipped'&&!event.track.faceDown&&fieldCellEvidence(event)?.basis==='zoom')faceCheck.current(event);
  }
  // A new card-recognition mode restarts the reader, so the watcher must pick up the new one.
  const {generation}=useRecognitionBackend(),readerKey=useMemo(()=>({source,generation}),[source,generation]);
  const tournament=isTournamentTable(room);
  const watch=useFieldWatcher({tournament:tournament?{saved:()=>readTournamentMode(room.slug,seat)}:undefined,owner:ownsSource,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,duelKey:room.slug,captureSize,deviceKey:cameraKey,deviceLabel:hub.devices.find(d=>d.deviceId===hub.cameraId)?.label||undefined,sourceKey:readerKey,
    async create(){const resources=await ownFieldResources(()=>(recognitionPriorsFor(current.current.room,seat)));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,placeUnsure:!!current.current.room.unsureNamesEnabled,earlyExitMargin:.02,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,onHeldCard:handleHeld,onHeldUnsure:handleHeldUnsure,cpuBusy:(urgent?:boolean)=>resources.cpuBusy(urgent)||calibrationBusy.current};},onEvent:handle});
  useEffect(()=>{
    const reject=(event:Event)=>{if(!(event instanceof CustomEvent))return;const value=event.detail;if(value?.slug!==current.current.room.slug||value.seat!==seat||typeof value.ref!=='string')return;const id=[...bindings.current.entries()].find(([,ref])=>ref===value.ref)?.[0]??value.ref;watch.notACard(id,(()=>{const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===value.ref);return card?knownZone(card):undefined;})());setPrompts(list=>list.filter(p=>p.track.id!==id));};
    window.addEventListener(NOT_A_CARD_EVENT,reject);return()=>window.removeEventListener(NOT_A_CARD_EVENT,reject);
  },[seat,watch.notACard]);
  // Every camera lock step (the first lock at camera start, a re-lock, an anti-glare exposure step, lock off)
  // changes brightness and sharpness: the watcher learns its blur and shadow baselines again.
  const lock=hub.cameraLock,lockKey=lock?`${lock.enabled}|${lock.locked}|${lock.busy}|${lock.debug??''}`:'';
  const {resetBaselines}=watch;
  useEffect(()=>{if(lockKey)resetBaselines();},[lockKey,resetBaselines]);
  const updateCalibration=useCallback((grid:FieldCalibration,placed?:boolean)=>{
    watch.setCalibration(grid,placed);
    // Keep an unanswered identity prompt, but require fresh visibility at the
    // new revision before accepting it. Already queued actions keep the old revision.
    setPrompts(list=>list.map(event=>{
      const track=watch.getTrack(event.track.id);
      return track?.state==='prompt'?{...event,track}:event;
    }));
  },[watch.setCalibration,watch.getTrack]);
  // Back to Auto-detect with cards on the board: the board can hold manual work, and a re-sync can remove it. No writes until the player asks.
  const holdKey=`dd-remote-sync-hold:${room.slug}:${seat}`;
  const [syncHold,setSyncHoldState]=useState(()=>{try{return sessionStorage.getItem(holdKey)==='1';}catch{return false;}});
  const setSyncHold=useCallback((on:boolean)=>{setSyncHoldState(on);try{if(on)sessionStorage.setItem(holdKey,'1');else sessionStorage.removeItem(holdKey);}catch{/* Memory-only fallback. */}},[holdKey]);
  recordingCalibration.current=room.recordingEnabled&&watch.calibration?{calibration:watch.calibration,format:room.format?.id??room.state.deckChecks.format.id,placed:watch.placed,needed:watch.calibrationNeeded}:undefined;
  enabledRef.current=watch.enabled&&!watch.calibrationNeeded&&!syncHold;syncHoldRef.current=syncHold;tracks.current=watch.snapshot.tracks;
  // Grid check, from the camera: 2+ resting cards in a gap between cells or outside the grid, in several scans in a row.
  const gridSuspect=!!watch.snapshot.gridShift?.suspect;
  useEffect(()=>{if(gridSuspect&&!shiftHinted.current){shiftHinted.current=true;setShiftHint(true);}},[gridSuspect]);
  // Slow computer: one quiet offer of Tap to identify (a slow detector, or the browser video encoder reports it is CPU limited). Only the player changes the mode; the answer is remembered.
  const [tapOffer,setTapOffer]=useState(false),slowWatch=useRef(createSlowWatch());
  const setDetection=useCallback((on:boolean)=>{
    // A tournament table keeps its own choice and leaves the device preference alone.
    if(tournament)saveTournamentMode(room.slug,seat,on?'auto':'tap');else saveTapChoice(on?'keep':'switch');
    setTapOffer(false);
    setSyncHold(on&&!watch.enabled&&current.current.room.state.seats[seat].twin.some(card=>publicField(card.zone)));
    watch.setEnabled(on);
  },[watch.setEnabled,watch.enabled,seat,setSyncHold,tournament,room.slug]);
  const modeReason=useRef<TournamentModeReason>('player');
  // Only a switch is a slow-offer change. Keep changes nothing, so the next manual switch stays a player change.
  const answerTapOffer=(choice:TapChoice)=>{modeReason.current=choice==='switch'?'slow-offer':'player';if(choice==='switch'&&!tournament)noteTapReason('slow');setDetection(choice==='keep');};
  const offerable=watch.enabled&&ownsSource&&hub.cameraOn&&room.status==='active';
  useEffect(()=>{
    if(tapOffer&&!offerable)setTapOffer(false);
    if(tapOffer||!offerable||tapOfferShown()||(tournament?readTournamentMode(room.slug,seat):readTapChoice()))return;
    const at=performance.now();slowWatch.current.see(at,watch.snapshot.metrics);
    if((recognition.backend==='wasm'&&isWeakDevice(fieldPacerDevice()))||slowWatch.current.slow(at)){markTapOfferShown();setTapOffer(true);}
  },[watch.snapshot,offerable,recognition.backend,tapOffer]);
  // The table state keeps my detection mode on every table (a tournament table also shows it to the opponent; a normal table keeps it in the log). I send it when it differs from the state (table start, a switch, the camera turning off or on), never again after a reload. The tell is public and changes no board.
  const sentMode=useRef<TournamentMode|null>(null),modeSeat=room.spectator?-1:seat;
  // A failed send is tried again after 2, 4 and 8 s (then it stops); `retry` re-runs the effect below.
  const [retry,setRetry]=useState(0),attempts=useRef(0),retryTimer=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>()=>clearTimeout(retryTimer.current),[]);
  const mode=ownDetectionMode({ownsSource,cameraOn:hub.cameraOn,enabled:watch.enabled});
  const desiredMode=useRef(mode);desiredMode.current=mode;
  useEffect(()=>{
    if(modeSeat<0||!watch.settingsLoaded||room.status!=='active'||sentMode.current===mode)return;
    // The video hub reports no camera while it connects or reconnects. Say nothing until it settles, so the badge does not flap.
    if(hub.starting)return;
    // Short wait: the camera and the phone link settle a moment after the page opens, and the first answer should be the real one.
    const timer=setTimeout(()=>{
      const known=stateMode(current.current.room.state,modeSeat);
      sentMode.current=mode;
      if(known===mode){modeReason.current='player';return;}
      const reason=known?modeReason.current:'start';modeReason.current='player';
      void transaction(async(latest,act)=>{
        if(desiredMode.current!==mode||stateMode(latest.state,modeSeat)===mode)return;
        const updated=await act({type:'detection.mode',actorSeat:modeSeat,mode,reason,cam:reason==='start'?fieldCameraStamp(undefined,'camera','detection-mode'):playerStamp(reason==='slow-offer'?'prompt':'detection-mode')});
        if(!updated)throw new Error('Detection mode was not saved');
      }).then(()=>{attempts.current=0;}).catch(()=>{
        sentMode.current=null;if(reason!=='player')modeReason.current=reason;
        if(attempts.current>=3)return;
        retryTimer.current=setTimeout(()=>setRetry(count=>count+1),2000*2**attempts.current++);
      });
    },mode==='manual'||sentMode.current===null?1500:0);
    return()=>clearTimeout(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[modeSeat,watch.settingsLoaded,room.status,mode,hub.starting,retry]);
  // Video lag offer: the browser encoder stayed CPU limited (sustained, page visible; see `watchCpuLimit`) and still is when the offer would show.
  // Own state, so it never uses up the Tap offer. `videoOffer` is the wish; it counts as shown (once per page, with its 20 s) only while it is the notice on screen.
  const [videoOffer,setVideoOffer]=useState(false);
  const videoOfferable=ownsSource&&hub.videoRateAvailable&&hub.cameraOn&&room.status==='active'&&hub.videoRate===30;
  useEffect(()=>{
    if(videoOffer&&!videoOfferable)setVideoOffer(false);
    if(videoOffer||!videoOfferable||videoOfferShown()||readVideoChoice()||!hub.cpuConstrained||document.hidden)return;
    let live=true;
    void hub.cpuStillLimited().then(still=>{if(live&&still&&!document.hidden)setVideoOffer(true);});
    return()=>{live=false;};
  },[videoOffer,videoOfferable,hub.cpuConstrained,hub.cpuStillLimited]);
  const videoOfferShowing=videoOffer&&!failedUpdate&&!recovery&&!syncHold&&!shiftHint&&!notice&&!tapOffer;
  useEffect(()=>{
    if(!videoOfferShowing)return;
    // Sample again as the offer comes on screen: a limit that ended while another notice was up must not raise it.
    let live=true,timer:ReturnType<typeof setTimeout>|undefined;
    void hub.cpuStillLimited().then(still=>{
      if(!live)return;
      if(!still||document.hidden){setVideoOffer(false);return;}
      markVideoOfferShown();
      timer=setTimeout(()=>setVideoOffer(false),VIDEO_OFFER_MS);
    });
    return()=>{live=false;clearTimeout(timer);};
  },[videoOfferShowing,hub.cpuStillLimited]);
  const answerVideoOffer=(rate:15|30)=>{hub.setVideoRate(rate);setVideoOffer(false);};
  // Low light hint: the webcam delivers under 20 fps for a while (a dim room makes it lengthen the exposure). Once per page, dismissable, and it waits behind every other notice.
  const {slowCamera}=useSendHealth();
  const [lightHint,setLightHint]=useState(false);
  const lightHintable=ownsSource&&hub.cameraOn&&room.status==='active'&&slowCamera&&!lowLightHintShown;
  useEffect(()=>{if(lightHintable)setLightHint(true);},[lightHintable]);
  const lightHintShowing=lightHint&&!failedUpdate&&!recovery&&!syncHold&&!shiftHint&&!notice&&!tapOffer&&!videoOfferShowing;
  // Soft camera: the watcher found a resting card it never got a sharp crop of. One hint per sitting (the watcher raises it once); it waits behind every other notice.
  const [softDismissed,setSoftDismissed]=useState(false);
  const softHintShowing=!!watch.snapshot.softCamera&&!softDismissed&&!lightHintShowing&&!failedUpdate&&!recovery&&!syncHold&&!shiftHint&&!notice&&!tapOffer&&!videoOfferShowing;
  useEffect(()=>{
    if(!lightHintShowing)return;
    lowLightHintShown=true;
    const timer=setTimeout(()=>setLightHint(false),30_000);
    return()=>clearTimeout(timer);
  },[lightHintShowing]);
  // No answer in time: the offer goes and nothing is saved.
  useEffect(()=>{if(!tapOffer)return;const timer=setTimeout(()=>setTapOffer(false),TAP_OFFER_MS);return()=>clearTimeout(timer);},[tapOffer]);
  // Show a still outline on the board at once (local only). The saved "Reading" card takes its place with the same look.
  const ghostState=useRef(newGhostState());
  const changedZones=useRef(createChangedZones());
  const [changes,setChanges]=useState<readonly FieldZone[]>([]);
  useEffect(()=>{changedZones.current=createChangedZones();setChanges([]);},[room.slug,seat,room.state.match.games.length]);
  useEffect(()=>{
    const update=()=>{
      const holds=correctionsFor(current.current.room,seat);
      const next=watch.enabled&&!watch.calibrationNeeded&&!syncHold ? changedZones.current.observe(watch.getTracks(),current.current.room.state.seats[seat].twin,performance.now(),id=>bindings.current.get(id)??id,(ref,at)=>holds.blocks([ref],at)) : [];
      setChanges(before=>before.join(',')===next.join(',')?before:next);
    };
    update();const timer=setInterval(update,300);return()=>clearInterval(timer);
  },[watch.enabled,watch.calibrationNeeded,syncHold,room.state,seat]);
  const restingReads=useRef(new Map<string,FieldEvent>());
  function observeCorrections(tracks:readonly FieldTrack[]){
    const released=correctionsFor(current.current.room,seat).observe(tracks.map(t=>({id:t.id,ref:bindings.current.get(t.id)??t.id,...fieldZoneLocation(t.zone),faceDown:t.faceDown,position:t.position,cardId:t.cardId,removed:t.removed,resting:!!t.visible&&t.restSince!==undefined})),performance.now());
    for(const id of released)watch.forget(id,{suppress:false});
  }
  function publishReadings(){
    const key=String(seat),holds=correctionsFor(current.current.room,seat);
    const early=nextFieldGhosts(watch.getTracks(),ghostState.current,Date.now(),key,id=>placeholders.current.has(id)||bindings.current.has(id));
    const rested=[...restingReads.current.values()].flatMap(event=>{
      const t=watch.getTrack(event.track.id);
      if(!t||t.removed||t.state==='prompt'||t.revision!==event.track.revision){restingReads.current.delete(event.track.id);return [];}
      if(t.faceDown||!t.visible||piles.has(t.zone))return [];
      return [{id:t.id,...fieldZoneLocation(t.zone),faceDown:false,defense:t.position==='defense'}];
    });
    const ghosts=[...new Map([...early,...rested].map(g=>[g.id,g])).values()].filter(g=>!holds.blocks([bindings.current.get(g.id)??g.id],g));
    setFieldGhosts(key,watch.enabled&&!watch.calibrationNeeded&&live()?ghosts:[]);
  }
  useEffect(()=>{
    observeCorrections(watch.snapshot.tracks);
    publishReadings();
  },[watch.snapshot.tracks,watch.enabled,watch.calibrationNeeded,seat,room.state]);
  // A card that leaves the board (removed, Undo) must not flash a ghost while its track is still on the mat.
  const ghostTwinsPrev=useRef<TwinCard[]>([]);
  const ownTwin=room.state.seats[seat].twin;
  useEffect(()=>{for(const card of ghostTwinsPrev.current)if(!ownTwin.some(c=>c.ref===card.ref))blockGhostCell(String(seat),card.zone,card.slot);ghostTwinsPrev.current=ownTwin;},[ownTwin,seat]);
  useEffect(()=>()=>setFieldGhosts(String(seat),[]),[seat]);
  useEffect(()=>{
    const abandoned=[...placeholders.current.keys()].filter(id=>{const track=watch.getTrack(id);return !track||track.state==='dismissed'||track.removed;});
    if(abandoned.length)void queue(async act=>{for(const id of abandoned)await removePlaceholder(id,act,true);},undefined,false,false,laneOf([...abandoned,...abandoned.map(id=>placeholders.current.get(id))]));
  },[watch.snapshot,watch.enabled,source]);
  useEffect(()=>{missingCopies.current.clear();mergedCopies.current.clear();},[room.slug,seat]);
  // Only the watcher's clear-footprint removal window can send a card to
  // hand. A missing ref after a restart has no pixels that prove departure.

  useEffect(()=>{
    const timer=setInterval(()=>{
      if(!live()||repairingCopies.current||calibrationBusy.current||document.hidden)return;
      const twins=current.current.room.state.seats[seat].twin,at=Date.now();
      const tracked=(ref:string)=>tracks.current.find(t=>(bindings.current.get(t.id)??t.id)===ref);
      for(const ghost of twins){
        const code=cardCode(ghost),lost=tracked(ghost.ref),mergedAt=mergedCopies.current.get(ghost.ref);
        // A restored merge is an owner override. A covered live track is not gone.
        if(!code||(mergedAt!==undefined&&current.current.room.lastSeq>mergedAt)||(lost&&!lost.removed)){missingCopies.current.delete(ghost.ref);continue;}
        // Camera absence cannot distinguish a real pile copy from a duplicate.
        // Only overlapping twins at one precise field position are safe to repair.
        const keep=twins.find(c=>c.ref!==ghost.ref&&cardCode(c)===code&&sameFieldSlot(ghost,c)&&c.faceUp&&(()=>{const t=tracked(c.ref);return t?.state==='identified'&&t.visible&&!t.removed&&entries.current.get(t.cardId??'')?.passcode===code;})());
        if(!keep){missingCopies.current.delete(ghost.ref);continue;}
        const since=missingCopies.current.get(ghost.ref)??at;missingCopies.current.set(ghost.ref,since);
        if(at-since<5000)continue;
        repairingCopies.current=true;
        void queue(async act=>{
          const latest=current.current.room,twins=latest.state.seats[seat].twin,survivor=twins.find(c=>c.ref===keep.ref),duplicate=twins.find(c=>c.ref===ghost.ref),t=tracked(keep.ref),gone=tracked(ghost.ref);
          if(!live()||!survivor||!duplicate||!sameFieldSlot(survivor,duplicate)||!t?.visible||t.removed||(gone&&!gone.removed))return;
          const updated=await act({type:'twin.merge',actorSeat:seat,seat,keepRef:survivor.ref,removeRef:duplicate.ref,reason:'Camera sees one physical copy; absent duplicate merged'});
          if(updated){mergedCopies.current.set(duplicate.ref,updated.lastSeq);missingCopies.current.delete(duplicate.ref);setDeparture(null);setNotice(`${survivor.name??'Card'} duplicate merged · one physical copy`);setUndoId(updated.state.undo?.actionId??'');}
        },undefined,false,false,laneOf([keep.ref,ghost.ref],[knownZone(keep)])).finally(()=>{repairingCopies.current=false;});
        break;
      }
    },500);
    return()=>clearInterval(timer);
  },[room.slug,seat,watch.enabled]);
  useEffect(()=>{
    const active=new Set(watch.snapshot.tracks.filter(t=>t.state==='prompt'&&!t.removed).map(t=>`${t.id}:${t.revision??0}`));
    for(const key of prompted.current)if(!active.has(key))prompted.current.delete(key);
    const zones=new Map(room.state.seats[seat].twin.map(c=>[c.ref,c.zone]));
    const previous=previousBoard.current;
    const revisedPiles=new Set(room.events.flatMap(({seq,action})=>seq>previous.seq&&action.type==='pile.set'&&action.seat===seat&&action.cam?.ui!=='pile-add'?[action.zone]:[]));
    setPrompts(list=>{
      const next=list.filter(p=>{
        const track=watch.getTrack(p.track.id),pile=observedPile(p.track.zone);
        if(pile&&revisedPiles.has(pile))return false;
        return !watch.enabled&&pile||track?.state==='prompt'&&(track.revision??0)===(p.track.revision??0);
      });
      return next.length===list.length?list:next;
    });
    for(const [ref,zone] of previous.zones){
      if(zones.get(ref)===zone||readerRemovals.current.has(ref))continue;
      const removedFromPile=(zone==='graveyard'||zone==='banished')&&room.events?.some(({seq,action})=>
        seq>previous.seq&&(
          action.type==='twin.remove'&&action.source!=='auto'&&action.seat===seat&&action.cardRef===ref||
          action.type==='pile.lift'&&action.source!=='auto'&&action.seat===seat&&action.zone===zone&&action.cardRefs.includes(ref)||
          action.type==='pile.set'&&action.seat===seat&&action.zone===zone&&!action.entries.some(entry=>entry.ref===ref)));
      if(removedFromPile){
        // Retire the removed card's outline while allowing a different pile top to be read.
        for(const track of watch.getTracks())if(observedPile(track.zone)===zone&&(bindings.current.get(track.id)??track.id)===ref)watch.forget(track.id);
      }
      if(zones.has(ref))continue;
      forgetPhysical(ref);
      if(!removedFromPile&&!correctionsFor(current.current.room,seat).has(ref)){
        const track=watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===ref);
        watch.forget(track?.id??ref);
      }
    }
    // Consume the exemption only after the server removal is observed, or after
    // a batched replacement already contains the identified card.
    for(const ref of readerRemovals.current)if(!zones.has(ref)||room.state.seats[seat].twin.some(card=>card.ref===ref&&cardCode(card)))readerRemovals.current.delete(ref);
    prunePhysical();
    previousBoard.current={seq:room.lastSeq,zones};
    for(const [zone,pile] of orderedPiles){
      const prompted=promptedPileTops.current.get(zone);
      if(prompted&&room.state.seats[seat].twin.filter(c=>c.zone===pile).at(-1)?.ref!==prompted)promptedPileTops.current.delete(zone);
    }
    const value=departureRef.current;if(!value)return;
    const card=room.state.seats[seat].twin.find(c=>c.ref===value.ref);
    if(!card||(value.zone==='pending'&&(value.pile?!pileDepartureStillMissing(value,card):!fieldDepartureMissing(value)))||(!destinations.some(d=>d.zone===card.zone)&&value.zone!=='pending')){setDeparture(null);setNotice('');}
    else if(!(value.zone==='pending'&&value.pile)&&destinations.some(d=>d.zone===card.zone)&&(card.zone!==value.zone||card.zone==='banished'&&(card.faceUp===false)!==!!value.down))setDeparture({...value,zone:card.zone,down:card.zone==='banished'&&card.faceUp===false});
  },[room.state,room.events,room.lastSeq,seat,watch.snapshot]);
  // Stack visibility only affects the Deck/Extra display. The public pile lists
  // survive an inspection or shuffle even when the camera sees bare mat.
  const missingDecks=(watch.snapshot.missingPiles??[]).filter(zone=>zone==='DECK'||zone==='EXTRA').join(',');
  useEffect(()=>publishMissingPiles(seat,missingDecks?missingDecks.split(','):[]),[missingDecks,seat]);
  useEffect(()=>()=>publishMissingPiles(seat,[]),[seat]);
  function recover() {
    if(!recovery)return;const placement=recovery.placement;
    void queueHuman('stale-recover',async act=>{
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===placement.card.ref);
      if(card&&(card.cardId!==placement.card.cardId||card.zone!==placement.zone||card.slot!==placement.card.slot||card.faceUp!==placement.card.faceUp)){setRecovery(null);setNotice('The placement changed. Check its card popup.');return;}
      if(card&&!await act({type:'twin.remove',actorSeat:seat,seat,cardRef:card.ref}))return;
      forgetPhysical(placement.card.ref);watch.forget(placement.card.ref);setPrompts(list=>list.filter(p=>p.track.id!==placement.card.ref));setRecovery(null);setNotice('Stale placement removed');
    });
  }
  /** The player says a monster in a Spell & Trap Zone belongs in a Monster Zone: one move, then the camera keeps it there. */
  function moveFromSpellTrap(value:{ref:string;name:string}) {
    setRowPrompts(list=>list.filter(p=>p.ref!==value.ref));
    void queueHuman('st-move',async act=>{
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===value.ref);
      if(!live()||!card||card.zone!=='spell-trap')return;
      // The free zone is read now, not when the prompt opened.
      const target=nearestFreeMonsterZone(current.current.room.state.seats[seat].twin as never,`S${card.slot??1}` as FieldZone,card.ref);
      if(!target){setNotice('No free Main Monster Zone. Choose a zone manually.');return;}
      const updated=await act({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,...fieldZoneLocation(target),...(card.faceUp?{name:value.name}:{}),...(card.position?{position:card.position}:{})});
      if(updated){holdForPlayer(card.ref);setNotice(`${value.name} → ${target}`);setUndoId(updated.state.undo?.actionId??'');}
    });
  }
  useEffect(()=>{const gone=rowPrompts.filter(p=>!room.state.seats[seat].twin.some(c=>c.ref===p.ref&&c.zone==='spell-trap'));if(gone.length)setRowPrompts(list=>list.filter(p=>!gone.includes(p)));},[room.state,rowPrompts,seat]);
  const rowCard=rowPrompts[0]&&room.state.seats[seat].twin.find(c=>c.ref===rowPrompts[0].ref),rowZone=rowCard?`S${rowCard.slot??'?'}`:'a Spell/Trap Zone',rowTarget=rowCard?nearestFreeMonsterZone(room.state.seats[seat].twin as never,`S${rowCard.slot??1}` as FieldZone,rowCard.ref):undefined;
  function receivingTrack(seen:PileSeen|undefined):FieldTrack|undefined {
    if(seen)return 'track' in seen?watch.getTrack(seen.track.id):watch.getTracks().find(t=>t.zone===(seen.zone==='graveyard'?'GY':'BANISHED')&&
      t.visible&&!t.removed&&(bindings.current.get(t.id)??t.id)===seen.twin.ref);
  }
  /** The pile card the camera showed is the departed card: its pile track follows the card, the stand-in is removed, one Undo reverts both. */
  async function adoptPileCard(act:RoomMutation,seen:PileSeen,cardRef:string,movedId:string) {
    // A pile track with no stand-in yet: it follows the card from here on (Undo dismisses it with the card); nothing to remove.
    if('track' in seen){
      bindings.current.set(seen.track.id,cardRef);
      if(seen.track.visible)watch.confirm(seen.track.id,seen.track.cardId,cardRef,false);
      return;
    }
    const standIn=current.current.room.state.seats[seat].twin.find(c=>c.ref===seen.twin.ref);
    if(!standIn||standIn.zone!==seen.zone||standIn.cardId||standIn.passcode||standIn.name)return;
    const pileTrack=watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===seen.twin.ref);
    if(pileTrack){bindings.current.set(pileTrack.id,cardRef);watch.confirm(pileTrack.id,undefined,cardRef,false);}
    readerRemovals.current.add(seen.twin.ref);
    const dropped=await act({type:'twin.remove',source:'auto',actorSeat:seat,seat,cardRef:seen.twin.ref});
    if(!dropped?.state.undo?.actionId){readerRemovals.current.delete(seen.twin.ref);return;}
    setChain(dropped.state.undo.actionId,{ids:movedId?[movedId]:[],...(pileTrack?{rebind:{trackId:pileTrack.id,ref:seen.twin.ref,adoptedRef:cardRef}}:{})});
    return {state:dropped,undoTarget:dropped.state.undo.actionId};
  }
  /** Adopt the pile evidence for a rule-defaulted GY or Extra Deck departure. */
  function settleLate(ref:string,seen:PileSeen) {
    const waiting=lateDefaults.current.get(ref);
    lateBusy.current=true;lateDefaults.current.delete(ref);setLeaveChoice(null);
    return queue(async act=>{
      const now=current.current.room.state.seats[seat].twin,card=now.find(c=>c.ref===ref);
      // A card the default rule put in the Graveyard waits too: its own pile track (or a Banished one) settles it.
      if(!live()||!card||!(card.zone==='extra'||waiting?.pile&&card.zone==='graveyard')||'twin' in seen&&!now.some(c=>c.ref===seen.twin.ref)||undoKept.current.has(ref))return;
      // The proof is checked again here: the queue can be slow, and the track may be gone, named as another card, or owned by now.
      const track=receivingTrack(seen);
      if(!track||track.removed||observedPile(track.zone)!==seen.zone||track.faceDown===seen.faceUp)return;
      const proof={twins:now,tracks:watch.getTracks(),lastSeen:waiting?.lastSeen??track.firstSeen,cardId:waiting?.cardId,
        owns:(t:FieldTrack)=>bindings.current.get(t.id)??t.id,pileContactAt:watch.getSnapshot?.()?.pileContactAt};
      if('track' in seen?fieldPileTrackEvidence(proof)?.track.id!==track.id:
        seen.zone==='banished'&&fieldPileEvidence(proof)?.twin.ref!==seen.twin.ref)return;
      // Always one move: the camera confirmed the pile, so the card drops its field origin and no later second copy can take it.
      const moved=await act({type:'twin.move',source:'auto',confirmed:true,actorSeat:seat,seat,cardRef:ref,zone:seen.zone,faceUp:seen.zone==='banished'?seen.faceUp:true,...(card.faceUp&&card.name?{name:card.name}:{})},undefined,undefined,track);
      if(!moved)return;
      const adopted=await adoptPileCard(act,seen,ref,moved.state.undo?.actionId??'');
      const name=card.name??'Card';
      setDeparture({ref,name,zone:seen.zone,...(seen.zone==='banished'&&!seen.faceUp?{down:true}:{})});
      setNotice(`${name} → ${fieldLeaveLabel(seen.zone,seen.faceUp)} · seen on camera · auto`);setUndoId(adopted?.undoTarget??moved.state.undo?.actionId??'');
    }).finally(()=>{lateBusy.current=false;});
  }
  function chooseLate(ref:string) {
    const choice=leaveChoice,twin=choice&&current.current.room.state.seats[seat].twin.find(c=>c.ref===choice.twinRef);
    if(!choice||!twin){setLeaveChoice(null);return;}
    void settleLate(ref,{twin,zone:choice.zone,faceUp:choice.faceUp});
  }
  /** Pile evidence as it arrives: it settles a waiting departure on that tick, and corrects a GY default the camera contradicts. */
  useEffect(()=>{
    if(!live())return;
    if(!pendingDepartures.current.size&&!lateDefaults.current.size)return;
    const twins=room.state.seats[seat].twin,tracks=watch.getTracks(),owns=(t:FieldTrack)=>bindings.current.get(t.id)??t.id,now=performance.now();
    for(const [id,{event,origin,unresolved,pileWorked}] of pendingDepartures.current){
      if(!twins.some(c=>c.ref===origin.ref&&c.zone===origin.zone&&c.slot===origin.slot)){cancelDeparture(id);continue;}
      if(now-(leaveStarted.current.get(id)??now)>(pileWorked?PILE_ACTION_CAP_MS+5000:10_000)){if(!unresolved)cancelDeparture(id);continue;}
      if(settlingDepartures.current.has(id)||!watch.isRemoved(id))continue;
      const snap=watch.getSnapshot?.();
      if(fieldDepartureHasBack(event,snap)||!departurePileEvidence(event,snap))continue;
      const timer=departureTimers.current.get(id);if(timer)clearTimeout(timer);departureTimers.current.delete(id);settlingDepartures.current.add(id);
      handle(event,origin);
    }
    // A later top can identify a card already sent to the GY or Extra Deck by rule.
    const late=[...lateDefaults.current].filter(([ref,info])=>{
      if(now-info.at<=LATE_PILE_MS&&twins.some(c=>c.ref===ref&&(c.zone==='extra'||info.pile&&c.zone==='graveyard')))return true;
      lateDefaults.current.delete(ref);return false;
    });
    const lateProof={twins,tracks,lastSeen:Math.min(...late.map(([,i])=>i.lastSeen)),owns,cardId:late.length===1?late[0][1].cardId:undefined,
      pileContactAt:watch.getSnapshot?.()?.pileContactAt};
    const seen:PileSeen|undefined=late.length&&!lateBusy.current&&!pendingDepartures.current.size?fieldPileEvidence(lateProof)??(late.length===1?fieldPileTrackEvidence(lateProof):undefined):undefined;
    if(!late.length)choiceClosed.current.clear();
    if(!seen){if(leaveChoice&&!late.length)setLeaveChoice(null);return;}
    if(late.length===1)void settleLate(late[0][0],seen);
    else if('twin' in seen&&leaveChoice?.twinRef!==seen.twin.ref&&!choiceClosed.current.has(seen.twin.ref))setLeaveChoice({twinRef:seen.twin.ref,zone:seen.zone,faceUp:seen.faceUp,options:late.map(([ref])=>({ref,name:twins.find(c=>c.ref===ref)?.name??'Card'}))});
  },[room.state,seat,watch.snapshot]);
  function redirect(zone:string,down=false) {
    void queueHuman('redirect',async act=>{
      const value=departureRef.current;if(!value||!live())return;
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===value.ref);
      const pileChoice=value.zone==='pending'&&value.pile;
      if(pileChoice===zone)return;
      if(!card||(pileChoice?!pileDepartureStillMissing(value,card):!destinations.some(d=>d.zone===card.zone)&&!(value.zone==='pending'&&fieldDepartureMissing(value))))return;
      setPending(true);
      try{const updated=await act({type:'twin.move',...(value.pile?{}:{source:'auto' as const}),actorSeat:seat,seat,cardRef:card.ref,zone,...(zone==='banished'?{faceUp:!down}:zone==='graveyard'?{faceUp:true}:zone==='deck'||value.pile&&zone==='hand'?{faceUp:false}:zone==='extra'?(card.faceUp&&/\bpendulum\b/i.test(cardInfo(cardCode(card))?.type??'')?{faceUp:true,pendulum:true}:{faceUp:false}):{}),...(card.faceUp?{name:value.name}:{})});if(updated){setDeparture({...value,zone,down:zone==='banished'&&down});setNotice(`${value.name} → ${fieldLeaveLabel(zone,!down)}${value.pile?'':' · auto'}`);setUndoId(updated.state.undo?.actionId??'');}}finally{setPending(false);}
    });
  }
  /** The tag's "Attach to": the card that left the field goes under an Xyz Monster (either side's), keeping its owner. */
  function attachTo(target:{seat:number;ref:string;name:string}) {
    void queueHuman('attach',async act=>{
      const value=departureRef.current;if(!value||!live())return;
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===value.ref);
      if(!card||card.token)return;
      setPending(true);
      try{const updated=await act({type:'twin.attach',actorSeat:seat,seat:target.seat,cardRef:target.ref,kind:'xyz',materialRefs:[card.ref],...(target.seat!==seat?{materialSeat:seat}:{})});if(updated){setDeparture({...value,zone:'material'});setNotice(`${value.name} → under ${target.name} · auto`);setUndoId(updated.state.undo?.actionId??'');}}finally{setPending(false);}
    });
  }
  useEffect(()=>{
    // Tap to identify: the saved mat grid still goes out (it is not a tracking claim), so the other feeds draw their overlays on this camera. The `tap` mode tells them no card is followed.
    const message={...fieldTrackMessage(watch.snapshot,entries.current,known(),watch.placed?watch.calibration:undefined),...(watch.enabled&&!syncHold?{}:{mode:'tap' as const})},key=JSON.stringify(message);lastMessage.current=message;
    if(key!==published.current){published.current=key;hub.publishFieldTracks(message);}
  },[watch.snapshot,watch.calibration,watch.placed,watch.enabled,syncHold,hub.publishFieldTracks,room.state]);
  // The feeds draw the zone grid from the saved calibration and the cards the watcher sees.
  const gridFormat=room.format?.id??room.state.deckChecks.format.id;
  const gridKey=watch.snapshot.tracks.filter(t=>t.visible&&!t.removed).map(t=>`${t.id}:${t.zone}:${t.card.quad.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')}`).join('|');
  useEffect(()=>{
    publishZoneGrid({ownSeat:seat,format:gridFormat,calibration:watch.calibration,placed:watch.placed,calibrationNeeded:watch.calibrationNeeded,defaultSide:defaultSideFor(phone?'phone':'webcam'),setCalibration:updateCalibration,calibrate:()=>{if(host?.querySelector('video')?.videoWidth)setCalibrating(true);},
      tracks:watch.snapshot.tracks.filter(t=>t.visible&&!t.removed).map(t=>({id:t.id,zone:t.zone,quad:t.card.quad}))});
    // The key stands for the visible cards without republishing on every sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[seat,gridFormat,phone,watch.calibration,watch.placed,watch.calibrationNeeded,updateCalibration,gridKey,host,watch.snapshot.tracks.length]);
  useEffect(()=>clearZoneGrid,[]);
  // Zone rules (docs/remote-duels/zone-rules.md). Only HARD rules move a card the
  // camera placed: a Field Spell goes to the Field Zone, a Link Monster to the
  // Monster Zones. Every other card stays where the camera saw it; an unusual zone
  // is only marked "Check zone?" on the board. Manual moves are left alone.
  const ruleFixes=useRef(new Set<string>()),[factsTick,setFactsTick]=useState(0);
  // The seat's registered deck loads its card facts as soon as the watcher starts, so the first placement does not wait on a cold lookup.
  // With no deck list one common card still wakes the route.
  const warmed=useRef('');
  useEffect(()=>{
    const key=`${room.slug}:${seat}`;if(warmed.current===key)return;warmed.current=key;
    const ids=[...new Set([...deckIdsOf(room,seat),...room.state.seats[seat].twin.map(c=>cardCode(c)??0)])].filter(id=>id>0);
    void loadCards(ids.length?ids:[46986414]).then(()=>setFactsTick(n=>n+1)).catch(()=>undefined);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.slug,seat]);
  useEffect(()=>{
    if(!live())return;
    const twins=room.state.seats[seat].twin,format=room.format?.id??room.state.deckChecks.format.id;
    // A card placed without facts: now that its facts are here, record its summon with the placement time so materials lifted afterwards are taken.
    for(const [ref,late] of [...lateSummons.current]){
      const facts=cardInfo(late.code),card=twins.find(c=>c.ref===ref);
      if(!card||!['monster','extra-monster'].includes(card.zone)||performance.now()-late.at>SUMMON_WINDOW_MS){lateSummons.current.delete(ref);continue;}
      if(!facts)continue;
      lateSummons.current.delete(ref);
      const kind=fieldSummonKind(facts);if(kind&&!summons.current.has(ref))summons.current.set(ref,{kind:kind.kind,name:late.name,rating:kind.rating,at:late.at,count:0,pending:[],trackId:late.trackId});
    }
    for(const card of twins){
      if(!card.faceUp||!publicField(card.zone)||manual.current.has(card.ref))continue;
      // Only a card the camera sees now: a hand move on the board is the player's choice.
      if(!watch.getTracks().some(t=>(bindings.current.get(t.id)??t.id)===card.ref&&t.visible&&!t.removed))continue;
      const zone=toZone(card.zone,card.slot),code=cardCode(card);if(!zone||!code)continue;
      const facts=cardInfo(code);if(!facts){void loadCards([code]).then(()=>{if(cardInfo(code))setFactsTick(n=>n+1);});continue;}
      const target=hardFieldZone(facts,zone,twins,card.ref,format,equipSourceOn(twins));if(!target)continue;
      const key=`${card.ref}:${zone}:${target}`;if(ruleFixes.current.has(key))continue;ruleFixes.current.add(key);
      void queue(async act=>{
        const latest=current.current.room.state.seats[seat].twin.find(c=>c.ref===card.ref);
        if(!live()||!latest||toZone(latest.zone,latest.slot)!==zone||manual.current.has(card.ref))return;
        const updated=await act({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,...fieldZoneLocation(target),...(latest.name?{name:latest.name}:{}),zoneRule:zoneMoveLabel(facts,target),...(latest.position?{position:latest.position}:{})});
        if(updated){
          const rule=`${latest.name??'Card'}: ${zoneMoveLabel(facts,target)}`;
          setNotice(rule);noteRowFix(card.ref);setUndoId(updated.state.undo?.actionId??'');
        }
      },undefined,false,false,laneOf([card.ref],[zone,target]));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.state,seat,factsTick]);
  // Board re-sync: every few seconds (and at once from "Scan field") compare what
  // the camera saw in its last full detector pass with the board and fix differences
  // with the same rules. No prompts; one log note (not an undo step) when something
  // changed. Each fix is its own undoable action and is tried once per board state.
  // A card the player moved or undid stays until the camera shows a new change.
  const missingSince=useRef(new Map<string,number>());
  const [scanning,setScanning]=useState(false),[lastScan,setLastScan]=useState<ScanAdvice['last']>(),scanMark=useRef({asked:0,sweepMs:0,origin:'manual' as 'manual'|'auto'|'remote'}),scanChanges=useRef(0),scanEndedAt=useRef(-Infinity),resyncing=useRef(false),resyncStarted=useRef(0),resynced=useRef(new Map<string,{board:string;fails:number}>());
  useEffect(()=>{resynced.current.clear();},[room.slug,seat]);
  // A fix that failed because the server was out of reach was never really tried: when it is back, every fix may run again.
  useEffect(()=>onOutageEnd(()=>{resynced.current.clear();}),[]);
  const boardState=()=>{let h=0;for(const c of current.current.room.state.seats[seat].twin)for(const ch of `${c.ref}|${c.zone}|${c.slot??''}|${c.position??''}|${c.faceUp?1:0};`)h=(h*31+ch.charCodeAt(0))|0;return String(h);};
  /** False when this fix was already tried on this board state. A failed write may try again (3 times) next cycle. */
  const tryFix=(key:string)=>{const board=boardState(),seen=resynced.current.get(key);if(seen?.board===board)return false;resynced.current.set(key,{board,fails:seen?.fails??0});return true;};
  const fixFailed=(key:string,error:unknown)=>{console.info('[remote field] re-sync write skipped',key,error instanceof Error?error.message:error);if(error instanceof OutageGaveUpError){resynced.current.delete(key);return;}const seen=resynced.current.get(key);if(seen&&++seen.fails<3)seen.board='';};
  // A fresh zoom triggers the face check directly. Older detector evidence uses the still-frame check.
  /** A scan is over (the two passes and the board writes): keep how long each part took. Dev tools and the e2e check read it from the Scan field button. */
  const finishScan=()=>{const m=scanMark.current,at=performance.now();scanEndedAt.current=at;const last={origin:m.origin,sweepMs:Math.round(m.sweepMs),totalMs:Math.round(at-m.asked),changes:scanChanges.current};console.info('[remote field] scan timing',last);setLastScan(last);};
  const faceBusy=useRef(false);
  const faceFixes=(at:number,scan:boolean,zoom?:FieldEvent)=>{
    const reading=new Set(placeholders.current.values());
    return face.current.due({at,scan,seat,tracks:watch.getTracks(),twins:current.current.room.state.seats[seat].twin,refOf:t=>bindings.current.get(t.id)??t.id,zoneOf:knownZone,skip:ref=>reading.has(ref)||heldStacks.current.has(ref),
      freshZoom:t=>!!zoom&&zoom.track.id===t.id&&zoom.track.zone===t.zone&&zoom.track.restSince===t.restSince&&fieldEvidenceMatches(zoom,t),
      identity:t=>{const entry=t.cardId?entries.current.get(t.cardId):undefined,code=entry&&catalogCardId(entry);return code?{cardId:code,name:entry!.name}:undefined;}});
  };
  const flipFace=async(act:FieldMutation,{track,card,proposal}:FieldFaceFix)=>{
    const backoff=()=>face.current.failed(card.ref,performance.now());
    const refuse=(message:string)=>{face.current.hold(card.ref,track.faceDown);setNotice(message);};
    const event:FieldEvent={type:'flipped',track,source:'auto',result:faceReadFor(track)};
    if(proxyClash(event))return backoff();
    if(proposal.faceUp){
      if(differentKnownSet(card,proposal)){
        if(!fieldSureSetRead(track,event.result))return backoff();
        let written:RemoteRoom|null=null;
        try{await apply(event,async(proposal,key)=>{
          const updated=await act(proposal,key,event);
          if(updated)written=updated;
          return updated;
        });}
        catch(error){
          // Once the old Set has left, the face check can no longer retry on its ref.
          if(written){
            if(error instanceof StaleFieldPlacementError)setRecovery(error);
            else {setFailedUpdate({event,work:next=>apply(event,next)});setNotice(error instanceof Error?error.message:'Could not save the field update.');}
          }
          throw error;
        }
        return written??backoff();
      }
      const facts=cardInfo(proposal.cardId??cardCode(card));
      const notice=remoteActivationNotice(current.current.room.state,seat,facts&&remoteActivationLimit(facts.name,facts.effectText));
      if(notice){refuse(notice);return;}
    }
    let action: Parameters<typeof applyFieldFaceFlip>[3] = proposal;
    if(track.faceDown && track.zone!==knownZone(card)){
      const twins=current.current.room.state.seats[seat].twin;
      const projected=projectObserved(track,twins,card,cardInfo(cardCode(card)));
      if(!projected.zone||proxyClash(event,projected.zone))return backoff();
      const setMove=fieldSetMove(card,{...track,zone:projected.zone},seat,true);
      if (!setMove || keepsManual(card.ref,fieldZoneLocation(track.zone),track.position) || twins.some(c=>c.ref!==card.ref&&c.zone===setMove.zone&&c.slot===setMove.slot))return backoff();
      action=setMove;
    }
    let updated:RemoteRoom|null;
    try{updated=await applyFieldFaceFlip(track,()=>watch.getTrack(track.id),(proposal,id)=>act(proposal,id,event),action,!!card.faceUp&&!!card.materials?.length);}
    catch(error){if(error instanceof RemoteDuelError&&error.code==='ACTIVATION_LIMIT'){refuse(error.message);return;}throw error;}
    if(!updated)return backoff();
    if(card.faceUp===track.faceDown)face.current.flipped(card.ref,performance.now());
    if(!track.faceDown)watch.confirm(track.id,track.cardId,card.ref,false);
    rememberPhysical(card.ref,track.zone);
    return updated;
  };
  const faceCheck=useRef<(zoom?:FieldEvent)=>void>(()=>undefined);
  faceCheck.current=zoom=>{
    if(faceBusy.current||!live()||calibrationBusy.current||document.hidden)return;
    const fixes=faceFixes(performance.now(),false,zoom);if(!fixes.length)return;
    const lanes=laneOf(fixes.map(f=>f.card.ref),fixes.map(f=>knownZone(f.card)));
    for(const {track,card,proposal} of fixes)if(proposal.faceUp&&differentKnownSet(card,proposal))
      lanes.push(...fieldLanes({type:'flipped',track,source:'auto'})??[]);
    faceBusy.current=true;
    void queue(async act=>{
      for(const {card:{ref}} of fixes){
        // Earlier work in the queue may have settled it already.
        const fix=faceFixes(performance.now(),false,zoom).find(f=>f.card.ref===ref);if(!fix)continue;
        try{await flipFace(act,fix);}catch(error){console.info('[remote field] face check write failed',ref,error instanceof Error?error.message:error);face.current.failed(ref,performance.now());}
      }
    },undefined,false,true,lanes).finally(()=>{faceBusy.current=false;});
  };
  useEffect(()=>{const timer=setInterval(()=>faceCheck.current(),200);return()=>clearInterval(timer);},[]);
  /** `manualScan` = a Scan field pass (fresh sweep, no 2 s wait). `gentle` = it was not the player's own press (auto resync, a Rescan request): it
   *  keeps Undo-kept cards, face holds and hand-moved cards, and says nothing when the board already matches. */
  function resync(manualScan=false,gentle=false,provenOnly=false,keepWait=false) {
    const strict=manualScan&&!gentle;
    if(resyncing.current||!live()||calibrationBusy.current){if(manualScan)setScanning(false);if(strict){setNotice(resyncing.current?'Board check already running':calibrationBusy.current?'Finish calibration first':'Camera is not watching the field');}return;}
    resyncing.current=true;resyncStarted.current=performance.now();let note='';
    void queue(async act=>{
      let changes=0,lastUndo='';const snap=watch.getSnapshot?.(),fullAt=snap?.lastFullAt;
      if(!snap||!live()||fullAt===undefined&&!provenOnly)return;
      const refOf=(t:FieldTrack)=>bindings.current.get(t.id)??t.id;
      const write=async(key:string,proposal:Parameters<RoomMutation>[0],evidence?:FieldEvent|number,pileTrack?:FieldTrack)=>{
        if(outageDown()){resynced.current.delete(key);return;} // not tried: the server is out of reach
        try{
          const updated=typeof evidence==='number'?await act({...proposal,cam:fieldCameraStamp(undefined,'camera',undefined,evidence)},undefined,undefined,pileTrack):await act(proposal,undefined,evidence);
          if(updated){changes++;lastUndo=updated.state.undo?.actionId??lastUndo;}return updated;
        }catch(error){fixFailed(key,error);}
      };
      // Scan field: every board card with a track or a resting back of the other face in its zone turns over (never removed, never to the hand).
      // A back seen in both passes beats a track that still says up: such a card is never turned up first, and the face check leaves it until that track turns.
      if(strict){
        const backs=snap.lastScanBacks??[];
        for(const fix of faceFixes(performance.now(),true)){
          if(backs.includes(fix.track.zone)){
            if(!fix.track.faceDown){holdFace(fix.card.ref);continue;}
            // A same-cell scan back clears identity in the same write as a tracked flip.
            if(fix.track.zone===knownZone(fix.card))fix.proposal={...fix.proposal,identityUncertain:true};
          }
          try{const updated=await flipFace(act,fix);if(updated){changes++;lastUndo=updated.state.undo?.actionId??lastUndo;}}catch(error){console.info('[remote field] face write failed',fix.card.ref,error instanceof Error?error.message:error);}
        }
        for(const zone of backs){
          const card=current.current.room.state.seats[seat].twin.find(c=>c.ownerSeat===undefined&&(c.faceUp||c.publicIdentity&&!c.setBy&&!c.knownFaceDown)&&publicField(c.zone)&&knownZone(c)===zone&&![...placeholders.current.values()].includes(c.ref));if(!card)continue;
          const proposal=fieldFaceProposal(card,{faceDown:true,position:'attack',identityUncertain:true},seat);if(!proposal)continue;
          const wasUp=card.faceUp;
          if(!await write(`flip:${card.ref}:true`,proposal,snap.lastScanAt))continue;
          if(wasUp)face.current.flipped(card.ref,performance.now());
          if(snap.tracks.some(t=>!t.removed&&!t.faceDown&&refOf(t)===card.ref))holdFace(card.ref);
        }
      }
      // Only cards the last full detector pass saw (on CPU it can be seconds old), after they settled.
      const settled=provenOnly||fullAt===undefined?[]:snap.tracks.filter(t=>t.state==='identified'&&!t.removed&&!piles.has(t.zone)&&fullAt-t.firstSeen>1500);
      const seenInFullPass=(t:FieldTrack)=>t.visible&&t.lastSeen>=(fullAt??Infinity);
      // 1. A known field card in another zone than the camera shows: move it (zone rules apply).
      for(const t of settled){
        if(!seenInFullPass(t))continue;
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(c=>c.ref===refOf(t));
        if(!card||!publicField(card.zone)||!t.cardId&&!t.faceDown||keepsManual(card.ref,fieldZoneLocation(t.zone),t.position))continue;
        // The face check writes a camera Set and its destination together.
        const faceDiffers=card.faceUp===t.faceDown;if(faceDiffers&&(t.faceDown||!face.current.held(card.ref)))continue;
        const facts=cardInfo(cardCode(card));
        if(faceDiffers&&isFieldSpell(facts))continue;
        const event={type:'moved',track:t,source:'auto'} as const;
        const stillThere=()=>{const observed=watch.getTrack(t.id);return observed?.zone===t.zone&&fieldEvidenceMatches(event,observed);};
        if(!stillThere()||proxyClash(event))continue;
        const projected=projectObserved(t,twins,card,facts);if(!projected.zone||proxyClash(event,projected.zone))continue;
        // A hard-rule fix (Field Spell → FIELD) the player undid is not redone here either.
        if(ruleFixes.current.has(`${card.ref}:${toZone(card.zone,card.slot)}:${projected.zone}`))continue;
        const location=fieldZoneLocation(projected.zone),position=faceDiffers?card.position:fieldTwinPosition({...t,zone:projected.zone});
        const setMove=card.publicIdentity&&!card.faceUp?fieldSetMove(card,{...t,zone:projected.zone},seat,t.zone!==knownZone(card)):undefined;
        if(setMove||card.zone!==location.zone||card.slot!==location.slot||card.position!==position){
          const key=`move:${card.ref}>${location.zone}${location.slot??''}${position}${setMove?.physicalZoneChanged?t.zone:''}`;
          if(!tryFix(key)||!await write(key,setMove ?? {type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,...location,position},event))continue;
        }
        if(!faceDiffers&&stillThere())rememberPhysical(card.ref,t.zone);
      }
      // 2. A field copy the camera placed while the same card in the GY/banished shows it left: one card.
      for(const t of settled){
        if(!seenInFullPass(t))continue;
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(c=>c.ref===refOf(t)),entry=t.cardId?entries.current.get(t.cardId):undefined;
        if(!card||!card.faceUp||!publicField(card.zone)||!entry||!card.ref.startsWith('fw-')||keepsManual(card.ref,fieldZoneLocation(t.zone),t.position))continue;
        const copy=pileExit(t,entry,twins);if(!copy||keepsManual(copy.ref,fieldZoneLocation(t.zone),t.position))continue;
        const key=`merge:${card.ref}:${copy.ref}`;if(!tryFix(key))continue;
        const updated=await write(key,{type:'twin.merge',actorSeat:seat,seat,keepRef:card.ref,removeRef:copy.ref,reason:'Board re-sync: the camera saw this card leave the pile'});
        if(updated)mergedCopies.current.set(copy.ref,updated.lastSeq);
      }
      // 3. A card the camera knows that the board does not show (or shows off the field): place it again.
      for(const t of settled){
        if(!seenInFullPass(t)&&!recentCommittedSet(t))continue;
        const ref=refOf(t),card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
        if(card&&publicField(card.zone)||placeholders.current.has(t.id)||!t.faceDown&&!t.cardId)continue;
        // An Undo of this card (placement or pile exit) is the player's choice: leave it.
        if(undoKept.current.has(ref)||keepsManual(ref,fieldZoneLocation(t.zone),t.position)||card?.zone==='hand'||card&&recentFieldDeparture(card,serverNow()))continue;
        const key=`place:${t.id}:${t.zone}:${t.revision??0}`;if(!tryFix(key))continue;
        const before=current.current.room.lastSeq;
        const event:FieldEvent={type:'placed',track:t,source:'auto'};
        try{await apply(event,(proposal,id)=>act(proposal,id,event));}catch(error){fixFailed(key,error);}
        if(current.current.room.lastSeq>before){changes++;lastUndo=current.current.room.state.undo?.actionId??lastUndo;}
      }
      // 4. A field card whose zone shows no card in 2 full scans (no hand, no moving shadow), with or
      // without a live track: remove it. An Undo keeps it until the player presses Scan field.
      for(const ref of missingSince.current.keys())if(!snap.missingTwins?.includes(ref))missingSince.current.delete(ref);
      for(const ref of snap.missingTwins??[]){
        if(!strict&&[...pendingDepartures.current.values()].some(({origin})=>origin.ref===ref))continue;
        const since=missingSince.current.get(ref)??performance.now();missingSince.current.set(ref,since);
        // Scan field is authoritative: its two fresh passes already showed the zone empty, so it does not wait.
        const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
        if(!card||card.ownerSeat!==undefined||!publicField(card.zone))continue;
        const currentSnap=watch.getSnapshot?.(),zone=knownZone(card);
        const proofAt=zone&&fieldEmptyProofs(currentSnap)?.[zone];
        const proven=proofAt!==undefined&&!currentSnap?.tracks.some(t=>!t.removed&&t.visible&&(t.zone===zone||refOf(t)===ref));
        if(provenOnly&&!proven||(!manualScan||keepWait)&&!proven&&performance.now()-since<2000)continue;
        if(!strict&&zone&&currentSnap?.blindZones?.includes(zone))continue;
        const now=performance.now();
        if(!strict&&proven&&now<proofAt!+DEPARTURE_WAIT_MS)continue;
        const code=cardCode(card);
        const pileProof={twins:current.current.room.state.seats[seat].twin,tracks:currentSnap?.tracks??[],lastSeen:proofAt??since,owns:refOf,cardId:code?String(code):undefined,pileContactAt:currentSnap?.pileContactAt};
        const seen=proven&&!strict&&currentSnap?.missingTwins?.length===1&&pendingDepartures.current.size===0?
          fieldPileEvidence(pileProof)??fieldPileTrackEvidence(pileProof):undefined;
        if(!strict&&!seen&&activeDeparturePile(currentSnap,proofAt??since,now,fieldActivityWindow(currentSnap)))continue;
        if(manual.current.has(ref)&&!strict)continue;
        if(undoKept.current.has(ref)){if(!strict)continue;undoKept.current.delete(ref);}
        // An unnamed Set the camera placed and no longer sees is taken back, not added to the hand as an unknown card.
        const unnamedSet=strict&&!card.faceUp&&!cardCode(card)&&card.ref.startsWith('fw-');
        const proposal=unnamedSet?{type:'twin.remove' as const,source:'auto' as const,actorSeat:seat,seat,cardRef:card.ref}:fieldDepartureProposal(card,seat,seen?{zone:seen.zone,faceUp:seen.faceUp}:undefined,cardInfo(code));if(!proposal)continue;
        const key=`remove:${ref}`;if(!tryFix(key))continue;
        const updated=await write(key,proposal,now,receivingTrack(seen));
        if(updated&&seen){const adopted=await adoptPileCard(act,seen,ref,lastUndo);if(adopted)lastUndo=adopted.undoTarget;}
      }
      const text=`Board re-synced (${changes} change${changes===1?'':'s'})`;
      // The note is a log line only: the server keeps it out of the undo history, so Undo reverts the last fix.
      scanChanges.current=changes;
      // The log line is saved after the board is done: the scan does not wait one more round trip for it.
      if(changes){if(!provenOnly)note=text;setNotice(text);setUndoId(lastUndo);}
      else if(strict)setNotice('Board matches the camera');
    },undefined,false,true,boardLanes()).finally(()=>{
      resyncing.current=false;
      if(manualScan){setScanning(false);finishScan();}
      if(note)void queue(async act=>{try{await act({type:'log.note',actorSeat:seat,text:note});}catch(error){console.info('[remote field] re-sync note skipped',error);}},undefined,false,true,['note']);
    });
  }
  const resyncRef=useRef(resync);resyncRef.current=resync;
  const emptyProofs=fieldEmptyProofs(watch.snapshot);
  const provenMissing=(watch.snapshot.missingTwins??[]).filter(ref=>{
    if(!emptyProofs)return false;
    const card=room.state.seats[seat].twin.find(c=>c.ref===ref),zone=card&&knownZone(card);
    return zone!==undefined&&emptyProofs[zone]!==undefined;
  }).join(',');
  useEffect(()=>{
    if(!provenMissing||document.hidden)return;
    const timer=setTimeout(()=>{
      const latest=watch.getSnapshot?.(),proofs=fieldEmptyProofs(latest);
      for(const card of current.current.room.state.seats[seat].twin){
        if(!latest?.missingTwins?.includes(card.ref)||!publicField(card.zone)||manual.current.has(card.ref)||undoKept.current.has(card.ref))continue;
        const zone=knownZone(card),proofAt=zone&&proofs?.[zone];if(proofAt===undefined)continue;
        const track=latest.tracks.find(t=>t.removed&&(bindings.current.get(t.id)??t.id)===card.ref&&t.zone===zone);
        if(!track||!watch.isRemoved(track.id))continue;
        const evidence:FieldCellEvidence={basis:'pixel',emptyProofAt:proofAt};
        handle({type:'removed',track,source:'auto',reason:'empty',removedAt:proofAt,evidence} as FieldEvent);
      }
    },150);
    const sweep=setTimeout(()=>resyncRef.current(false,false,true),DEPARTURE_WAIT_MS);
    const retry=setTimeout(()=>resyncRef.current(false,false,true),PILE_DEPARTURE_CAP_MS);
    return()=>{clearTimeout(timer);clearTimeout(sweep);clearTimeout(retry);};
  },[room.slug,seat,watch.enabled,provenMissing]);
  // End of the hold: the placements dropped during it go on the board now. Moves and removals wait for the sweep, which is the proof they need.
  const placeHeldCards=useRef(()=>{});
  placeHeldCards.current=()=>{
    enabledRef.current=watch.enabled&&!watch.calibrationNeeded;syncHoldRef.current=false;heldPlaced.current.deferred=0;
    const seen=watch.getTracks().filter(t=>t.state==='identified'&&t.visible&&!t.removed&&!piles.has(t.zone)&&(t.faceDown||t.cardId));
    if(seen.length)void queue(async act=>{
      for(const t of seen){
        const ref=bindings.current.get(t.id)??t.id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
        if(card&&publicField(card.zone)||placeholders.current.has(t.id)||keepsManual(ref,fieldZoneLocation(t.zone),t.position))continue;
        try{await apply({type:'placed',track:t,source:'auto'},act);}catch(error){console.info('[remote field] held card write skipped',t.id,error instanceof Error?error.message:error);}
      }
    },undefined,false,true,laneOf(seen.map(t=>bindings.current.get(t.id)??t.id),[...seen.map(t=>t.zone),...PILE_LANES]));
  };
  useEffect(()=>{
    const every=recognition.backend==='webgpu'?4000:8000;
    const timer=setInterval(()=>{if(!document.hidden&&scanTimer.current===undefined)resyncRef.current();},every);
    return()=>clearInterval(timer);
  },[room.slug,seat,recognition.backend]);
  // "Scan field": force two fresh full detector passes and the watcher's sweep (5 s at most on a slow CPU), then re-sync once.
  const scanTimer=useRef<ReturnType<typeof setInterval>|undefined>(undefined),scanGuard=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  // One failed tick sets the error and the next good tick clears it. It counts as a fault once it has lasted 3 s, and stops counting only after
  // 3 s without any error, so a reader that fails again and again between good ticks still shows as off.
  const rawWatcherError=watch.snapshot.status==='error',[errorLasted,setErrorLasted]=useState(false),lastWatcherError=useRef(''),errorNow=useRef(false),errorOnsets=useRef(0);
  const errorStart=useRef<ReturnType<typeof setTimeout>|undefined>(undefined),errorClear=useRef<ReturnType<typeof setTimeout>|undefined>(undefined);
  useEffect(()=>{
    const wasError=errorNow.current;errorNow.current=rawWatcherError;
    if(rawWatcherError){
      lastWatcherError.current=watch.snapshot.error||'Card watcher unavailable';
      if(!wasError)errorOnsets.current++;
      clearTimeout(errorClear.current);errorClear.current=undefined;
      if(errorStart.current===undefined)errorStart.current=setTimeout(()=>{errorStart.current=undefined;if(errorNow.current||errorOnsets.current>=3)setErrorLasted(true);},3000);
    }else if(errorClear.current===undefined&&(errorOnsets.current>0||errorLasted)){
      errorClear.current=setTimeout(()=>{errorClear.current=undefined;errorOnsets.current=0;setErrorLasted(false);},3000);
    }
  },[rawWatcherError,watch.snapshot.error,errorLasted]);
  useEffect(()=>()=>{clearTimeout(errorStart.current);clearTimeout(errorClear.current);},[]);
  const watcherError=errorLasted?(rawWatcherError?watch.snapshot.error:'')||lastWatcherError.current||'Card watcher unavailable':'';
  useEffect(()=>()=>{clearInterval(scanTimer.current);clearTimeout(scanGuard.current);},[]);
  // The guard has done its job as soon as the scan has ended.
  useEffect(()=>{if(!scanning)clearTimeout(scanGuard.current);},[scanning]);
  /** `manual` is the player's own press. `auto`, `quiet` (the background check) and `remote` (a Rescan request) never end the sync hold and are silent unless they change the board. `quiet` keeps the 2 s proof before a removal. Returns false when it did not start. */
  const scanField=useCallback((origin:'manual'|'auto'|'remote'|'quiet'='manual'):boolean=>{
    const gentle=origin!=='manual';clipAction('scan',{origin});
    if(scanTimer.current!==undefined||resyncing.current){if(!gentle)setNotice(resyncing.current&&performance.now()-resyncStarted.current>15000?'Board check is stuck. Reload the page.':'Board check already running');return false;}
    if(watcherError){if(!gentle)setNotice('Scan field cannot run: the card reader is not running. Reload the page or use Tap to identify.');return false;}
    if(gentle&&(syncHoldRef.current||calibrationBusy.current))return false;
    if(!gentle&&syncHold){setSyncHold(false);placeHeldCards.current();}
    setScanning(true);const asked=performance.now();scanMark.current={asked,sweepMs:0,origin:origin==='quiet'?'auto':origin};scanChanges.current=0;watch.scanNow?.({gentle});
        clearTimeout(scanGuard.current);
    // The button never stays on Scanning… for longer than this. The re-sync lock (resyncing) stays until its own save ends, so a new scan cannot start over a running one.
    scanGuard.current=setTimeout(()=>{console.info('[remote field] scan guard ended the scan',{resyncing:resyncing.current,sweeping:scanTimer.current!==undefined});clearInterval(scanTimer.current);scanTimer.current=undefined;setScanning(false);if(!gentle)setNotice('Scan did not finish. Try again.');},15000);
    scanTimer.current=setInterval(()=>{
      const swept=watch.getSnapshot?.()?.lastScanAt??-Infinity;
      if(swept>=asked-50||performance.now()-asked>=5000){clearInterval(scanTimer.current);scanTimer.current=undefined;scanMark.current.sweepMs=performance.now()-asked;resyncRef.current(true,gentle,false,origin==='quiet');
        // A card on a zone the camera only half sees cannot be checked: say so instead of leaving it on the board silently.
        // Shown after the re-sync has had time to post its own notices, so they do not overwrite it.
        const offFrame=gentle?[]:watch.getSnapshot?.()?.lastScanOffFrame??[];
        if(offFrame.length){const names=offFrame.map(fieldZoneLabel).join(', '),one=offFrame.length===1;setTimeout(()=>setNotice(`${names} ${one?'is':'are'} partly out of view, so ${one?'its card':'their cards'} cannot be checked. Move the camera or mat so ${one?'it fits':'they fit'}.`),1500);}
      }
    },40);
    return true;
  },[watch.scanNow,watch.getSnapshot,setSyncHold,syncHold,watcherError]);
  useEffect(()=>{publishFieldScan({seat,scanning,enabled:watch.enabled,loaded:watch.settingsLoaded,ready:ownsSource&&hub.cameraOn,scan:scanField,setDetection,error:watcherError});},[seat,scanning,scanField,ownsSource,hub.cameraOn,watch.enabled,watch.settingsLoaded,setDetection,watcherError]);
  useEffect(()=>()=>publishFieldScan({seat:null,scanning:false,enabled:false,ready:false}),[]);
  // What the camera and the board disagree about (a board card whose cell shows nothing, or a resting card inside a zone that no track follows),
  // once the board has been still for 3 s and the last full pass is fresh. Cards the player brought back with Undo or moved by hand do not count.
  const scanFieldRef=useRef(scanField);scanFieldRef.current=scanField;
  const readMismatch=useCallback(()=>{
    const now=performance.now(),snap=watch.getSnapshot?.();
    if(!snap||(snap.status!=='watching'&&snap.status!=='budget')||snap.lastFullAt===undefined||now-snap.lastFullAt>3000)return null;
    if(snap.lastMotionAt!==undefined&&now-snap.lastMotionAt<3000)return null;
    const missing=(snap.missingTwins??[]).filter(ref=>!undoKept.current.has(ref)&&!manual.current.has(ref)),untracked=snap.untracked??0;
    if(!missing.length&&!untracked)return null;
    return {missing:missing.length,untracked,key:`${missing.join(',')}|${untracked}|${snap.lastMotionAt??''}`};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[watch.getSnapshot]);
  // The reason shown on the Scan field button and the status chip. It shows while the mismatch lasts, never during a scan, and waits 2 s after one so
  // a stale reading does not flash it again.
  const [adviceReason,setAdviceReason]=useState<string|null>(null);
  const quietHint=useRef<string|null>(null);
  useEffect(()=>{
    const timer=setInterval(()=>{
      const now=performance.now();let next:string|null=null;
      if(!document.hidden&&live()&&scanTimer.current===undefined&&!resyncing.current&&!calibrationBusy.current&&now-scanEndedAt.current>=2000){
        const m=readMismatch();next=syncHoldRef.current?scanReason({holding:true,untracked:0,missing:0}):m?scanReason(m):quietHint.current;
      }
      setAdviceReason(before=>before===next?before:next);
    },1000);
    return()=>clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.slug,seat,readMismatch]);
  useEffect(()=>{setAdviceReason(null);},[room.slug,seat]);
  useEffect(()=>{publishScanAdvice({seat,reason:adviceReason,last:lastScan});},[seat,adviceReason,lastScan]);
  useEffect(()=>()=>clearScanAdvice(),[]);
  // Auto resync: a gentle Scan field by itself, at most every 20 s, but only when the player is idle: no card prompt or notice open, no Retry or
  // recovery banner, no attack or pending table question, no pointer button held (a drag), and never with the sync hold waiting. The same mismatch
  // with no motion in between is not scanned again. Anything else only shows the reason on the Scan field button and the status chip, and the player decides.
  const autoSeen=useRef(''),autoIdle=useRef(false),pointerHeld=useRef(false);
  useEffect(()=>{autoSeen.current='';},[room.slug,seat]);
  useEffect(()=>{
    const down=()=>{pointerHeld.current=true;},up=()=>{pointerHeld.current=false;};
    document.addEventListener('pointerdown',down,true);document.addEventListener('pointerup',up,true);document.addEventListener('pointercancel',up,true);window.addEventListener('blur',up);
    return()=>{document.removeEventListener('pointerdown',down,true);document.removeEventListener('pointerup',up,true);document.removeEventListener('pointercancel',up,true);window.removeEventListener('blur',up);};
  },[]);
  useEffect(()=>{
    const timer=setInterval(()=>{
      if(document.hidden||!live()||syncHoldRef.current||scanTimer.current!==undefined||resyncing.current||calibrationBusy.current||!autoIdle.current||pointerHeld.current)return;
      const now=performance.now();
      if(now-autoScanAt.current<20_000)return;
      const m=readMismatch();if(!m||m.key===autoSeen.current)return;
      autoSeen.current=m.key;autoScanAt.current=now;scanFieldRef.current('auto');
    },1000);
    return()=>clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.slug,seat,readMismatch]);
  // Quiet background check (on by default; kill switches in quietCheckEnabled). Not in Tap mode (watch off). Every 2 s it compares the watcher's own tracks with the board, but only in zones whose pixels moved after
  // their last confirmed read; no detector pass, no queue job. Pile zones are left to the pile watcher. It yields to any owner read (readerBusy), to any motion
  // or hand anywhere, and to everything the auto scan waits for. A gap that stays for two checks starts one gentle scan (same 20 s limit as the auto scan, and a
  // removal still waits for its normal 2 s proof); anything less sure, and every face gap, only shows the hint on Scan field.
  const quietRef=useRef<ReturnType<typeof createQuietCheck>|null>(null);
  const quietOn=quietCheckEnabled();
  useEffect(()=>{
    if(!quietOn)return;
    const quiet=createQuietCheck();quietRef.current=quiet;quietHint.current=null;
    const timer=setInterval(()=>{
      const snap=watch.getSnapshot?.();if(!snap)return;
      const now=performance.now();
      // Tap mode, a hidden tab, a stopped or restarting watcher: forget everything the check knew.
      if(document.hidden||!enabledRef.current||(snap.status!=='watching'&&snap.status!=='budget')){quiet.reset();quietHint.current=null;return;}
      const result=quiet.check({now,tracks:snap.tracks,twins:current.current.room.state.seats[seat].twin,activityAt:snap.lastFieldActivityAtByZone??{},lastFullAt:snap.lastFullAt,missing:snap.missingTwins??[],
        refOf:id=>bindings.current.get(id)??id,zoneOf:knownZone,held:ref=>undoKept.current.has(ref)||manual.current.has(ref),isPile:zone=>piles.has(zone),
        skipTrack:(t,card)=>placeholders.current.has(t.id)||!t.faceDown&&!t.cardId||card?.zone==='hand'||!!card&&recentFieldDeparture(card,serverNow())||!!card&&face.current.held(card.ref),
        // Same waits as the re-sync removal step: a departure in flight, a zone the camera only half sees, a proof that is still inside its wait.
        skipCard:card=>{const zone=knownZone(card),proofAt=zone?fieldEmptyProofs(snap)?.[zone]:undefined;return recentFieldDeparture(card,serverNow())||[...pendingDepartures.current.values()].some(({origin})=>origin.ref===card.ref)||!!zone&&!!snap.blindZones?.includes(zone)||proofAt!==undefined&&now<proofAt+DEPARTURE_WAIT_MS;},
        lastMotionAt:snap.lastMotionAt,handZones:snap.handZones,fieldActive:snap.fieldActive,scanAllowed:now-autoScanAt.current>=20_000,
        busy:!live()||readerBusy(false)||syncHoldRef.current||scanTimer.current!==undefined||resyncing.current||calibrationBusy.current||!autoIdle.current||pointerHeld.current});
      if(result.verdict!=='wait')quietHint.current=result.verdict==='hint'?result.reason??null:null;
      if(result.verdict==='fix'&&now-autoScanAt.current>=20_000&&scanFieldRef.current('quiet')){autoScanAt.current=now;quiet.scanned();quietHint.current=null;}
    },2000);
    return()=>{clearInterval(timer);quietHint.current=null;quietRef.current=null;};
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.slug,seat,quietOn]);
  // A new calibration or a baseline reset clears the pixel activity the ledger compares with: start the check over.
  useEffect(()=>{quietRef.current?.reset();quietHint.current=null;},[watch.calibration,watch.calibrationNeeded,lockKey]);
  // Rescan from another seat: run my own gentle Scan field on my full-resolution camera and the normal placement flow. It never ends my sync hold,
  // and waits while calibration is open (open prompts do not pause it). The answer says what happened: started, off (Auto-detect is not watching), busy or paused.
  const rescanRef=useRef<(from:number)=>RescanReply>(()=>'off');
  rescanRef.current=from=>{
    if(!current.current.active||!watch.enabled)return 'off';
    if(tournament||document.hidden||!live()||syncHoldRef.current||calibrationBusy.current)return 'paused';
    if(scanTimer.current!==undefined||resyncing.current||!scanFieldRef.current('remote'))return 'busy';
    const who=room.seats.find(item=>item.seat===from)?.displayName??`Seat ${from+1}`;
    setNotice(`Rescan requested by ${who}`);
    return 'started';
  };
  const {setRescanHandler}=hub;
  useEffect(()=>{setRescanHandler(from=>rescanRef.current(from));return()=>setRescanHandler(null);},[setRescanHandler]);
  // Debug overlay (own feed): raw detector boxes, track states and the last decision per track.
  useEffect(()=>{if(!fieldDebugEnabled())return;const m=watch.snapshot.metrics,boardTwin=current.current.room.state.seats[seat].twin;publishFieldDebug({faces:Object.fromEntries(watch.snapshot.tracks.flatMap(t=>{const card=t.state==='identified'&&!t.removed?boardTwin.find(c=>c.ref===(bindings.current.get(t.id)??t.id)&&publicField(c.zone)):undefined;return card&&card.faceUp===t.faceDown?[[t.id,`board: ${card.faceUp?'up':'down'} · track: ${t.faceDown?'down':'up'}`]]:[];})),blur:watch.snapshot.blur,shadow:watch.snapshot.shadow,debug:watch.snapshot.debug,tracks:watch.snapshot.tracks,status:watch.snapshot.status,error:watch.snapshot.error,detectorMs:m.detectorMs,priorityPassMs:m.priorityPassMs,zoomMs:m.zoomMs,dutyPercent:m.dutyPercent,intervalMs:m.intervalMs,writeError:lastWriteError.current,backend:debugBackend(),gate:{live:live(),enabled:watch.enabled,syncHold,calibrationNeeded:watch.calibrationNeeded,deferred:heldPlaced.current.deferred,dropped:heldPlaced.current.dropped},gridShift:watch.snapshot.gridShift});},[watch.snapshot,syncHold]);
  useEffect(()=>()=>publishFieldDebug(null),[]);
  useEffect(()=>{const timer=setInterval(()=>hub.publishFieldTracks(lastMessage.current),1000);return()=>clearInterval(timer);},[hub.publishFieldTracks]);
  useEffect(()=>()=>hub.publishFieldTracks({type:'field.tracks',cards:[]}),[hub.publishFieldTracks]);
  useEffect(()=>{for(const [id,away] of tokenAway.current)if(!tokenInCell(room.state.seats[seat].twin,away.cell))tokenAway.current.delete(id);},[room.state.seats,seat]);
  useEffect(()=>{if(!tokenPrompt)return;if(!room.state.seats[seat].twin.some(c=>c.ref===tokenPrompt.token.ref)||!watch.getTrack(tokenPrompt.event.track.id)||watch.isRemoved(tokenPrompt.event.track.id))setTokenPrompt(null);},[room.state.seats,tokenPrompt,seat,watch]);
  useEffect(()=>{
    for(const id of proxyMarkers.current){
      const track=watch.getTrack(id);
      if(!track||track.removed)proxyBlockedTracks.current.delete(id);
      if(!track||track.removed||!isProxyMarker(track))proxyMarkers.current.delete(id);
    }
    if(!proxyClashes.length)return;
    const active=proxyClashes.filter(({event,zone,proxy})=>{
      const track=trackForChoice(event);
      return live()&&track&&!track.removed&&track.zone===event.track.zone&&(track.revision??0)===(event.track.revision??0)&&proxyAt(zone)?.proxy.ref===proxy.ref;
    });
    if(active.length!==proxyClashes.length)setProxyClashes(active);
  });
  // A new notice never kicks out an Undo notice that still has time: it moves down the stack and keeps its Undo and its time left.
  // This runs before the timer effect below, after its cleanup has counted the time left.
  useEffect(()=>{
    const prev=shownNotice.current;shownNotice.current=notice?{text:notice,undoId}:null;
    if(!prev?.undoId||prev.undoId===undoId||settledUndo.current.has(prev.undoId))return;
    // A newer action took this one back in its chain: its own Undo would be refused, so only the newer one stays.
    for(const link of undoChain.current.values())if(link.ids.includes(prev.undoId))return;
    const left=noticeLeft.current;if(left<=0)return;
    setKept(list=>[{key:prev.undoId,text:prev.text,undoId:prev.undoId,left},...list.filter(item=>item.key!==prev.undoId)].slice(0,NOTICE_STACK-1));
  },[notice,undoId]);
  // The timer stops while the pointer or the keyboard is on a notice, and an Undo notice stays longer. After a hold it goes on with the time left.
  useEffect(()=>{
    if(!notice)return;
    const key=`${notice}\u0000${undoId}`;if(noticeKey.current!==key){noticeKey.current=key;noticeLeft.current=undoId?UNDO_NOTICE_MS:NOTICE_MS;}
    if(noticeHeld)return;
    const started=Date.now(),timer=setTimeout(()=>{noticeLeft.current=-1;setNotice('');setDeparture(null);setUndoId('');},noticeLeft.current);
    return()=>{clearTimeout(timer);if(noticeLeft.current>=0)noticeLeft.current=Math.max(1500,noticeLeft.current-(Date.now()-started));};
  },[notice,undoId,noticeHeld]);
  useEffect(()=>{if(!kept.length||noticeHeld)return;const timer=setInterval(()=>setKept(list=>list.map(item=>({...item,left:item.left-500})).filter(item=>item.left>0)),500);return()=>clearInterval(timer);},[kept.length,noticeHeld]);
  const glareTracks=watch.enabled&&!syncHold?watch.snapshot.tracks.filter(track=>track.glare&&!isProxyMarker(track)):[];
  const shownGlare=useRef(new Set<string>());
  useEffect(()=>{shownGlare.current.clear();undoChain.current.clear();},[room.slug]);
  useEffect(()=>{
    if(notice||failedUpdate||recovery||leaveChoice||shiftHint||tokenPrompt||proxyPrompt||rowPrompts.length||heldPick||calibrating)return;
    const track=glareTracks.find(track=>!shownGlare.current.has(track.id)&&watch.getTrack(track.id)?.glare);
    if(!track)return;
    shownGlare.current.add(track.id);
    setUndoId('');setNotice(`Glare on ${track.zone}: tilt the card or move the light`);
  },[glareTracks,notice,failedUpdate,recovery,leaveChoice,shiftHint,tokenPrompt,proxyPrompt,rowPrompts.length,heldPick,calibrating,watch.getTrack]);
  const activePrompts=prompts.filter(event=>{
    const track=watch.getTrack(event.track.id)??(!watch.enabled&&observedPile(event.track.zone)?event.track:undefined);
    return track?.state==='prompt'&&(track.revision??0)===(event.track.revision??0)&&!reviewing(event)&&!isProxyMarker(track)&&!proxyAt(track.zone)&&
      !correctionsFor(current.current.room,seat).blocks([bindings.current.get(track.id)??track.id],fieldZoneLocation(track.zone));
  });
  if(glareTracks.length){
    const registered=new Set(registeredDeckPasscodes(room,seat));
    for(const track of glareTracks){
      const live=watch.getTrack(track.id);
      if(!live?.glare||live.revision!==track.revision||(!live.visible&&live.state!=='candidate'))continue;
      if(correctionsFor(current.current.room,seat).blocks([bindings.current.get(track.id)??track.id],fieldZoneLocation(track.zone)))continue;
      const index=activePrompts.findIndex(event=>event.track.id===track.id),existing=activePrompts[index];
      const scored=live.glare.candidates.length?live.glare.candidates:fieldGlareChoices(existing?.result);
      const choices=scored.filter(candidate=>{const code=catalogCardId(entries.current.get(candidate.cardId));return code!==undefined&&registered.has(code);});
      if(!choices.length)continue;
      const prompt:FieldEvent={...(existing??{type:'prompt',source:'auto',reason:'uncertain'}),track:{...live,glare:{...live.glare,candidates:choices}}};
      if(existing)activePrompts[index]=prompt;else activePrompts.push(prompt);
    }
  }
  const extraIds=current.current.room.seats.find(s=>s.seat===seat)?.deck?.deck.extra??[];
  const promptMaterials=(event:FieldEvent)=>stackUnder(event.track.id).flatMap(ref=>{const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);return card?[card]:[];});
  const promptInfo=useCardInfo(activePrompts.flatMap(event=>[
    ...(event.track.glare?.candidates??event.result?.candidates??[]).map(candidate=>{const entry=entries.current.get(candidate.cardId);return entry?catalogCardId(entry):undefined;}),
    ...(promptMaterials(event).length>=2?[...extraIds,...promptMaterials(event).map(cardCode)]:[]),
  ]));
  const promptViews=activePrompts.filter(event=>{
    const at=fieldZoneLocation(event.track.zone);
    if(changes.includes(event.track.zone))return false;
    if(watch.getTrack(event.track.id)?.restSince===undefined)return true;
    return !current.current.room.state.seats[seat].twin.some(c=>c.zone===at.zone&&c.slot===at.slot&&publicField(c.zone)&&(cardCode(c)||!c.faceUp||c.token));
  }).map(event=>{
    const observed=watch.getTrack(event.track.id)??event.track,twins=current.current.room.state.seats[seat].twin;
    const pile=observedPile(observed.zone);
    if(pile){
      const entry=pileGuess(event),cardId=catalogCardId(entry);
      const source=entry?pilePromptSource(event,observed,entry,current.current.room.state.seats[seat]):undefined;
      return {id:observed.id,revision:event.track.revision,zone:observed.zone,quad:observed.card.quad,candidates:[],
        pile:{zone:pile,guess:entry&&cardId?{cardId,name:entry.name,from:source?.label}:undefined}};
    }
    if(event.reason==='card-presence')return {id:event.track.id,revision:event.track.revision,zone:observed.zone,title:'Card here?',presence:true,quad:observed.card.quad,candidates:[{id:'face-down',label:'Set card'}]};
    // Cards that fit the observed zone come first; others stay available (a monster can be an Equip Card).
    const fits=(cardId:string)=>{const entry=entries.current.get(cardId);return fieldCandidateFitsZone(observed.zone,entry?promptInfo(catalogCardId(entry)):undefined);};
    const glare=event.track.glare?.candidates;
    const prior=glare?[]:fieldStackXyzCandidates({materials:promptMaterials(event),extra:extraIds,facts:promptInfo}).flatMap(id=>{const entry=[...entries.current.values()].find(entry=>catalogCardId(entry)===id);return entry?[{cardId:entry.cardId}]:[];});
    const ranked=[...prior,...(event.result?.candidates??[])].filter((candidate,index,all)=>all.findIndex(c=>c.cardId===candidate.cardId)===index);
    const choices=observed.faceDown?[{cardId:'face-down'}]:glare??ranked.sort((a,b)=>Number(prior.some(c=>c.cardId===b.cardId))-Number(prior.some(c=>c.cardId===a.cardId))||Number(fits(b.cardId))-Number(fits(a.cardId))).slice(0,5);
    return {id:event.track.id,revision:event.track.revision,zone:observed.zone,title:prior.length?'Xyz Monster on this stack?':event.reason==='changed'?'Card changed?':'New card?',quad:observed.card.quad,
      candidates:choices.map(candidate=>{
        const entry=entries.current.get(candidate.cardId),track={...observed,id:bindings.current.get(event.track.id)??event.track.id,cardId:candidate.cardId};
        const resolved=resolveExisting(event,track,entry,twins);
        const projected=projectFieldZone({zone:observed.zone,facts:entry?promptInfo(catalogCardId(entry)):undefined,twins,ref:resolved.existing?.ref,faceDown:observed.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        return {id:candidate.cardId,label:`${observed.faceDown?'Confirm face-down card':entry?.name??candidate.cardId} · ${resolved.blocked?'Another physical card owns this ref':projected.zone?`To ${projected.label}`:projected.reason}`,disabled:resolved.blocked||!projected.zone};
      })};
  });
  function acceptPilePrompt(id:string,{cardId,name}:{cardId:number;name:string}) {
    const event=activePrompts.find(p=>p.track.id===id),zone=event&&observedPile(event.track.zone);
    if(!event||!zone||reviewing(event))return;
    const card={cardId,name};
    const entry=[...entries.current.values()].find(item=>catalogCardId(item)===card.cardId)??{...card,cardId:String(card.cardId),passcode:card.cardId};
    setPending(true);
    void transaction(async (latest,post)=>{
      const player=latest.state.seats[seat];
      if(latest.status!=='active'||latest.state.ended||player.eliminated)return;
      const track=watch.enabled?watch.getTrack(id):event.track;
      if(!track||track.state!=='prompt'||(track.revision??0)!==(event.track.revision??0)||observedPile(track.zone)!==zone){
        setNotice('The card changed. Check the pile again.');return;
      }
      const source=pilePromptSource(event,track,entry,player),boundRef=bindings.current.get(id)??id;
      const bound=player.twin.find(twin=>twin.ref===boundRef&&twin.zone===zone);
      const unnamed=bound&&!cardCode(bound)&&!bound.name?bound:undefined;
      const act:RoomMutation=(proposal,key)=>post({...proposal,cam:playerStamp('pile-choice')},key??crypto.randomUUID());
      let ref=source?.ref??(unnamed&&!source?unnamed.ref:bound&&sameObservedCard(bound,card)?bound.ref:crypto.randomUUID());
      let updated:RemoteRoom|null=latest;
      if(source?.ref)updated=await act({type:'twin.move',actorSeat:seat,seat,cardRef:ref,zone,faceUp:true,confirmed:true});
      else if(unnamed&&!source)updated=await act({type:'card.identified',actorSeat:seat,seat,cardRef:ref,...card,source:'typed'});
      else if(ref!==bound?.ref){
        updated=await act({type:'twin.place',actorSeat:seat,seat,zone,anotherCopy:true,card:{...card,ref,faceUp:true,position:'attack'}});
        if(updated)ref=placedTwin(updated.state.seats[seat].twin,{...card,ref,zone})?.ref??ref;
      }
      if(!updated)return;
      let trackId=id;
      if(unnamed&&ref!==unnamed.ref){
        const adopted=await adoptPileCard(act,{twin:unnamed,zone,faceUp:true},ref,updated.state.undo?.actionId??'');
        if(adopted){updated=adopted.state;trackId=watch.getTrack(id)?id:ref;}
      }
      bindings.current.set(id,ref);watch.confirm(trackId,entry.cardId,ref,true);
      setPrompts(prompts=>prompts.filter(prompt=>prompt.track.id!==id));
      if(updated!==latest){setNotice(`${card.name} → ${zone==='graveyard'?'GY':'Banished'}`);setUndoId(updated.state.undo?.actionId??'');}
    }).catch(error=>setNotice(error instanceof Error?error.message:'Could not update the pile.')).finally(()=>setPending(false));
  }
  const st=room.state;
  const incomingId=proxyPrompt?.event.track.cardId;
  const proxyFacts=incomingId?cardInfo(catalogCardId(entries.current.get(incomingId))??Number(incomingId)):undefined;
  const peerTwins=st.seats[facingSeat(seat,st.seats.length)??-1]?.twin;
  const proxyOptions=proxyPrompt?freeFieldZones(st.seats[seat].twin,proxyFacts,proxyPrompt.event.track.faceDown,gridFormat)
    .filter(zone=>{
      const land=fieldZoneLocation(zone);
      return !proxyAt(zone)&&!(land.zone==='extra-monster'&&land.slot&&peerTwins?.some(card=>card.zone===land.zone&&card.slot===mirrorEmz(land.slot!)))&&
        !watch.getTracks().some(track=>track.id!==proxyPrompt.event.track.id&&track.visible&&!track.removed&&track.zone===zone);
    }):[];
  autoIdle.current=!promptViews.length&&!notice&&!failedUpdate&&!recovery&&!leaveChoice&&!shiftHint&&!tokenPrompt&&!proxyPrompt&&!rowPrompts.length&&!heldPick&&!calibrating&&!st.attack&&!st.twinConfirmation&&!(st.twinConfirmationQueue?.length);
  // What waits for the player must never be silent: the chip says it, and a click opens the Card notices dock (or resumes a sync hold).
  const waiting=syncHold?0:promptViews.length+proxyClashes.length,scanAdvice=watch.enabled&&!syncHold&&!waiting&&!scanning&&!watch.calibrationNeeded&&!watch.aspectChanged&&!watcherError?adviceReason:null,attention=waiting>0||watch.enabled&&(syncHold||!!scanAdvice);
  const label=waiting>0?`${waiting} card${waiting===1?'':'s'} need${waiting===1?'s':''} you`:!watch.enabled?'Tap to identify':syncHold?'Auto-detect paused · sync board':watch.aspectChanged?'Camera shape changed · Calibrate zones':scanning&&!syncHold?'Scanning field…':scanAdvice?`${scanAdvice} · Scan field`:watch.calibrationNeeded?(watch.calibration?.orientation?'Calibrate your zones · auto-placement paused':'Choose your side · auto-placement paused'):watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watcherError?'Reader off':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  // Only the "Identify card" prompt needs text injected; the plain "Reading…" card is drawn by the board itself.
  const readingStyles=room.state.seats.flatMap((player,index)=>player.twin.flatMap(card=>{
    if(index!==seat||!card.ref.startsWith('fw-')||cardCode(card)||!card.faceUp||!publicField(card.zone))return [];
    if(!activePrompts.some(p=>(bindings.current.get(p.track.id)??p.track.id)===card.ref))return [];
    const zone=card.zone==='monster'?`m${card.slot??1}`:card.zone==='spell-trap'?`s${card.slot??1}`:card.zone==='extra-monster'?`emz${card.slot??1}`:'f';
    const selector=`[data-testid="field-${index}"] [data-zone="${zone}"]`;
    return [`${selector}>div:first-child{animation:none;background:linear-gradient(110deg,#233c3b 20%,#507b70 45%,#233c3b 70%)}${selector}>div:first-child>span{font-size:0}${selector}>div:first-child>span::after{content:"Identify card";font-size:10px;color:#e5f5ef}`];
  })).join('');
  /** Undo from a notice: the one on screen, or an older one kept in the stack. It ends with the card changes of that notice only. */
  const undoNotice=(id:string)=>{const isCurrent=id===undoId;void queueHuman('undo',async act=>{
    clipAction('undo',{actionId:id});const departed=isCurrent?departureRef.current?.ref:undefined,link=undoChain.current.get(id),chain=link?.ids??[];undoChain.current.delete(id);
    try{
      let updated=await act({type:'undo',actorSeat:seat,targetActionId:id});for(const next of chain)if(updated)updated=await act({type:'undo',actorSeat:seat,targetActionId:next})??updated;
      if(updated){settledUndo.current.add(id);if(link?.rebind){bindings.current.set(link.rebind.trackId,link.rebind.ref);watch.confirm(watch.getTrack(link.rebind.trackId)?link.rebind.trackId:link.rebind.adoptedRef,undefined,link.rebind.ref,false);readerRemovals.current.delete(link.rebind.ref);}if(departed&&updated.state.seats[seat].twin.some(card=>card.ref===departed&&publicField(card.zone)))watch.dismiss(departed);if(isCurrent){setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}else setKept(list=>list.map(item=>item.key===id?{...item,text:'Automatic field change undone',undoId:'',left:2500}:item));}
    }catch(error){
      // An older notice that cannot be undone any more says why in its own place, and does not replace the notice on top or ask for a retry.
      if(isCurrent||!(error instanceof RemoteDuelError))throw error;
      setKept(list=>list.map(item=>item.key===id?{...item,text:error.message,undoId:'',left:2500}:item));
    }
  });};
  /** The Undo button shows while the table still holds that action as undoable; a newer action elsewhere does not take it away. */
  const undoOk=(id:string)=>{const history=room.state.undoHistory;return history?history.some(entry=>entry.actionId===id&&!entry.undone&&!entry.reason):room.state.undo?.actionId===id;};
  return <>
    <style>{readingStyles}</style>
    <FieldWatcherUI keepUnresolved zoneSeat={seat} changes={syncHold?[]:changes} onChanged={zone=>requestManualZone({seat,zone,actions:true})} onWrong={id=>{const event=activePrompts.find(p=>p.track.id===id);if(event)requestManualZone({seat,zone:event.track.zone,ref:bindings.current.get(id)??event.bindRef??id,faceDown:event.track.faceDown});}} onNotACard={id=>{
      const event=activePrompts.find(p=>p.track.id===id);if(!event)return;
      const ref=bindings.current.get(id)??event.bindRef??id;
      const pile=observedPile(event.track.zone);
      if(pile){
        watch.notACard(id,event.track.zone,event.track.card.quad);
        setPrompts(list=>list.filter(p=>p.track.id!==id));
        void transaction(async (latest,act)=>{
          const card=latest.state.seats[seat].twin.find(c=>c.ref===ref&&c.zone===pile);
          if(card&&pileWrites.current.has(ref)&&(!cardCode(card)&&!card.name||ref===id))
            await act({type:'twin.remove',actorSeat:seat,seat,cardRef:ref,cam:playerStamp('not-a-card')});
        }).catch(error=>setNotice(error instanceof Error?error.message:'Could not remove the card.'));
        return;
      }
      correctionsFor(current.current.room,seat).begin(ref,[fieldZoneLocation(event.track.zone)]);
      watch.notACard(id);restingReads.current.delete(id);publishReadings();setPrompts(list=>list.filter(p=>p.track.id!==id));
      void queueHuman('not-a-card',async act=>{const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);if(card&&!card.token&&publicField(card.zone))await act({type:'twin.remove',actorSeat:seat,seat,cardRef:ref});});
    }} dock={dock} host={host} enabled={watch.enabled} onEnabledChange={setDetection} statusLabel={label} attention={attention} onStatusAction={attention?()=>{if(syncHold||scanAdvice)scanField();else window.dispatchEvent(new CustomEvent(NOTIFY_OPEN_EVENT,{detail:{seat}}));}:undefined} statusExtra={<><RecognitionBadge phoneCamera={hub.phones.some(p=>p.seat===seat)}/>{recording?<RecordingBadge/>:null}</>} statusTitle={!watch.enabled?'Auto-detect is off. Click a card in any camera to read it. The board does not follow the cards.':watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%`} calibrated={watch.placed} calibrationDisabled={!video?.videoWidth} onCalibrate={()=>setCalibrating(true)} pending={pending}
      prompts={syncHold?[]:promptViews} pileDeck={deckIdsOf(room,seat)} onPileChoose={acceptPilePrompt} onPileOpen={onOpenPile}
      onChoose={(id,cardId)=>{
        console.info('[remote field] candidate click',id,cardId);
        const event=activePrompts.find(p=>p.track.id===id),track=watch.getTrack(id);
        if(!event||!track){console.error('[remote field] expired candidate prompt',id);setNotice('Card prompt expired. Keep the card still for a fresh read.');return;}
        if(event.reason==='card-presence'&&!watch.acceptSet(id)){setNotice('Keep the card still, then choose again.');return;}
        const glare=event.track.glare;
        const selection=glare?{...event,track:{...event.track,glare:{...glare,candidates:glare.candidates.filter(c=>c.cardId===cardId)}}}:{...event,track:watch.getTrack(id)??track};
        setFailedUpdate(null);setPending(true);
        const chosen=cardId==='face-down'?undefined:cardId;
        const save=()=>queue(act=>apply(selection,act,chosen),selection,!!chosen||event.reason==='card-presence');
        const waiting=chosen?fieldFacts(selection,chosen):undefined;
        void (waiting?waiting.then(save):save()).finally(()=>setPending(false));
      }}
      onDismiss={id=>{
        const presence=activePrompts.find(p=>p.track.id===id&&p.reason==='card-presence');
        if(presence){correctionsFor(current.current.room,seat).begin(bindings.current.get(id)??presence.bindRef??id,[fieldZoneLocation(presence.track.zone)]);watch.notACard(id);}else watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));
        void queueHuman(presence?'not-a-card':'dismiss',async act=>{
          if(!await removePlaceholder(id,act)||!presence)return;
          const ref=bindings.current.get(id)??presence.bindRef??id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
          if(card&&!card.token&&publicField(card.zone))await act({type:'twin.remove',actorSeat:seat,seat,cardRef:ref});
        });
      }}
      noticeTestId={departure?'field-departure-toast':undefined} onNoticeHold={setNoticeHeld} kept={kept.filter(item=>!item.undoId||undoOk(item.undoId)).map(item=>({key:item.key,node:<>{item.text}{item.undoId?<button type="button" onClick={()=>undoNotice(item.undoId)}>Undo</button>:null}</>}))}
      notice={tokenPrompt?.choosing?<span data-testid="token-clash-zones">Which zone is the card in?
        {freeFieldZones(room.state.seats[seat].twin,tokenPrompt.facts,tokenPrompt.event.track.faceDown).map(zone=><button type="button" key={zone} disabled={pending} data-testid={`token-clash-zone-${zone}`} onClick={()=>{const {event,zone:cell}=tokenPrompt;setTokenPrompt(null);tokenAway.current.set(event.track.id,{cell,zone});void queue(act=>apply(event,act),event);}}>{zone}</button>)}
        <button type="button" onClick={()=>setTokenPrompt({...tokenPrompt,choosing:false})}>Back</button></span>:tokenPrompt?<span data-testid="token-clash">A token is in {tokenPrompt.zone}. Tribute/remove the token and place {tokenPrompt.name} here?
        <button type="button" disabled={pending} onClick={()=>{const {event,token}=tokenPrompt;setTokenPrompt(null);tokenUndo.current=undefined;void queueHuman('token',async act=>{const removed=await act({type:'twin.remove',actorSeat:seat,seat,cardRef:token.ref});const actionId=removed?.state.undo?.actionId;if(!removed||!actionId)return;correctionsFor(current.current.room,seat).release(token.ref);tokenUndo.current={trackId:event.track.id,actionId};setNotice('Token removed · Undo');setUndoId(actionId);},event).then(()=>queue(act=>apply(event,act),event));}} data-testid="token-clash-remove">Remove token</button>
        <button type="button" onClick={()=>setTokenPrompt({...tokenPrompt,choosing:true})} data-testid="token-clash-other">Choose another zone</button></span>:rowPrompts[0]?<span data-testid="monster-in-st">{rowPrompts[0].name} is a monster in {rowZone}.
        <button type="button" disabled={pending} data-testid="monster-in-st-move" onClick={()=>moveFromSpellTrap(rowPrompts[0])}>Move to {rowTarget??'a Monster Zone'}</button>
        <button type="button" data-testid="monster-in-st-keep" onClick={()=>{const first=rowPrompts[0];rowKept.current.add(first.ref);setRowPrompts(list=>list.filter(p=>p.ref!==first.ref));}}>Keep (equipped or placed by a card)</button></span>:failedUpdate?<>{notice||'Could not save the field update.'}<button type="button" disabled={pending} onClick={()=>void queue(failedUpdate.work,failedUpdate.event,failedUpdate.humanChoice)}>Retry field update</button></>:recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:leaveChoice?<span data-testid="leave-choice">The camera saw a card {leaveChoice.zone==='banished'?`banished${leaveChoice.faceUp?'':' face-down'}`:'in the Graveyard'}. Which card was it?{leaveChoice.options.map(o=><button type="button" key={o.ref} disabled={pending} onClick={()=>chooseLate(o.ref)}>{o.name}</button>)}<button type="button" onClick={()=>{choiceClosed.current.add(leaveChoice.twinRef);setLeaveChoice(null);}}>Neither</button></span>:syncHold?<span data-testid="sync-board-hold">Auto-detect is on. The board keeps its cards until you sync it.<button type="button" onClick={()=>{scanField();}}>Sync board to camera</button></span>:shiftHint?<span data-testid="zone-shift-hint">Zones look shifted — Recalibrate?<button type="button" onClick={()=>{setShiftHint(false);setCalibrating(true);}}>Recalibrate</button><button type="button" onClick={()=>setShiftHint(false)}>Dismiss</button></span>:notice?<>{departure?<span data-notice-line>{notice}</span>:notice}{departure?<span data-leave-tags>{departure.zone!=='pending'?` → ${fieldLeaveLabel(departure.zone,!departure.down)}`:null} {attachTargets.map(t=><button type="button" key={`attach-${t.ref}`} disabled={pending} onClick={()=>attachTo(t)}>Attach to {t.name}</button>)}{(departure.pile?handFirst:destinations).map(d=><button type="button" key={d.title} disabled={pending||(departure.zone==='pending'&&d.zone===departure.pile)||d.zone===departure.zone&&(d.zone!=='banished'||('down' in d)===!!departure.down)} onClick={()=>redirect(d.zone,'down' in d)}>{d.title}</button>)}</span>:null}
        {departure?.zone==='pending'&&!departure.pile?<button type="button" disabled={pending} onClick={()=>redirect('hand')}>Retry removal</button>:null}
        {undoId&&undoOk(undoId)?<button type="button" onClick={()=>undoNotice(undoId)}>Undo</button>:null}</>:proxyPrompt?<span data-testid="proxy-clash">
        {proxyClashLabel(proxyAt(proxyPrompt.zone)?.proxy??proxyPrompt.proxy)}
        {proxyOptions.length?<span> Free zones: {proxyOptions.join(', ')}.</span>:null}
        {proxyPrompt.holder===seat||proxyPrompt.proxy.ownerSeat===seat?<button type="button" disabled={pending} onClick={()=>replaceProxy(proxyPrompt)}>Remove proxy and place here</button>:null}
        <button type="button" disabled={pending} onClick={()=>leaveProxyMarker(proxyPrompt.event.track.id)}>Leave it (marker)</button>
      </span>:heldPick?<span data-testid="held-pick">Which card did you hold up?
        {heldPick.options.map(o=><button type="button" key={o.cardId} disabled={pending} data-testid="held-pick-card" onClick={()=>{const pick=heldPick;setHeldPick(null);void queueHuman('held-pick',act=>commitHeld(act,o.cardId,o.name,`${pick.id}-pick`,performance.now(),`${pick.id}-pick`));}}>{o.name}</button>)}
        <button type="button" data-testid="held-pick-none" onClick={()=>setHeldPick(null)}>Not an activation</button></span>:tapOffer?<span data-testid="tap-identify-offer">{tournament?'This computer is slow for live tracking. Switch to tap-to-identify? Your opponent will see the switch.':'This computer is slow for live tracking. Switch to tap-to-identify?'}<button type="button" onClick={()=>answerTapOffer('switch')}>Switch</button><button type="button" onClick={()=>answerTapOffer('keep')}>Keep</button></span>:videoOfferShowing?<span data-testid="video-fps-offer">Your computer is struggling with video. Switch to 15 fps to reduce lag?<button type="button" onClick={()=>answerVideoOffer(15)}>Switch</button><button type="button" onClick={()=>answerVideoOffer(30)}>Keep</button></span>:lightHintShowing?<span data-testid="low-light-hint">Camera is slow — add light or turn off auto exposure<button type="button" onClick={()=>setLightHint(false)}>Dismiss</button></span>:softHintShowing?<span data-testid="soft-camera-hint">Camera is out of focus — tap to focus or move closer<button type="button" onClick={()=>setSoftDismissed(true)}>Dismiss</button></span>:undefined}/>
    {calibrating?<FieldCalibrationControl defaultSide={defaultSideFor(phone?'phone':'webcam')} video={video} initialCalibration={watch.calibration} placed={watch.placed} format={room.format?.id??room.state.deckChecks.format.id} detectCalibrationCards={async frame=>{const result=await detectCards(await createImageBitmap(frame));if(result.status!=='ready')throw new Error(result.note);return result.cards;}} onSave={grid=>{updateCalibration(grid,true);setCalibrating(false);}} onCancel={()=>{if(watch.calibrationNeeded&&!watch.calibration?.orientation)setDetection(false);setCalibrating(false);}}/>:null}
  </>;
}

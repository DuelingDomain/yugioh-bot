"use client";
import { recognitionPriorsFor } from "@/lib/remote/recognition-priors";

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {catalogCardId,fieldZoneLocation,yugioh,type HeldCardEvent,type FieldEvent,type FieldTrack,type FieldZone,type KnownFieldCard,type FieldCalibration,fieldPacerDevice} from '@yugidraft/vision';
import {markVideoOfferShown,readVideoChoice,VIDEO_OFFER_MS,videoOfferShown} from '@/lib/remote/video-rate';
import {createSlowWatch,isWeakDevice,markTapOfferShown,readTapChoice,saveTapChoice,tapOfferShown,TAP_OFFER_MS,type TapChoice} from '@/lib/remote/tap-offer';
import {remoteHandReadDecision,REMOTE_HAND_SUGGESTION_EVENT,recentFieldDeparture,type RemoteRoom,type RemoteSummonKind,type TwinCard} from '@yugidraft/shared/remote';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {applyFieldFaceFlip,fieldFaceProposal,fieldStrongBack,fieldTwinPosition,fieldDepartureProposal,fieldDepartureStillMissing,heldFieldReadPending,fieldPlacementProposals,fieldEvidenceMatches,simultaneousFieldCopies,applyVerifiedFieldMutation,StaleFieldPlacementError,observedFieldZone,staleFieldOccupant,retryFieldMutation} from '@/lib/remote/field-proposals';
import {createFieldFaceCheck,type FieldFaceFix} from '@/lib/remote/field-face';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {onManualMove} from '@/lib/remote/manual-moves';
import {projectFieldZone,fieldCandidateFitsZone,hardFieldZone,zoneMoveLabel,equipSourceOnField,becomesTrapMonster} from '@/lib/remote/field-legality';
import {bindFieldTiming,markFieldTiming,bindBackTiming} from '@/lib/remote/field-timing';
import {saveLocalFieldDiagnostic} from '@/lib/remote/field-diagnostics';
import {ownFieldResources,detectCards,prepareOwnReader} from './ui/recognizer';
import {RecognitionBadge} from './ui/recognition-setting';
import {useRecognitionBackend,gpuLossReason} from './ui/recognition-backend';
import {useVideoHub} from './ui/video-hub';
import {cardCode,sameObservedCard,deckIdsOf,placedTwin} from './ui/model';
import {FieldCalibrationControl} from './field-calibration';
import {publishZoneGrid,clearZoneGrid,defaultSideFor,fieldDebugEnabled,publishFieldDebug,publishMissingPiles,publishFieldScan} from '@/lib/remote/zone-grid';
import {nextFieldGhosts,setFieldGhosts,blockGhostCell,newGhostState} from '@/lib/remote/field-ghosts';
import {FieldWatcherUI} from './field-watcher-ui';
import {serverNow} from './ui/api';
import {cardInfo,loadCards,useCardInfo} from './ui/catalog';
import {fieldSummonKind,fieldSummonMaterials,fieldSummonMinimum,fieldSummonNotice,heldStackStillStacked,SUMMON_WINDOW_MS,type FieldVanish} from '@/lib/remote/field-summons';
import {distinctFieldQuads} from '@/lib/remote/field-proposals';

const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
/** A removed field card goes to the hand this long after the watcher's removal (it may still flip back or be a material). */
const DEPARTURE_WAIT_MS=800;
const publicField=(zone:string)=>['monster','extra-monster','spell-trap','field','pendulum'].includes(zone);
const sameFieldSlot=(a:TwinCard,b:TwinCard)=>publicField(a.zone)&&a.zone===b.zone&&(a.zone==='field'||(a.slot!==undefined&&a.slot===b.slot));
const piles=new Set<FieldZone>(['GY','BANISHED','DECK','EXTRA']);
const physicalZonePattern=/^(?:M[1-5]|S[1-5]|EMZ[12]|FIELD)$/;
/** A hand over the GY/banished pile counts as exit evidence for a card that shows on the field up to 10 s later. */
const PILE_EXIT_MS=10_000;
/** An Equip effect on this field makes a monster in a Spell & Trap Zone plausible (an Equip Card). */
const equipSourceOn=(twins:readonly TwinCard[])=>equipSourceOnField(twins,c=>cardInfo(cardCode(c)));
function readPhysicalZones(key:string):Map<string,FieldZone> {
  try {
    const value=JSON.parse(sessionStorage.getItem(key)??'{}');
    if(value&&typeof value==='object'&&!Array.isArray(value))return new Map(Object.entries(value).filter((pair):pair is [string,FieldZone]=>typeof pair[1]==='string'&&physicalZonePattern.test(pair[1])));
  }catch{/* Storage is optional; current-camera reservations still work in memory. */}
  return new Map();
}
type Entry={cardId:string;passcode:number;name:string};
type Departure={ref:string;name:string;zone:string};
const destinations=[['graveyard','GY'],['banished','Banish'],['hand','Hand'],['deck','Deck'],['extra','Extra Deck']] as const;
/** Owner evidence, table mutations and UI remain isolated from the feed reader. */
export function AutoFieldWatcher({room,transaction,diagnosticsAllowed=false,dock}:{room:RemoteRoom;transaction:RoomTransaction;diagnosticsAllowed?:boolean;dock?:HTMLElement|null}) {
  const hub=useVideoHub(),seat=room.mySeat,source=hub.sourceFor(seat);
  const phone=hub.phones.find(p=>p.seat===seat&&p.paired);
  const ownsSource=!!source&&(source.local||!!phone&&phone.mode!=='scan');
  const cameraKey=phone?`phone:${phone.id}`:hub.cameraId;
  const current=useRef({room,active:false});
  if(current.current.room.slug!==room.slug||room.lastSeq>=current.current.room.lastSeq)current.current.room=room;
  current.current.active=ownsSource&&hub.cameraOn;
  const deckKey=deckIdsOf(room,seat).join(',');
  useEffect(()=>{
    if(!ownsSource||!hub.cameraOn)return;
    void prepareOwnReader(recognitionPriorsFor(current.current.room,seat)).catch(()=>undefined);
  },[room.slug,seat,ownsSource,hub.cameraOn,deckKey]);
  const enabledRef=useRef(true),calibrationBusy=useRef(false),tracks=useRef<FieldTrack[]>([]);
  const manual=useRef(new Map<string,{zone:string;slot?:number;position?:string}>());
  const entries=useRef(new Map<string,Entry>()),bindings=useRef(new Map<string,string>()),published=useRef(''),lastMessage=useRef<ReturnType<typeof fieldTrackMessage>>({type:'field.tracks',cards:[]}),previousRefs=useRef(new Set<string>());
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
  const debugBackend=()=>{const loss=gpuLossReason();return `${recognition.backend==='webgpu'?'GPU':recognition.backend?'CPU':'reader'}${recognition.note?` (${recognition.note})`:''}${loss?` · GPU lost ${new Date(loss.at).toLocaleTimeString()}: ${loss.reason}`:''}`;};
  const prompted=useRef(new Set<string>()),placeholders=useRef(new Map<string,string>()),readerRemovals=useRef(new Set<string>());
  // Summon window: monsters that left the field (watcher time) and Extra Deck summons placed moments ago.
  const vanishes=useRef<FieldVanish[]>([]),summons=useRef(new Map<string,{kind:RemoteSummonKind;name:string;rating?:number;at:number;count:number;pending:string[];trackId:string}>());
  // Stacks the glue holds back (a card moved on top of another card): the summon window decides, then the default applies.
  // stackKept: a stack whose default the player undid; the camera leaves it alone while it stays stacked.
  const heldStacks=useRef(new Set<string>()),stackKept=useRef(new Set<string>()),stackTimers=useRef(new Set<ReturnType<typeof setTimeout>>()),undoChain=useRef<{after:string;ids:string[]}>({after:'',ids:[]}),watchStartedAt=useRef(performance.now());
  useEffect(()=>{vanishes.current=[];summons.current.clear();heldStacks.current.clear();stackKept.current.clear();watchStartedAt.current=performance.now();},[room.slug,seat,source]);
  useEffect(()=>()=>{for(const timer of stackTimers.current)clearTimeout(timer);stackTimers.current.clear();},[]);
  /**
   * A new pile card needs entry evidence (not a restart re-read): the camera ran 2 s, and a hand was over that pile up to
   * 10 s before it showed (or still is), or a sure read differs from the current top (the top's look changed).
   */
  const pileEntry=(track:Pick<FieldTrack,'zone'|'firstSeen'>,differs=false)=>{const touched=watch.getSnapshot?.()?.pileTouchedAt?.[track.zone as 'GY'|'BANISHED']??-Infinity;return track.firstSeen-watchStartedAt.current>2000&&(differs||touched>=track.firstSeen-PILE_EXIT_MS);};
  /** True while the camera has this twin out of view (by its ref or a bound track id). */
  const outOfView=(ref:string)=>watch.isRemoved(ref)||watch.getTracks().some(t=>t.removed&&(bindings.current.get(t.id)??t.id)===ref);
  /** Twin refs of the cards under this track (the whole stack), bottom first. */
  const stackUnder=(trackId:string)=>{const out:string[]=[],all=watch.getTracks();let level=[trackId];for(let n=0;n<10&&level.length;n++){level=all.filter(t=>t.under&&level.includes(t.under)&&!t.removed).map(t=>t.id);out.unshift(...level.map(id=>bindings.current.get(id)??id));}return [...new Set(out)];};
  const missingCopies=useRef(new Map<string,number>()),mergedCopies=useRef(new Map<string,number>()),repairingCopies=useRef(false);
  calibrationBusy.current=calibrating;
  const [failedUpdate,setFailedUpdate]=useState<{work:(act:RoomMutation)=>Promise<void>;event?:FieldEvent;humanChoice?:boolean}|null>(null);
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false),[recovery,setRecovery]=useState<StaleFieldPlacementError|null>(null);
  const heldTimers=useRef(new Map<string,ReturnType<typeof setInterval>>()),departureTimers=useRef(new Map<string,ReturnType<typeof setTimeout>>());
  /** Monsters out of view during the 2 s departure wait (track id): an Extra Deck summon in that window takes them as materials. */
  const pendingLeft=useRef(new Map<string,FieldVanish>());
  useEffect(()=>()=>{for(const timer of heldTimers.current.values())clearInterval(timer);heldTimers.current.clear();for(const timer of departureTimers.current.values())clearTimeout(timer);departureTimers.current.clear();pendingLeft.current.clear();},[room.slug,seat,source]);
  const [departure,setDepartureState]=useState<Departure|null>(null),departureRef=useRef<Departure|null>(null);
  // Grid check: when the card type contradicts the camera row for 2+ cards in 2 minutes, the zones are
  // probably shifted by one row. One hint per table and seat.
  const rowFixes=useRef(new Map<string,number>()),[shiftHint,setShiftHint]=useState(false),shiftHinted=useRef(false);
  useEffect(()=>{rowFixes.current.clear();shiftHinted.current=false;setShiftHint(false);},[room.slug,seat]);
  const noteRowFix=(ref:string)=>{
    const at=performance.now();rowFixes.current.set(ref,at);
    for(const [key,when] of rowFixes.current)if(at-when>120_000)rowFixes.current.delete(key);
    if(rowFixes.current.size>=2&&!shiftHinted.current){shiftHinted.current=true;setShiftHint(true);}
  };
  useEffect(()=>setRecovery(null),[room.slug,seat]);
  const setDeparture=(value:Departure|null)=>{departureRef.current=value;setDepartureState(value);};
  useEffect(()=>{setHost(document.querySelector<HTMLElement>(`[data-testid="feed-box-${seat}"]`));setPrompts([]);prompted.current.clear();previousRefs.current=new Set();bindings.current.clear();},[room.slug,seat,source]);
  useEffect(()=>{placeholders.current.clear();readerRemovals.current.clear();},[room.slug,seat]);
  const savePhysical=()=>{try{sessionStorage.setItem(physical.current!.key,JSON.stringify(Object.fromEntries(physical.current!.zones)));}catch{/* Memory-only fallback. */}};
  const forgetPhysical=(ref:string)=>{if(physical.current!.zones.delete(ref))savePhysical();};
  const prunePhysical=()=>{const refs=new Set(current.current.room.state.seats[seat].twin.map(c=>c.ref));let changed=false;for(const ref of physical.current!.zones.keys())if(!refs.has(ref)){physical.current!.zones.delete(ref);changed=true;}if(changed)savePhysical();};
  const rememberPhysical=(ref:string,zone:FieldZone)=>{if(physicalZonePattern.test(zone)&&current.current.room.state.seats[seat].twin.some(c=>c.ref===ref&&publicField(c.zone))&&physical.current!.zones.get(ref)!==zone){physical.current!.zones.set(ref,zone);savePhysical();}};
  // A physical hint reserves a ref only. Omitting the quad forces a fresh identity read.
  const knownZone=(card:TwinCard)=>publicField(card.zone)?physical.current!.zones.get(card.ref)??observedFieldZone(room.slug,seat,card.ref)??toZone(card.zone,card.slot):toZone(card.zone,card.slot);
  const projectObserved=(track:Pick<FieldTrack,'zone'|'faceDown'>,twins:readonly TwinCard[],card:TwinCard|undefined,facts:ReturnType<typeof cardInfo>,wasHidden=false):ReturnType<typeof projectFieldZone>=>{
    // Turning a bound card over retains its virtual destination until it physically moves.
    const saved=card&&(track.faceDown||!card.faceUp||wasHidden)&&knownZone(card)===track.zone?toZone(card.zone,card.slot):undefined;
    return saved?{zone:saved,label:''}:projectFieldZone({zone:track.zone,facts,twins,ref:card?.ref,faceDown:track.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,equipSource:equipSourceOn(twins)});
  };
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{if([...placeholders.current.values()].includes(c.ref))return [];const zone=c.zone==='hand'?'HAND' as const:knownZone(c);return zone?[{id:c.ref,zone,cardId:c.faceUp||c.publicIdentity||['deck','hand','extra'].includes(c.zone)?String(cardCode(c)??''):undefined,faceDown:!c.faceUp,position:c.position}]:[];});
  const offer=(event:FieldEvent)=>{
    const key=`${event.track.id}:${event.track.revision??0}`;
    if(event.track.faceDown||prompted.current.has(key))return;
    // React may replay state updaters. Reserve once outside the pure updater.
    prompted.current.add(key);setPrompts(list=>[...list.slice(-5),event]);
  };
  const live=()=>current.current.active&&enabledRef.current&&current.current.room.status==='active'&&!current.current.room.state.ended&&!current.current.room.state.seats[seat].eliminated;
  /** A card the player moved by hand keeps its place while the real card stays where the camera last saw it. */
  const keepsManual=(ref:string,location:{zone:string;slot?:number},position?:string)=>{
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
  /** Refs the player brought back with Undo while the camera shows no card: only Scan field removes them again. */
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
  const undoCards=useRef(new Map<string,string[]>()),undoSeq=useRef<number|null>(null);
  useEffect(()=>{undoCards.current.clear();undoSeq.current=null;},[room.slug,seat]);
  useEffect(()=>{
    for(const entry of room.state.undoHistory??[])undoCards.current.set(entry.actionId,entry.cards);
    const events=room.events??[],newest=events.reduce((n,e)=>Math.max(n,e.seq),0);
    if(undoSeq.current===null){undoSeq.current=newest;return;}
    for(const e of events){
      if(e.seq<=undoSeq.current)continue;
      if((e.action.type==='twin.flip'||e.action.type==='twin.move'&&e.action.faceUp!==undefined)&&e.action.seat===seat&&e.action.source!=='auto'){holdFace(e.action.cardRef);continue;}
      if(e.action.type!=='undo')continue;
      const targetId=e.action.targetActionId,target=events.find(x=>x.id===targetId||(x.action as {idempotencyKey?:string}).idempotencyKey===targetId)?.action as Record<string,unknown>|undefined;
      // Fallback when the entry was never seen (action and Undo in one update): the refs the action names.
      const named=target?[target.cardRef,(target.card as {ref?:string}|undefined)?.ref,...(Array.isArray(target.cardRefs)?target.cardRefs:[]),target.keepRef,target.removeRef].filter((ref):ref is string=>typeof ref==='string').map(ref=>`${String(target.seat??seat)}:${ref}`):[];
      for(const qualified of undoCards.current.get(targetId)??named){
        const at=qualified.indexOf(':');if(Number(qualified.slice(0,at))===seat)holdForPlayer(qualified.slice(at+1));
      }
    }
    undoSeq.current=Math.max(undoSeq.current,newest);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.events,room.state.undoHistory,seat]);
  /** `quiet`: a background board re-sync. A failed write is logged only (no notice, no Retry banner); it is tried again next cycle. */
  function queue(work:(act:RoomMutation)=>Promise<void>,event?:FieldEvent,humanChoice=false,quiet=false) {
    console.info('[remote field] queued',event?.type,event?.track.id,event?.track.revision);
    markFieldTiming(event?.timing,'queued');
    return transaction(async(latest,act)=>{
      current.current.room=latest;markFieldTiming(event?.timing,'dequeued');
      console.info('[remote field] dequeued',event?.type,event?.track.id,latest.lastSeq);
      const apply:RoomMutation=async (input,idempotencyKey)=>{const actionId=idempotencyKey??crypto.randomUUID();
        // A Trap that the camera sees go from S/T to a Monster Zone is a Trap Monster: it keeps its S/T zone.
        let proposal=input;if(input.type==='twin.move'&&input.trapMonster===undefined){const moving=current.current.room.state.seats[seat].twin.find(c=>c.ref===input.cardRef);if(becomesTrapMonster(moving,cardInfo(moving&&cardCode(moving)),input.zone))proposal={...input,trapMonster:true};}bindFieldTiming(actionId,current.current.room.slug,event?.timing);
        console.info('[remote field] write',proposal.type,actionId);markFieldTiming(event?.timing,'mutation',{actionId});const updated=await retryFieldMutation(act,proposal,actionId,()=>proposal.type==='undo'||live()&&(!event||(event.type==='removed'?watch.isRemoved(event.track.id):fieldEvidenceMatches(event,watch.getTrack(event.track.id),humanChoice))),error=>{const text=error instanceof Error?error.message:String(error);console.warn('[remote field] save failed',proposal.type,text);lastWriteError.current=`${new Date().toLocaleTimeString()} ${text}`;markFieldTiming(event?.timing,'writeFailed',{type:proposal.type});if(!quiet)setNotice(text);});console.info('[remote field] write result',proposal.type,updated?.lastSeq??'not saved');if(!updated)console.info('[remote field] write skipped: the card changed before it was saved',proposal.type);if(updated){current.current.room=updated;prunePhysical();}return updated;};
      await work(apply);console.info('[remote field] flushed',event?.type,event?.track.id,current.current.room.lastSeq);setFailedUpdate(previous=>previous?.work===work?null:previous);
    }).catch(error=>{console.error('[remote field] update failed',error);if(quiet)return;if(error instanceof StaleFieldPlacementError)setRecovery(error);else{setFailedUpdate({work,event,humanChoice});setNotice(error instanceof Error?error.message:'Could not save the field update. Use Retry field update.');}});
  }
  function resolveExisting(event:FieldEvent,track:FieldTrack,entry:Entry|undefined,twins:readonly TwinCard[]) {
    const reusable=(card:TwinCard)=>publicField(card.zone)||['deck','hand','extra'].includes(card.zone)||card.ref===event.fromRef||['GY','BANISHED'].includes(track.zone)&&card.zone===fieldZoneLocation(track.zone).zone;
    let existing=twins.find(c=>c.ref===track.id&&reusable(c));
    const sameSlot=(c:typeof twins[number])=>knownZone(c)===track.zone;
    const owns=(t:FieldTrack,ref:string)=>(bindings.current.get(t.id)??t.id)===ref;
    if(!existing&&event.type==='prompt'){
      // Explicit confirmation may correct the old twin at this physical spot,
      // including a reserved restart ref whose identity has not been trusted.
      const bound=twins.find(c=>c.ref===event.bindRef&&reusable(c));
      if(bound&&tracks.current.some(t=>t.id!==event.track.id&&owns(t,bound.ref)&&t.visible&&!t.removed)){return {existing,blocked:true};}
      // The physical card can move while its prompt waits; keep its reservation.
      existing=bound??twins.find(c=>publicField(c.zone)&&sameSlot(c)&&!tracks.current.some(t=>owns(t,c.ref)&&t.visible&&!t.removed));
    }
    if(existing&&entry&&!publicField(existing.zone)&&publicField(fieldZoneLocation(track.zone).zone)&&
      !twins.some(c=>['graveyard','banished'].includes(c.zone)&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name}))){
      // Reader reservations are inferred. An absent field owner takes priority
      // over a private ref unless a second current physical copy is witnessed.
      for(const copy of twins.filter(c=>(publicField(c.zone)||c.zone==='hand'&&c.departedFrom&&publicField(c.departedFrom.zone))&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name})).sort((a,b)=>Number(publicField(b.zone))-Number(publicField(a.zone)))){
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
  /** The newest face-up member of this seat's GY/banished pile with this identity. */
  const pileCopy=(members:readonly TwinCard[],entry:Entry)=>[...members].reverse().find(c=>c.faceUp&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name}));
  /**
   * Pile exit. A card the camera sees on the field while the same card lies in this seat's
   * GY/banished pile is that pile card moving (never a 2nd copy) when the pile shows it left:
   * the pile cell shows the empty mat now, the pile outline is gone, or a hand was over the pile
   * shortly before the card showed and the copy was the top. A pile card the camera still sees on the pile stays.
   */
  function pileExit(track:Pick<FieldTrack,'zone'|'faceDown'|'firstSeen'>,entry:Entry|undefined,twins:readonly TwinCard[]):TwinCard|undefined {
    if(!entry||track.faceDown||piles.has(track.zone))return;
    const snap=watch.getSnapshot?.();if(!snap)return;
    for(const [zone,pileZone] of [['GY','graveyard'],['BANISHED','banished']] as const){
      const members=twins.filter(c=>c.zone===pileZone),copy=pileCopy(members,entry);
      if(!copy)continue;
      // The watcher's re-check against the empty mat (sharp frames, no hand, no card that still looks like itself).
      // Only for a field card first seen at most 10 s before the cell cleared: an older field copy is a real copy.
      const clearAt=snap.pileClearSince?.[zone];
      if(clearAt!==undefined&&track.firstSeen>=clearAt-PILE_EXIT_MS)return copy;
      const seen=snap.tracks.some(t=>(bindings.current.get(t.id)??t.id)===copy.ref&&t.zone===zone&&t.visible&&!t.removed);
      if(seen)continue;
      const touched=snap.pileTouchedAt?.[zone]??-Infinity;
      if(snap.missingPiles?.includes(zone)||members.at(-1)===copy&&touched>=track.firstSeen-PILE_EXIT_MS&&touched<=track.firstSeen+1000)return copy;
    }
  }
  function abstain(event:FieldEvent,message:string) {
    if(watch.getTrack(event.track.id)?.state==='prompt')offer({...event,type:'prompt',reason:'uncertain'});
    setNotice(message);
  }
  async function removePlaceholder(id:string,act:RoomMutation) {
    const ref=placeholders.current.get(id);if(!ref)return true;
    const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
    // A manual identification owns the twin now; never delete that correction.
    if(card&&cardCode(card)){placeholders.current.delete(id);bindings.current.set(id,ref);return true;}
    // This intermediate removal belongs to the reader, so the room update
    // must not forget and suppress the live track before its identity is saved.
    readerRemovals.current.add(ref);
    try{if(card&&!await act({type:'twin.remove',actorSeat:seat,seat,cardRef:ref})){readerRemovals.current.delete(ref);return false;}}
    catch(error){readerRemovals.current.delete(ref);throw error;}
    placeholders.current.delete(id);bindings.current.delete(id);return true;
  }
  async function showPlaceholder(event:FieldEvent,act:RoomMutation) {
    console.info('[remote field] placeholder',event.track.id,event.track.zone);
    const observed=watch.getTrack(event.track.id);
    if(!live()||!fieldEvidenceMatches(event,observed)||placeholders.current.has(event.track.id))return;
    const location=fieldZoneLocation(observed!.zone),twins=current.current.room.state.seats[seat].twin;
    if(piles.has(observed!.zone)||twins.some(c=>c.zone===location.zone&&c.slot===location.slot))return;
    if(twins.some(c=>c.faceUp&&cardCode(c)&&observedFieldZone(room.slug,seat,c.ref)===observed!.zone))return;
    const proposal=fieldPlacementProposals({track:{...observed!,cardId:undefined},seat})[0];if(!proposal||proposal.type!=='twin.place')return;
    const updated=await act(proposal);if(!updated)return;
    const saved=updated.state.seats[seat].twin.find(c=>c.zone===location.zone&&c.slot===location.slot);if(!saved)return;
    placeholders.current.set(event.track.id,saved.ref);bindings.current.set(event.track.id,saved.ref);
    const after=watch.getTrack(event.track.id);
    if(!after||after.removed||after.revision!==event.track.revision)await removePlaceholder(event.track.id,act);
  }
  async function apply(event:FieldEvent,act:RoomMutation,chosen?:string,attempt=0) {
    console.info('[remote field] identify',event.track.id,chosen??event.track.cardId,event.track.zone,event.type);
    const humanChoice=!!chosen&&event.type==='prompt';
    const matchesEvidence=(track:FieldTrack|undefined)=>fieldEvidenceMatches(event,track,humanChoice);
    const mutate=(proposal:Parameters<typeof applyVerifiedFieldMutation>[3])=>applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,proposal,humanChoice);
    const observed=watch.getTrack(event.track.id);
    if(!live()||!matchesEvidence(observed)){
      console.warn('[remote field] identification deferred',event.track.id,observed?.state,observed?.visible,observed?.revision,attempt);
      if(chosen){setNotice('Card is moving or covered. Keep it still, then choose again.');return;}
      // A hand passing over the card hides it for a moment. Retry the same
      // evidence quietly; a changed card brings its own fresh event.
      if(live()&&observed&&!observed.removed&&attempt<6&&(observed.revision??0)===(event.track.revision??0)&&observed.cardId===event.track.cardId)
        setTimeout(()=>{void queue(next=>apply(event,next,undefined,attempt+1),event);},400);
      return;
    }
    let track={...observed!,id:bindings.current.get(event.track.id)??event.track.id,...(chosen?{cardId:chosen,faceDown:false}:{})};
    const entry=track.cardId?entries.current.get(track.cardId):undefined;
    let twins=current.current.room.state.seats[seat].twin;
    let existing=twins.find(c=>c.ref===track.id);
    let location=fieldZoneLocation(track.zone);
    if(!track.faceDown&&!entry)throw new Error('Card details are unavailable. Use Retry field update.');
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
    if(existing&&['GY','BANISHED'].includes(track.zone)&&existing.zone===location.zone&&existing.faceUp===!track.faceDown&&entry&&sameObservedCard(existing,{cardId:catalogCardId(entry),name:entry.name})){
      bindings.current.set(event.track.id,existing.ref);watch.confirm(event.track.id,track.cardId,existing.ref,false);return;
    }
    if(existing)track={...track,id:existing.ref};
    else if(twins.some(c=>c.ref===track.id))track={...track,id:`fw-${crypto.randomUUID()}`};
    const placementRef=track.id;
    const code=entry?catalogCardId(entry):undefined;
    if(code&&!track.faceDown){
      const metadata=loadCards([code]);
      if(existing&&!existing.faceUp&&knownZone(existing)===track.zone)void metadata.catch(()=>undefined);else await metadata;
    }
    const latest=watch.getTrack(event.track.id);if(!live()||!matchesEvidence(latest))throw new Error('Card changed while loading its details. Keep it still, then try again.');
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
    // A revive: the same card lies in the GY/banished pile and a hand was just over that pile. Let the pile settle
    // (at most ~1 s) and check its cell again before this becomes a new copy. No prompt.
    if(!existing&&!track.faceDown&&entry&&!piles.has(track.zone)&&attempt<3){
      const touched=watch.getSnapshot?.()?.pileTouchedAt;
      const settling=([['GY','graveyard'],['BANISHED','banished']] as const).some(([zone,pileZone])=>performance.now()-(touched?.[zone]??-Infinity)<1000&&!!pileCopy(twins.filter(c=>c.zone===pileZone),entry));
      if(settling){setTimeout(()=>{if(live())void queue(next=>apply(event,next,chosen,attempt+1),event,humanChoice);},400);return;}
    }
    if(existing)track={...track,id:existing.ref};
    else if(twins.some(c=>c.ref===track.id))track={...track,id:`fw-${crypto.randomUUID()}`};
    // A pile card the camera re-reads after a restart (or with no hand over the pile) is the current top, not a new card.
    const pileTop=['GY','BANISHED'].includes(track.zone)?twins.filter(c=>c.zone===location.zone).at(-1):undefined;
    if(['GY','BANISHED'].includes(track.zone)&&!existing&&!pileEntry(track,!!code&&!track.bestMatch&&!!pileTop&&cardCode(pileTop)!==code)){
      const top=pileTop;
      if(top){bindings.current.set(event.track.id,top.ref);watch.confirm(event.track.id,top.faceUp&&cardCode(top)===code?track.cardId:undefined,top.ref,false);}
      return;
    }
    // Extra Deck summon: the monsters under this card or that left the field in the window are its materials.
    const summonType=!existing&&!track.faceDown&&code?fieldSummonKind(cardInfo(code)):undefined;
    const materialRefs=summonType&&/^(M[1-5]|EMZ[12])$/.test(track.zone)?fieldSummonMaterials({kind:summonType.kind,rating:summonType.rating,covered:stackUnder(event.track.id),vanished:vanishes.current,pending:[...pendingLeft.current.values()],firstSeen:track.firstSeen,twins,removed:outOfView,now:serverNow()}):undefined;
    const summon=summonType&&materialRefs?{kind:summonType.kind,materialRefs}:undefined;
    const stale=staleFieldOccupant(twins,watch.getTracks().map(track=>({...track,id:bindings.current.get(track.id)??track.id})),track.zone,existing?.ref??track.id);
    // Release a slot only for a card that lands in it: a Trap seen in M4 goes to the Spell/Trap row and leaves the M4 twin alone.
    const claimsSlot=stale&&projectObserved(track,twins.filter(c=>c.ref!==stale.ref),existing,entry?cardInfo(catalogCardId(entry)):undefined).zone===track.zone;
    if(stale&&claimsSlot&&!summon?.materialRefs.includes(stale.ref)){
      const trackBefore=watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===stale.ref);
      const absentAt=trackBefore?.lastSeen??missingSince.current.get(stale.ref)??performance.now();
      missingSince.current.set(stale.ref,absentAt);
      if(performance.now()-absentAt<2000){
        const key=`stale:${event.track.id}`;
        // The latest apply replaces the wait: a player who corrects a choice during it keeps the correction.
        const waiting=departureTimers.current.get(key);if(waiting)clearTimeout(waiting);
        departureTimers.current.set(key,setTimeout(()=>{
          departureTimers.current.delete(key);if(live())void queue(act=>apply(event,act,chosen,attempt),event,humanChoice);
        },Math.max(1,2000-(performance.now()-absentAt))));
        return;
      }
      const departure=fieldDepartureProposal(stale,seat);
      if(!departure||!await act(departure))return;
      // The departure counts as a vanish too: the summon that follows can still take this monster as a material.
      if(departure.zone==='hand'&&stale.faceUp&&['monster','extra-monster'].includes(stale.zone))vanishes.current=[...vanishes.current.filter(v=>v.ref!==stale.ref),{ref:stale.ref,at:absentAt}].slice(-10);
      twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    }
    const projected=projectObserved(track,twins,existing,entry?cardInfo(catalogCardId(entry)):undefined);
    if(!projected.zone){abstain(event,projected.reason??'Choose a legal zone manually.');return;}
    const physicalAtSave={zone:track.zone,position:track.position};
    track={...track,zone:projected.zone};location=fieldZoneLocation(projected.zone);
    if(!piles.has(track.zone)&&twins.some(c=>c.ref!==existing?.ref&&!summon?.materialRefs.includes(c.ref)&&c.zone===location.zone&&c.slot===location.slot)) {abstain(event,'This zone is occupied. Choose a free zone.');return;}
    // The reader already placed this physical card. Identify it in place rather
    // than removing and recreating it while the next camera event is queued.
    const readingCard=current.current.room.state.seats[seat].twin.find(c=>c.ref===placeholderRef);
    if(!existing&&!track.faceDown&&entry&&readingCard?.faceUp&&readingCard.zone===location.zone&&readingCard.slot===location.slot){
      existing=readingCard;track={...track,id:readingCard.ref};
    }
    setPending(true);
    try {
      if(existing?.ref!==placeholderRef&&!await removePlaceholder(event.track.id,act))return;
      let updated:RemoteRoom|null=null;
      const originReturn=!!existing&&['deck','hand','extra','graveyard','banished'].includes(existing.zone)&&existing.zone!==location.zone;
      const atomicReveal=!!existing&&!originReturn&&!existing.faceUp&&!track.faceDown&&!!entry;
      if(existing&&!originReturn&&existing.faceUp===track.faceDown){
        // No write now: the player holds this face, the card is in its quiet time, or an Xyz Monster has no clear back. The face check comes back to it.
        if(!chosen&&(face.current.held(existing.ref)||!face.current.allows(existing.ref,performance.now()))||track.faceDown&&existing.materials?.length&&!fieldStrongBack(track))return;
        updated=await mutate({type:'twin.flip',source:'auto',actorSeat:seat,seat,cardRef:existing.ref,faceUp:!track.faceDown,position:fieldTwinPosition(track),...(atomicReveal?{cardId:catalogCardId(entry!),name:entry!.name,bestMatch:track.bestMatch}:{})});if(!updated)return;
        face.current.flipped(existing.ref,performance.now());
      }
      // The resolver has just required a distinct, same-frame witness for every
      // existing copy. Undo's clock estimate rounds HTTP Date up; evidence must
      // use its lower bound so the server never sees a future camera sample.
      const copyCount=code?twins.filter(c=>{if(!publicField(c.zone)||!sameObservedCard(c,{cardId:code,name:entry?.name}))return false;const other=watch.getTrack(c.ref)??tracks.current.find(t=>(bindings.current.get(t.id)??t.id)===c.ref);return !!other&&simultaneousFieldCopies(track,other,true);}).length:0;
      const copyProof=!existing&&copyCount?{simultaneousQuads:copyCount+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-track.lastSeen))}:undefined;
      for(const proposal of atomicReveal?[]:fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing&&!originReturn,fromRef:originReturn?existing!.ref:undefined,copyProof,summon})){
        // The camera row was not legal for this card type: the log line says so ("Trap → S3"). No prompt.
        updated=await mutate(proposal.type==='twin.place'&&projected.moved?{...proposal,zoneRule:projected.moved}:proposal);if(!updated){if(matchesEvidence(watch.getTrack(event.track.id)))offer({...event,type:'prompt',reason:'recognition-error'});return;}
        if(proposal.type==='twin.place'){
          const canonical=placedTwin(updated.state.seats[seat].twin,{...proposal.card,zone:proposal.zone});
          if(!canonical)throw new Error('Camera placement was not returned in its slot');
          if(canonical.ref!==track.id){existing=twins.find(c=>c.ref===canonical.ref)??canonical;track={...track,id:canonical.ref};}
          bindings.current.set(event.track.id,canonical.ref);
          // Count only the materials the server took (it skips cards that changed since the read).
          const after=updated.state.seats[seat].twin,usedRefs=(summon?.materialRefs??[]).filter(ref=>{const c=after.find(t=>t.ref===ref);return summon!.kind==='xyz'?c?.materialOf===canonical.ref:c?.zone==='graveyard';});
          if(summonType)summons.current.set(canonical.ref,{kind:summonType.kind,name:entry?.name??'Card',rating:summonType.rating,at:performance.now(),count:usedRefs.length,pending:[],trackId:event.track.id});
          if(summon){const used=new Set(usedRefs);vanishes.current=vanishes.current.filter(v=>!used.has(v.ref));for(const ref of usedRefs)stackKept.current.delete(ref);for(const [trackId,v] of pendingLeft.current)if(used.has(v.ref)){const timer=departureTimers.current.get(trackId);if(timer)clearTimeout(timer);departureTimers.current.delete(trackId);pendingLeft.current.delete(trackId);}}
        }
      }
      const currentTarget=()=>{
        const observed=watch.getTrack(event.track.id);if(!live()||!matchesEvidence(observed))return;
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(item=>item.ref===track.id);if(!card)return;
        const target=projectObserved(observed!,twins,card,cardInfo(code),!!existing&&!existing.faceUp);
        if(!target.zone){abstain(event,target.reason??'Choose a legal zone manually.');return;}
        return {observed:observed!,card,location:fieldZoneLocation(target.zone),position:fieldTwinPosition({...observed!,zone:target.zone})};
      };
      const matches=(target:NonNullable<ReturnType<typeof currentTarget>>)=>target.card.zone===target.location.zone&&target.card.slot===target.location.slot&&target.card.position===target.position;
      let target=currentTarget();if(!target)return;
      if(!matches(target)&&!(existing&&keepsManual(existing.ref,fieldZoneLocation(target.observed.zone),target.observed.position))){
        const physicallyMoved=target.observed.zone!==physicalAtSave.zone||target.observed.position!==physicalAtSave.position;
        const initialCorrection=!!existing&&!keepsManual(existing.ref,location,track.position)&&(existing.zone!==location.zone||existing.slot!==location.slot||existing.position!==fieldTwinPosition(track));
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
      watch.confirm(event.track.id,track.cardId,target.card.ref,event.type==='prompt');rememberPhysical(target.card.ref,target.observed.zone);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
      const materialName=(ref:string)=>{const c=current.current.room.state.seats[seat].twin.find(t=>t.ref===ref);return c?.name??entries.current.get(watch.getTracks().find(t=>(bindings.current.get(t.id)??t.id)===ref)?.cardId??'')?.name??'Card';};
      const wasLeaving=departureRef.current?.ref===target.card.ref;setDeparture(null);
      // Turning a board card over is no news: the table's Undo covers it. Only an uncertain read asks for a look.
      if(existing&&!originReturn&&(track.faceDown||atomicReveal&&!track.bestMatch)){if(wasLeaving)setNotice('');if(projected.moved)noteRowFix(target.card.ref);return;}
      setNotice(summon?`${fieldSummonNotice(summon.kind,entry?.name??'Card',summon.materialRefs.map(materialName))} · auto`:`${track.bestMatch?'Best match · ':''}${track.faceDown?'Face-down card':entry?.name} placed${projected.moved?` · ${projected.moved}`:''} · auto`);setUndoId(updated?.state.undo?.actionId??'');
      if(projected.moved)noteRowFix(target.card.ref);
    }finally{setPending(false);}
  }
  function handleHeld(event:HeldCardEvent) {
    const entry=entries.current.get(event.cardId),cardId=entry?catalogCardId(entry):Number(event.cardId);
    if(typeof cardId!=='number'||!Number.isSafeInteger(cardId)||cardId<=0||heldTimers.current.has(event.id))return;
    // Read at once after stillness. Commit only after the episode ends and no field play follows.
    let endedAt:number|undefined;
    const timer=setInterval(()=>{
      if(!live()){clearInterval(timer);heldTimers.current.delete(event.id);return;}
      const stillHeld=watch.getSnapshot()?.held?.some(t=>t.id===event.id&&t.visible);
      if(stillHeld){endedAt=undefined;return;}
      endedAt??=performance.now();
      if(performance.now()-endedAt<800)return;
      const readAt=event.at-performance.timeOrigin;
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
  }
  function handle(event:FieldEvent,departureOrigin?:Pick<TwinCard,'ref'|'zone'|'slot'>) {
    if(event.type!=='removed'){
      const timer=departureTimers.current.get(event.track.id);if(timer){clearTimeout(timer);departureTimers.current.delete(event.track.id);}
      pendingLeft.current.delete(event.track.id);
    }
    // A phantom: no card box on the mat plane ever backed this track (an arm, a box across two cells). Its unnamed card is
    // taken back off the board, never sent to the hand. A named front still leaves through the usual departure.
    if(event.type==='removed'&&event.reason==='phantom'&&!placeholders.current.has(event.track.id)){
      const ref=bindings.current.get(event.track.id)??event.track.id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(card&&publicField(card.zone)&&!(card.faceUp&&cardCode(card))){
        void queue(async act=>{
          const latest=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
          if(!live()||!latest||!publicField(latest.zone)||undoKept.current.has(ref)||!watch.isRemoved(event.track.id))return;
          const updated=await act({type:'twin.remove',actorSeat:seat,seat,cardRef:ref});
          if(updated){setNotice(`${latest.faceUp?'Unread card':'Face-down card'} removed: nothing on the mat there · auto`);setUndoId(updated.state.undo?.actionId??'');}
        },event);
        return;
      }
    }
    // Every field departure waits the same window and defaults to the hand. Back to Deck/Extra is never guessed
    // from camera motion (event.destination): only the notice button or voice sends a card there.
    if(event.type==='removed'&&!departureOrigin&&!placeholders.current.has(event.track.id)){
      const ref=bindings.current.get(event.track.id)??event.track.id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(!card||!publicField(card.zone))return;
      const origin={ref:card.ref,zone:card.zone,slot:card.slot};
      if(departureTimers.current.has(event.track.id))return;
      if(card.faceUp&&['monster','extra-monster'].includes(card.zone))pendingLeft.current.set(event.track.id,{ref:card.ref,at:event.track.lastSeen});
      // The watcher already needed two empty full scans; a short wait lets a flip or a summon claim the card first.
      departureTimers.current.set(event.track.id,setTimeout(()=>{departureTimers.current.delete(event.track.id);pendingLeft.current.delete(event.track.id);if(live()&&watch.isRemoved(event.track.id))handle(event,origin);},DEPARTURE_WAIT_MS));
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
    if(event.type==='prompt'){
      if(event.reason==='recognition-error')setNotice('Card recognition failed. Keep the card still and choose its card, or use the feed reader.');
      if(event.reason==='pile'&&event.result?.tier==='sure'&&['GY','BANISHED'].includes(event.track.zone))void queue(act=>apply(event,act),event);
      else{
        // A new pile top that cannot be read still counts: push an unnamed card now; the player names it from the prompt or the pile.
        if(['GY','BANISHED'].includes(event.track.zone))void queue(async act=>{
          const twins=current.current.room.state.seats[seat].twin,ref=bindings.current.get(event.track.id)??event.track.id;
          if(!live()||twins.some(c=>c.ref===ref))return;
          const zone=event.track.zone==='GY'?'graveyard':'banished';
          if(!pileEntry(event.track)){const top=twins.filter(c=>c.zone===zone).at(-1);if(top)bindings.current.set(event.track.id,top.ref);return;}
          const updated=await act({type:'twin.place',source:'auto',actorSeat:seat,seat,zone,card:{ref,faceUp:true,position:'attack'}});
          if(updated){bindings.current.set(event.track.id,ref);setNotice(`Unknown card added to the ${zone==='graveyard'?'GY':'banished pile'} · name it`);setUndoId(updated.state.undo?.actionId??'');}
        },event);
        offer(event);
      }
      return;
    }
    void queue(async act=>{
      if(event.previousId&&!await removePlaceholder(event.previousId,act))return;
      // The watcher placed a provisional Set that was really a card lifted from
      // a pile: drop that unnamed back before the pile ref moves to its slot.
      if(event.type==='moved'&&event.replacesRef){
        const setRef=bindings.current.get(event.replacesRef)??event.replacesRef,provisional=current.current.room.state.seats[seat].twin.find(c=>c.ref===setRef);
        if(provisional&&!provisional.faceUp&&!cardCode(provisional)&&publicField(provisional.zone)&&!await act({type:'twin.remove',actorSeat:seat,seat,cardRef:provisional.ref}))return;
      }
      if(event.type==='reading'){await showPlaceholder(event,act);return;}
      if(event.type==='removed'&&placeholders.current.has(event.track.id)){await removePlaceholder(event.track.id,act);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));return;}
      if(event.type==='placed'){await apply(event,act);return;}
      const ref=bindings.current.get(event.track.id)??event.track.id;
      // The camera sees this card again: an earlier Undo no longer keeps it.
      if(event.type==='moved')undoKept.current.delete(ref);
      // Back on the field: it is no longer a vanished material candidate.
      if(event.type==='moved')vanishes.current=vanishes.current.filter(v=>v.ref!==ref);
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(!live()||!card)return;
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
        if(!s||!top||s.kind!=='xyz'||performance.now()-s.at>SUMMON_WINDOW_MS||!['monster','extra-monster'].includes(top.zone)||!card.faceUp||!['monster','extra-monster'].includes(card.zone))return;
        const attached=await act({type:'twin.attach',actorSeat:seat,seat,cardRef:top.ref,kind:'xyz',materialRefs:[card.ref]});
        if(attached){s.count++;setNotice(`${fieldSummonNotice('xyz',s.name,[card.ref])} · auto`);setUndoId(attached.state.undo?.actionId??'');}
        return;
      }
      if(event.type==='removed') {
        if(!watch.isRemoved(event.track.id)&&!watch.isRemoved(card.ref))return;
        if(undoKept.current.has(card.ref)||!fieldDepartureStillMissing(card,departureOrigin??card,watch.getTracks().map(t=>({...t,id:bindings.current.get(t.id)??t.id}))))return;
        // The owner just fixed the pile order: the camera top rule must not take cards out of the pile.
        if(['graveyard','banished'].includes(card.zone)&&current.current.room.events.some(e=>e.action.type==='pile.order'&&e.action.seat===seat&&e.action.zone===card.zone&&serverNow()-e.at<3000))return;
        const monster=card.faceUp&&['monster','extra-monster'].includes(card.zone);
        const proposal=fieldDepartureProposal(card,seat);if(!proposal)return;
        const name=proposal.name??(card.faceUp?entries.current.get(event.track.cardId??'')?.name:undefined)??'Card';
        const updated=await act({...proposal,...(card.faceUp?{name}:{})});
        if(!live()||!watch.isRemoved(card.ref))return;
        setDeparture({ref:card.ref,name,zone:updated?proposal.zone:'pending'});setNotice(`${name} ${proposal.zone==='deck'?'returned to Deck':'left the field'} · ${updated?'auto':'update failed'}`);setUndoId(updated?.state.undo?.actionId??'');
        // Summon window: a monster that leaves the field (default: to the hand) can be a material of a summon just before or after it.
        if(updated&&monster&&proposal.zone==='hand'){
          const at=event.track.lastSeen;vanishes.current=[...vanishes.current.filter(v=>v.ref!==card.ref&&Math.abs(v.at-at)<=2*SUMMON_WINDOW_MS),{ref:card.ref,at}].slice(-10);
          // After the summon: only while it still has fewer materials than the minimum, and for an Xyz only a card that lay
          // over the Xyz's spot. A summon that was undone (its card is gone) is forgotten.
          const nowAt=performance.now(),twinsNow=current.current.room.state.seats[seat].twin;
          for(const [topRef] of summons.current)if(!twinsNow.some(c=>c.ref===topRef&&['monster','extra-monster'].includes(c.zone)))summons.current.delete(topRef);
          const recent=[...summons.current].filter(([,s])=>{
            if(nowAt-s.at>SUMMON_WINDOW_MS||s.count+s.pending.length>=fieldSummonMinimum(s.kind))return false;
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
        if(!publicField(card.zone)&&!recentFieldDeparture(card,serverNow())){await apply(event,act);return;}
        let observed=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        if(keepsManual(card.ref,fieldZoneLocation(observed.zone),observed.position))return;
        const code=cardCode(card);if(code&&!piles.has(observed.zone))await loadCards([code]);
        observed=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        const projected=projectObserved(observed,current.current.room.state.seats[seat].twin,card,cardInfo(code));
        if(!projected.zone){setNotice(projected.reason??'Choose a legal zone manually.');return;}
        const location=fieldZoneLocation(projected.zone);
        if(keepsManual(card.ref,location,observed.position))return;
        const under=stackUnder(event.track.id);
        const stacked=current.current.room.state.seats[seat].twin.find(c=>c.ref!==card.ref&&under.includes(c.ref)&&c.zone===location.zone&&c.slot===location.slot);
        if(stacked){
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
              const name=below!.faceUp?below!.name??'Card':'Card',departure=fieldDepartureProposal(below!,seat);if(!departure)return;
              const left=await next({...departure,...(below!.faceUp?{name}:{})});if(!left)return;
              const moved=await next({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:mover.ref,...location,position:fieldTwinPosition(live_)});
              // One Undo puts both back: the top card's move first, then the card under it.
              const leftId=left.state.undo?.actionId??'',movedId=moved?.state.undo?.actionId??'';
              undoChain.current={after:movedId,ids:moved&&leftId?[leftId]:[]};setDeparture(null);
              setNotice(`${name} → hand (covered)${moved?'':' · move failed'} · Undo`);setUndoId(moved?movedId:leftId);
              stackKept.current.add(mover.ref);
            },event);},SUMMON_WINDOW_MS);
            stackTimers.current.add(timer);
          }
          return;
        }
        stackKept.current.delete(card.ref);
        if(card.zone!==location.zone||card.slot!==location.slot||card.position!==fieldTwinPosition({...observed,zone:projected.zone})){
          const updated=await act({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,...location,position:fieldTwinPosition({...observed,zone:projected.zone})});
          if(!updated)return;
          if(departureRef.current?.ref===card.ref){setDeparture(null);setNotice('');}
        }
        const after=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!live()||!fieldEvidenceMatches(event,after))return;
        const twins=current.current.room.state.seats[seat].twin,persisted=twins.find(c=>c.ref===card.ref);if(!persisted)return;
        const target=projectObserved(after!,twins,persisted,cardInfo(code));
        if(target.zone){const latest=fieldZoneLocation(target.zone);if(persisted.zone===latest.zone&&persisted.slot===latest.slot&&persisted.position===fieldTwinPosition({...after!,zone:target.zone}))rememberPhysical(card.ref,after!.zone);}
      }else if(event.type==='flipped'&&event.track.faceDown)await apply(event,act);
    },event);
  }
  // A new card-recognition mode restarts the reader, so the watcher must pick up the new one.
  const {generation}=useRecognitionBackend(),readerKey=useMemo(()=>({source,generation}),[source,generation]);
  const watch=useFieldWatcher({owner:ownsSource,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,duelKey:room.slug,captureSize,deviceKey:cameraKey,deviceLabel:hub.devices.find(d=>d.deviceId===hub.cameraId)?.label||undefined,sourceKey:readerKey,
    async create(){const resources=await ownFieldResources(()=>(recognitionPriorsFor(current.current.room,seat)));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,earlyExitMargin:.02,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,onHeldCard:handleHeld,cpuBusy:()=>resources.cpuBusy()||calibrationBusy.current};},onEvent:handle});
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
  enabledRef.current=watch.enabled&&!watch.calibrationNeeded&&!syncHold;tracks.current=watch.snapshot.tracks;
  // Slow computer: one quiet offer of Tap to identify (a slow detector, or the browser video encoder reports it is CPU limited). Only the player changes the mode; the answer is remembered.
  const [tapOffer,setTapOffer]=useState(false),slowWatch=useRef(createSlowWatch());
  const setDetection=useCallback((on:boolean)=>{
    saveTapChoice(on?'keep':'switch');setTapOffer(false);
    setSyncHold(on&&!watch.enabled&&current.current.room.state.seats[seat].twin.some(card=>publicField(card.zone)));
    watch.setEnabled(on);
  },[watch.setEnabled,watch.enabled,seat,setSyncHold]);
  const answerTapOffer=(choice:TapChoice)=>setDetection(choice==='keep');
  const offerable=watch.enabled&&ownsSource&&hub.cameraOn&&room.status==='active';
  useEffect(()=>{
    if(tapOffer&&!offerable)setTapOffer(false);
    if(tapOffer||!offerable||tapOfferShown()||readTapChoice())return;
    const at=performance.now();slowWatch.current.see(at,watch.snapshot.metrics);
    if((recognition.backend==='wasm'&&isWeakDevice(fieldPacerDevice()))||slowWatch.current.slow(at)){markTapOfferShown();setTapOffer(true);}
  },[watch.snapshot,offerable,recognition.backend,tapOffer]);
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
  // No answer in time: the offer goes and nothing is saved.
  useEffect(()=>{if(!tapOffer)return;const timer=setTimeout(()=>setTapOffer(false),TAP_OFFER_MS);return()=>clearTimeout(timer);},[tapOffer]);
  // Show a still outline on the board at once (local only). The saved "Reading" card takes its place with the same look.
  const ghostState=useRef(newGhostState());
  useEffect(()=>{
    const key=String(seat);
    setFieldGhosts(key,watch.enabled&&!watch.calibrationNeeded?nextFieldGhosts(watch.snapshot.tracks,ghostState.current,Date.now(),key,id=>placeholders.current.has(id)||bindings.current.has(id)):[]);
  },[watch.snapshot.tracks,watch.enabled,watch.calibrationNeeded,seat]);
  // A card that leaves the board (removed, Undo) must not flash a ghost while its track is still on the mat.
  const ghostTwinsPrev=useRef<TwinCard[]>([]);
  const ownTwin=room.state.seats[seat].twin;
  useEffect(()=>{for(const card of ghostTwinsPrev.current)if(!ownTwin.some(c=>c.ref===card.ref))blockGhostCell(String(seat),card.zone,card.slot);ghostTwinsPrev.current=ownTwin;},[ownTwin,seat]);
  useEffect(()=>()=>setFieldGhosts(String(seat),[]),[seat]);
  useEffect(()=>{
    const abandoned=[...placeholders.current.keys()].filter(id=>{const track=watch.getTrack(id);return !track||track.state==='dismissed'||track.removed;});
    if(abandoned.length)void queue(async act=>{for(const id of abandoned)await removePlaceholder(id,act);});
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
        }).finally(()=>{repairingCopies.current=false;});
        break;
      }
    },500);
    return()=>clearInterval(timer);
  },[room.slug,seat,watch.enabled]);
  useEffect(()=>{
    const active=new Set(watch.snapshot.tracks.filter(t=>t.state==='prompt'&&!t.removed).map(t=>`${t.id}:${t.revision??0}`));
    for(const key of prompted.current)if(!active.has(key))prompted.current.delete(key);
    setPrompts(list=>{const next=list.filter(p=>{const live=watch.getTrack(p.track.id);return live?.state==='prompt'&&(live.revision??0)===(p.track.revision??0);});return next.length===list.length?list:next;});
    const refs=new Set(room.state.seats[seat].twin.map(c=>c.ref));
    for(const ref of previousRefs.current)if(!refs.has(ref)&&!readerRemovals.current.has(ref)){forgetPhysical(ref);watch.forget(ref);}
    // Consume the exemption only after the server removal is observed, or after
    // a batched replacement already contains the identified card.
    for(const ref of readerRemovals.current)if(!refs.has(ref)||room.state.seats[seat].twin.some(card=>card.ref===ref&&cardCode(card)))readerRemovals.current.delete(ref);
    prunePhysical();
    previousRefs.current=refs;
    const value=departureRef.current;if(!value)return;
    const card=room.state.seats[seat].twin.find(c=>c.ref===value.ref);
    if(!card||(value.zone==='pending'&&!watch.isRemoved(value.ref))||(!destinations.some(([zone])=>zone===card.zone)&&value.zone!=='pending')){setDeparture(null);setNotice('');}
    else if(destinations.some(([zone])=>zone===card.zone)&&card.zone!==value.zone)setDeparture({...value,zone:card.zone});
  },[room.state,seat,watch.snapshot]);
  // "Out of view is gone" for piles. A missing GY/Banished stack was picked up
  // as a whole: its cards go to the hand in one undoable action. A missing
  // Deck/Extra only dims on the board (nothing is created, no prompt). When a
  // stack comes back, Deck/Extra show again; GY/Banished are not re-created.
  const missingKey=(watch.snapshot.missingPiles??[]).join(',');
  const liftedPiles=useRef(new Set<string>());
  useEffect(()=>{
    const missing=new Set(missingKey?missingKey.split(','):[]);
    publishMissingPiles(seat,['DECK','EXTRA'].filter(zone=>missing.has(zone)));
    for(const [zone,pileZone,label] of [['GY','graveyard','Graveyard'],['BANISHED','banished','Banished']] as const){
      if(!missing.has(zone)){liftedPiles.current.delete(zone);continue;}
      if(liftedPiles.current.has(zone)||!current.current.room.state.seats[seat].twin.some(c=>c.zone===pileZone))continue;
      liftedPiles.current.add(zone);
      void queue(async act=>{
        if(!live()||!current.current.room.state.seats[seat].twin.some(c=>c.zone===pileZone))return;
        // Pile entries that are accounted for: a member the camera placed on the field as a new card while the pile
        // emptied (seen there now, first seen up to 10 s before the cell cleared) moved there. It stays one card.
        const snap=watch.getSnapshot?.(),clearAt=snap?.pileClearSince?.[zone]??performance.now(),used=new Set<string>();
        for(const member of current.current.room.state.seats[seat].twin.filter(c=>c.zone===pileZone&&c.faceUp&&cardCode(c))){
          const field=current.current.room.state.seats[seat].twin.find(c=>!used.has(c.ref)&&c.ref.startsWith('fw-')&&c.faceUp&&publicField(c.zone)&&sameObservedCard(c,member)&&
            !!snap?.tracks.some(t=>(bindings.current.get(t.id)??t.id)===c.ref&&t.visible&&!t.removed&&t.firstSeen>=clearAt-PILE_EXIT_MS));
          if(!field)continue;
          used.add(field.ref);
          const merged=await act({type:'twin.merge',actorSeat:seat,seat,keepRef:field.ref,removeRef:member.ref,reason:'The camera saw this card leave the pile'});
          if(merged){mergedCopies.current.set(member.ref,merged.lastSeq);setDeparture(null);setNotice(`${field.name??'Card'} moved from the ${label} · auto`);setUndoId(merged.state.undo?.actionId??'');}
        }
        const refs=current.current.room.state.seats[seat].twin.filter(c=>c.zone===pileZone).map(c=>c.ref);if(!refs.length||!live())return;
        const updated=await act({type:'pile.lift',actorSeat:seat,seat,zone:pileZone,cardRefs:refs,source:'auto'});
        setDeparture(null);setNotice(`${label} picked up (${refs.length} card${refs.length===1?'':'s'}) · ${updated?'auto':'update failed'}`);if(updated)setUndoId(updated.state.undo?.actionId??'');
      });
    }
  },[missingKey,seat]);
  useEffect(()=>()=>publishMissingPiles(seat,[]),[seat]);
  function recover() {
    if(!recovery)return;const placement=recovery.placement;
    void queue(async act=>{
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===placement.card.ref);
      if(card&&(card.cardId!==placement.card.cardId||card.zone!==placement.zone||card.slot!==placement.card.slot||card.faceUp!==placement.card.faceUp)){setRecovery(null);setNotice('The placement changed. Check its card popup.');return;}
      if(card&&!await act({type:'twin.remove',actorSeat:seat,seat,cardRef:card.ref}))return;
      forgetPhysical(placement.card.ref);watch.forget(placement.card.ref);setPrompts(list=>list.filter(p=>p.track.id!==placement.card.ref));setRecovery(null);setNotice('Stale placement removed');
    });
  }
  function redirect(zone:string) {
    void queue(async act=>{
      const value=departureRef.current;if(!value||!live())return;
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===value.ref);
      if(!card||(!destinations.some(([z])=>z===card.zone)&&!(value.zone==='pending'&&watch.isRemoved(card.ref))))return;
      setPending(true);
      try{const updated=await act({type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,zone,...(card.faceUp?{name:value.name}:{})});if(updated){setDeparture({...value,zone});setNotice(`${value.name} left the field · auto`);setUndoId(updated.state.undo?.actionId??'');}}finally{setPending(false);}
    });
  }
  useEffect(()=>{
    // Tap to identify: no mat grid goes out, so other players read this camera and do not trust the board's zones.
    const message={...fieldTrackMessage(watch.snapshot,entries.current,known(),watch.enabled&&!syncHold?watch.calibration:undefined),...(watch.enabled&&!syncHold?{}:{mode:'tap' as const})},key=JSON.stringify(message);lastMessage.current=message;
    if(key!==published.current){published.current=key;hub.publishFieldTracks(message);}
  },[watch.snapshot,watch.calibration,watch.enabled,syncHold,hub.publishFieldTracks,room.state]);
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
  useEffect(()=>{
    if(!live())return;
    const twins=room.state.seats[seat].twin,format=room.format?.id??room.state.deckChecks.format.id;
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
      });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  },[room.state,seat,factsTick]);
  // Board re-sync: every few seconds (and at once from "Scan field") compare what
  // the camera saw in its last full detector pass with the board and fix differences
  // with the same rules. No prompts; one log note (not an undo step) when something
  // changed. Each fix is its own undoable action and is tried once per board state.
  // A card the player moved or undid stays until the camera shows a new change.
  const missingSince=useRef(new Map<string,number>());
  const [scanning,setScanning]=useState(false),resyncing=useRef(false),resynced=useRef(new Map<string,{board:string;fails:number}>());
  useEffect(()=>{resynced.current.clear();},[room.slug,seat]);
  const boardState=()=>{let h=0;for(const c of current.current.room.state.seats[seat].twin)for(const ch of `${c.ref}|${c.zone}|${c.slot??''}|${c.position??''}|${c.faceUp?1:0};`)h=(h*31+ch.charCodeAt(0))|0;return String(h);};
  /** False when this fix was already tried on this board state. A failed write may try again (3 times) next cycle. */
  const tryFix=(key:string)=>{const board=boardState(),seen=resynced.current.get(key);if(seen?.board===board)return false;resynced.current.set(key,{board,fails:seen?.fails??0});return true;};
  const fixFailed=(key:string,error:unknown)=>{console.info('[remote field] re-sync write skipped',key,error instanceof Error?error.message:error);const seen=resynced.current.get(key);if(seen&&++seen.fails<3)seen.board='';};
  // Face check. A flip event fires once, on the change, and is dropped if its card stays out of sight during the retries. So the
  // board follows the track's face itself, whichever path caused the difference: after 600 ms of still frames, one flip action,
  // no notice. The rules are in field-face.ts. Holds are in memory: after a reload the board follows the camera again.
  const faceBusy=useRef(false);
  const faceFixes=(at:number,scan:boolean)=>{
    const reading=new Set(placeholders.current.values());
    return face.current.due({at,scan,seat,tracks:watch.getTracks(),twins:current.current.room.state.seats[seat].twin,refOf:t=>bindings.current.get(t.id)??t.id,skip:ref=>reading.has(ref)||heldStacks.current.has(ref),
      identity:t=>{const entry=t.cardId?entries.current.get(t.cardId):undefined,code=entry&&catalogCardId(entry);return code?{cardId:code,name:entry!.name}:undefined;}});
  };
  const flipFace=async(act:RoomMutation,{track,card,proposal}:FieldFaceFix)=>{
    const updated=await applyFieldFaceFlip(track,()=>watch.getTrack(track.id),act,proposal,!!card.faceUp&&!!card.materials?.length);if(!updated)return updated;
    if(card.faceUp===track.faceDown)face.current.flipped(card.ref,performance.now());
    if(!track.faceDown)watch.confirm(track.id,track.cardId,card.ref,false);
    rememberPhysical(card.ref,track.zone);
    return updated;
  };
  const faceCheck=useRef<()=>void>(()=>undefined);
  faceCheck.current=()=>{
    if(faceBusy.current||!live()||calibrationBusy.current||document.hidden)return;
    const fixes=faceFixes(performance.now(),false);if(!fixes.length)return;
    faceBusy.current=true;
    void queue(async act=>{
      for(const {card:{ref}} of fixes){
        // Earlier work in the queue may have settled it already.
        const fix=faceFixes(performance.now(),false).find(f=>f.card.ref===ref);if(!fix)continue;
        try{await flipFace(act,fix);}catch(error){console.info('[remote field] face check write failed',ref,error instanceof Error?error.message:error);face.current.failed(ref,performance.now());}
      }
    },undefined,false,true).finally(()=>{faceBusy.current=false;});
  };
  useEffect(()=>{const timer=setInterval(()=>faceCheck.current(),200);return()=>clearInterval(timer);},[]);
  function resync(manualScan=false) {
    if(resyncing.current||!live()||calibrationBusy.current){if(manualScan){setScanning(false);setNotice(resyncing.current?'Board check already running':calibrationBusy.current?'Finish calibration first':'Camera is not watching the field');}return;}
    resyncing.current=true;
    void queue(async act=>{
      let changes=0,lastUndo='';const snap=watch.getSnapshot?.(),fullAt=snap?.lastFullAt;
      if(!snap||!live()||fullAt===undefined)return;
      const refOf=(t:FieldTrack)=>bindings.current.get(t.id)??t.id;
      const write=async(key:string,proposal:Parameters<RoomMutation>[0])=>{
        try{const updated=await act(proposal);if(updated){changes++;lastUndo=updated.state.undo?.actionId??lastUndo;}return updated;}catch(error){fixFailed(key,error);}
      };
      // Scan field: every board card with a track or a resting back of the other face in its zone turns over (never removed, never to the hand).
      // A back seen in both passes beats a track that still says up: such a card is never turned up first, and the face check leaves it until that track turns.
      if(manualScan){
        const backs=snap.lastScanBacks??[];
        for(const fix of faceFixes(performance.now(),true)){
          if(!fix.track.faceDown&&backs.includes(fix.track.zone)){holdFace(fix.card.ref);continue;}
          try{const updated=await flipFace(act,fix);if(updated){changes++;lastUndo=updated.state.undo?.actionId??lastUndo;}}catch(error){console.info('[remote field] face write failed',fix.card.ref,error instanceof Error?error.message:error);}
        }
        for(const zone of backs){
          const card=current.current.room.state.seats[seat].twin.find(c=>(c.faceUp||c.publicIdentity&&!c.setBy)&&publicField(c.zone)&&knownZone(c)===zone&&![...placeholders.current.values()].includes(c.ref));if(!card)continue;
          const proposal=fieldFaceProposal(card,{faceDown:true,position:'attack'},seat);if(!proposal)continue;
          const wasUp=card.faceUp;
          if(!await write(`flip:${card.ref}:true`,proposal))continue;
          if(wasUp)face.current.flipped(card.ref,performance.now());
          if(snap.tracks.some(t=>!t.removed&&!t.faceDown&&refOf(t)===card.ref))holdFace(card.ref);
        }
      }
      // Only cards the last full detector pass saw (on CPU it can be seconds old), after they settled.
      const settled=snap.tracks.filter(t=>t.state==='identified'&&t.visible&&!t.removed&&!piles.has(t.zone)&&t.lastSeen>=fullAt&&fullAt-t.firstSeen>1500);
      // 1. A known field card in another zone than the camera shows: move it (zone rules apply).
      for(const t of settled){
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(c=>c.ref===refOf(t));
        if(!card||!publicField(card.zone)||!t.cardId&&!t.faceDown||keepsManual(card.ref,fieldZoneLocation(t.zone),t.position))continue;
        // A face difference goes through the face check: one flip action, one Undo, not a position change first.
        // While the player holds that difference the card can still move, and it keeps its position.
        const faceDiffers=card.faceUp===t.faceDown;if(faceDiffers&&!face.current.held(card.ref))continue;
        const code=cardCode(card);if(code)await loadCards([code]);
        const projected=projectObserved(t,twins,card,cardInfo(code));if(!projected.zone)continue;
        // A hard-rule fix (Field Spell → FIELD) the player undid is not redone here either.
        if(ruleFixes.current.has(`${card.ref}:${toZone(card.zone,card.slot)}:${projected.zone}`))continue;
        const location=fieldZoneLocation(projected.zone),position=faceDiffers?card.position:fieldTwinPosition({...t,zone:projected.zone});
        if(card.zone===location.zone&&card.slot===location.slot&&card.position===position)continue;
        const key=`move:${card.ref}>${location.zone}${location.slot??''}${position}`;if(!tryFix(key))continue;
        await write(key,{type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:card.ref,...location,position});
      }
      // 2. A field copy the camera placed while the same card in the GY/banished shows it left: one card.
      for(const t of settled){
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(c=>c.ref===refOf(t)),entry=t.cardId?entries.current.get(t.cardId):undefined;
        if(!card||!card.faceUp||!publicField(card.zone)||!entry||!card.ref.startsWith('fw-')||keepsManual(card.ref,fieldZoneLocation(t.zone),t.position))continue;
        const copy=pileExit(t,entry,twins);if(!copy||keepsManual(copy.ref,fieldZoneLocation(t.zone),t.position))continue;
        const key=`merge:${card.ref}:${copy.ref}`;if(!tryFix(key))continue;
        const updated=await write(key,{type:'twin.merge',actorSeat:seat,seat,keepRef:card.ref,removeRef:copy.ref,reason:'Board re-sync: the camera saw this card leave the pile'});
        if(updated)mergedCopies.current.set(copy.ref,updated.lastSeq);
      }
      // 3. A card the camera knows that the board does not show (or shows off the field): place it again.
      for(const t of settled){
        const ref=refOf(t),card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
        if(card&&publicField(card.zone)||placeholders.current.has(t.id)||!t.faceDown&&!t.cardId)continue;
        // An Undo of this card (placement or pile exit) is the player's choice: leave it.
        if(keepsManual(ref,fieldZoneLocation(t.zone),t.position)||card&&recentFieldDeparture(card,serverNow()))continue;
        const key=`place:${t.id}:${t.zone}:${t.revision??0}`;if(!tryFix(key))continue;
        const before=current.current.room.lastSeq;
        try{await apply({type:'placed',track:t,source:'auto'},act);}catch(error){fixFailed(key,error);}
        if(current.current.room.lastSeq>before){changes++;lastUndo=current.current.room.state.undo?.actionId??lastUndo;}
      }
      // 4. A field card whose zone shows no card in 2 full scans (no hand, no moving shadow), with or
      // without a live track: remove it. An Undo keeps it until the player presses Scan field.
      for(const ref of missingSince.current.keys())if(!snap.missingTwins?.includes(ref))missingSince.current.delete(ref);
      for(const ref of snap.missingTwins??[]){
        const since=missingSince.current.get(ref)??performance.now();missingSince.current.set(ref,since);
        // Scan field is authoritative: its two fresh passes already showed the zone empty, so it does not wait.
        if(!manualScan&&performance.now()-since<2000)continue;
        const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
        if(!card||!publicField(card.zone))continue;
        if(undoKept.current.has(ref)){if(!manualScan)continue;undoKept.current.delete(ref);}
        // An unnamed Set the camera placed and no longer sees is taken back, not added to the hand as an unknown card.
        const unnamedSet=manualScan&&!card.faceUp&&!cardCode(card)&&card.ref.startsWith('fw-');
        const proposal=unnamedSet?{type:'twin.remove' as const,actorSeat:seat,seat,cardRef:card.ref}:fieldDepartureProposal(card,seat);if(!proposal)continue;
        const key=`remove:${ref}`;if(!tryFix(key))continue;
        await write(key,proposal);
      }
      const text=`Board re-synced (${changes} change${changes===1?'':'s'})`;
      // The note is a log line only: the server keeps it out of the undo history, so Undo reverts the last fix.
      if(changes){try{await act({type:'log.note',actorSeat:seat,text});}catch(error){console.info('[remote field] re-sync note skipped',error);}setNotice(text);setUndoId(lastUndo);}
      else if(manualScan)setNotice('Board matches the camera');
    },undefined,false,true).finally(()=>{resyncing.current=false;if(manualScan)setScanning(false);});
  }
  const resyncRef=useRef(resync);resyncRef.current=resync;
  // End of the hold: the placements dropped during it go on the board now. Moves and removals wait for the sweep, which is the proof they need.
  const placeHeldCards=useRef(()=>{});
  placeHeldCards.current=()=>{
    enabledRef.current=watch.enabled&&!watch.calibrationNeeded;
    const seen=watch.getTracks().filter(t=>t.state==='identified'&&t.visible&&!t.removed&&!piles.has(t.zone)&&(t.faceDown||t.cardId));
    if(seen.length)void queue(async act=>{
      for(const t of seen){
        const ref=bindings.current.get(t.id)??t.id,card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
        if(card&&publicField(card.zone)||placeholders.current.has(t.id)||keepsManual(ref,fieldZoneLocation(t.zone),t.position))continue;
        try{await apply({type:'placed',track:t,source:'auto'},act);}catch(error){console.info('[remote field] held card write skipped',t.id,error instanceof Error?error.message:error);}
      }
    },undefined,false,true);
  };
  useEffect(()=>{
    const every=recognition.backend==='webgpu'?4000:8000;
    const timer=setInterval(()=>{if(!document.hidden)resyncRef.current();},every);
    return()=>clearInterval(timer);
  },[room.slug,seat,recognition.backend]);
  // "Scan field": force two fresh full detector passes and the watcher's sweep (5 s at most on a slow CPU), then re-sync once.
  const scanTimer=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  useEffect(()=>()=>clearInterval(scanTimer.current),[]);
  const scanField=useCallback(()=>{
    if(scanTimer.current!==undefined||resyncing.current){setNotice('Board check already running');return;}
    if(syncHold){setSyncHold(false);placeHeldCards.current();}
    setScanning(true);const asked=performance.now();watch.scanNow?.();
    scanTimer.current=setInterval(()=>{
      const swept=watch.getSnapshot?.()?.lastScanAt??-Infinity;
      if(swept>=asked-50||performance.now()-asked>=5000){clearInterval(scanTimer.current);scanTimer.current=undefined;resyncRef.current(true);}
    },100);
  },[watch.scanNow,watch.getSnapshot,setSyncHold,syncHold]);
  useEffect(()=>{publishFieldScan({seat,scanning,enabled:watch.enabled,ready:ownsSource&&hub.cameraOn,scan:scanField,setDetection});},[seat,scanning,scanField,ownsSource,hub.cameraOn,watch.enabled,setDetection]);
  useEffect(()=>()=>publishFieldScan({seat:null,scanning:false,enabled:false,ready:false}),[]);
  // Debug overlay (own feed): raw detector boxes, track states and the last decision per track.
  useEffect(()=>{if(!fieldDebugEnabled())return;const m=watch.snapshot.metrics,boardTwin=current.current.room.state.seats[seat].twin;publishFieldDebug({faces:Object.fromEntries(watch.snapshot.tracks.flatMap(t=>{const card=t.state==='identified'&&!t.removed?boardTwin.find(c=>c.ref===(bindings.current.get(t.id)??t.id)&&publicField(c.zone)):undefined;return card&&card.faceUp===t.faceDown?[[t.id,`board: ${card.faceUp?'up':'down'} · track: ${t.faceDown?'down':'up'}`]]:[];})),blur:watch.snapshot.blur,shadow:watch.snapshot.shadow,debug:watch.snapshot.debug,tracks:watch.snapshot.tracks,status:watch.snapshot.status,detectorMs:m.detectorMs,dutyPercent:m.dutyPercent,intervalMs:m.intervalMs,writeError:lastWriteError.current,backend:debugBackend()});},[watch.snapshot]);
  useEffect(()=>()=>publishFieldDebug(null),[]);
  useEffect(()=>{const timer=setInterval(()=>hub.publishFieldTracks(lastMessage.current),1000);return()=>clearInterval(timer);},[hub.publishFieldTracks]);
  useEffect(()=>()=>hub.publishFieldTracks({type:'field.tracks',cards:[]}),[hub.publishFieldTracks]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>{setNotice('');setDeparture(null);setUndoId('');},5000);return()=>clearTimeout(timer);},[notice,undoId]);
  const activePrompts=prompts.filter(event=>{const live=watch.getTrack(event.track.id);return live?.state==='prompt'&&(live.revision??0)===(event.track.revision??0);});
  const promptInfo=useCardInfo(activePrompts.flatMap(event=>(event.result?.candidates??[]).map(candidate=>{const entry=entries.current.get(candidate.cardId);return entry?catalogCardId(entry):undefined;})));
  const promptViews=activePrompts.map(event=>{
    const observed=watch.getTrack(event.track.id)!,twins=current.current.room.state.seats[seat].twin;
    // Cards that fit the observed zone come first; others stay available (a monster can be an Equip Card).
    const fits=(cardId:string)=>{const entry=entries.current.get(cardId);return fieldCandidateFitsZone(observed.zone,entry?promptInfo(catalogCardId(entry)):undefined);};
    const choices=event.reason==='pile'?[]:observed.faceDown?[{cardId:'face-down'}]:[...(event.result?.candidates??[])].sort((a,b)=>Number(fits(b.cardId))-Number(fits(a.cardId))).slice(0,5);
    return {id:event.track.id,zone:observed.zone,title:event.reason==='changed'?'Card changed?':'New card?',quad:observed.card.quad,emptyMessage:event.reason==='pile'?'Move an existing card to this pile from its popup.':undefined,
      candidates:choices.map(candidate=>{
        const entry=entries.current.get(candidate.cardId),track={...observed,id:bindings.current.get(event.track.id)??event.track.id,cardId:candidate.cardId};
        const resolved=resolveExisting(event,track,entry,twins);
        const projected=projectFieldZone({zone:observed.zone,facts:entry?promptInfo(catalogCardId(entry)):undefined,twins,ref:resolved.existing?.ref,faceDown:observed.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        return {id:candidate.cardId,label:`${observed.faceDown?'Confirm face-down card':entry?.name??candidate.cardId} · ${resolved.blocked?'Another physical card owns this ref':projected.zone?`To ${projected.label}`:projected.reason}`,disabled:resolved.blocked||!projected.zone};
      })};
  });
  const label=!watch.enabled?'Tap to identify':watch.aspectChanged?'Camera shape changed · Calibrate zones':watch.calibrationNeeded?(watch.calibration?.orientation?'Calibrate your zones · auto-placement paused':'Choose your side · auto-placement paused'):watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  // Only the "Identify card" prompt needs text injected; the plain "Reading…" card is drawn by the board itself.
  const readingStyles=room.state.seats.flatMap((player,index)=>player.twin.flatMap(card=>{
    if(index!==seat||!card.ref.startsWith('fw-')||cardCode(card)||!card.faceUp||!publicField(card.zone))return [];
    if(!activePrompts.some(p=>(bindings.current.get(p.track.id)??p.track.id)===card.ref))return [];
    const zone=card.zone==='monster'?`m${card.slot??1}`:card.zone==='spell-trap'?`s${card.slot??1}`:card.zone==='extra-monster'?`emz${card.slot??1}`:'f';
    const selector=`[data-testid="field-${index}"] [data-zone="${zone}"]`;
    return [`${selector}>div:first-child{animation:none;background:linear-gradient(110deg,#233c3b 20%,#507b70 45%,#233c3b 70%)}${selector}>div:first-child>span{font-size:0}${selector}>div:first-child>span::after{content:"Identify card";font-size:10px;color:#e5f5ef}`];
  })).join('');
  return <>
    <style>{readingStyles}</style>
    <FieldWatcherUI dock={dock} host={host} enabled={watch.enabled} onEnabledChange={setDetection} statusLabel={label} statusExtra={<RecognitionBadge phoneCamera={hub.phones.some(p=>p.seat===seat)}/>} statusTitle={!watch.enabled?'Auto-detect is off. Click a card in any camera to read it. The board does not follow the cards.':watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%`} calibrated={watch.placed} calibrationDisabled={!video?.videoWidth} onCalibrate={()=>setCalibrating(true)} pending={pending}
      prompts={syncHold?[]:promptViews}
      onChoose={(id,cardId)=>{
        console.info('[remote field] candidate click',id,cardId);
        const event=activePrompts.find(p=>p.track.id===id),track=watch.getTrack(id);
        if(!event||!track){console.error('[remote field] expired candidate prompt',id);setNotice('Card prompt expired. Keep the card still for a fresh read.');return;}
        const selection={...event,track};setFailedUpdate(null);setPending(true);
        void queue(act=>apply(selection,act,cardId==='face-down'?undefined:cardId),selection,cardId!=='face-down').finally(()=>setPending(false));
      }}
      onDismiss={id=>{watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));void queue(async act=>{await removePlaceholder(id,act);});}}
      noticeTestId={departure?'field-departure-toast':undefined}
      notice={failedUpdate?<>{notice||'Could not save the field update.'}<button type="button" disabled={pending} onClick={()=>void queue(failedUpdate.work,failedUpdate.event,failedUpdate.humanChoice)}>Retry field update</button></>:recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:syncHold?<span data-testid="sync-board-hold">Auto-detect is on. The board keeps its cards until you sync it.<button type="button" onClick={scanField}>Sync board to camera</button></span>:shiftHint?<span data-testid="zone-shift-hint">Zones look shifted — Recalibrate?<button type="button" onClick={()=>{setShiftHint(false);setCalibrating(true);}}>Recalibrate</button><button type="button" onClick={()=>setShiftHint(false)}>Dismiss</button></span>:notice?<>{notice}{departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,title])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>redirect(zone)}>{title}</button>)}</span>:null}
        {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>redirect('hand')}>Retry removal</button>:null}
        {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void queue(async act=>{const departed=departureRef.current?.ref,chain=undoChain.current.after===undoId?undoChain.current.ids:[];undoChain.current={after:'',ids:[]};let updated=await act({type:'undo',actorSeat:seat,targetActionId:undoId});for(const id of chain)if(updated)updated=await act({type:'undo',actorSeat:seat,targetActionId:id})??updated;if(updated){if(departed&&updated.state.seats[seat].twin.some(card=>card.ref===departed&&publicField(card.zone)))watch.dismiss(departed);setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}</>:tapOffer?<span data-testid="tap-identify-offer">This computer is slow for live tracking. Switch to tap-to-identify?<button type="button" onClick={()=>answerTapOffer('switch')}>Switch</button><button type="button" onClick={()=>answerTapOffer('keep')}>Keep</button></span>:videoOfferShowing?<span data-testid="video-fps-offer">Your computer is struggling with video. Switch to 15 fps to reduce lag?<button type="button" onClick={()=>answerVideoOffer(15)}>Switch</button><button type="button" onClick={()=>answerVideoOffer(30)}>Keep</button></span>:undefined}/>
    {calibrating?<FieldCalibrationControl video={video} initialCalibration={watch.calibration} format={room.format?.id??room.state.deckChecks.format.id} detectCalibrationCards={async frame=>{const result=await detectCards(await createImageBitmap(frame));if(result.status!=='ready')throw new Error(result.note);return result.cards;}} onSave={grid=>{updateCalibration(grid,true);setCalibrating(false);}} onCancel={()=>{if(watch.calibrationNeeded&&!watch.calibration?.orientation)setDetection(false);setCalibrating(false);}}/>:null}
  </>;
}

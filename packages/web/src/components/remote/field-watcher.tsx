"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {catalogCardId,fieldZoneLocation,yugioh,type FieldEvent,type FieldTrack,type FieldZone,type KnownFieldCard,type FieldCalibration} from '@yugidraft/vision';
import {recentFieldDeparture,type RemoteRoom,type TwinCard} from '@yugidraft/shared/remote';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {fieldTwinPosition,fieldDepartureProposal,fieldPlacementProposals,fieldEvidenceMatches,simultaneousFieldCopies,applyVerifiedFieldMutation,StaleFieldPlacementError,observedFieldZone,staleFieldOccupant,retryFieldMutation} from '@/lib/remote/field-proposals';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {onManualMove} from '@/lib/remote/manual-moves';
import {projectFieldZone,fieldCandidateFitsZone,hardFieldZone,zoneMoveLabel,equipSourceOnField,becomesTrapMonster} from '@/lib/remote/field-legality';
import {bindFieldTiming,markFieldTiming,bindBackTiming} from '@/lib/remote/field-timing';
import {saveLocalFieldDiagnostic} from '@/lib/remote/field-diagnostics';
import {ownFieldResources,detectCards,prepareOwnReader} from './ui/recognizer';
import {RecognitionBadge} from './ui/recognition-setting';
import {useRecognitionBackend,gpuLossReason} from './ui/recognition-backend';
import {useVideoHub} from './ui/video-hub';
import {cardCode,sameObservedCard,deckIdsOf,seenCardIds,placedTwin} from './ui/model';
import {FieldCalibrationControl} from './field-calibration';
import {publishZoneGrid,clearZoneGrid,defaultSideFor,fieldDebugEnabled,publishFieldDebug,publishMissingPiles,publishFieldScan} from '@/lib/remote/zone-grid';
import {isTypingTarget} from '@/lib/typing-target';
import {FieldWatcherUI} from './field-watcher-ui';
import {serverNow} from './ui/api';
import {cardInfo,loadCards,useCardInfo} from './ui/catalog';

const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
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
    void prepareOwnReader({decklist:deckIdsOf(current.current.room,seat),seen:seenCardIds(current.current.room)}).catch(()=>undefined);
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
  const missingCopies=useRef(new Map<string,number>()),mergedCopies=useRef(new Map<string,number>()),repairingCopies=useRef(false);
  calibrationBusy.current=calibrating;
  const [failedUpdate,setFailedUpdate]=useState<{work:(act:RoomMutation)=>Promise<void>;event?:FieldEvent;humanChoice?:boolean}|null>(null);
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false),[recovery,setRecovery]=useState<StaleFieldPlacementError|null>(null);
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
  const holdForPlayer=(ref:string)=>{
    const id=[...bindings.current.entries()].find(([,bound])=>bound===ref)?.[0]??ref,track=watch.getTrack(id);
    if(track?.visible&&!track.removed)manual.current.set(ref,{...fieldZoneLocation(track.zone),position:track.position});
  };
  const undoCards=useRef(new Map<string,string[]>()),undoSeq=useRef<number|null>(null);
  useEffect(()=>{undoCards.current.clear();undoSeq.current=null;},[room.slug,seat]);
  useEffect(()=>{
    for(const entry of room.state.undoHistory??[])undoCards.current.set(entry.actionId,entry.cards);
    const events=room.events??[],newest=events.reduce((n,e)=>Math.max(n,e.seq),0);
    if(undoSeq.current===null){undoSeq.current=newest;return;}
    for(const e of events){
      if(e.seq<=undoSeq.current||e.action.type!=='undo')continue;
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
  /**
   * Pile exit. A card the camera sees on the field while the same card lies in this seat's
   * GY/banished pile is that pile card moving (never a 2nd copy) when the pile shows it left:
   * the pile outline is gone, or a hand was over the pile shortly before the card showed and
   * the copy was the top. A pile card the camera still sees on the pile stays.
   */
  function pileExit(track:Pick<FieldTrack,'zone'|'faceDown'|'firstSeen'>,entry:Entry|undefined,twins:readonly TwinCard[]):TwinCard|undefined {
    if(!entry||track.faceDown||piles.has(track.zone))return;
    const snap=watch.getSnapshot?.();if(!snap)return;
    for(const [zone,pileZone] of [['GY','graveyard'],['BANISHED','banished']] as const){
      const members=twins.filter(c=>c.zone===pileZone),copy=[...members].reverse().find(c=>c.faceUp&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name}));
      if(!copy)continue;
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
    existing=freshBinding.existing??pileExit(track,entry,twins);
    if(existing)track={...track,id:existing.ref};
    else if(twins.some(c=>c.ref===track.id))track={...track,id:`fw-${crypto.randomUUID()}`};
    const stale=staleFieldOccupant(twins,watch.getTracks().map(track=>({...track,id:bindings.current.get(track.id)??track.id})),track.zone,existing?.ref??track.id);
    if(stale){
      const departure=fieldDepartureProposal(stale,seat);
      if(!departure||!await act(departure))return;
      twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    }
    const projected=projectObserved(track,twins,existing,entry?cardInfo(catalogCardId(entry)):undefined);
    if(!projected.zone){abstain(event,projected.reason??'Choose a legal zone manually.');return;}
    const physicalAtSave={zone:track.zone,position:track.position};
    track={...track,zone:projected.zone};location=fieldZoneLocation(projected.zone);
    if(!piles.has(track.zone)&&twins.some(c=>c.ref!==existing?.ref&&c.zone===location.zone&&c.slot===location.slot)) {abstain(event,'This zone is occupied. Choose a free zone.');return;}
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
      if(existing&&!originReturn&&existing.faceUp===track.faceDown){updated=await mutate({type:'twin.flip',actorSeat:seat,seat,cardRef:existing.ref,faceUp:!track.faceDown,position:fieldTwinPosition(track),...(atomicReveal?{cardId:catalogCardId(entry!),name:entry!.name,bestMatch:track.bestMatch,source:'auto' as const}:{})});if(!updated)return;}
      // The resolver has just required a distinct, same-frame witness for every
      // existing copy. Undo's clock estimate rounds HTTP Date up; evidence must
      // use its lower bound so the server never sees a future camera sample.
      const copyCount=code?twins.filter(c=>{if(!publicField(c.zone)||!sameObservedCard(c,{cardId:code,name:entry?.name}))return false;const other=watch.getTrack(c.ref)??tracks.current.find(t=>(bindings.current.get(t.id)??t.id)===c.ref);return !!other&&simultaneousFieldCopies(track,other,true);}).length:0;
      const copyProof=!existing&&copyCount?{simultaneousQuads:copyCount+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-track.lastSeen))}:undefined;
      for(const proposal of atomicReveal?[]:fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing&&!originReturn,fromRef:originReturn?existing!.ref:undefined,copyProof})){
        // The camera row was not legal for this card type: the log line says so ("Trap → S3"). No prompt.
        updated=await mutate(proposal.type==='twin.place'&&projected.moved?{...proposal,zoneRule:projected.moved}:proposal);if(!updated){if(matchesEvidence(watch.getTrack(event.track.id)))offer({...event,type:'prompt',reason:'recognition-error'});return;}
        if(proposal.type==='twin.place'){
          const canonical=placedTwin(updated.state.seats[seat].twin,{...proposal.card,zone:proposal.zone});
          if(!canonical)throw new Error('Camera placement was not returned in its slot');
          if(canonical.ref!==track.id){existing=twins.find(c=>c.ref===canonical.ref)??canonical;track={...track,id:canonical.ref};}
          bindings.current.set(event.track.id,canonical.ref);
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
      setDeparture(null);setNotice(`${track.bestMatch?'Best match · ':''}${track.faceDown?'Face-down card':entry?.name} placed${projected.moved?` · ${projected.moved}`:''} · auto`);setUndoId(updated?.state.undo?.actionId??'');
      if(projected.moved)noteRowFix(target.card.ref);
    }finally{setPending(false);}
  }
  function handle(event:FieldEvent) {
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
      else offer(event);
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
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(!live()||!card)return;
      if(event.type==='removed') {
        if(!watch.isRemoved(event.track.id)&&!watch.isRemoved(card.ref))return;
        const proposal=fieldDepartureProposal(card,seat,event.destination==='DECK'?'deck':event.destination==='EXTRA'?'extra':undefined);if(!proposal)return;
        const name=proposal.name??(card.faceUp?entries.current.get(event.track.cardId??'')?.name:undefined)??'Card';
        const updated=await act({...proposal,...(card.faceUp?{name}:{})});
        if(!live()||!watch.isRemoved(card.ref))return;
        setDeparture({ref:card.ref,name,zone:updated?proposal.zone:'pending'});setNotice(`${name} ${proposal.zone==='deck'?'returned to Deck':'left the field'} · ${updated?'auto':'update failed'}`);setUndoId(updated?.state.undo?.actionId??'');return;
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
    async create(){const resources=await ownFieldResources(()=>({decklist:deckIdsOf(current.current.room,seat),seen:seenCardIds(current.current.room)}));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,earlyExitMargin:.02,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,cpuBusy:()=>resources.cpuBusy()||calibrationBusy.current};},onEvent:handle});
  const updateCalibration=useCallback((grid:FieldCalibration,placed?:boolean)=>{
    watch.setCalibration(grid,placed);
    // Keep an unanswered identity prompt, but require fresh visibility at the
    // new revision before accepting it. Already queued actions keep the old revision.
    setPrompts(list=>list.map(event=>{
      const track=watch.getTrack(event.track.id);
      return track?.state==='prompt'?{...event,track}:event;
    }));
  },[watch.setCalibration,watch.getTrack]);
  enabledRef.current=watch.enabled&&!watch.calibrationNeeded;tracks.current=watch.snapshot.tracks;
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
    const message=fieldTrackMessage(watch.snapshot,entries.current,known(),watch.calibration),key=JSON.stringify(message);lastMessage.current=message;
    if(key!==published.current){published.current=key;hub.publishFieldTracks(message);}
  },[watch.snapshot,watch.calibration,hub.publishFieldTracks,room.state]);
  // The feeds draw the zone grid from the saved calibration and the cards the watcher sees.
  const gridFormat=room.format?.id??room.state.deckChecks.format.id;
  const gridKey=watch.snapshot.tracks.filter(t=>t.visible&&!t.removed).map(t=>`${t.id}:${t.zone}:${t.card.quad.map(p=>`${p.x.toFixed(3)},${p.y.toFixed(3)}`).join(';')}`).join('|');
  useEffect(()=>{
    publishZoneGrid({ownSeat:seat,format:gridFormat,calibration:watch.calibration,placed:watch.placed,defaultSide:defaultSideFor(phone?'phone':'webcam'),setCalibration:updateCalibration,calibrate:()=>{if(host?.querySelector('video')?.videoWidth)setCalibrating(true);},
      tracks:watch.snapshot.tracks.filter(t=>t.visible&&!t.removed).map(t=>({id:t.id,zone:t.zone,quad:t.card.quad}))});
    // The key stands for the visible cards without republishing on every sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[seat,gridFormat,phone,watch.calibration,watch.placed,updateCalibration,gridKey,host,watch.snapshot.tracks.length]);
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
  const [scanning,setScanning]=useState(false),resyncing=useRef(false),resynced=useRef(new Map<string,{board:string;fails:number}>());
  useEffect(()=>{resynced.current.clear();},[room.slug,seat]);
  const boardState=()=>{let h=0;for(const c of current.current.room.state.seats[seat].twin)for(const ch of `${c.ref}|${c.zone}|${c.slot??''}|${c.position??''}|${c.faceUp?1:0};`)h=(h*31+ch.charCodeAt(0))|0;return String(h);};
  /** False when this fix was already tried on this board state. A failed write may try again (3 times) next cycle. */
  const tryFix=(key:string)=>{const board=boardState(),seen=resynced.current.get(key);if(seen?.board===board)return false;resynced.current.set(key,{board,fails:seen?.fails??0});return true;};
  const fixFailed=(key:string,error:unknown)=>{console.info('[remote field] re-sync write skipped',key,error instanceof Error?error.message:error);const seen=resynced.current.get(key);if(seen&&++seen.fails<3)seen.board='';};
  function resync(manualScan=false) {
    if(resyncing.current||!live()||calibrationBusy.current){if(manualScan){setScanning(false);setNotice(resyncing.current?'Board check already running':'Camera is not watching the field');}return;}
    resyncing.current=true;
    void queue(async act=>{
      let changes=0,lastUndo='';const snap=watch.getSnapshot?.(),fullAt=snap?.lastFullAt;
      if(!snap||!live()||fullAt===undefined)return;
      const refOf=(t:FieldTrack)=>bindings.current.get(t.id)??t.id;
      const write=async(key:string,proposal:Parameters<RoomMutation>[0])=>{
        try{const updated=await act(proposal);if(updated){changes++;lastUndo=updated.state.undo?.actionId??lastUndo;}return updated;}catch(error){fixFailed(key,error);}
      };
      // Only cards the last full detector pass saw (on CPU it can be seconds old), after they settled.
      const settled=snap.tracks.filter(t=>t.state==='identified'&&t.visible&&!t.removed&&!piles.has(t.zone)&&t.lastSeen>=fullAt&&fullAt-t.firstSeen>1500);
      // 1. A known field card in another zone than the camera shows: move it (zone rules apply).
      for(const t of settled){
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(c=>c.ref===refOf(t));
        if(!card||!publicField(card.zone)||!t.cardId&&!t.faceDown||keepsManual(card.ref,fieldZoneLocation(t.zone),t.position))continue;
        const code=cardCode(card);if(code)await loadCards([code]);
        const projected=projectObserved(t,twins,card,cardInfo(code));if(!projected.zone)continue;
        // A hard-rule fix (Field Spell → FIELD) the player undid is not redone here either.
        if(ruleFixes.current.has(`${card.ref}:${toZone(card.zone,card.slot)}:${projected.zone}`))continue;
        const location=fieldZoneLocation(projected.zone),position=fieldTwinPosition({...t,zone:projected.zone});
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
      const text=`Board re-synced (${changes} change${changes===1?'':'s'})`;
      // The note is a log line only: the server keeps it out of the undo history, so Undo reverts the last fix.
      if(changes){try{await act({type:'log.note',actorSeat:seat,text});}catch(error){console.info('[remote field] re-sync note skipped',error);}setNotice(text);setUndoId(lastUndo);}
      else if(manualScan)setNotice('Board matches the camera');
    },undefined,false,true).finally(()=>{resyncing.current=false;if(manualScan)setScanning(false);});
  }
  const resyncRef=useRef(resync);resyncRef.current=resync;
  useEffect(()=>{
    const every=recognition.backend==='webgpu'?4000:8000;
    const timer=setInterval(()=>{if(!document.hidden)resyncRef.current();},every);
    return()=>clearInterval(timer);
  },[room.slug,seat,recognition.backend]);
  // "Scan field": force a full detector pass, wait for it (3 s at most), then re-sync once.
  const scanTimer=useRef<ReturnType<typeof setInterval>|undefined>(undefined);
  useEffect(()=>()=>clearInterval(scanTimer.current),[]);
  const scanField=useCallback(()=>{
    if(scanTimer.current!==undefined||resyncing.current){setNotice('Board check already running');return;}
    setScanning(true);const asked=performance.now(),since=watch.getSnapshot?.()?.lastFullAt??-Infinity;watch.scanNow?.();
    scanTimer.current=setInterval(()=>{
      const full=watch.getSnapshot?.()?.lastFullAt??-Infinity;
      if(full>since&&full>=asked-50||performance.now()-asked>=3000){clearInterval(scanTimer.current);scanTimer.current=undefined;resyncRef.current(true);}
    },100);
  },[watch.scanNow,watch.getSnapshot]);
  useEffect(()=>{publishFieldScan({seat,scanning,enabled:watch.enabled,ready:ownsSource&&hub.cameraOn,scan:scanField});},[seat,scanning,scanField,ownsSource,hub.cameraOn,watch.enabled]);
  useEffect(()=>()=>publishFieldScan({seat:null,scanning:false,enabled:false,ready:false}),[]);
  // "S" scans the field from anywhere on the page, like the button beside the board.
  const canScan=ownsSource&&hub.cameraOn&&watch.enabled&&!scanning;
  const scanRef=useRef({canScan,scanField});scanRef.current={canScan,scanField};
  useEffect(()=>{
    const onKey=(event:KeyboardEvent)=>{
      if((event.key!=='s'&&event.key!=='S')||event.ctrlKey||event.metaKey||event.altKey||event.shiftKey||event.repeat||event.defaultPrevented||isTypingTarget(event.target))return;
      if(!scanRef.current.canScan||document.querySelector('[role="dialog"][aria-modal="true"]'))return;
      event.preventDefault();scanRef.current.scanField();
    };
    document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
  },[]);
  // Debug overlay (own feed): raw detector boxes, track states and the last decision per track.
  useEffect(()=>{if(!fieldDebugEnabled())return;const m=watch.snapshot.metrics;publishFieldDebug({debug:watch.snapshot.debug,tracks:watch.snapshot.tracks,status:watch.snapshot.status,detectorMs:m.detectorMs,dutyPercent:m.dutyPercent,intervalMs:m.intervalMs,writeError:lastWriteError.current,backend:debugBackend()});},[watch.snapshot]);
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
  const label=watch.aspectChanged?'Camera shape changed · Calibrate zones':watch.calibrationNeeded?(watch.calibration?.orientation?'Calibrate your zones · auto-placement paused':'Choose your side · auto-placement paused'):!watch.enabled?'Auto-placement off':watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  const readingStyles=room.state.seats.flatMap((player,index)=>player.twin.flatMap(card=>{
    if(!card.ref.startsWith('fw-')||cardCode(card)||!card.faceUp||!publicField(card.zone))return [];
    const zone=card.zone==='monster'?`m${card.slot??1}`:card.zone==='spell-trap'?`s${card.slot??1}`:card.zone==='extra-monster'?`emz${card.slot??1}`:'f';
    const selector=`[data-testid="field-${index}"] [data-zone="${zone}"]`;
    const prompt=index===seat&&activePrompts.some(p=>(bindings.current.get(p.track.id)??p.track.id)===card.ref);
    return [`${selector}>div:first-child{background:linear-gradient(110deg,#233c3b 20%,#507b70 45%,#233c3b 70%);background-size:240% 100%;${prompt?'':'animation:field-reading 1.2s linear infinite;'}}${selector}>div:first-child>span{font-size:0}${selector}>div:first-child>span::after{content:"${prompt?'Identify card':'Reading…'}";font-size:10px;color:#e5f5ef}`];
  })).join('');
  return <>
    <style>{`@keyframes field-reading{to{background-position:-240% 0}}${readingStyles}@media(prefers-reduced-motion:reduce){[data-testid^="field-"] [data-zone]>div{animation:none!important}}`}</style>
    <FieldWatcherUI dock={dock} host={host} enabled={watch.enabled} onEnabledChange={watch.setEnabled} statusLabel={label} statusExtra={<RecognitionBadge phoneCamera={hub.phones.some(p=>p.seat===seat)}/>} statusTitle={watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%`} calibrated={watch.placed} calibrationDisabled={!video?.videoWidth} onCalibrate={()=>setCalibrating(true)} pending={pending}
      prompts={promptViews}
      onChoose={(id,cardId)=>{
        console.info('[remote field] candidate click',id,cardId);
        const event=activePrompts.find(p=>p.track.id===id),track=watch.getTrack(id);
        if(!event||!track){console.error('[remote field] expired candidate prompt',id);setNotice('Card prompt expired. Keep the card still for a fresh read.');return;}
        const selection={...event,track};setFailedUpdate(null);setPending(true);
        void queue(act=>apply(selection,act,cardId==='face-down'?undefined:cardId),selection,cardId!=='face-down').finally(()=>setPending(false));
      }}
      onDismiss={id=>{watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));void queue(async act=>{await removePlaceholder(id,act);});}}
      noticeTestId={departure?'field-departure-toast':undefined}
      notice={failedUpdate?<>{notice||'Could not save the field update.'}<button type="button" disabled={pending} onClick={()=>void queue(failedUpdate.work,failedUpdate.event,failedUpdate.humanChoice)}>Retry field update</button></>:recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:shiftHint?<span data-testid="zone-shift-hint">Zones look shifted — Recalibrate?<button type="button" onClick={()=>{setShiftHint(false);setCalibrating(true);}}>Recalibrate</button><button type="button" onClick={()=>setShiftHint(false)}>Dismiss</button></span>:notice?<>{notice}{departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,title])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>redirect(zone)}>{title}</button>)}</span>:null}
        {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>redirect('hand')}>Retry removal</button>:null}
        {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void queue(async act=>{const departed=departureRef.current?.ref,updated=await act({type:'undo',actorSeat:seat,targetActionId:undoId});if(updated){if(departed&&updated.state.seats[seat].twin.some(card=>card.ref===departed&&publicField(card.zone)))watch.dismiss(departed);setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}</>:undefined}/>
    {calibrating?<FieldCalibrationControl video={video} initialCalibration={watch.calibration} format={room.format?.id??room.state.deckChecks.format.id} detectCalibrationCards={async frame=>{const result=await detectCards(await createImageBitmap(frame));if(result.status!=='ready')throw new Error(result.note);return result.cards;}} onSave={grid=>{updateCalibration(grid,true);setCalibrating(false);}} onCancel={()=>{if(watch.calibrationNeeded&&!watch.calibration?.orientation)watch.setEnabled(false);setCalibrating(false);}}/>:null}
  </>;
}

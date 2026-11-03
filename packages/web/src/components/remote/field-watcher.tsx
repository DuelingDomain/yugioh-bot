"use client";

import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {catalogCardId,fieldZoneLocation,yugioh,type FieldEvent,type FieldTrack,type FieldZone,type KnownFieldCard,type FieldCalibration} from '@yugidraft/vision';
import {recentFieldDeparture,type RemoteRoom,type TwinCard} from '@yugidraft/shared/remote';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {fieldTwinPosition,fieldDepartureProposal,fieldPlacementProposals,fieldEvidenceMatches,simultaneousFieldCopies,applyVerifiedFieldMutation,StaleFieldPlacementError,observedFieldZone,staleFieldOccupant,retryFieldMutation} from '@/lib/remote/field-proposals';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {onManualMove} from '@/lib/remote/manual-moves';
import {projectFieldZone,fieldCandidateFitsZone} from '@/lib/remote/field-legality';
import {bindFieldTiming,markFieldTiming,bindBackTiming} from '@/lib/remote/field-timing';
import {saveLocalFieldDiagnostic} from '@/lib/remote/field-diagnostics';
import {ownFieldResources,detectCards,prepareOwnReader} from './ui/recognizer';
import {RecognitionBadge} from './ui/recognition-setting';
import {useRecognitionBackend} from './ui/recognition-backend';
import {useVideoHub} from './ui/video-hub';
import {cardCode,sameObservedCard,deckIdsOf,seenCardIds,placedTwin} from './ui/model';
import {FieldCalibrationControl} from './field-calibration';
import {publishZoneGrid,clearZoneGrid,defaultSideFor} from '@/lib/remote/zone-grid';
import {FieldWatcherUI} from './field-watcher-ui';
import {serverNow} from './ui/api';
import {cardInfo,loadCards,useCardInfo} from './ui/catalog';

const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
const publicField=(zone:string)=>['monster','extra-monster','spell-trap','field','pendulum'].includes(zone);
const sameFieldSlot=(a:TwinCard,b:TwinCard)=>publicField(a.zone)&&a.zone===b.zone&&(a.zone==='field'||(a.slot!==undefined&&a.slot===b.slot));
const piles=new Set<FieldZone>(['GY','BANISHED','DECK','EXTRA']);
const physicalZonePattern=/^(?:M[1-5]|S[1-5]|EMZ[12]|FIELD)$/;
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
  const prompted=useRef(new Set<string>()),placeholders=useRef(new Map<string,string>()),readerRemovals=useRef(new Set<string>());
  const missingCopies=useRef(new Map<string,number>()),mergedCopies=useRef(new Map<string,number>()),repairingCopies=useRef(false);
  calibrationBusy.current=calibrating;
  const [failedUpdate,setFailedUpdate]=useState<{work:(act:RoomMutation)=>Promise<void>;event?:FieldEvent}|null>(null);
  const unbacked=useRef(new Map<string,{since:number;samples:number;sample:number}>()),releasing=useRef(new Set<string>());
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false),[recovery,setRecovery]=useState<StaleFieldPlacementError|null>(null);
  const [departure,setDepartureState]=useState<Departure|null>(null),departureRef=useRef<Departure|null>(null);
  useEffect(()=>setRecovery(null),[room.slug,seat]);
  const setDeparture=(value:Departure|null)=>{departureRef.current=value;setDepartureState(value);};
  useEffect(()=>{setHost(document.querySelector<HTMLElement>(`[data-testid="feed-box-${seat}"]`));setPrompts([]);previousRefs.current=new Set();bindings.current.clear();},[room.slug,seat,source]);
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
    return saved?{zone:saved,label:''}:projectFieldZone({zone:track.zone,facts,twins,ref:card?.ref,faceDown:track.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
  };
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{if([...placeholders.current.values()].includes(c.ref))return [];const zone=c.zone==='hand'?'HAND' as const:knownZone(c);return zone?[{id:c.ref,zone,cardId:c.faceUp||c.publicIdentity||['deck','hand','extra'].includes(c.zone)?String(cardCode(c)??''):undefined,faceDown:!c.faceUp,position:c.position}]:[];});
  const offer=(event:FieldEvent)=>{
    if(event.track.faceDown||prompted.current.has(event.track.id))return;
    // React may replay state updaters. Reserve once outside the pure updater.
    prompted.current.add(event.track.id);setPrompts(list=>[...list.slice(-5),event]);
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
  function queue(work:(act:RoomMutation)=>Promise<void>,event?:FieldEvent) {
    console.info('[remote field] queued',event?.type,event?.track.id,event?.track.revision);
    markFieldTiming(event?.timing,'queued');
    return transaction(async(latest,act)=>{
      current.current.room=latest;markFieldTiming(event?.timing,'dequeued');
      console.info('[remote field] dequeued',event?.type,event?.track.id,latest.lastSeq);
      const apply:RoomMutation=async (proposal,idempotencyKey)=>{const actionId=idempotencyKey??crypto.randomUUID();bindFieldTiming(actionId,current.current.room.slug,event?.timing);
        console.info('[remote field] write',proposal.type,actionId);markFieldTiming(event?.timing,'mutation',{actionId});const updated=await retryFieldMutation(act,proposal,actionId,()=>proposal.type==='undo'||live()&&(!event||(event.type==='removed'?watch.isRemoved(event.track.id):fieldEvidenceMatches(event,watch.getTrack(event.track.id)))),error=>{console.warn('[remote field] save failed',proposal.type,error);markFieldTiming(event?.timing,'writeFailed',{type:proposal.type});setNotice('Could not save the field update. Retrying…');});console.info('[remote field] write result',proposal.type,updated?.lastSeq??'not saved');if(!updated)setNotice('Card changed before the field update was saved. Keep it still, then try again.');if(updated){current.current.room=updated;prunePhysical();}return updated;};
      await work(apply);console.info('[remote field] flushed',event?.type,event?.track.id,current.current.room.lastSeq);setFailedUpdate(previous=>previous?.work===work?null:previous);
    }).catch(error=>{console.error('[remote field] update failed',error);if(error instanceof StaleFieldPlacementError)setRecovery(error);else{setFailedUpdate({work,event});setNotice(error instanceof Error?error.message:'Could not save the field update. Use Retry field update.');}});
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
    if(!existing&&entry){
      const copies=twins.filter(c=>reusable(c)&&sameObservedCard(c,{cardId:catalogCardId(entry),name:entry.name})).sort((a,b)=>Number(recentFieldDeparture(b,serverNow()))*2+Number(publicField(b.zone))-Number(recentFieldDeparture(a,serverNow()))*2-Number(publicField(a.zone)));
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
  async function apply(event:FieldEvent,act:RoomMutation,chosen?:string) {
    console.info('[remote field] identify',event.track.id,chosen??event.track.cardId,event.track.zone,event.type);
    const observed=watch.getTrack(event.track.id);
    if(!live()||!fieldEvidenceMatches(event,observed)){
      console.warn('[remote field] identification deferred',event.track.id,observed?.state,observed?.visible,observed?.revision);
      setNotice(chosen?'Card is moving or covered. Keep it still, then choose again.':'Card changed before identification. Keep it still for a fresh read.');return;
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
        const updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.move',actorSeat:seat,seat,cardRef:setPlaceholder.ref,...location,position:fieldTwinPosition(track)});if(!updated)return;
      }
      placeholders.current.delete(event.track.id);bindings.current.set(event.track.id,setPlaceholder.ref);
      watch.confirm(event.track.id,undefined,setPlaceholder.ref,false);rememberPhysical(setPlaceholder.ref,track.zone);return;
    }
    // Reserve the visual cue until catalog loading and duplicate checks finish.
    twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    track={...track,id:bindings.current.get(event.track.id)??event.track.id};
    const resolved=resolveExisting(event,track,entry,twins);
    if(resolved.blocked){offer({...event,type:'prompt',reason:'uncertain'});return;}
    existing=resolved.existing;
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
    const latest=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,latest))throw new Error('Card changed while loading its details. Keep it still, then try again.');
    // Keep the reserved physical ref while refreshing geometry and occupancy after I/O.
    track={...latest!,id:existing?.ref??placementRef,...(chosen?{cardId:chosen,faceDown:false}:{})};
    twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    const freshBinding=resolveExisting(event,track,entry,twins);
    if(freshBinding.blocked){abstain(event,'Another physical card owns this ref. Check the field.');return;}
    existing=freshBinding.existing;
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
    if(!piles.has(track.zone)&&twins.some(c=>c.ref!==existing?.ref&&c.zone===location.zone&&c.slot===location.slot)) {offer({...event,type:'prompt',reason:'uncertain'});return;}
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
      if(existing&&!originReturn&&existing.faceUp===track.faceDown){updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.flip',actorSeat:seat,seat,cardRef:existing.ref,faceUp:!track.faceDown,position:fieldTwinPosition(track),...(atomicReveal?{cardId:catalogCardId(entry!),name:entry!.name,bestMatch:track.bestMatch,source:'auto' as const}:{})});if(!updated)return;}
      // The resolver has just required a distinct, same-frame witness for every
      // existing copy. Undo's clock estimate rounds HTTP Date up; evidence must
      // use its lower bound so the server never sees a future camera sample.
      const copyCount=code?twins.filter(c=>{if(!publicField(c.zone)||!sameObservedCard(c,{cardId:code,name:entry?.name}))return false;const other=watch.getTrack(c.ref)??tracks.current.find(t=>(bindings.current.get(t.id)??t.id)===c.ref);return !!other&&simultaneousFieldCopies(track,other,true);}).length:0;
      const copyProof=!existing&&copyCount?{simultaneousQuads:copyCount+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-track.lastSeen))}:undefined;
      for(const proposal of atomicReveal?[]:fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing&&!originReturn,fromRef:originReturn?existing!.ref:undefined,copyProof})){
        updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,proposal);if(!updated){if(fieldEvidenceMatches(event,watch.getTrack(event.track.id)))offer({...event,type:'prompt',reason:'recognition-error'});return;}
        if(proposal.type==='twin.place'){
          const canonical=placedTwin(updated.state.seats[seat].twin,{...proposal.card,zone:proposal.zone});
          if(!canonical)throw new Error('Camera placement was not returned in its slot');
          if(canonical.ref!==track.id){existing=twins.find(c=>c.ref===canonical.ref)??canonical;track={...track,id:canonical.ref};}
          bindings.current.set(event.track.id,canonical.ref);
        }
      }
      const currentTarget=()=>{
        const observed=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,observed))return;
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
        updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.move',source:'auto',actorSeat:seat,seat,cardRef:target.card.ref,...target.location,position:target.position});
        if(!updated)return;
        target=currentTarget();if(!target)return;
        if(!matches(target)){setNotice('The card is still moving. Confirm it once settled.');return;}
      }
      if(!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      placeholders.current.delete(event.track.id);
      bindings.current.set(event.track.id,target.card.ref);
      watch.confirm(event.track.id,track.cardId,target.card.ref,event.type==='prompt');rememberPhysical(target.card.ref,target.observed.zone);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
      setDeparture(null);setNotice(`${track.bestMatch?'Best match · ':''}${track.faceDown?'Face-down card':entry?.name} placed · auto`);setUndoId(updated?.state.undo?.actionId??'');
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
      if(event.reason==='pile'&&event.result?.tier==='sure'&&['GY','BANISHED'].includes(event.track.zone))void queue(act=>apply(event,act),event);
      else offer(event);
      return;
    }
    void queue(async act=>{
      if(event.previousId&&!await removePlaceholder(event.previousId,act))return;
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
  const watch=useFieldWatcher({owner:ownsSource,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,duelKey:room.slug,deviceKey:cameraKey,deviceLabel:hub.devices.find(d=>d.deviceId===hub.cameraId)?.label||undefined,sourceKey:readerKey,
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
  useEffect(()=>{
    if(!live()||calibrationBusy.current||!watch.placed||!['watching','budget'].includes(watch.snapshot.status)){unbacked.current.clear();return;}
    const at=performance.now(),sample=watch.snapshot.metrics.samples;
    for(const card of current.current.room.state.seats[seat].twin){
      if(!publicField(card.zone)||manual.current.has(card.ref)||releasing.current.has(card.ref))continue;
      // Existing tracks own clear-mat/hand/Undo checks. This window only
      // releases virtual reservations that have no local physical track.
      const zone=knownZone(card),backed=watch.snapshot.tracks.some(t=>
        (bindings.current.get(t.id)??t.id)===card.ref||!t.removed&&at-t.lastSeen<450&&t.zone===zone&&t.state==='candidate');
      if(backed){unbacked.current.delete(card.ref);continue;}
      const missing=unbacked.current.get(card.ref)??{since:at,samples:0,sample:-1};
      if(sample!==missing.sample){missing.samples++;missing.sample=sample;}unbacked.current.set(card.ref,missing);
      if(missing.samples<3||at-missing.since<200)continue;
      releasing.current.add(card.ref);
      void queue(async act=>{
        const latest=current.current.room.state.seats[seat].twin.find(c=>c.ref===card.ref);
        const witness=watch.getTracks().some(t=>(bindings.current.get(t.id)??t.id)===card.ref||!t.removed&&performance.now()-t.lastSeen<450&&t.state==='candidate'&&t.zone===zone);
        if(!latest||!publicField(latest.zone)||witness)return;
        const proposal=fieldDepartureProposal(latest,seat);if(proposal&&await act(proposal))unbacked.current.delete(card.ref);
      }).finally(()=>releasing.current.delete(card.ref));
    }
  },[watch.snapshot,watch.placed,room.state]);

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
  const video=host?.querySelector('video')??null;
  useEffect(()=>{
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
  useEffect(()=>{const timer=setInterval(()=>hub.publishFieldTracks(lastMessage.current),1000);return()=>clearInterval(timer);},[hub.publishFieldTracks]);
  useEffect(()=>()=>hub.publishFieldTracks({type:'field.tracks',cards:[]}),[hub.publishFieldTracks]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>{setNotice('');setDeparture(null);setUndoId('');},5000);return()=>clearTimeout(timer);},[notice,undoId]);
  const activePrompts=prompts.filter(event=>{const live=watch.getTrack(event.track.id);return live?.state==='prompt'&&(live.revision??0)===(event.track.revision??0);});
  const promptInfo=useCardInfo(activePrompts.flatMap(event=>(event.result?.candidates??[]).map(candidate=>{const entry=entries.current.get(candidate.cardId);return entry?catalogCardId(entry):undefined;})));
  const promptViews=activePrompts.map(event=>{
    const observed=watch.getTrack(event.track.id)!,twins=current.current.room.state.seats[seat].twin;
    const choices=event.reason==='pile'?[]:observed.faceDown?[{cardId:'face-down'}]:(event.result?.candidates??[]).filter(candidate=>{const entry=entries.current.get(candidate.cardId);return fieldCandidateFitsZone(observed.zone,entry?promptInfo(catalogCardId(entry)):undefined);}).slice(0,5);
    return {id:event.track.id,zone:observed.zone,title:event.reason==='changed'?'Card changed?':'New card?',quad:observed.card.quad,emptyMessage:event.reason==='pile'?'Move an existing card to this pile from its popup.':undefined,
      candidates:choices.map(candidate=>{
        const entry=entries.current.get(candidate.cardId),track={...observed,id:bindings.current.get(event.track.id)??event.track.id,cardId:candidate.cardId};
        const resolved=resolveExisting(event,track,entry,twins);
        const projected=projectFieldZone({zone:observed.zone,facts:entry?promptInfo(catalogCardId(entry)):undefined,twins,ref:resolved.existing?.ref,faceDown:observed.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        return {id:candidate.cardId,label:`${observed.faceDown?'Confirm face-down card':entry?.name??candidate.cardId} · ${resolved.blocked?'Another physical card owns this ref':projected.zone?`To ${projected.label}`:projected.reason}`,disabled:resolved.blocked||!projected.zone};
      })};
  });
  const label=watch.calibrationNeeded?(watch.calibration?.orientation?'Calibrate your zones · auto-placement paused':'Choose your side · auto-placement paused'):!watch.enabled?'Auto-placement off':watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
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
        void queue(act=>apply(selection,act,cardId==='face-down'?undefined:cardId),selection).finally(()=>setPending(false));
      }}
      onDismiss={id=>{watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));void queue(async act=>{await removePlaceholder(id,act);});}}
      noticeTestId={departure?'field-departure-toast':undefined}
      notice={failedUpdate?<>{notice||'Could not save the field update.'}<button type="button" disabled={pending} onClick={()=>void queue(failedUpdate.work,failedUpdate.event)}>Retry field update</button></>:recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:notice?<>{notice}{departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,title])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>redirect(zone)}>{title}</button>)}</span>:null}
        {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>redirect('hand')}>Retry removal</button>:null}
        {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void queue(async act=>{const departed=departureRef.current?.ref,updated=await act({type:'undo',actorSeat:seat,targetActionId:undoId});if(updated){if(departed&&updated.state.seats[seat].twin.some(card=>card.ref===departed&&publicField(card.zone)))watch.dismiss(departed);setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}</>:undefined}/>
    {calibrating?<FieldCalibrationControl video={video} initialCalibration={watch.calibration} format={room.format?.id??room.state.deckChecks.format.id} detectCalibrationCards={async frame=>{const result=await detectCards(await createImageBitmap(frame));if(result.status!=='ready')throw new Error(result.note);return result.cards;}} onSave={grid=>{updateCalibration(grid,true);setCalibrating(false);}} onCancel={()=>{if(watch.calibrationNeeded&&!watch.calibration?.orientation)watch.setEnabled(false);setCalibrating(false);}}/>:null}
  </>;
}

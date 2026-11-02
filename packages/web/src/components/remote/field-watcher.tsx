"use client";

import {useCallback,useEffect,useRef,useState} from 'react';
import {catalogCardId,fieldZoneLocation,yugioh,type FieldEvent,type FieldTrack,type FieldZone,type KnownFieldCard,type FieldCalibration} from '@yugidraft/vision';
import type {RemoteRoom,TwinCard} from '@yugidraft/shared/remote';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {fieldTwinPosition,fieldDepartureProposal,fieldPlacementProposals,fieldEvidenceMatches,simultaneousFieldCopies,applyVerifiedFieldMutation,StaleFieldPlacementError} from '@/lib/remote/field-proposals';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {onManualMove} from '@/lib/remote/manual-moves';
import {projectFieldZone} from '@/lib/remote/field-legality';
import {saveLocalFieldDiagnostic} from '@/lib/remote/field-diagnostics';
import {ownFieldResources,detectCards} from './ui/recognizer';
import {useVideoHub} from './ui/video-hub';
import {cardCode,deckIdsOf,seenCardIds,placedTwin} from './ui/model';
import {FieldCalibrationControl} from './field-calibration';
import {publishZoneGrid,clearZoneGrid} from '@/lib/remote/zone-grid';
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
const destinations=[['graveyard','GY'],['banished','Banish'],['hand','Hand'],['extra','Extra Deck']] as const;
/** Owner evidence, table mutations and UI remain isolated from the feed reader. */
export function AutoFieldWatcher({room,transaction,diagnosticsAllowed=false}:{room:RemoteRoom;transaction:RoomTransaction;diagnosticsAllowed?:boolean}) {
  const hub=useVideoHub(),seat=room.mySeat,source=hub.sourceFor(seat);
  const phone=hub.phones.find(p=>p.seat===seat&&p.paired);
  const ownsSource=!!source&&(source.local||!!phone&&phone.mode!=='scan');
  const cameraKey=phone?`phone:${phone.id}`:hub.cameraId;
  const current=useRef({room,active:false});
  if(current.current.room.slug!==room.slug||room.lastSeq>=current.current.room.lastSeq)current.current.room=room;
  current.current.active=ownsSource&&hub.cameraOn;
  const enabledRef=useRef(true),calibrationBusy=useRef(false),tracks=useRef<FieldTrack[]>([]);
  const manual=useRef(new Map<string,{zone:string;slot?:number;position?:string}>());
  const entries=useRef(new Map<string,Entry>()),bindings=useRef(new Map<string,string>()),published=useRef(''),lastMessage=useRef<ReturnType<typeof fieldTrackMessage>>({type:'field.tracks',cards:[]}),previousRefs=useRef(new Set<string>());
  const physicalKey=`dd-field-physical:v1:${room.guildId}:${room.slug}:${seat}`,physical=useRef<{key:string;zones:Map<string,FieldZone>}|null>(null);
  if(physical.current?.key!==physicalKey)physical.current={key:physicalKey,zones:readPhysicalZones(physicalKey)};
  const [host,setHost]=useState<HTMLElement|null>(null),[prompts,setPrompts]=useState<FieldEvent[]>([]),[calibrating,setCalibrating]=useState(false);
  const prompted=useRef(new Set<string>()),placeholders=useRef(new Map<string,string>()),readerRemovals=useRef(new Set<string>());
  const missingCopies=useRef(new Map<string,number>()),mergedCopies=useRef(new Map<string,number>()),repairingCopies=useRef(false);
  calibrationBusy.current=calibrating;
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
  const knownZone=(card:TwinCard)=>publicField(card.zone)?physical.current!.zones.get(card.ref)??toZone(card.zone,card.slot):toZone(card.zone,card.slot);
  const projectObserved=(track:Pick<FieldTrack,'zone'|'faceDown'>,twins:readonly TwinCard[],card:TwinCard|undefined,facts:ReturnType<typeof cardInfo>,wasHidden=false):ReturnType<typeof projectFieldZone>=>{
    // Turning a bound card over retains its virtual destination until it physically moves.
    const saved=card&&(track.faceDown||!card.faceUp||wasHidden)&&knownZone(card)===track.zone?toZone(card.zone,card.slot):undefined;
    return saved?{zone:saved,label:''}:projectFieldZone({zone:track.zone,facts,twins,ref:card?.ref,faceDown:track.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
  };
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{if([...placeholders.current.values()].includes(c.ref))return [];const zone=knownZone(c);return zone?[{id:c.ref,zone,cardId:c.faceUp?String(cardCode(c)??''):undefined,faceDown:!c.faceUp,position:c.position}]:[];});
  const offer=(event:FieldEvent)=>!event.track.faceDown&&setPrompts(list=>{if(prompted.current.has(event.track.id))return list;prompted.current.add(event.track.id);return [...list.slice(-5),event];});
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
  function queue(work:(act:RoomMutation)=>Promise<void>) {
    return transaction(async(latest,act)=>{
      current.current.room=latest;
      const apply:RoomMutation=async proposal=>{const updated=await act(proposal);if(updated){current.current.room=updated;prunePhysical();}return updated;};
      await work(apply);
    }).catch(error=>{if(error instanceof StaleFieldPlacementError)setRecovery(error);else setNotice('Could not update the field. Try a card prompt.');});
  }
  function resolveExisting(event:FieldEvent,track:FieldTrack,entry:Entry|undefined,twins:readonly TwinCard[]) {
    let existing=twins.find(c=>c.ref===track.id);
    const sameSlot=(c:typeof twins[number])=>knownZone(c)===track.zone;
    const owns=(t:FieldTrack,ref:string)=>(bindings.current.get(t.id)??t.id)===ref;
    if(!existing&&event.type==='prompt'){
      // Explicit confirmation may correct the old twin at this physical spot,
      // including a reserved restart ref whose identity has not been trusted.
      const bound=twins.find(c=>c.ref===event.bindRef);
      if(bound&&tracks.current.some(t=>t.id!==event.track.id&&owns(t,bound.ref)&&t.visible&&!t.removed)){return {existing,blocked:true};}
      // The physical card can move while its prompt waits; keep its reservation.
      existing=bound??twins.find(c=>sameSlot(c)&&!tracks.current.some(t=>owns(t,c.ref)&&t.visible&&!t.removed));
    }
    if(!existing&&entry){
      const copies=twins.filter(c=>cardCode(c)===catalogCardId(entry));
      for(const copy of copies){
        const cached=tracks.current.find(t=>t.id!==event.track.id&&owns(t,copy.ref));
        // Events precede the React snapshot render. Both witnesses must be read
        // from the running watcher, rather than comparing a new frame to stale UI.
        const other=watch.getTrack(copy.ref)??(cached?watch.getTrack(cached.id):undefined);
        if(other&&simultaneousFieldCopies(track,other))continue;
        // An occluded/lost copy or an existing pile/hand copy owns this read.
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
    const observed=watch.getTrack(event.track.id);
    if(!live()||!fieldEvidenceMatches(event,observed)||placeholders.current.has(event.track.id))return;
    const location=fieldZoneLocation(observed!.zone),twins=current.current.room.state.seats[seat].twin;
    if(piles.has(observed!.zone)||twins.some(c=>c.zone===location.zone&&c.slot===location.slot))return;
    const proposal=fieldPlacementProposals({track:{...observed!,cardId:undefined},seat})[0];if(!proposal||proposal.type!=='twin.place')return;
    const updated=await act(proposal);if(!updated)return;
    const saved=updated.state.seats[seat].twin.find(c=>c.zone===location.zone&&c.slot===location.slot);if(!saved)return;
    placeholders.current.set(event.track.id,saved.ref);bindings.current.set(event.track.id,saved.ref);
    const after=watch.getTrack(event.track.id);
    if(!after||after.removed||after.revision!==event.track.revision)await removePlaceholder(event.track.id,act);
  }
  async function apply(event:FieldEvent,act:RoomMutation,chosen?:string) {
    const observed=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,observed))return;
    let track={...observed!,id:bindings.current.get(event.track.id)??event.track.id,...(chosen?{cardId:chosen,faceDown:false}:{})};
    const entry=track.cardId?entries.current.get(track.cardId):undefined;
    let twins=current.current.room.state.seats[seat].twin;
    let existing=twins.find(c=>c.ref===track.id);
    let location=fieldZoneLocation(track.zone);
    if(!track.faceDown&&!entry){offer({...event,type:'prompt',reason:'recognition-error'});return;}
    if(piles.has(track.zone)){
      const resolved=resolveExisting(event,track,entry,twins);
      if(resolved.blocked)return;
      existing=resolved.existing;
      // A pile outline can follow a uniquely lost instance; it cannot create one.
      const lost=tracks.current.filter(t=>t.id!==track.id&&t.state==='identified'&&(!t.visible||t.removed)&&t.cardId===track.cardId&&track.firstSeen-t.lastSeen<10000&&twins.some(c=>c.ref===t.id));
      if(!existing&&lost.length===1){existing=twins.find(c=>c.ref===lost[0].id);}
      if(!existing){offer({...event,type:'prompt',reason:'pile'});return;}
      const moved=await act({type:'twin.move',actorSeat:seat,seat,cardRef:existing.ref,...location,position:fieldTwinPosition(track)});
      if(!moved){offer({...event,type:'prompt',reason:'recognition-error'});return;}
      if(!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      bindings.current.set(event.track.id,existing.ref);watch.confirm(event.track.id,track.cardId,existing.ref,event.type==='prompt');
      setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));return;
    }
    const placeholderRef=placeholders.current.get(event.track.id),manual=twins.find(c=>c.ref===placeholderRef&&cardCode(c));
    if(manual){
      placeholders.current.delete(event.track.id);bindings.current.set(event.track.id,manual.ref);
      if(!chosen){watch.confirm(event.track.id,String(cardCode(manual)),manual.ref);return;}
    }
    // Reserve the visual cue until catalog loading and duplicate checks finish.
    twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    track={...track,id:bindings.current.get(event.track.id)??event.track.id};
    const resolved=resolveExisting(event,track,entry,twins);
    if(resolved.blocked){offer({...event,type:'prompt',reason:'uncertain'});return;}
    existing=resolved.existing;
    if(existing)track={...track,id:existing.ref};
    const code=entry?catalogCardId(entry):undefined;
    if(code&&!track.faceDown)await loadCards([code]);
    const latest=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,latest))return;
    // Keep the reserved physical ref while refreshing geometry and occupancy after I/O.
    track={...latest!,id:existing?.ref??bindings.current.get(event.track.id)??event.track.id,...(chosen?{cardId:chosen,faceDown:false}:{})};
    twins=current.current.room.state.seats[seat].twin.filter(c=>c.ref!==placeholders.current.get(event.track.id));
    const freshBinding=resolveExisting(event,track,entry,twins);
    if(freshBinding.blocked){abstain(event,'Another physical card owns this ref. Check the field.');return;}
    existing=freshBinding.existing;if(existing)track={...track,id:existing.ref};
    const projected=projectObserved(track,twins,existing,entry?cardInfo(catalogCardId(entry)):undefined);
    if(!projected.zone){abstain(event,projected.reason??'Choose a legal zone manually.');return;}
    const physicalAtSave={zone:track.zone,position:track.position};
    track={...track,zone:projected.zone};location=fieldZoneLocation(projected.zone);
    if(twins.some(c=>c.ref!==existing?.ref&&c.zone===location.zone&&c.slot===location.slot)) {offer({...event,type:'prompt',reason:'uncertain'});return;}
    setPending(true);
    try {
      if(!await removePlaceholder(event.track.id,act))return;
      let updated:RemoteRoom|null=null;
      if(existing&&existing.faceUp===track.faceDown){updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.flip',actorSeat:seat,seat,cardRef:existing.ref,faceUp:!track.faceDown});if(!updated)return;}
      // The resolver has just required a distinct, same-frame witness for every
      // existing copy. Undo's clock estimate rounds HTTP Date up; evidence must
      // use its lower bound so the server never sees a future camera sample.
      const copyCount=code?twins.filter(c=>cardCode(c)===code).length:0;
      const copyProof=!existing&&copyCount?{simultaneousQuads:copyCount+1,at:Math.floor(serverNow()-999-Math.max(0,performance.now()-track.lastSeen))}:undefined;
      for(const proposal of fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing,copyProof})){
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
        updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.move',actorSeat:seat,seat,cardRef:target.card.ref,...target.location,position:target.position});
        if(!updated)return;
        target=currentTarget();if(!target)return;
        if(!matches(target)){setNotice('The card is still moving. Confirm it once settled.');return;}
      }
      if(!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      bindings.current.set(event.track.id,target.card.ref);
      watch.confirm(event.track.id,track.cardId,target.card.ref,event.type==='prompt');rememberPhysical(target.card.ref,target.observed.zone);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
      setDeparture(null);setNotice(`${track.bestMatch?'Best match · ':''}${track.faceDown?'Face-down card':entry?.name} placed · auto`);setUndoId(updated?.state.undo?.actionId??'');
    }finally{setPending(false);}
  }
  function handle(event:FieldEvent) {
    if(event.track.faceDown){
      const ref=bindings.current.get(event.track.id)??event.track.id;
      const message={...lastMessage.current,cards:lastMessage.current.cards.filter(c=>c.ref!==ref)};
      lastMessage.current=message;published.current=JSON.stringify(message);hub.publishFieldTracks(message);
    }
    if(diagnosticsAllowed&&(event.type==='prompt'||(event.type==='placed'&&event.track.bestMatch)))void saveLocalFieldDiagnostic(event,entries.current);
    if(event.type==='prompt'){
      if(event.reason==='pile'&&event.result?.tier==='sure'&&event.track.zone==='GY')void queue(act=>apply(event,act));
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
        const proposal=fieldDepartureProposal(card,seat);if(!proposal)return;
        const name=proposal.name??(card.faceUp?entries.current.get(event.track.cardId??'')?.name:undefined)??'Card';
        const updated=await act({...proposal,...(card.faceUp?{name}:{})});
        if(!live()||!watch.isRemoved(card.ref))return;
        setDeparture({ref:card.ref,name,zone:updated?proposal.zone:'pending'});setNotice(`${name} left the field · ${updated?'auto':'update failed'}`);setUndoId(updated?.state.undo?.actionId??'');return;
      }
      if(event.type==='moved') {
        let observed=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        if(keepsManual(card.ref,fieldZoneLocation(observed.zone),observed.position))return;
        const code=cardCode(card);if(code)await loadCards([code]);
        observed=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        const projected=projectObserved(observed,current.current.room.state.seats[seat].twin,card,cardInfo(code));
        if(!projected.zone){setNotice(projected.reason??'Choose a legal zone manually.');return;}
        const location=fieldZoneLocation(projected.zone);
        if(keepsManual(card.ref,location,observed.position))return;
        if(card.zone!==location.zone||card.slot!==location.slot||card.position!==fieldTwinPosition({...observed,zone:projected.zone})){if(!await act({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,...location,position:fieldTwinPosition({...observed,zone:projected.zone})}))return;if(departureRef.current?.ref===card.ref){setDeparture(null);setNotice('');}}
        const after=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!live()||!fieldEvidenceMatches(event,after))return;
        const twins=current.current.room.state.seats[seat].twin,persisted=twins.find(c=>c.ref===card.ref);if(!persisted)return;
        const target=projectObserved(after!,twins,persisted,cardInfo(code));
        if(target.zone){const latest=fieldZoneLocation(target.zone);if(persisted.zone===latest.zone&&persisted.slot===latest.slot&&persisted.position===fieldTwinPosition({...after!,zone:target.zone}))rememberPhysical(card.ref,after!.zone);}
      }else if(event.type==='flipped'&&event.track.faceDown)await apply(event,act);
    });
  }
  const watch=useFieldWatcher({owner:ownsSource,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,duelKey:room.slug,deviceKey:cameraKey,sourceKey:source,
    async create(){const resources=await ownFieldResources(()=>({decklist:deckIdsOf(current.current.room,seat),seen:seenCardIds(current.current.room)}));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,cpuBusy:()=>resources.cpuBusy()||calibrationBusy.current};},onEvent:handle});
  const updateCalibration=useCallback((grid:FieldCalibration)=>{
    watch.setCalibration(grid);
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
      try{const updated=await act({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone,source:'auto',...(card.faceUp?{name:value.name}:{})});if(updated){setDeparture({...value,zone});setNotice(`${value.name} left the field · auto`);setUndoId(updated.state.undo?.actionId??'');}}finally{setPending(false);}
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
    publishZoneGrid({ownSeat:seat,format:gridFormat,calibration:watch.calibration,setCalibration:updateCalibration,calibrate:()=>{if(host?.querySelector('video')?.videoWidth)setCalibrating(true);},
      tracks:watch.snapshot.tracks.filter(t=>t.visible&&!t.removed).map(t=>({id:t.id,zone:t.zone,quad:t.card.quad}))});
    // The key stands for the visible cards without republishing on every sample.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[seat,gridFormat,watch.calibration,updateCalibration,gridKey,host,watch.snapshot.tracks.length]);
  useEffect(()=>clearZoneGrid,[]);
  useEffect(()=>{const timer=setInterval(()=>hub.publishFieldTracks(lastMessage.current),1000);return()=>clearInterval(timer);},[hub.publishFieldTracks]);
  useEffect(()=>()=>hub.publishFieldTracks({type:'field.tracks',cards:[]}),[hub.publishFieldTracks]);
  useEffect(()=>{if(!notice)return;const timer=setTimeout(()=>{setNotice('');setDeparture(null);setUndoId('');},5000);return()=>clearTimeout(timer);},[notice,undoId]);
  const activePrompts=prompts.filter(event=>{const live=watch.getTrack(event.track.id);return live?.state==='prompt'&&(live.revision??0)===(event.track.revision??0);});
  const promptInfo=useCardInfo(activePrompts.flatMap(event=>(event.result?.candidates??[]).map(candidate=>{const entry=entries.current.get(candidate.cardId);return entry?catalogCardId(entry):undefined;})));
  const promptViews=activePrompts.map(event=>{
    const observed=watch.getTrack(event.track.id)!,twins=current.current.room.state.seats[seat].twin;
    const choices=event.reason==='pile'?[]:observed.faceDown?[{cardId:'face-down'}]:event.result?.candidates.slice(0,5)??[];
    return {id:event.track.id,zone:observed.zone,title:event.reason==='changed'?'Card changed?':'New card?',quad:observed.card.quad,emptyMessage:event.reason==='pile'?'Move an existing card to this pile from its popup.':undefined,
      candidates:choices.map(candidate=>{
        const entry=entries.current.get(candidate.cardId),track={...observed,id:bindings.current.get(event.track.id)??event.track.id,cardId:candidate.cardId};
        const resolved=resolveExisting(event,track,entry,twins);
        const projected=projectFieldZone({zone:observed.zone,facts:entry?promptInfo(catalogCardId(entry)):undefined,twins,ref:resolved.existing?.ref,faceDown:observed.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        return {id:candidate.cardId,label:`${observed.faceDown?'Confirm face-down card':entry?.name??candidate.cardId} · ${resolved.blocked?'Another physical card owns this ref':projected.zone?`To ${projected.label}`:projected.reason}`,disabled:resolved.blocked||!projected.zone};
      })};
  });
  const label=watch.calibrationNeeded?'Choose your side · auto-placement paused':!watch.enabled?'Auto-placement off':watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  const readingStyles=room.state.seats.flatMap((player,index)=>player.twin.flatMap(card=>{
    if(!card.ref.startsWith('fw-')||cardCode(card)||!card.faceUp||!publicField(card.zone))return [];
    const zone=card.zone==='monster'?`m${card.slot??1}`:card.zone==='spell-trap'?`s${card.slot??1}`:card.zone==='extra-monster'?`emz${card.slot??1}`:'f';
    const selector=`[data-testid="field-${index}"] [data-zone="${zone}"]`;
    const prompt=index===seat&&activePrompts.some(p=>(bindings.current.get(p.track.id)??p.track.id)===card.ref);
    return [`${selector}>div:first-child{background:linear-gradient(110deg,#233c3b 20%,#507b70 45%,#233c3b 70%);background-size:240% 100%;${prompt?'':'animation:field-reading 1.2s linear infinite;'}}${selector}>div:first-child>span{font-size:0}${selector}>div:first-child>span::after{content:"${prompt?'Identify card':'Reading…'}";font-size:10px;color:#e5f5ef}`];
  })).join('');
  return <>
    <style>{`@keyframes field-reading{to{background-position:-240% 0}}${readingStyles}@media(prefers-reduced-motion:reduce){[data-testid^="field-"] [data-zone]>div{animation:none!important}}`}</style>
    <FieldWatcherUI host={host} enabled={watch.enabled} onEnabledChange={watch.setEnabled} statusLabel={label} statusTitle={watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%`} calibrated={!!watch.calibration} calibrationDisabled={!video?.videoWidth} onCalibrate={()=>setCalibrating(true)} pending={pending}
      prompts={promptViews}
      onChoose={(id,cardId)=>{const event=activePrompts.find(p=>p.track.id===id);if(event)void queue(act=>apply(event,act,cardId==='face-down'?undefined:cardId));}}
      onDismiss={id=>{watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));void queue(async act=>{await removePlaceholder(id,act);});}}
      noticeTestId={departure?'field-departure-toast':undefined}
      notice={recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:notice?<>{notice}{departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,title])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>redirect(zone)}>{title}</button>)}</span>:null}
        {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>redirect('hand')}>Retry removal</button>:null}
        {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void queue(async act=>{const departed=departureRef.current?.ref,updated=await act({type:'undo',actorSeat:seat,targetActionId:undoId});if(updated){if(departed&&updated.state.seats[seat].twin.some(card=>card.ref===departed&&publicField(card.zone)))watch.dismiss(departed);setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}</>:undefined}/>
    {calibrating?<FieldCalibrationControl video={video} initialCalibration={watch.calibration} format={room.format?.id??room.state.deckChecks.format.id} detectCalibrationCards={async frame=>{const result=await detectCards(await createImageBitmap(frame));if(result.status!=='ready')throw new Error(result.note);return result.cards;}} onSave={grid=>{updateCalibration(grid);setCalibrating(false);}} onCancel={()=>{if(watch.calibrationNeeded)watch.setEnabled(false);setCalibrating(false);}}/>:null}
  </>;
}

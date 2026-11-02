"use client";

import {useEffect,useRef,useState} from 'react';
import {catalogCardId,fieldZoneLocation,yugioh,type FieldEvent,type FieldTrack,type FieldZone,type KnownFieldCard} from '@yugidraft/vision';
import type {RemoteRoom,TwinCard} from '@yugidraft/shared/remote';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {fieldDepartureProposal,fieldPlacementProposals,fieldEvidenceMatches,applyVerifiedFieldMutation,StaleFieldPlacementError} from '@/lib/remote/field-proposals';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {projectFieldZone} from '@/lib/remote/field-legality';
import {ownFieldResources} from './ui/recognizer';
import {useVideoHub} from './ui/video-hub';
import {cardCode,deckIdsOf,seenCardIds} from './ui/model';
import {FieldCalibrationControl} from './field-calibration';
import {FieldWatcherUI} from './field-watcher-ui';
import {serverNow} from './ui/use-remote-room';
import {cardInfo,loadCards,useCardInfo} from './ui/catalog';

const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
const publicField=(zone:string)=>['monster','extra-monster','spell-trap','field','pendulum'].includes(zone);
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
export function AutoFieldWatcher({room,transaction}:{room:RemoteRoom;transaction:RoomTransaction}) {
  const hub=useVideoHub(),seat=room.mySeat,source=hub.sourceFor(seat);
  const current=useRef({room,active:false});
  if(current.current.room.slug!==room.slug||room.lastSeq>=current.current.room.lastSeq)current.current.room=room;
  current.current.active=!!source?.local&&hub.cameraOn;
  const enabledRef=useRef(true),calibrationBusy=useRef(false),tracks=useRef<FieldTrack[]>([]);
  const entries=useRef(new Map<string,Entry>()),bindings=useRef(new Map<string,string>()),published=useRef(''),lastMessage=useRef<ReturnType<typeof fieldTrackMessage>>({type:'field.tracks',cards:[]}),previousRefs=useRef(new Set<string>());
  const physicalKey=`dd-field-physical:v1:${room.guildId}:${room.slug}:${seat}`,physical=useRef<{key:string;zones:Map<string,FieldZone>}|null>(null);
  if(physical.current?.key!==physicalKey)physical.current={key:physicalKey,zones:readPhysicalZones(physicalKey)};
  const [host,setHost]=useState<HTMLElement|null>(null),[prompts,setPrompts]=useState<FieldEvent[]>([]),[calibrating,setCalibrating]=useState(false);
  calibrationBusy.current=calibrating;
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false),[recovery,setRecovery]=useState<StaleFieldPlacementError|null>(null);
  const [departure,setDepartureState]=useState<Departure|null>(null),departureRef=useRef<Departure|null>(null);
  useEffect(()=>setRecovery(null),[room.slug,seat]);
  const setDeparture=(value:Departure|null)=>{departureRef.current=value;setDepartureState(value);};
  useEffect(()=>{setHost(document.querySelector<HTMLElement>(`[data-testid="feed-box-${seat}"]`));setPrompts([]);previousRefs.current=new Set();bindings.current.clear();},[room.slug,seat,source]);
  const savePhysical=()=>{try{sessionStorage.setItem(physical.current!.key,JSON.stringify(Object.fromEntries(physical.current!.zones)));}catch{/* Memory-only fallback. */}};
  const forgetPhysical=(ref:string)=>{if(physical.current!.zones.delete(ref))savePhysical();};
  const prunePhysical=()=>{const refs=new Set(current.current.room.state.seats[seat].twin.map(c=>c.ref));let changed=false;for(const ref of physical.current!.zones.keys())if(!refs.has(ref)){physical.current!.zones.delete(ref);changed=true;}if(changed)savePhysical();};
  const rememberPhysical=(ref:string,zone:FieldZone)=>{if(physicalZonePattern.test(zone)&&current.current.room.state.seats[seat].twin.some(c=>c.ref===ref&&publicField(c.zone))&&physical.current!.zones.get(ref)!==zone){physical.current!.zones.set(ref,zone);savePhysical();}};
  // A physical hint reserves a ref only. Omitting the quad forces a fresh identity read.
  const knownZone=(card:TwinCard)=>publicField(card.zone)?physical.current!.zones.get(card.ref)??toZone(card.zone,card.slot):toZone(card.zone,card.slot);
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{const zone=knownZone(c);return zone?[{id:c.ref,zone,cardId:c.faceUp?String(cardCode(c)??''):undefined,faceDown:!c.faceUp,position:c.position}]:[];});
  const offer=(event:FieldEvent)=>setPrompts(list=>[...list.filter(p=>p.track.id!==event.track.id).slice(-5),event]);
  const live=()=>current.current.active&&enabledRef.current&&current.current.room.status==='active'&&!current.current.room.state.ended&&!current.current.room.state.seats[seat].eliminated;
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
      // An unread restart track may reserve the physical spot before adopting its ref.
      const unbound=twins.filter(c=>publicField(c.zone)&&c.faceUp&&cardCode(c)===catalogCardId(entry)&&(!tracks.current.some(t=>owns(t,c.ref)||(t.id!==event.track.id&&!t.removed&&t.zone===knownZone(c)))||sameSlot(c)));
      if(unbound.length>1){return {existing,blocked:true};}
      if(unbound.length===1)existing=unbound[0];
    }
    return {existing,blocked:false};
  }
  function abstain(event:FieldEvent,message:string) {
    if(watch.getTrack(event.track.id)?.state==='prompt')offer({...event,type:'prompt',reason:'uncertain'});
    setNotice(message);
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
      // A pile outline can follow a uniquely lost instance; it cannot create one.
      const lost=tracks.current.filter(t=>t.id!==track.id&&t.state==='identified'&&(!t.visible||t.removed)&&t.cardId===track.cardId&&track.firstSeen-t.lastSeen<10000&&twins.some(c=>c.ref===t.id));
      if(!existing&&lost.length===1){existing=twins.find(c=>c.ref===lost[0].id);}
      if(!existing){offer({...event,type:'prompt',reason:'pile'});return;}
      const moved=await act({type:'twin.move',actorSeat:seat,seat,cardRef:existing.ref,...location,position:track.position});
      if(!moved){offer({...event,type:'prompt',reason:'recognition-error'});return;}
      if(!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      bindings.current.set(event.track.id,existing.ref);watch.confirm(event.track.id,track.cardId,existing.ref);
      setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));return;
    }
    const resolved=resolveExisting(event,track,entry,twins);
    if(resolved.blocked){offer({...event,type:'prompt',reason:'uncertain'});return;}
    existing=resolved.existing;
    if(existing)track={...track,id:existing.ref};
    const code=entry?catalogCardId(entry):undefined;
    if(code&&!track.faceDown)await loadCards([code]);
    const latest=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,latest))return;
    // Keep the reserved physical ref while refreshing geometry and occupancy after I/O.
    track={...latest!,id:existing?.ref??bindings.current.get(event.track.id)??event.track.id,...(chosen?{cardId:chosen,faceDown:false}:{})};
    twins=current.current.room.state.seats[seat].twin;
    const freshBinding=resolveExisting(event,track,entry,twins);
    if(freshBinding.blocked){abstain(event,'Another physical card owns this ref. Check the field.');return;}
    existing=freshBinding.existing;if(existing)track={...track,id:existing.ref};
    const projected=projectFieldZone({zone:track.zone,facts:entry?cardInfo(catalogCardId(entry)):undefined,twins,ref:existing?.ref,faceDown:track.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
    if(!projected.zone){abstain(event,projected.reason??'Choose a legal zone manually.');return;}
    const physicalAtSave={zone:track.zone,position:track.position};
    track={...track,zone:projected.zone};location=fieldZoneLocation(projected.zone);
    if(twins.some(c=>c.ref!==existing?.ref&&c.zone===location.zone&&c.slot===location.slot)) {offer({...event,type:'prompt',reason:'uncertain'});return;}
    setPending(true);
    try {
      let updated:RemoteRoom|null=null;
      if(existing&&existing.faceUp===track.faceDown){updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.flip',actorSeat:seat,seat,cardRef:existing.ref,faceUp:!track.faceDown});if(!updated)return;}
      for(const proposal of fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing})){
        updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,proposal);if(!updated){if(fieldEvidenceMatches(event,watch.getTrack(event.track.id)))offer({...event,type:'prompt',reason:'recognition-error'});return;}
      }
      const currentTarget=()=>{
        const observed=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,observed))return;
        const twins=current.current.room.state.seats[seat].twin,card=twins.find(item=>item.ref===track.id);if(!card)return;
        const target=projectFieldZone({zone:observed!.zone,facts:cardInfo(code),twins,ref:card.ref,faceDown:track.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        if(!target.zone){abstain(event,target.reason??'Choose a legal zone manually.');return;}
        return {observed:observed!,card,location:fieldZoneLocation(target.zone)};
      };
      const matches=(target:NonNullable<ReturnType<typeof currentTarget>>)=>target.card.zone===target.location.zone&&target.card.slot===target.location.slot&&target.card.position===target.observed.position;
      let target=currentTarget();if(!target)return;
      if(!matches(target)){
        const physicallyMoved=target.observed.zone!==physicalAtSave.zone||target.observed.position!==physicalAtSave.position;
        const initialCorrection=!!existing&&(existing.zone!==location.zone||existing.slot!==location.slot||existing.position!==track.position);
        if(!physicallyMoved&&!initialCorrection){setNotice('The placement changed. Check this card.');return;}
        // A genuine move is separate from the atomic placement and keeps its ref.
        updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,{type:'twin.move',actorSeat:seat,seat,cardRef:target.card.ref,...target.location,position:target.observed.position});
        if(!updated)return;
        target=currentTarget();if(!target)return;
        if(!matches(target)){setNotice('The card is still moving. Confirm it once settled.');return;}
      }
      if(!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      if(existing)bindings.current.set(event.track.id,existing.ref);
      watch.confirm(event.track.id,track.cardId,existing?.ref);rememberPhysical(target.card.ref,target.observed.zone);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
      setDeparture(null);setNotice(`${track.faceDown?'Face-down card':entry?.name} placed · auto`);setUndoId(updated?.state.undo?.actionId??'');
    }finally{setPending(false);}
  }
  function handle(event:FieldEvent) {
    if(event.type==='prompt'){
      if(event.reason==='pile'&&event.result?.tier==='sure'&&event.track.zone==='GY')void queue(act=>apply(event,act));
      else offer(event);
      return;
    }
    void queue(async act=>{
      if(event.type==='placed'){await apply(event,act);return;}
      const ref=bindings.current.get(event.track.id)??event.track.id;
      const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===ref);
      if(!live()||!card)return;
      if(event.type==='removed') {
        if(!watch.isRemoved(card.ref))return;
        const proposal=fieldDepartureProposal(card,seat);if(!proposal)return;
        const name=proposal.name??(card.faceUp?entries.current.get(event.track.cardId??'')?.name:undefined)??'Card';
        const updated=await act({...proposal,...(card.faceUp?{name}:{})});
        if(!live()||!watch.isRemoved(card.ref))return;
        setDeparture({ref:card.ref,name,zone:updated?proposal.zone:'pending'});setNotice(`${name} left the field · ${updated?'auto':'update failed'}`);setUndoId(updated?.state.undo?.actionId??'');return;
      }
      if(event.type==='moved') {
        let observed=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        const code=cardCode(card);if(code)await loadCards([code]);
        observed=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        const projected=projectFieldZone({zone:observed.zone,facts:cardInfo(code),twins:current.current.room.state.seats[seat].twin,ref:card.ref,faceDown:observed.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        if(!projected.zone){setNotice(projected.reason??'Choose a legal zone manually.');return;}
        const location=fieldZoneLocation(projected.zone);
        if(card.zone!==location.zone||card.slot!==location.slot||card.position!==observed.position){if(!await act({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,...location,position:observed.position}))return;if(departureRef.current?.ref===card.ref){setDeparture(null);setNotice('');}}
        const after=watch.getTrack(event.track.id)??watch.getTrack(ref);if(!live()||!fieldEvidenceMatches(event,after))return;
        const twins=current.current.room.state.seats[seat].twin,persisted=twins.find(c=>c.ref===card.ref);if(!persisted)return;
        const target=projectFieldZone({zone:after!.zone,facts:cardInfo(code),twins,ref:card.ref,faceDown:after!.faceDown,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id});
        if(target.zone){const latest=fieldZoneLocation(target.zone);if(persisted.zone===latest.zone&&persisted.slot===latest.slot&&persisted.position===after!.position)rememberPhysical(card.ref,after!.zone);}
      }else if(event.type==='flipped'&&card.faceUp===event.track.faceDown)await act({type:'twin.flip',actorSeat:seat,seat,cardRef:card.ref,faceUp:!event.track.faceDown});
    });
  }
  const watch=useFieldWatcher({owner:source?.local===true,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,sourceKey:source,
    async create(){const resources=await ownFieldResources(()=>({decklist:deckIdsOf(current.current.room,seat),seen:seenCardIds(current.current.room)}));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,cpuBusy:()=>resources.cpuBusy()||calibrationBusy.current};},onEvent:handle});
  enabledRef.current=watch.enabled;tracks.current=watch.snapshot.tracks;
  useEffect(()=>{
    setPrompts(list=>{const next=list.filter(p=>{const live=watch.getTrack(p.track.id);return live?.state==='prompt'&&(live.revision??0)===(p.track.revision??0);});return next.length===list.length?list:next;});
    const refs=new Set(room.state.seats[seat].twin.map(c=>c.ref));
    for(const ref of previousRefs.current)if(!refs.has(ref)){forgetPhysical(ref);watch.forget(ref);}
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
    const message=fieldTrackMessage(watch.snapshot,entries.current,known()),key=JSON.stringify(message);lastMessage.current=message;
    if(key!==published.current){published.current=key;hub.publishFieldTracks(message);}
  },[watch.snapshot,hub.publishFieldTracks,room.state]);
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
  const video=host?.querySelector('video')??null;
  const label=watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  return <>
    <FieldWatcherUI host={host} enabled={watch.enabled} onEnabledChange={watch.setEnabled} statusLabel={label} statusTitle={watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%`} calibrated={!!watch.calibration} calibrationDisabled={!video?.videoWidth} onCalibrate={()=>setCalibrating(true)} pending={pending}
      prompts={promptViews}
      onChoose={(id,cardId)=>{const event=activePrompts.find(p=>p.track.id===id);if(event)void queue(act=>apply(event,act,cardId==='face-down'?undefined:cardId));}}
      onDismiss={id=>{watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));}}
      noticeTestId={departure?'field-departure-toast':undefined}
      notice={recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:notice?<>{notice}{departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,title])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>redirect(zone)}>{title}</button>)}</span>:null}
        {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>redirect('graveyard')}>Retry removal</button>:null}
        {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void queue(async act=>{const departed=departureRef.current?.ref,updated=await act({type:'undo',actorSeat:seat,targetActionId:undoId});if(updated){if(departed&&updated.state.seats[seat].twin.some(card=>card.ref===departed&&publicField(card.zone)))watch.dismiss(departed);setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}</>:undefined}/>
    {calibrating?<FieldCalibrationControl video={video} format={room.format?.id??room.state.deckChecks.format.id} onSave={grid=>{watch.setCalibration(grid);setCalibrating(false);}} onCancel={()=>setCalibrating(false)}/>:null}
  </>;
}

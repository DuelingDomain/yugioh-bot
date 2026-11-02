"use client";

import {useEffect,useRef,useState} from 'react';
import {catalogCardId,fieldZoneLocation,yugioh,type FieldEvent,type FieldTrack,type FieldZone,type KnownFieldCard} from '@yugidraft/vision';
import type {RemoteRoom} from '@yugidraft/shared/remote';
import type {RoomMutation,RoomTransaction} from '@/lib/remote/room-mutations';
import {useFieldWatcher} from '@/lib/remote/use-field-watcher';
import {fieldDepartureProposal,fieldPlacementProposals,fieldEvidenceMatches,applyVerifiedFieldMutation,StaleFieldPlacementError} from '@/lib/remote/field-proposals';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import {ownFieldResources} from './ui/recognizer';
import {useVideoHub} from './ui/video-hub';
import {cardCode,deckIdsOf,seenCardIds} from './ui/model';
import {FieldCalibrationControl} from './field-calibration';
import {FieldWatcherUI} from './field-watcher-ui';
import {serverNow} from './ui/use-remote-room';

const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
const publicField=(zone:string)=>['monster','extra-monster','spell-trap','field','pendulum'].includes(zone);
const piles=new Set<FieldZone>(['GY','BANISHED','DECK','EXTRA']);
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
  const [host,setHost]=useState<HTMLElement|null>(null),[prompts,setPrompts]=useState<FieldEvent[]>([]),[calibrating,setCalibrating]=useState(false);
  calibrationBusy.current=calibrating;
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false),[recovery,setRecovery]=useState<StaleFieldPlacementError|null>(null);
  const [departure,setDepartureState]=useState<Departure|null>(null),departureRef=useRef<Departure|null>(null);
  const setDeparture=(value:Departure|null)=>{departureRef.current=value;setDepartureState(value);};
  useEffect(()=>{setHost(document.querySelector<HTMLElement>(`[data-testid="feed-box-${seat}"]`));setPrompts([]);previousRefs.current=new Set();bindings.current.clear();},[room.slug,seat,source]);
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{const zone=toZone(c.zone,c.slot);return zone?[{id:c.ref,zone,cardId:c.faceUp?String(cardCode(c)??''):undefined,faceDown:!c.faceUp,position:c.position}]:[];});
  const offer=(event:FieldEvent)=>setPrompts(list=>[...list.filter(p=>p.track.id!==event.track.id).slice(-5),event]);
  const live=()=>current.current.active&&enabledRef.current&&current.current.room.status==='active'&&!current.current.room.state.ended&&!current.current.room.state.seats[seat].eliminated;
  function queue(work:(act:RoomMutation)=>Promise<void>) {
    return transaction(async(latest,act)=>{
      current.current.room=latest;
      const apply:RoomMutation=async proposal=>{const updated=await act(proposal);if(updated)current.current.room=updated;return updated;};
      await work(apply);
    }).catch(error=>{if(error instanceof StaleFieldPlacementError)setRecovery(error);else setNotice('Could not update the field. Try a card prompt.');});
  }
  async function apply(event:FieldEvent,act:RoomMutation,chosen?:string) {
    const observed=watch.getTrack(event.track.id);if(!live()||!fieldEvidenceMatches(event,observed))return;
    let track={...observed!,id:bindings.current.get(event.track.id)??event.track.id,...(chosen?{cardId:chosen,faceDown:false}:{})};
    const entry=track.cardId?entries.current.get(track.cardId):undefined;
    const twins=current.current.room.state.seats[seat].twin;
    let existing=twins.find(c=>c.ref===track.id);
    const location=fieldZoneLocation(track.zone);
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
    if(!existing&&entry){
      const unbound=twins.filter(c=>publicField(c.zone)&&c.faceUp&&cardCode(c)===catalogCardId(entry)&&!tracks.current.some(t=>t.id===c.ref&&t.visible&&!t.removed));
      if(unbound.length>1){offer({...event,type:'prompt',reason:'uncertain'});return;}
      if(unbound.length===1){existing=unbound[0];track={...track,id:existing.ref};}
    }
    if(twins.some(c=>c.ref!==existing?.ref&&c.zone===location.zone&&c.slot===location.slot)) {offer({...event,type:'prompt',reason:'uncertain'});return;}
    setPending(true);
    try {
      let updated:RemoteRoom|null=null;
      for(const proposal of fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing})){
        updated=await applyVerifiedFieldMutation(event,()=>watch.getTrack(event.track.id),act,proposal);if(!updated){if(fieldEvidenceMatches(event,watch.getTrack(event.track.id)))offer({...event,type:'prompt',reason:'recognition-error'});return;}
      }
      if(existing&&!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      if(existing&&(existing.zone!==location.zone||existing.slot!==location.slot||existing.position!==track.position)){updated=await act({type:'twin.move',actorSeat:seat,seat,cardRef:existing.ref,...location,position:track.position});if(!updated){offer({...event,type:'prompt',reason:'recognition-error'});return;}}
      if(!fieldEvidenceMatches(event,watch.getTrack(event.track.id)))return;
      if(existing)bindings.current.set(event.track.id,existing.ref);
      watch.confirm(event.track.id,track.cardId,existing?.ref);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));
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
        const observed=watch.getTrack(ref);if(!observed?.visible||observed.removed||observed.state!=='identified')return;
        const location=fieldZoneLocation(observed.zone);
        if(card.zone!==location.zone||card.slot!==location.slot||card.position!==observed.position){await act({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,...location,position:observed.position});if(departureRef.current?.ref===card.ref){setDeparture(null);setNotice('');}}
      }else if(event.type==='flipped'&&card.faceUp===event.track.faceDown)await act({type:'twin.flip',actorSeat:seat,seat,cardRef:card.ref,faceUp:!event.track.faceDown});
    });
  }
  const watch=useFieldWatcher({owner:source?.local===true,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,sourceKey:source,
    async create(){const resources=await ownFieldResources(()=>({decklist:deckIdsOf(current.current.room,seat),seen:seenCardIds(current.current.room)}));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,cpuBusy:()=>resources.cpuBusy()||calibrationBusy.current};},onEvent:handle});
  enabledRef.current=watch.enabled;tracks.current=watch.snapshot.tracks;
  useEffect(()=>{
    const refs=new Set(room.state.seats[seat].twin.map(c=>c.ref));
    for(const ref of previousRefs.current)if(!refs.has(ref))watch.forget(ref);
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
      watch.forget(placement.card.ref);setPrompts(list=>list.filter(p=>p.track.id!==placement.card.ref));setRecovery(null);setNotice('Stale placement removed');
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
  const video=host?.querySelector('video')??null;
  const label=watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  return <>
    <FieldWatcherUI host={host} enabled={watch.enabled} onEnabledChange={watch.setEnabled} statusLabel={label} statusTitle={watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%${!watch.calibration?' · Calibrate zones for exact columns':''}`} calibrated={!!watch.calibration} calibrationDisabled={!video?.videoWidth} onCalibrate={()=>setCalibrating(true)} pending={pending}
      prompts={prompts.map(event=>({id:event.track.id,zone:event.track.zone,title:event.reason==='changed'?'Card changed?':'New card?',quad:event.track.card.quad,emptyMessage:event.reason==='pile'?'Move an existing card to this pile from its popup.':undefined,candidates:event.reason==='pile'?[]:event.result?.candidates.slice(0,5).map(c=>({id:c.cardId,label:entries.current.get(c.cardId)?.name??c.cardId}))??[]}))}
      onChoose={(id,cardId)=>{const event=prompts.find(p=>p.track.id===id);if(event)void queue(act=>apply(event,act,cardId));}}
      onDismiss={id=>{watch.dismiss(id);setPrompts(list=>list.filter(p=>p.track.id!==id));}}
      noticeTestId={departure?'field-departure-toast':undefined}
      notice={recovery?<>{recovery.message}<button type="button" onClick={recover}>Remove stale placement</button></>:notice?<>{notice}{departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,title])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>redirect(zone)}>{title}</button>)}</span>:null}
        {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>redirect('graveyard')}>Retry removal</button>:null}
        {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void queue(async act=>{const updated=await act({type:'undo',actorSeat:seat,targetActionId:undoId});if(updated){setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}</>:undefined}/>
    {calibrating?<FieldCalibrationControl video={video} format={room.format?.id??room.state.deckChecks.format.id} onSave={grid=>{watch.setCalibration(grid);setCalibrating(false);}} onCancel={()=>setCalibrating(false)}/>:null}
  </>;
}

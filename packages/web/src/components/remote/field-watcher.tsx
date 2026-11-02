"use client";

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { catalogCardId, fieldZoneLocation, yugioh, type FieldEvent, type FieldTrack, type FieldZone, type KnownFieldCard } from '@yugidraft/vision';
import type { RemoteActionProposal, RemoteRoom } from '@yugidraft/shared/remote';
import { useFieldWatcher } from '@/lib/remote/use-field-watcher';
import { fieldDepartureProposal, fieldPlacementProposals } from '@/lib/remote/field-proposals';
import {fieldTrackMessage} from '@/lib/remote/field-track-cache';
import { ownFieldResources } from './ui/recognizer';
import { useVideoHub } from './ui/video-hub';
import { cardCode, deckIdsOf, seenCardIds } from './ui/model';
import { FieldCalibrationControl } from './field-calibration';
import {serverNow} from './ui/use-remote-room';

const control:CSSProperties={background:'#17221ff2',color:'#ecf4ec',border:'1px solid #708879',borderRadius:6,padding:'6px 9px',fontSize:12,lineHeight:1.4};
const toZone=(zone:string,slot?:number):FieldZone|undefined=>zone==='monster'?`M${slot??1}` as FieldZone:zone==='spell-trap'?`S${slot??1}` as FieldZone:zone==='extra-monster'?`EMZ${slot??1}` as FieldZone:({field:'FIELD',graveyard:'GY',banished:'BANISHED',deck:'DECK',extra:'EXTRA'} as Record<string,FieldZone>)[zone];
type Entry={cardId:string;passcode:number;name:string};
const destinations=[['graveyard','GY'],['banished','Banish'],['hand','Hand'],['extra','Extra Deck']] as const;
/** One table mount; all controls and overlays stay outside the UI worker's files. */
export function AutoFieldWatcher({room,action}:{room:RemoteRoom;action(proposal:RemoteActionProposal):Promise<RemoteRoom|null>}) {
  const hub=useVideoHub(),seat=room.mySeat,source=hub.sourceFor(seat);
  const current=useRef({room,action,active:!!source?.local&&hub.cameraOn});current.current={room,action,active:!!source?.local&&hub.cameraOn};
  const enabledRef=useRef(true),calibrationBusy=useRef(false);
  const entries=useRef(new Map<string,Entry>()),chain=useRef(Promise.resolve());
  const [host,setHost]=useState<HTMLElement|null>(null),[prompts,setPrompts]=useState<FieldEvent[]>([]),[calibrating,setCalibrating]=useState(false);
  calibrationBusy.current=calibrating;
  const [notice,setNotice]=useState(''),[undoId,setUndoId]=useState(''),[pending,setPending]=useState(false);
  type Departure={ref:string;name:string;zone:string};
  const [departure,setDepartureState]=useState<Departure|null>(null),departureRef=useRef<Departure|null>(null);
  const setDeparture=(value:Departure|null)=>{departureRef.current=value;setDepartureState(value);};
  useEffect(()=>{setHost(document.querySelector<HTMLElement>(`[data-testid="feed-box-${seat}"]`));setPrompts([]);},[room.slug,seat,source]);
  const known=():KnownFieldCard[]=>current.current.room.state.seats[seat].twin.flatMap(c=>{const zone=toZone(c.zone,c.slot);return zone?[{id:c.ref,zone,cardId:c.faceUp?String(cardCode(c)??''):undefined,faceDown:!c.faceUp,position:c.position}]:[];});
  const offer=(event:FieldEvent)=>setPrompts(list=>[...list.filter(p=>p.track.id!==event.track.id).slice(-5),event]);
  async function apply(event:FieldEvent,chosen?:string) {
    const {room:now,action:act}=current.current;
    if(!current.current.active||!enabledRef.current||now.status!=='active'||now.state.ended||now.state.seats[seat].eliminated)return;
    const track={...event.track,...(chosen?{cardId:chosen,faceDown:false}:{})};
    const entry=track.cardId?entries.current.get(track.cardId):undefined;
    const existing=now.state.seats[seat].twin.find(c=>c.ref===track.id);
    // An occupied slot needs a human decision: no replacement or duplicate physical evidence.
    const location=fieldZoneLocation(track.zone);
    if(!existing&&now.state.seats[seat].twin.some(c=>c.zone===location.zone&&c.slot===location.slot&&!['graveyard','banished','deck','extra'].includes(c.zone))){offer({...event,type:'prompt',reason:'uncertain'});return;}
    if(!track.faceDown&&!entry){offer({...event,type:'prompt',reason:'recognition-error'});return;}
    setPending(true);
    try {
      const proposals=fieldPlacementProposals({track,seat,cardId:entry?catalogCardId(entry):undefined,name:entry?.name,existing:!!existing});
      if(!proposals.length){setNotice('Deck area: identity kept private');watch.dismiss(track.id);return;}
      let updated:RemoteRoom|null=null;
      for(const proposal of proposals){updated=await act(proposal);if(!updated){offer({...event,type:'prompt',reason:'recognition-error'});return;}}
      watch.confirm(track.id,track.cardId);setPrompts(list=>list.filter(p=>p.track.id!==track.id));
      setDeparture(null);setNotice(`${track.faceDown?'Face-down card':entry?.name} placed · auto`);setUndoId(updated?.state.undo?.actionId??'');
    }finally{setPending(false);}
  }
  function handle(event:FieldEvent) {
    if(event.type==='prompt'){offer(event);return;}
    chain.current=chain.current.then(async()=>{
      if(event.type==='placed'){await apply(event);return;}
      const {room:now,action:act}=current.current;const card=now.state.seats[seat].twin.find(c=>c.ref===event.track.id);
      if(!current.current.active||!enabledRef.current||!card||now.status!=='active'||now.state.ended||now.state.seats[seat].eliminated)return;
      if(event.type==='removed') {
        if(!watch.isRemoved(event.track.id))return;
        const proposal=fieldDepartureProposal(card,seat);if(!proposal)return;
        const name=proposal.name??(card.faceUp?entries.current.get(event.track.cardId??'')?.name:undefined)??'Card';
        const updated=await act({...proposal,...(card.faceUp?{name}:{})});
        if(!current.current.active||!enabledRef.current||current.current.room.status!=='active'||current.current.room.state.ended||!watch.isRemoved(card.ref))return;
        if(!updated){setDeparture({ref:card.ref,name,zone:'pending'});setNotice(`${name} left the field · update failed`);setUndoId('');return;}
        setDeparture({ref:card.ref,name,zone:proposal.zone});setNotice(`${name} left the field · auto`);setUndoId(updated.state.undo?.actionId??'');
        return;
      }
      // Moves and flips retain the same physical ref and use the normal Undo path.
      if(event.type==='moved') {
        const location=fieldZoneLocation(event.track.zone);
        if(card.zone!==location.zone||card.slot!==location.slot||card.position!==event.track.position){await act({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,...location,position:event.track.position});if(departureRef.current?.ref===card.ref){setDeparture(null);setNotice('');}}
      } else if(event.type==='flipped'&&card.faceUp===event.track.faceDown)await act({type:'twin.flip',actorSeat:seat,seat,cardRef:card.ref,faceUp:!event.track.faceDown});
    }).catch(()=>setNotice('Could not update the field. Try a card prompt.'));
  }
  const watch=useFieldWatcher({owner:source?.local===true,active:hub.cameraOn&&room.status==='active'&&!room.state.ended&&!room.state.seats[seat].eliminated,seatKey:`${room.guildId}:${room.seats.find(s=>s.seat===seat)?.userId??'local'}:${seat}`,sourceKey:source,
    async create(){const resources=await ownFieldResources(()=>({decklist:deckIdsOf(current.current.room,seat),seen:seenCardIds(current.current.room)}));if(!resources)return null;entries.current=new Map(resources.entries.map(e=>[e.cardId,e]));return {...resources,profile:yugioh,format:current.current.room.format?.id??current.current.room.state.deckChecks.format.id,getKnownCards:known,cpuBusy:()=>resources.cpuBusy()||calibrationBusy.current};},onEvent:handle});
  enabledRef.current=watch.enabled;
  useEffect(()=>{
    const value=departureRef.current;if(!value)return;
    const card=room.state.seats[seat].twin.find(c=>c.ref===value.ref);
    if(!card||(value.zone==='pending'&&!watch.isRemoved(value.ref))||(!destinations.some(([zone])=>zone===card.zone)&&value.zone!=='pending')){setDeparture(null);setNotice('');}
    else if(destinations.some(([zone])=>zone===card.zone)&&card.zone!==value.zone)setDeparture({...value,zone:card.zone});
  },[room.state,seat,watch.snapshot]);
  async function redirect(zone:string) {
    if(!departure||pending||!current.current.active||!enabledRef.current||current.current.room.status!=='active'||current.current.room.state.ended)return;
    const card=current.current.room.state.seats[seat].twin.find(c=>c.ref===departure.ref);
    if(!card||(!destinations.some(([z])=>z===card.zone)&&!(departure.zone==='pending'&&watch.isRemoved(card.ref))))return;
    setPending(true);
    try{const updated=await current.current.action({type:'twin.move',actorSeat:seat,seat,cardRef:card.ref,zone,source:'auto',...(card.faceUp?{name:departure.name}:{})});if(updated){setDeparture({...departure,zone});setNotice(`${departure.name} left the field · auto`);setUndoId(updated.state.undo?.actionId??'');}}finally{setPending(false);}
  }
  useEffect(()=>{hub.publishFieldTracks(fieldTrackMessage(watch.snapshot,entries.current,known()));},[watch.snapshot,hub.publishFieldTracks,room.state]);
  useEffect(()=>()=>hub.publishFieldTracks({type:'field.tracks',cards:[]}),[hub.publishFieldTracks]);
  const video=host?.querySelector('video')??null;
  function anchor(track:FieldTrack):CSSProperties {
    if(!video||!host)return {left:8,top:40};
    const r=video.getBoundingClientRect(),h=host.getBoundingClientRect(),scale=Math.min(r.width/(video.videoWidth||1),r.height/(video.videoHeight||1));
    const width=video.videoWidth*scale,height=video.videoHeight*scale,cx=track.card.quad.reduce((s,p)=>s+p.x,0)/4,cy=Math.max(...track.card.quad.map(p=>p.y));
    return {left:Math.max(4,Math.min(h.width-224,r.left-h.left+(r.width-width)/2+cx*width-105)),top:Math.max(40,Math.min(h.height-145,r.top-h.top+(r.height-height)/2+cy*height+4))};
  }
  if(!host)return null;
  const label=watch.snapshot.status==='starting'?'Preparing card reader…':watch.snapshot.status==='hidden'?'Paused · tab hidden':watch.snapshot.status==='busy'?'Paused · busy':watch.snapshot.status==='error'?'Watcher unavailable':watch.snapshot.status==='budget'?'Watching field · CPU guard':hub.cameraOn?'Watching field':'Camera off';
  return createPortal(<div onClick={e=>e.stopPropagation()} onPointerDown={e=>e.stopPropagation()} onKeyDown={e=>e.stopPropagation()}>
    <div style={{position:'absolute',top:8,left:8,zIndex:22,display:'flex',gap:5,flexWrap:'wrap',maxWidth:'calc(100% - 16px)'}}>
      <label style={control}><input type="checkbox" checked={watch.enabled} onChange={e=>watch.setEnabled(e.target.checked)}/> Auto-detect cards</label>
      {watch.enabled?<span style={control} role="status" title={watch.snapshot.error??`Detector ${Math.round(watch.snapshot.metrics.detectorMs)} ms · duty ${watch.snapshot.metrics.dutyPercent.toFixed(1)}%`} data-testid="field-watcher-status">{label}</span>:null}
      <button type="button" style={control} disabled={!video?.videoWidth} onClick={()=>setCalibrating(true)}>{watch.calibration?'Recalibrate':'Calibrate zones'}</button>
    </div>
    {watch.enabled?prompts.map(event=><div key={event.track.id} role="group" aria-label="New card?" data-testid="field-watcher-prompt" style={{...control,...anchor(event.track),position:'absolute',zIndex:24,width:216,maxHeight:190,overflow:'auto'}}>
      <strong>New card?</strong>
        {event.result?.candidates.slice(0,5).map(c=><button type="button" key={c.cardId} disabled={pending} style={{display:'block',width:'100%',textAlign:'left'}} onClick={()=>void apply(event,c.cardId)}>{entries.current.get(c.cardId)?.name??c.cardId}</button>)}
        {!event.result?.candidates.length?<span> Use the feed reader to confirm this card.</span>:null}
      <button type="button" onClick={()=>{watch.dismiss(event.track.id);setPrompts(list=>list.filter(p=>p.track.id!==event.track.id));}}>Dismiss</button>
    </div>):null}
    {notice?<div style={{...control,position:'absolute',bottom:8,left:8,zIndex:23,maxWidth:'calc(100% - 16px)'}} role="status" data-testid={departure?'field-departure-toast':undefined}>{notice}
      {departure?<span> → {destinations.find(([z])=>z===departure.zone)?.[1]} {destinations.map(([zone,label])=><button type="button" key={zone} disabled={pending||departure.zone===zone} onClick={()=>void redirect(zone)}>{label}</button>)}</span>:null}
      {departure?.zone==='pending'?<button type="button" disabled={pending} onClick={()=>void redirect('graveyard')}>Retry removal</button>:null}
      {undoId&&room.state.undo?.actionId===undoId&&serverNow()<=room.state.undo.at+5000?<button type="button" onClick={()=>void current.current.action({type:'undo',actorSeat:seat,targetActionId:undoId}).then(ok=>{if(ok){setDeparture(null);setNotice('Automatic field change undone');setUndoId('');}})}>Undo</button>:null}
    </div>:null}
    {calibrating?<FieldCalibrationControl video={video} format={room.format?.id??room.state.deckChecks.format.id} onSave={grid=>{watch.setCalibration(grid);setCalibrating(false);}} onCancel={()=>setCalibrating(false)}/>:null}
  </div>,host);
}

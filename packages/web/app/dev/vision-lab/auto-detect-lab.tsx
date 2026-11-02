"use client";

import { useEffect, useRef, useState } from 'react';
import { createOwnFeedBuffer, createRecognizer, yugioh, type IdentityEmbedder, type FieldEvent, type FieldTrack, type FieldFormat, type IndexEntry, type Recognizer } from '@yugidraft/vision';
import { useFieldWatcher } from '@/lib/remote/use-field-watcher';
import { FieldCalibrationControl } from '@/components/remote/field-calibration';
import styles from './vision-lab.module.css';

/** Live camera harness for exactly the same engine/hook used on the remote table. */
export function AutoDetectLab({defaultEmbedder='dinov2-small-duel'}:{defaultEmbedder?:IdentityEmbedder}={}) {
  const video=useRef<HTMLVideoElement>(null),stream=useRef<MediaStream|null>(null),buffer=useRef<ReturnType<typeof createOwnFeedBuffer>|null>(null),reader=useRef<Recognizer|null>(null),epoch=useRef(0);
  const [source,setSource]=useState<MediaStream|null>(null),[backend,setBackend]=useState<'auto'|'wasm'>('auto'),[deck,setDeck]=useState('');
  const [embedder,setEmbedder]=useState<IdentityEmbedder>(defaultEmbedder);
  const [format,setFormat]=useState<FieldFormat>('normal');
  const [entries,setEntries]=useState(new Map<string,IndexEntry>()),[events,setEvents]=useState<FieldEvent[]>([]),[board,setBoard]=useState<FieldTrack[]>([]),[prompts,setPrompts]=useState<FieldEvent[]>([]);
  const [error,setError]=useState(''),[starting,setStarting]=useState(false),[calibrating,setCalibrating]=useState(false),[undo,setUndo]=useState<FieldTrack[]|null>(null);
  const [departure,setDeparture]=useState<{track:FieldTrack;destination:string}|null>(null);
  const current=useRef({deck,calibrating,board});current.current={deck,calibrating,board};
  const stop=()=>{epoch.current++;buffer.current?.stop();buffer.current=null;stream.current?.getTracks().forEach(t=>t.stop());stream.current=null;if(video.current)video.current.srcObject=null;reader.current?.dispose();reader.current=null;setSource(null);setStarting(false);setEvents([]);setBoard([]);setPrompts([]);setUndo(null);setDeparture(null);};
  useEffect(()=>()=>{epoch.current++;buffer.current?.stop();stream.current?.getTracks().forEach(t=>t.stop());reader.current?.dispose();},[]);
  useEffect(()=>{const controller=new AbortController();void fetch(yugioh.metaUrl,{signal:controller.signal}).then(r=>r.ok?r.json():Promise.reject(new Error('Prepare vision assets first'))).then(meta=>setEntries(new Map(meta.entries.map((e:IndexEntry)=>[e.cardId,e])))).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[]);
  async function start() {
    stop();const generation=epoch.current;setError('');setStarting(true);
    try {
      const media=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1920},height:{ideal:1080},facingMode:{ideal:'environment'}},audio:false});
      if(generation!==epoch.current){media.getTracks().forEach(t=>t.stop());return;}
      stream.current=media;video.current!.srcObject=media;await video.current!.play();
      if(generation!==epoch.current)return;
      buffer.current=createOwnFeedBuffer(video.current!);setSource(media);setStarting(false);
      for(const t of media.getVideoTracks())t.addEventListener('ended',()=>{if(generation===epoch.current)stop();},{once:true});
    }catch(e){if(generation===epoch.current){stop();setError((e as Error).message);}}
  }
  function apply(track:FieldTrack) {setUndo(current.current.board);setBoard(list=>[...list.filter(t=>t.id!==track.id),track]);setDeparture(null);}
  const watch=useFieldWatcher({owner:true,active:!!source,seatKey:`vision-lab:${format}:own:0`,sourceKey:source,
    async create(){reader.current??=createRecognizer({game:'yugioh',backend,embedder});return {recognizer:reader.current,buffer:{sample:()=>buffer.current?buffer.current.sample():Promise.reject(new Error('Waiting for camera'))},profile:yugioh,format,
      getPriors:()=>({decklist:current.current.deck.split(/[\s,]+/).filter(Boolean)}),cpuBusy:()=>current.current.calibrating,
      getKnownCards:()=>current.current.board.map(t=>({id:t.id,card:t.card,zone:t.zone,cardId:t.cardId,faceDown:t.faceDown,position:t.position}))};},
    onEvent(event){setEvents(list=>[event,...list].slice(0,40));if(event.type==='placed')apply(event.track);
      else if(event.type==='moved'||event.type==='flipped'){setBoard(list=>[...list.filter(t=>t.id!==event.track.id),event.track]);setDeparture(null);}
      else if(event.type==='removed'){
        if(!['GY','BANISHED','DECK','EXTRA'].includes(event.track.zone)&&current.current.board.some(t=>t.id===event.track.id)){setUndo(current.current.board);setBoard(list=>list.filter(t=>t.id!==event.track.id));setDeparture({track:event.track,destination:'GY'});}
      }else setPrompts(list=>[...list.filter(e=>e.track.id!==event.track.id),event]);}});
  const names=(t:FieldTrack)=>t.faceDown?'Face-down card':entries.get(t.cardId??'')?.name??'New card?';
  const metrics=watch.snapshot.metrics;
  const runtime=events.find(e=>e.result?.runtime)?.result?.runtime;
  return <section className={styles.capture} aria-label="Auto-detect lab">
    <div className={styles.controls}><button type="button" className={styles.primary} disabled={starting} onClick={()=>void start()}>{starting?'Starting…':'Start camera'}</button><button type="button" onClick={stop} disabled={!source&&!starting}>Stop</button>
      <label><input type="checkbox" checked={watch.enabled} onChange={e=>watch.setEnabled(e.target.checked)}/> Auto-detect cards</label>
      <label>Embedder <select aria-label="Auto-detect embedder" disabled={!!source||starting} value={embedder} onChange={e=>{reader.current?.dispose();reader.current=null;setEmbedder(e.target.value as IdentityEmbedder);}}><option value="dinov2-small-duel">DINOv2-duel</option><option value="dinov3-small">DINOv3-S</option></select></label>
      <label>Compute <select aria-label="Auto-detect compute" disabled={!!source} value={backend} onChange={e=>setBackend(e.target.value as 'auto'|'wasm')}><option value="auto">Auto · prefer WebGPU</option><option value="wasm">WASM · CPU benchmark</option></select></label>
      <label>Format <select aria-label="Auto-detect format" disabled={!!source} value={format} onChange={e=>setFormat(e.target.value as FieldFormat)}><option value="normal">Advanced</option><option value="domain">Domain</option><option value="genesys">Genesys</option><option value="genesys-domain">Genesys Domain</option></select></label>
      <button type="button" disabled={!source} onClick={()=>setCalibrating(true)}>{watch.calibration?'Recalibrate':'Calibrate zones'}</button>
    </div>
    {events.find(e=>e.result)?.result?<p>{events.find(e=>e.result)!.result!.timingsMs.total.toFixed(1)} ms/read · {embedder==='dinov3-small'?'DINOv3-S (uncalibrated)':'DINOv2-duel'}</p>:null}
    <p role="status" data-testid="auto-detect-status">{watch.snapshot.status==='starting'?'Preparing card reader…':source&&watch.enabled?'Watching field':'Start your camera to watch placements'} · {watch.snapshot.status}</p>
    <p>Place a card and keep your hand clear. Reading starts after about half a second of stability and confirms on a later frame. Sure reads fill the local twin with Undo. Other reads offer five choices. Clear absences leave the field automatically with Undo.</p>
    <label>Deck card IDs (optional) <input aria-label="Auto-detect deck priors" value={deck} onChange={e=>setDeck(e.target.value)} placeholder="46986414, 89631139"/></label>
    <div style={{position:'relative',maxWidth:1100,background:'#18221c',minHeight:200}}>
      <video ref={video} autoPlay muted playsInline style={{display:'block',width:'100%'}}/>
      {source?<svg aria-label="Tracked cards" viewBox="0 0 1 1" preserveAspectRatio="none" style={{position:'absolute',inset:0,width:'100%',height:'100%',pointerEvents:'none'}}>{watch.snapshot.tracks.filter(t=>!t.removed).map(t=><polygon key={t.id} points={t.card.quad.map(p=>`${p.x},${p.y}`).join(' ')} fill="none" stroke={t.state==='identified'?'#8de0aa':'#edc46c'} strokeWidth=".003"/>)}</svg>:null}
      {source?prompts.map(event=>{const t=watch.snapshot.tracks.find(t=>t.id===event.track.id)??event.track,cx=t.card.quad.reduce((s,p)=>s+p.x,0)/4,cy=t.card.quad.reduce((s,p)=>s+p.y,0)/4;return <div key={t.id} role="group" aria-label="New card?" style={{position:'absolute',left:`${Math.max(0,Math.min(.65,cx))*100}%`,top:`${Math.min(.65,cy)*100}%`,maxWidth:270,padding:10,background:'#17221ff5',color:'white',border:'1px solid #edc46c'}}>
        <strong>New card?</strong>
        {event.result?.candidates.slice(0,5).map(c=><button type="button" key={c.cardId} style={{display:'block'}} onClick={()=>{const track={...t,cardId:c.cardId,faceDown:false,state:'identified' as const};apply(track);watch.confirm(t.id,c.cardId);setPrompts(list=>list.filter(e=>e.track.id!==t.id));}}>{entries.get(c.cardId)?.name??c.cardId} · {c.score.toFixed(3)}</button>)}
        <button type="button" onClick={()=>{watch.dismiss(t.id);setPrompts(list=>list.filter(e=>e.track.id!==t.id));}}>Dismiss</button>
      </div>;}):null}
    </div>
    {error||watch.snapshot.error?<p role="alert">{error||watch.snapshot.error}</p>:null}
    {calibrating?<FieldCalibrationControl video={video.current} format={format} onSave={value=>{watch.setCalibration(value);setCalibrating(false);}} onCancel={()=>setCalibrating(false)}/>:null}
    <p>Detector {metrics.detectorMs.toFixed(1)} ms · interval {metrics.intervalMs.toFixed(0)} ms · inference duty {metrics.dutyPercent.toFixed(1)}% · latest placement {metrics.latencyMs.toFixed(0)} ms · {metrics.samples} samples / {metrics.skipped} skipped{runtime?` · WASM ${runtime.wasmThreads} threads · isolated ${runtime.crossOriginIsolated}`:''}</p>
    <p>Inference duty is elapsed inference work divided by its scheduled interval; use the offline benchmark for process CPU measurements.</p>
    {departure?<p role="status" data-testid="auto-detect-departure">{names(departure.track)} left the field → {departure.destination} {['GY','BANISHED','HAND','EXTRA'].map(destination=><button type="button" key={destination} disabled={departure.destination===destination} onClick={()=>setDeparture({...departure,destination})}>{destination==='EXTRA'?'Extra Deck':destination}</button>)}</p>:null}
    <h2>Local field twin</h2><button type="button" disabled={!undo} onClick={()=>{setBoard(undo??[]);setUndo(null);setDeparture(null);}}>Undo automatic field change</button>
    <ul data-testid="auto-detect-twin">{board.map(t=><li key={t.id}>{names(t)} · {t.zone} · {t.position} · {t.id}</li>)}</ul>
    <h2>Watcher events</h2><ol data-testid="auto-detect-events">{events.map((e,i)=><li key={i}>{e.type} · {names(e.track)} · {e.track.zone}{e.latencyMs?` · ${e.latencyMs.toFixed(0)} ms`:''} · auto</li>)}</ol>
  </section>;
}

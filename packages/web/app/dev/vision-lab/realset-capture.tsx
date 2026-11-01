"use client";
import {useState,type RefObject} from 'react';
import type {RealsetExport,RecognitionResult} from '@yugidraft/vision';
import styles from './vision-lab.module.css';

export function RealsetCapture({busy,enabled,onEnabledChange,result,confirmed,frame,source,point,deck,onDeckChange}:{
  busy:boolean;enabled:boolean;onEnabledChange:(value:boolean)=>void;result:RecognitionResult|null;confirmed:string|null;
  frame:RefObject<ImageBitmap|null>;source:'camera'|'photo'|null;point:{x:number;y:number};deck:string;onDeckChange:(value:string)=>void;
}) {
  const [samples,setSamples]=useState<RealsetExport['samples']>([]),[condition,setCondition]=useState(''),[status,setStatus]=useState('');
  function add(label:string|null) {
    const image=frame.current;
    if(busy || !image || !result?.raw || !source || !condition.trim() || samples.length>=20)return;
    const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
    canvas.getContext('2d')!.drawImage(image,0,0);
    const jpegBase64=canvas.toDataURL('image/jpeg',.85).split(',')[1];
    const q=result.detectedCard?.quad;
    const length=(a:{x:number;y:number},b:{x:number;y:number})=>Math.hypot((a.x-b.x)*image.width,(a.y-b.y)*image.height);
    const cardWidthPx=q?Math.round((length(q[0],q[1])+length(q[2],q[3]))/2):null;
    setSamples(old=>[...old,{id:crypto.randomUUID(),capturedAt:new Date().toISOString(),label,condition:condition.trim(),cardWidthPx,source,width:image.width,height:image.height,clickPoint:point,tier:result.tier,raw:result.raw!,latencyMs:result.timingsMs.total,jpegBase64}]);
    setStatus(label===null?'Non-card object labelled.':'Confirmed card labelled.');
  }
  function download() {
    const url=URL.createObjectURL(new Blob([JSON.stringify({version:1,samples})],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download=`vision-realset-${Date.now()}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const ready=Boolean(!busy && frame.current && result?.raw && condition.trim() && samples.length<20);
  return <section className={styles.diagnostics} aria-label="Real webcam test set">
    <label><input type="checkbox" checked={enabled} onChange={e=>onEnabledChange(e.target.checked)} /> Real webcam test set capture mode</label>
    {enabled?<>
      <p>Freeze a frame, then click a card or any non-card object. Confirm its true card name using the matches or search, or mark it as non-card. Keep art sleeves, empty mat, boxes and hands as negatives.</p>
      <label>Capture conditions <input aria-label="Capture conditions" value={condition} onChange={e=>setCondition(e.target.value)} placeholder="Webcam, angled, sleeved, dim, far" /></label>
      <label>Deck catalog IDs <input aria-label="Deck catalog IDs" value={deck} onChange={e=>onDeckChange(e.target.value)} placeholder="Comma-separated; leave empty for full catalog" /></label>
      <p>Frames and labels stay in this tab until you export. Export before leaving; 20 samples per batch. Capture mode records all views and disables temporal early exit.</p>
      <div className={styles.controls}>
        <button type="button" disabled={!ready || !confirmed} onClick={()=>add(confirmed)}>Label confirmed card</button>
        <button type="button" disabled={!ready} onClick={()=>add(null)}>Mark non-card object</button>
        <button type="button" disabled={!samples.length} onClick={download}>Export {samples.length} test samples</button>
        <button type="button" disabled={!samples.length} onClick={()=>{setSamples([]);setStatus('Batch cleared.');}}>Clear exported batch</button>
      </div>
      <p role="status">{status || `${samples.length} samples labelled. Freeze and read a target to add it.`}</p>
    </>:null}
  </section>;
}

"use client";
import { useState } from 'react';
import { createFieldCalibration, hasExtraMonsterZones, type FieldCalibration, type FieldFormat } from '@yugidraft/vision';

/** Two opposite reference clicks on a current frame; normalized source pixels, independent of CSS size. */
export function FieldCalibrationControl({video,format='normal',onSave,onCancel}:{video:HTMLVideoElement|null;format?:FieldFormat;onSave(value:FieldCalibration):void;onCancel():void}) {
  const [image]=useState(()=>{if(!video?.videoWidth)return '';const canvas=document.createElement('canvas');const scale=Math.min(1,960/video.videoWidth);canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',.75);});
  const [points,setPoints]=useState<{x:number;y:number}[]>([]),[error,setError]=useState('');
  return <div role="dialog" aria-label="Calibrate field zones" style={{position:'fixed',inset:'8%',zIndex:150,background:'#17221f',color:'#fff',padding:20,overflow:'auto',border:'1px solid #78998a'}}>
    <p>Click the top-left, top-right, bottom-right, then bottom-left corner of your mat. Your monster row is above your Spell/Trap row.</p>
    <p>{hasExtraMonsterZones(format)?'Include the two Extra Monster Zones above your main monster row: EMZ left above M2, EMZ right above M4.':'Genesys uses five Main Monster Zones and no Extra Monster Zones.'}</p>
    {image?<div style={{position:'relative',maxWidth:960}}><img src={image} alt="Click four clockwise mat corners" style={{width:'100%',cursor:'crosshair'}} onClick={event=>{const r=event.currentTarget.getBoundingClientRect(),point={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};const next=[...points,point];setPoints(next);if(next.length===4)try{onSave(createFieldCalibration(next));}catch(e){setError((e as Error).message);setPoints([]);}}}/>{points.map((p,i)=><span key={i} style={{position:'absolute',left:`${p.x*100}%`,top:`${p.y*100}%`,background:'#fff',color:'#000',borderRadius:'50%',padding:4,pointerEvents:'none'}}>{i+1}</span>)}</div>:<p>Start your camera before calibrating.</p>}
    {error?<p role="alert">{error}</p>:null}<p>{points.length}/4 reference points</p><button type="button" onClick={onCancel}>Cancel calibration</button>
  </div>;
}

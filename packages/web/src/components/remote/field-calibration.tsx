"use client";

import { useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createFieldCalibration, hasExtraMonsterZones, type FieldCalibration, type FieldFormat } from '@yugidraft/vision';
import { duelFontClasses } from '@/components/duel/fonts';
import table from './ui/remote-ui.module.css';
import s from './field-watcher-ui.module.css';

/** Four clockwise mat corners in normalized source pixels, independent of CSS size. */
export function FieldCalibrationControl({video,format='normal',onSave,onCancel}:{video:HTMLVideoElement|null;format?:FieldFormat;onSave(value:FieldCalibration):void;onCancel():void}) {
  const dialog=useRef<HTMLDivElement>(null),cancel=useRef(onCancel);cancel.current=onCancel;
  const description=useId();
  const [image]=useState(()=>{
    if(!video?.videoWidth)return '';
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);
    canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;
    canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.75);
  });
  const [points,setPoints]=useState<{x:number;y:number}[]>([]),[error,setError]=useState('');
  useLayoutEffect(()=>{
    const modal=dialog.current;if(!modal)return;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    modal.focus({preventScroll:true});
    const focusable=()=>Array.from(modal.querySelectorAll<HTMLElement>('button:not(:disabled),[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]'));
    const key=(event:KeyboardEvent)=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancel.current();return;}
      if(event.key!=='Tab')return;
      const buttons=focusable(),first=buttons[0],last=buttons.at(-1);
      if(!first){event.preventDefault();modal.focus();}
      else if(event.shiftKey&&(document.activeElement===first||document.activeElement===modal)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===modal)){event.preventDefault();first.focus();}
    };
    const contain=(event:FocusEvent)=>{if(!modal.contains(event.target as Node))modal.focus({preventScroll:true});};
    document.addEventListener('keydown',key,true);document.addEventListener('focusin',contain);
    return ()=>{
      document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',contain);
      document.body.style.overflow=overflow;
      if(opener?.isConnected)opener.focus({preventScroll:true});
    };
  },[]);
  if(typeof document==='undefined')return null;
  return createPortal(<div className={`${duelFontClasses} ${s.theme} ${s.backdrop}`} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <div ref={dialog} className={s.calibration} role="dialog" aria-label="Calibrate field zones" aria-modal="true" aria-describedby={description} tabIndex={-1}>
      <h2>Calibrate field zones</h2>
      <div id={description}>
        <p>Click the top-left, top-right, bottom-right, then bottom-left corner of your mat. Your monster row is above your Spell/Trap row.</p>
        <p>{hasExtraMonsterZones(format)?'Include the two Extra Monster Zones above your main monster row: EMZ left above M2, EMZ right above M4.':'Genesys uses five Main Monster Zones and no Extra Monster Zones.'}</p>
      </div>
      {image?<div className={s.calibrationImage}>
        <img src={image} alt="Click four clockwise mat corners" onClick={event=>{
          const r=event.currentTarget.getBoundingClientRect(),point={x:(event.clientX-r.left)/r.width,y:(event.clientY-r.top)/r.height};
          const next=[...points,point];setPoints(next);
          if(next.length===4)try{onSave(createFieldCalibration(next));}catch(e){setError((e as Error).message);setPoints([]);}
        }}/>
        {points.map((point,i)=><span key={i} className={s.corner} style={{left:`${point.x*100}%`,top:`${point.y*100}%`}}>{i+1}</span>)}
      </div>:<p>Start your camera before calibrating.</p>}
      {error?<p role="alert">{error}</p>:null}
      <footer className={s.calibrationFooter}><span role="status">{points.length}/4 reference points</span>
        <button type="button" className={table.btn} onClick={onCancel}>Cancel calibration</button>
      </footer>
    </div>
  </div>,document.body);
}

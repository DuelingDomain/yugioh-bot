"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { createFieldCalibration, createTwoCardCalibration, fieldMatPoint, hasExtraMonsterZones, type DetectedQuad, type FieldCalibration, type FieldFormat } from '@yugidraft/vision';
import { duelFontClasses } from '@/components/duel/fonts';
import table from './ui/remote-ui.module.css';
import s from './field-watcher-ui.module.css';
import g from './field-calibration.module.css';

type Point={x:number;y:number};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const cornerNames=['Top-left','Top-right','Bottom-right','Bottom-left'];

/** Four clockwise mat corners in normalized source pixels, independent of CSS size. */
export function FieldCalibrationControl({video,format='normal',initialCalibration,detectCalibrationCards,onSave,onCancel}:{video:HTMLVideoElement|null;format?:FieldFormat;initialCalibration?:FieldCalibration;detectCalibrationCards?:(frame:HTMLCanvasElement)=>Promise<DetectedQuad[]>;onSave(value:FieldCalibration):void;onCancel():void}) {
  const dialog=useRef<HTMLDivElement>(null),cancel=useRef(onCancel);cancel.current=onCancel;
  const imageBox=useRef<HTMLDivElement>(null),drag=useRef<{corner:number|null;start:Point;points:Point[]}|null>(null);
  const description=useId();
  const generation=useRef(0);
  const [image,setImage]=useState(()=>{
    if(!video?.videoWidth||!video.videoHeight)return '';
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);
    canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;
    canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.75);
  });
  const [points,setPoints]=useState<Point[]>(()=>initialCalibration?.corners.map(point=>({...point}))??[{x:.08,y:.08},{x:.92,y:.08},{x:.92,y:.92},{x:.08,y:.92}]),[error,setError]=useState('');
  const [gridHeight,setGridHeight]=useState(()=>1000*(video?.videoWidth&&video.videoHeight?video.videoHeight/video.videoWidth:9/16)),[busy,setBusy]=useState(false);
  const preview=useMemo(()=>{try{return createFieldCalibration(points);}catch{return undefined;}},[points]);
  const matPoint=(x:number,y:number)=>preview?fieldMatPoint({x,y},preview):{x:points.reduce((sum,p)=>sum+p.x,0)/4,y:points.reduce((sum,p)=>sum+p.y,0)/4};
  async function quickCalibration(){
    if(!detectCalibrationCards||!video?.videoWidth||!video.videoHeight)return;
    const request=++generation.current;setBusy(true);setError('');
    try {
      const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d')!.drawImage(video,0,0,frame.width,frame.height);
      const cards=await detectCalibrationCards(frame);if(request!==generation.current)return;
      const grid=createTwoCardCalibration(cards);setImage(frame.toDataURL('image/jpeg',.75));setGridHeight(1000*frame.height/frame.width);setPoints(grid.corners);
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'Could not capture both cards. Adjust the grid instead.');}
    finally{if(request===generation.current)setBusy(false);}
  }
  const cells=[{zone:'FIELD',label:'Field',x:0,y:0,w:.18,h:.56},{zone:'EXTRA',label:'Extra',x:0,y:.56,w:.18,h:.44},{zone:'BANISHED',label:'Banished',x:.82,y:0,w:.18,h:.25},{zone:'GY',label:'GY',x:.82,y:.25,w:.18,h:.31},{zone:'DECK',label:'Deck',x:.82,y:.56,w:.18,h:.44},
    ...Array.from({length:5},(_,i)=>({zone:`M${i+1}`,label:`M${i+1}`,x:.18+.128*i,y:hasExtraMonsterZones(format)?.2:0,w:.128,h:hasExtraMonsterZones(format)?.36:.56})),
    ...Array.from({length:5},(_,i)=>({zone:`S${i+1}`,label:`S${i+1}`,x:.18+.128*i,y:.56,w:.128,h:.44})),
    ...(hasExtraMonsterZones(format)?[{zone:'EMZ1',label:'EMZ',x:.308,y:0,w:.128,h:.2},{zone:'EMZ2',label:'EMZ',x:.564,y:0,w:.128,h:.2}]:[])];
  const move=(original:Point[],corner:number|null,dx:number,dy:number)=>{
    if(corner===null){dx=Math.max(-Math.min(...original.map(p=>p.x)),Math.min(1-Math.max(...original.map(p=>p.x)),dx));dy=Math.max(-Math.min(...original.map(p=>p.y)),Math.min(1-Math.max(...original.map(p=>p.y)),dy));}
    setPoints(original.map((point,i)=>corner===null||corner===i?{x:clamp(point.x+dx),y:clamp(point.y+dy)}:point));setError('');
  };
  const sourcePoint=(event:PointerEvent)=>{const rect=imageBox.current!.getBoundingClientRect();return {x:(event.clientX-rect.left)/rect.width,y:(event.clientY-rect.top)/rect.height};};
  const begin=(event:PointerEvent<HTMLElement|SVGSVGElement>,corner:number|null)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);drag.current={corner,start:sourcePoint(event),points};};
  const adjust=(event:ReactKeyboardEvent,corner:number|null)=>{const key=event.key,step=event.shiftKey?.02:.005;if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(key))return;event.preventDefault();move(points,corner,key==='ArrowLeft'?-step:key==='ArrowRight'?step:0,key==='ArrowUp'?-step:key==='ArrowDown'?step:0);};
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
      generation.current++;
      document.removeEventListener('keydown',key,true);document.removeEventListener('focusin',contain);
      document.body.style.overflow=overflow;
      if(opener?.isConnected)opener.focus({preventScroll:true});
    };
  },[]);
  if(typeof document==='undefined')return null;
  return createPortal(<div className={`${duelFontClasses} ${s.theme} ${s.backdrop}`} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <div ref={dialog} className={s.calibration} role="dialog" aria-label="Calibrate field zones" aria-modal="true" aria-describedby={description} aria-busy={busy} tabIndex={-1}>
      <h2>Calibrate field zones</h2>
      {detectCalibrationCards?<div className={g.quick}><strong>Quick setup with two cards</strong><p>Place two matching-size cards upright and flat in M1 and M5. Clear the rest of the mat. Either side may face the camera.</p><button type="button" className={table.btn} disabled={!image||busy} onClick={()=>void quickCalibration()}>{busy?'Finding both cards…':'Use cards in M1 and M5'}</button><p>Keep equal gaps between cards in both directions. Check the preview; adjust the corners if your mat spacing differs.</p></div>:null}
      <div id={description}>
        <p>Drag the field grid over your mat</p>
        <p>Move the grid or adjust its four corners until the zones line up. From your seat: Field at top-left, Extra at bottom-left, and Deck at bottom-right. Arrow keys adjust a focused handle; hold Shift for larger steps.</p>
        <p>{hasExtraMonsterZones(format)?'Include the two Extra Monster Zones above your main monster row: EMZ left above M2, EMZ right above M4.':'Genesys uses five Main Monster Zones and no Extra Monster Zones.'}</p>
      </div>
      {image?<div ref={imageBox} className={`${s.calibrationImage} ${g.image}`} data-testid="field-calibration-image" onPointerMove={event=>{const active=drag.current;if(active){const point=sourcePoint(event);move(active.points,active.corner,point.x-active.start.x,point.y-active.start.y);}}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        <img src={image} alt="Your camera view with an adjustable field grid" draggable={false}/>
        <svg className={g.grid} viewBox={`0 0 1000 ${gridHeight}`} preserveAspectRatio="none" role="img" aria-label="Field grid viewed from your seat" onPointerDown={event=>begin(event,null)}>
          {cells.map(cell=>{const center=matPoint(cell.x+cell.w/2,cell.y+cell.h/2),corners=[[cell.x,cell.y],[cell.x+cell.w,cell.y],[cell.x+cell.w,cell.y+cell.h],[cell.x,cell.y+cell.h]].map(([x,y])=>matPoint(x,y));return <g key={cell.zone}><polygon data-zone={cell.zone} points={corners.map(point=>`${point.x*1000},${point.y*gridHeight}`).join(' ')}/><text x={center.x*1000} y={center.y*gridHeight}>{cell.label}</text></g>;})}
        </svg>
        {points.map((point,i)=><button type="button" key={i} disabled={busy} className={g.handle} aria-label={`${cornerNames[i]} grid corner`} style={{left:`${point.x*100}%`,top:`${point.y*100}%`}} onPointerDown={event=>begin(event,i)} onKeyDown={event=>adjust(event,i)}>{i+1}</button>)}
        <button type="button" disabled={busy} className={`${g.handle} ${g.move}`} aria-label="Move field grid" style={{left:`${matPoint(.5,.56).x*100}%`,top:`${matPoint(.5,.56).y*100}%`}} onPointerDown={event=>begin(event,null)} onKeyDown={event=>adjust(event,null)}>↔</button>
      </div>:<p>Start your camera before calibrating.</p>}
      {error?<p role="alert">{error}</p>:null}
      <footer className={s.calibrationFooter}><span role="status">Save once for this seat and camera on this device.</span>
        <button type="button" className={table.btn} disabled={!image||busy} onClick={()=>{try{onSave(createFieldCalibration(points));}catch(e){setError((e as Error).message);}}}>Save calibration</button>
        <button type="button" className={table.btn} onClick={onCancel}>Cancel calibration</button>
      </footer>
    </div>
  </div>,document.body);
}

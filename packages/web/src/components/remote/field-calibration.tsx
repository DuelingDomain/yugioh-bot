"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { createFieldCalibration, createTwoCardCalibration, orientFieldFromHands, fieldMatPoint, hasExtraMonsterZones, type DetectedQuad, type FieldCalibration, type FieldFormat, type FieldOrientation } from '@yugidraft/vision';
import { fieldGridCells } from '@/lib/remote/zone-grid';
import { duelFontClasses } from '@/components/duel/fonts';
import { FieldOrientationControls } from './field-orientation';
import table from './ui/remote-ui.module.css';
import s from './field-watcher-ui.module.css';
import g from './field-calibration.module.css';

type Point={x:number;y:number};
const clamp=(value:number)=>Math.max(0,Math.min(1,value));
const cornerNames=['Top-left','Top-right','Bottom-right','Bottom-left'];

/** Four clockwise mat corners in normalized source pixels, independent of CSS size. */
export function FieldCalibrationControl({video,format='normal',initialCalibration,detectCalibrationCards,large=false,onSave,onCancel}:{video:HTMLVideoElement|null;large?:boolean;format?:FieldFormat;initialCalibration?:FieldCalibration;detectCalibrationCards?:(frame:HTMLCanvasElement)=>Promise<DetectedQuad[]>;onSave(value:FieldCalibration):void;onCancel():void}) {
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
  const [orientation,setOrientation]=useState<FieldOrientation|undefined>(initialCalibration?.orientation);
  const [calibrationCards,setCalibrationCards]=useState<DetectedQuad[]>([]);
  const [handStep,setHandStep]=useState<'left'|'right'|null>(initialCalibration?.orientation?null:'left');
  const leftHand=useRef<number|null>(null);
  const [gridHeight,setGridHeight]=useState(()=>1000*(video?.videoWidth&&video.videoHeight?video.videoHeight/video.videoWidth:9/16)),[busy,setBusy]=useState(false);
  const preview=useMemo(()=>{try{return createFieldCalibration(points,orientation);}catch{return undefined;}},[points,orientation]);
  const matPoint=(x:number,y:number)=>preview?fieldMatPoint({x,y},preview):{x:points.reduce((sum,p)=>sum+p.x,0)/4,y:points.reduce((sum,p)=>sum+p.y,0)/4};
  async function quickCalibration(){
    if(!detectCalibrationCards||!video?.videoWidth||!video.videoHeight)return;
    const request=++generation.current;setBusy(true);setError('');
    try {
      const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d')!.drawImage(video,0,0,frame.width,frame.height);
      const cards=await detectCalibrationCards(frame);if(request!==generation.current)return;
      if(cards.length!==2)throw new Error('Show exactly two cards: a MONSTER in M1 and a SPELL/TRAP in S5.');
      setImage(frame.toDataURL('image/jpeg',.75));setGridHeight(1000*frame.height/frame.width);setCalibrationCards(cards);setHandStep(null);
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'Could not capture both cards. Adjust the grid instead.');}
    finally{if(request===generation.current)setBusy(false);}
  }
  function chooseMonster(index:number){
    try{const grid=createTwoCardCalibration(calibrationCards,index);setPoints(grid.corners);setOrientation(grid.orientation);setCalibrationCards([]);setError('');}
    catch(e){setError((e as Error).message);}
  }
  function chooseHand(corner:number){
    if(!preview||!handStep)return;
    if(handStep==='left'){leftHand.current=corner;setHandStep('right');return;}
    try{const grid=orientFieldFromHands(preview,leftHand.current!,corner);setOrientation(grid.orientation);setHandStep(null);setError('');}
    catch(e){setError((e as Error).message);}
  }
  const cells=fieldGridCells(format);
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
    <div ref={dialog} className={`${s.calibration} ${large?s.calibrationLarge:''}`} data-large={large||undefined} role="dialog" aria-label="Calibrate field zones" aria-modal="true" aria-describedby={description} aria-busy={busy} tabIndex={-1}>
      <h2>Calibrate field zones</h2>
      {detectCalibrationCards?<div className={g.quick}><strong>Quick setup with two cards</strong><p>From your seat, place a MONSTER upright in M1 (front-left) and a SPELL/TRAP upright in S5 (back-right). Clear the rest of the mat. Keep both cards flat.</p><button type="button" className={table.btn} disabled={!image||busy} onClick={()=>void quickCalibration()}>{busy?'Finding both cards…':'Use cards in M1 and S5'}</button><p>Then tap the monster outline. The two different rows determine your side and mirroring. Keep equal gaps between zones; adjust the preview for your mat.</p></div>:null}
      <div id={description}>
        <p>Drag the field grid over your mat</p>
        <p>Move the grid or adjust its four corners until the zones line up. From your seat: Field at top-left, Extra at bottom-left, and Deck at bottom-right. Arrow keys adjust a focused handle; hold Shift for larger steps.</p>
        <p>{hasExtraMonsterZones(format)?'Include the two Extra Monster Zones above your main monster row: EMZ left above M2, EMZ right above M4.':'Genesys uses five Main Monster Zones and no Extra Monster Zones.'}</p>
      </div>
      {preview?<FieldOrientationControls calibration={preview} confirmHint={false} disabled={busy} onChange={grid=>{setOrientation(grid.orientation);setHandStep(null);setCalibrationCards([]);}}/>:null}
      <p>{handStep==='left'?'Tap the corner nearest your LEFT hand.':handStep==='right'?'Now tap the corner nearest your RIGHT hand.':orientation?'Your side is set. Check that M1 and S5 match your physical mat.':'Choose your side before saving.'}</p>
      <button type="button" className={table.btn} disabled={busy} onClick={()=>{setCalibrationCards([]);setHandStep('left');leftHand.current=null;}}>Set side from near corners</button>
      {calibrationCards.length?<p role="status">Tap the MONSTER in M1. The other card must be a SPELL/TRAP in S5.</p>:null}
      {image?<div ref={imageBox} className={`${s.calibrationImage} ${large?s.calibrationImageLarge:''} ${g.image}`} data-testid="field-calibration-image" onPointerMove={event=>{const active=drag.current;if(active){const point=sourcePoint(event);move(active.points,active.corner,point.x-active.start.x,point.y-active.start.y);}}} onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}>
        <img src={image} alt="Your camera view with an adjustable field grid" draggable={false}/>
        <svg className={g.grid} viewBox={`0 0 1000 ${gridHeight}`} preserveAspectRatio="none" role="img" aria-label="Field grid viewed from your seat" onPointerDown={event=>{if(!handStep&&!calibrationCards.length)begin(event,null);}}>
          {cells.map(cell=>{const center=matPoint(cell.x+cell.w/2,cell.y+cell.h/2),corners=[[cell.x,cell.y],[cell.x+cell.w,cell.y],[cell.x+cell.w,cell.y+cell.h],[cell.x,cell.y+cell.h]].map(([x,y])=>matPoint(x,y));return <g key={cell.zone}><polygon data-zone={cell.zone} points={corners.map(point=>`${point.x*1000},${point.y*gridHeight}`).join(' ')}/><text x={center.x*1000} y={center.y*gridHeight}>{cell.label}</text></g>;})}
        </svg>
        {calibrationCards.map((card,i)=>{const x=card.quad.reduce((sum,p)=>sum+p.x,0)/4,y=card.quad.reduce((sum,p)=>sum+p.y,0)/4;return <button key={i} type="button" className={g.cardChoice} style={{left:`${x*100}%`,top:`${y*100}%`}} onClick={()=>chooseMonster(i)}>This is the monster</button>;})}
        {points.map((point,i)=><button type="button" key={i} disabled={busy} className={g.handle} aria-label={`${cornerNames[i]} grid corner`} style={{left:`${point.x*100}%`,top:`${point.y*100}%`}} onPointerDown={event=>{if(!handStep)begin(event,i);}} onClick={()=>chooseHand(i)} onKeyDown={event=>adjust(event,i)}>{i+1}</button>)}
        <button type="button" disabled={busy} className={`${g.handle} ${g.move}`} aria-label="Move field grid" style={{left:`${matPoint(.5,.56).x*100}%`,top:`${matPoint(.5,.56).y*100}%`}} onPointerDown={event=>{if(!handStep&&!calibrationCards.length)begin(event,null);}} onKeyDown={event=>adjust(event,null)}>↔</button>
      </div>:<p>Start your camera before calibrating.</p>}
      {error?<p role="alert">{error}</p>:null}
      <footer className={s.calibrationFooter}><span role="status">Save once for this seat and camera on this device.</span>
        <button type="button" className={table.btn} disabled={!image||busy||!orientation||!!handStep||!!calibrationCards.length} onClick={()=>{try{onSave(createFieldCalibration(points,orientation));}catch(e){setError((e as Error).message);}}}>Save calibration</button>
        <button type="button" className={table.btn} onClick={onCancel}>Cancel calibration</button>
      </footer>
    </div>
  </div>,document.body);
}

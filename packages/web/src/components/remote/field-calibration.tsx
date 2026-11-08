"use client";

import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createFieldCalibration, createTwoCardCalibration, fieldMatPoint, hasExtraMonsterZones, shiftFieldCalibrationRows, swapFieldCalibrationRows, type DetectedQuad, type FieldCalibration, type FieldFormat, type FieldOrientation } from '@yugidraft/vision';
import { fieldGridCells } from '@/lib/remote/zone-grid';
import { duelFontClasses } from '@/components/duel/fonts';
import { FieldOrientationControls } from './field-orientation';
import { FitToMatControl } from './fit-to-mat';
import { FieldMoveSurface, FieldTransformControls, useFieldTransform } from './field-transform';
import { ZoneRowDiagram } from './ui/zone-row-diagram';
import table from './ui/remote-ui.module.css';
import s from './field-watcher-ui.module.css';
import g from './field-calibration.module.css';

/**
 * Whole-field calibration: move the grid, make it bigger or smaller, wider or narrower, taller or shorter, flip it.
 * The zones keep their fixed shape (card-sized, as on the real mat); no single zone can be moved or resized.
 */
export function FieldCalibrationControl({video,format='normal',initialCalibration,detectCalibrationCards,large=false,onFit,onSave,onCancel}:{video:HTMLVideoElement|null;large?:boolean;format?:FieldFormat;initialCalibration?:FieldCalibration;detectCalibrationCards?:(frame:HTMLCanvasElement)=>Promise<DetectedQuad[]>;onFit?(value:FieldCalibration):void;onSave(value:FieldCalibration):void;onCancel():void}) {
  const dialog=useRef<HTMLDivElement>(null),cancel=useRef(onCancel);
  const description=useId();
  const generation=useRef(0);
  const [image,setImage]=useState(()=>{
    if(!video?.videoWidth||!video.videoHeight)return '';
    const canvas=document.createElement('canvas'),scale=Math.min(1,960/video.videoWidth);
    canvas.width=video.videoWidth*scale;canvas.height=video.videoHeight*scale;
    canvas.getContext('2d')!.drawImage(video,0,0,canvas.width,canvas.height);
    return canvas.toDataURL('image/jpeg',.75);
  });
  const tf=useFieldTransform(initialCalibration?.corners,undefined,video?.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:16/9),[error,setError]=useState('');
  cancel.current=onCancel;
  const [orientation,setOrientation]=useState<FieldOrientation|undefined>(initialCalibration?.orientation);
  const [calibrationCards,setCalibrationCards]=useState<DetectedQuad[]>([]);
  /** After the two-card setup: M1 and S5 are lit so the player can see whether they sit on the cards. `swapAsk`: the fit is reflected, which is what swapped rows look like. */
  const [checking,setChecking]=useState(false),[swapAsk,setSwapAsk]=useState(false);
  const [gridHeight,setGridHeight]=useState(()=>1000*(video?.videoWidth&&video.videoHeight?video.videoHeight/video.videoWidth:9/16)),[busy,setBusy]=useState(false);
  const preview=useMemo(()=>{try{return createFieldCalibration(tf.corners,orientation);}catch{return undefined;}},[tf.corners,orientation]);
  const matPoint=(x:number,y:number)=>preview?fieldMatPoint({x,y},preview):{x:tf.corners.reduce((sum,p)=>sum+p.x,0)/4,y:tf.corners.reduce((sum,p)=>sum+p.y,0)/4};
  async function quickCalibration(){
    if(!detectCalibrationCards||!video?.videoWidth||!video.videoHeight)return;
    const request=++generation.current;setBusy(true);setError('');
    try {
      const frame=document.createElement('canvas');frame.width=video.videoWidth;frame.height=video.videoHeight;frame.getContext('2d')!.drawImage(video,0,0,frame.width,frame.height);
      const cards=await detectCalibrationCards(frame);if(request!==generation.current)return;
      if(cards.length!==2)throw new Error('Show exactly two cards: a MONSTER in M1 (Main Monster row) and a SPELL/TRAP in S5 (Spell & Trap row).');
      setImage(frame.toDataURL('image/jpeg',.75));setGridHeight(1000*frame.height/frame.width);setCalibrationCards(cards);
    }catch(e){if(request===generation.current)setError(e instanceof Error?e.message:'Could not capture both cards. Move the grid instead.');}
    finally{if(request===generation.current)setBusy(false);}
  }
  function chooseMonster(index:number){
    try{const grid=createTwoCardCalibration(calibrationCards,index);tf.rebase(grid.corners);setSwapAsk(grid.orientation?.mirrored!==(orientation?.mirrored??false));setOrientation(grid.orientation);setCalibrationCards([]);setChecking(true);setError('');}
    catch(e){setError((e as Error).message);}
  }
  /** Move the whole grid by rows along the mat (positive = toward you). */
  function shiftRows(rows:number){
    if(!preview)return;
    try{const grid=shiftFieldCalibrationRows(preview,rows);tf.rebase(grid.corners);setError('');}
    catch{setError('The grid cannot move further: it would leave the picture. Make it smaller with Size first.');}
  }
  function swapRows(){
    if(!preview)return;
    try{const grid=swapFieldCalibrationRows(preview);tf.rebase(grid.corners);setOrientation(grid.orientation);setSwapAsk(false);setError('');}
    catch{setError('The grid cannot be swapped here: it would leave the picture. Make it smaller with Size first.');}
  }
  const cells=fieldGridCells(format);
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
  const locked=busy||!!calibrationCards.length;
  return createPortal(<div className={`${duelFontClasses} ${s.theme} ${s.backdrop}`} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <div ref={dialog} className={`${s.calibration} ${large?s.calibrationLarge:''}`} data-large={large||undefined} role="dialog" aria-label="Calibrate field zones" aria-modal="true" aria-describedby={description} aria-busy={busy} tabIndex={-1}>
      <h2>Calibrate field zones</h2>
      <FitToMatControl video={video} auto calibration={preview} disabled={locked} onBusy={setBusy} onCapture={frame=>{setImage(frame.toDataURL('image/jpeg',.75));setGridHeight(1000*frame.height/frame.width);}} onApply={grid=>{tf.rebase(grid.corners);setOrientation(grid.orientation);setCalibrationCards([]);setError('');onFit?.(grid);}}/>
      {detectCalibrationCards?<div className={g.quick}><strong>Quick setup with two cards</strong><p>From your seat, place a MONSTER upright in M1: in the Main Monster row (the row nearer the middle of the table), at the far left. Place a SPELL/TRAP upright in S5: in the Spell &amp; Trap row (the row nearest you), at the far right. Clear the rest of the mat. Keep both cards flat.</p><ZoneRowDiagram/><button type="button" className={table.btn} disabled={!image||busy} onClick={()=>void quickCalibration()}>{busy?'Finding both cards…':'Use cards in M1 and S5'}</button><p>Then tap the monster outline. The two different rows determine your side and mirroring.</p></div>:null}
      <div id={description}>
        <p>Move the field grid over your mat</p>
        <p>Drag the grid over your mat. Drag a corner or edge to resize it; the opposite side stays put. Turn it to any angle with the round handle, or use the quarter-turn buttons. Arrow keys move it. From your seat: Field at top-left, Extra at bottom-left, and Deck at bottom-right.</p>
        <p>{hasExtraMonsterZones(format)?'Include the two Extra Monster Zones above your main monster row: EMZ left above M2, EMZ right above M4.':'Genesys uses five Main Monster Zones and no Extra Monster Zones.'}</p>
      </div>
      <FieldOrientationControls calibration={preview} confirmHint={false} disabled={busy} onChange={grid=>{setOrientation(grid.orientation);setCalibrationCards([]);}}/>
      <p>{orientation?'Your side is set. Check that M1 and S5 match your physical mat.':'Choose your side before saving.'}</p>
      {calibrationCards.length?<p role="status">Tap the MONSTER in M1. The other card must be a SPELL/TRAP in S5.</p>:null}
      {checking&&!calibrationCards.length?<div className={g.check} role="group" aria-label="Check zones" data-testid="calibration-check"><strong>Check zones</strong>
        <p>M1 and S5 are lit on the picture. They should sit on your two cards. If the whole grid is one row off, shift it.</p>
        {swapAsk?<p role="alert" data-testid="calibration-swap-ask">Did you swap the rows? The grid looks reflected, as if the monster is in the Spell &amp; Trap row and the spell or trap is in the Main Monster row.<button type="button" className={table.btn} disabled={busy} onClick={swapRows}>Yes, swap the rows</button><button type="button" className={table.btn} onClick={()=>setSwapAsk(false)}>No, keep it</button></p>:null}
        <div className={g.checkActions}><button type="button" className={table.btn} disabled={busy||!preview} onClick={()=>shiftRows(-1)}>Shift one row away from you</button><button type="button" className={table.btn} disabled={busy||!preview} onClick={()=>shiftRows(1)}>Shift one row toward you</button><button type="button" className={table.btn} onClick={()=>{setChecking(false);setSwapAsk(false);}}>Looks right</button></div>
      </div>:null}
      {image?<div className={`${s.calibrationImage} ${large?s.calibrationImageLarge:''} ${g.image}`} data-testid="field-calibration-image">
        <img src={image} alt="Your camera view with an adjustable field grid" draggable={false}/>
        <svg className={g.grid} viewBox={`0 0 1000 ${gridHeight}`} preserveAspectRatio="none" role="img" aria-label="Field grid viewed from your seat">
          {cells.map(cell=>{const center=matPoint(cell.x+cell.w/2,cell.y+cell.h/2),corners=[[cell.x,cell.y],[cell.x+cell.w,cell.y],[cell.x+cell.w,cell.y+cell.h],[cell.x,cell.y+cell.h]].map(([x,y])=>matPoint(x,y));return <g key={cell.zone}><polygon data-zone={cell.zone} data-lit={checking&&(cell.zone==='M1'||cell.zone==='S5')?'':undefined} points={corners.map(point=>`${point.x*1000},${point.y*gridHeight}`).join(' ')}/><text x={center.x*1000} y={center.y*gridHeight}>{cell.label}</text></g>;})}
        </svg>
        <FieldMoveSurface tf={tf} disabled={locked}/>
        {calibrationCards.map((card,i)=>{const x=card.quad.reduce((sum,p)=>sum+p.x,0)/4,y=card.quad.reduce((sum,p)=>sum+p.y,0)/4;return <button key={i} type="button" className={g.cardChoice} style={{left:`${x*100}%`,top:`${y*100}%`}} onClick={()=>chooseMonster(i)}>This is the monster</button>;})}
      </div>:<p>Start your camera before calibrating.</p>}
      <FieldTransformControls tf={tf} disabled={locked}/>
      {error?<p role="alert">{error}</p>:null}
      <footer className={s.calibrationFooter}><span role="status">Save once for this seat and camera on this device.</span>
        <button type="button" className={table.btn} disabled={!image||busy||!orientation||!!calibrationCards.length} onClick={()=>{try{onSave(createFieldCalibration(tf.corners,orientation));}catch(e){setError((e as Error).message);}}}>Save calibration</button>
        <button type="button" className={table.btn} onClick={onCancel}>Cancel calibration</button>
      </footer>
    </div>
  </div>,document.body);
}

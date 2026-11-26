"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { createFieldCalibration, createTwoCardCalibration, fieldMatPoint, hasExtraMonsterZones, onMat, shiftFieldCalibrationRows, swapFieldCalibrationRows, type DetectedQuad, type FieldCalibration, type FieldFormat, type FieldOrientation, type PlayerSide, type ZoneRect } from '@yugidraft/vision';
import { banishedOf, defaultBanished, fieldGridCells, isPlacedCalibration, startGridCorners, withBanished } from '@/lib/remote/zone-grid';
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
 * The zones keep their fixed shape (card-sized, as on the real mat). Only the Banished zone (a sideways cell) can be dragged on its own,
 * to where the player keeps it: beside the Graveyard, above it, or anywhere else on the mat.
 */
export function FieldCalibrationControl({video,format='normal',defaultSide='bottom',initialCalibration,placed=isPlacedCalibration(initialCalibration),detectCalibrationCards,large=false,onSave,onCancel}:{video:HTMLVideoElement|null;large?:boolean;format?:FieldFormat;initialCalibration?:FieldCalibration;defaultSide?:PlayerSide;placed?:boolean;detectCalibrationCards?:(frame:HTMLCanvasElement)=>Promise<DetectedQuad[]>;onSave(value:FieldCalibration):void;onCancel():void}) {
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
  useEffect(()=>()=>{if(image.startsWith('blob:'))URL.revokeObjectURL(image);},[image]);
  /** Until a side is chosen the grid shows the guess for this camera, in the start layout: Spell & Trap row on top, Extra Monster row at the bottom. */
  const guess=useMemo<FieldOrientation>(()=>({playerSide:defaultSide,mirrored:false}),[defaultSide]);
  const [orientation,setOrientation]=useState<FieldOrientation|undefined>(initialCalibration?.orientation);
  const orientationRef=useRef(orientation);orientationRef.current=orientation;
  const tf=useFieldTransform(initialCalibration?.corners??startGridCorners(guess),undefined,video?.videoWidth&&video.videoHeight?video.videoWidth/video.videoHeight:16/9,()=>startGridCorners(orientationRef.current??guess)),[error,setError]=useState('');
  cancel.current=onCancel;
  const [calibrationCards,setCalibrationCards]=useState<DetectedQuad[]>([]);
  /** After the two-card setup: M1 and S5 are lit so the player can see whether they sit on the cards. `swapAsk`: the fit is reflected, which is what swapped rows look like. */
  const [checking,setChecking]=useState(false),[swapAsk,setSwapAsk]=useState(false);
  const [gridHeight,setGridHeight]=useState(()=>1000*(video?.videoWidth&&video.videoHeight?video.videoHeight/video.videoWidth:9/16)),[busy,setBusy]=useState(false);
  /** A saved grid without a side (older saves) is drawn as before; a new one is drawn with the guess. */
  const drawn=orientation??(initialCalibration?undefined:guess);
  const preview=useMemo(()=>{try{return createFieldCalibration(tf.corners,drawn);}catch{return undefined;}},[tf.corners,drawn]);
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
    try{const limits=tf.grab().limits,grid=shiftFieldCalibrationRows(preview,rows,limits);tf.rebase(grid.corners,limits);setError('');}
    catch{setError('The grid cannot move further: it would leave the picture. Make it smaller with Size first.');}
  }
  function swapRows(){
    if(!preview)return;
    try{const limits=tf.grab().limits,grid=swapFieldCalibrationRows(preview,limits);tf.rebase(grid.corners,limits);setOrientation(grid.orientation);setSwapAsk(false);setError('');}
    catch{setError('The grid cannot be swapped here: it would leave the picture. Make it smaller with Size first.');}
  }
  /** Where the player moved the Banished zone (mat units); undefined while it sits at its default place. */
  const [banish,setBanish]=useState<ZoneRect|undefined>(()=>banishedOf(initialCalibration));
  const cells=useMemo(()=>fieldGridCells(format,1,banish?{BANISHED:banish}:undefined),[format,banish]);
  const banishBase=useRef<{rect:ZoneRect;at:{x:number;y:number}}|null>(null);
    /** The picture point under a pointer, on the mat. */
  const matUnder=(event:{clientX:number;clientY:number})=>{
    const box=imageBox.current?.getBoundingClientRect();if(!box||!preview||!box.width||!box.height)return null;
    return onMat({x:(event.clientX-box.left)/box.width,y:(event.clientY-box.top)/box.height},preview);
  };
  const currentBanished=():ZoneRect=>banish??defaultBanished(format);
  const moveBanished=(dx:number,dy:number,from=currentBanished())=>{const r={...from,x:from.x+dx,y:from.y+dy};setBanish(sameRect(r,defaultBanished(format))?undefined:r);};
  /** The zone names keep one size on screen, whatever the size of the picture: the picture's box is 1000 units wide, so units per pixel = 1000 / width. */
  const imageBox=useRef<HTMLDivElement>(null),[label,setLabel]=useState({unit:1,px:11});
  useEffect(()=>{
    const el=imageBox.current;if(!el||typeof ResizeObserver==='undefined')return;
    const read=()=>{const width=Math.max(el.getBoundingClientRect().width,200);setLabel({unit:1000/width,px:width<500?8.5:width<900?10:width<1500?11.5:13});};
    read();const watcher=new ResizeObserver(read);watcher.observe(el);return()=>watcher.disconnect();
  },[image]);
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
  const locked=busy||!!calibrationCards.length,quick=!!detectCalibrationCards;
  const settingNumber=quick?3:2;
  const shown=cells.map(cell=>{
    const points=[[cell.x,cell.y],[cell.x+cell.w,cell.y],[cell.x+cell.w,cell.y+cell.h],[cell.x,cell.y+cell.h]].map(([x,y])=>matPoint(x,y));
    return {cell,points,left:Math.min(...points.map(p=>p.x)),top:Math.min(...points.map(p=>p.y))};
  });
  const inset=label.px*.55*label.unit;
  const banishedShown=shown.find(item=>item.cell.zone==='BANISHED');
  return createPortal(<div className={`${duelFontClasses} ${s.theme} ${s.backdrop}`} onClick={event=>event.stopPropagation()} onPointerDown={event=>event.stopPropagation()}>
    <div ref={dialog} className={`${s.calibration} ${g.dialog} ${large?g.large:''}`} data-large={large||undefined} role="dialog" aria-label="Calibrate field zones" aria-modal="true" aria-describedby={description} aria-busy={busy} tabIndex={-1}>
      <h2 className={g.title}>Calibrate field zones</h2>
      <div className={g.body}>
        <div className={g.panel}>
          <section className={g.step}>
            <StepHead number={1} title="Fit automatically"/>
            <p className={g.line}>Let the app find the printed zones on your mat.</p>
            <FitToMatControl video={video} auto={!placed} defaultSide={defaultSide} calibration={preview} disabled={locked} onBusy={setBusy} onCapture={frame=>{const request=generation.current;frame.toBlob(blob=>{if(blob&&request===generation.current)setImage(URL.createObjectURL(blob));},'image/jpeg',.75);setGridHeight(1000*frame.height/frame.width);}} onApply={grid=>{tf.rebase(grid.corners);setOrientation(grid.orientation);setCalibrationCards([]);setError('');}}/>
          </section>
          {quick?<section className={g.step}>
            <StepHead number={2} title="Quick setup with two cards"/>
            <p className={g.line}>Put a MONSTER in M1 and a SPELL/TRAP in S5, then press the button.</p>
            <ZoneRowDiagram className={g.diagram}/>
            <button type="button" className={`${table.btn} ${table.go} ${g.wide}`} disabled={!image||busy} onClick={()=>void quickCalibration()}>{busy?'Finding both cards…':'Use cards in M1 and S5'}</button>
            <details className={g.help}><summary>How it works</summary>
              <p>From your seat, place a MONSTER upright in M1: in the Main Monster row (the row nearer the middle of the table), at the far left. Place a SPELL/TRAP upright in S5: in the Spell &amp; Trap row (the row nearest you), at the far right. Clear the rest of the mat. Keep both cards flat.</p>
              <p>Then tap the monster outline. The two different rows determine your side and mirroring.</p>
            </details>
          </section>:null}
          {calibrationCards.length?<p role="status" className={g.callout}>Tap the MONSTER in M1. The other card must be a SPELL/TRAP in S5.</p>:null}
          {checking&&!calibrationCards.length?<div className={g.check} role="group" aria-label="Check zones" data-testid="calibration-check"><strong>Check zones</strong>
            <p>M1 and S5 are lit on the picture. They should sit on your two cards. If the whole grid is one row off, shift it.</p>
            {swapAsk?<div role="alert" data-testid="calibration-swap-ask" className={g.swap}><p>Did you swap the rows? The grid looks reflected, as if the monster is in the Spell &amp; Trap row and the spell or trap is in the Main Monster row.</p><div className={g.actions}><button type="button" className={table.btn} disabled={busy} onClick={swapRows}>Yes, swap the rows</button><button type="button" className={`${table.btn} ${table.q}`} onClick={()=>setSwapAsk(false)}>No, keep it</button></div></div>:null}
            <div className={g.actions}><button type="button" className={table.btn} disabled={busy||!preview} onClick={()=>shiftRows(-1)}>Shift one row away from you</button><button type="button" className={table.btn} disabled={busy||!preview} onClick={()=>shiftRows(1)}>Shift one row toward you</button><button type="button" className={`${table.btn} ${table.go}`} onClick={()=>{setChecking(false);setSwapAsk(false);}}>Looks right</button></div>
          </div>:null}
          <section className={g.step}>
            <StepHead number={settingNumber} title="Fine-tune"/>
            <div id={description}>
              <p className={g.line}>Move the field grid over your mat</p>
              <details className={g.help}><summary>How it works</summary>
                <p>Drag the grid over your mat. Drag a corner or edge to resize it; the opposite side stays put. Turn it to any angle with the round handle, or use the quarter-turn buttons. Arrow keys move it. From your seat: Field at top-left, Extra at bottom-left, and Deck at bottom-right.</p>
                <p>{hasExtraMonsterZones(format)?'Include the two Extra Monster Zones above your main monster row: EMZ left above M2, EMZ right above M4.':'Genesys uses five Main Monster Zones and no Extra Monster Zones.'}</p>
              </details>
            </div>
            <FieldOrientationControls defaultSide={defaultSide} calibration={preview} confirmHint={false} disabled={busy} onChange={grid=>{if(grid.corners.some((corner,i)=>corner.x!==tf.corners[i].x||corner.y!==tf.corners[i].y))tf.rebase(grid.corners);setOrientation(grid.orientation);setCalibrationCards([]);}}/>
            <p className={g.note} data-set={orientation?'':undefined}>{orientation?'Your side is set. Check that M1 and S5 match your physical mat.':'Choose your side before saving.'}</p>
            <FieldTransformControls tf={tf} disabled={locked}/>
          </section>
          <section className={g.step} data-testid="banished-step">
            <StepHead number={settingNumber+1} title="Banished zone"/>
            <p className={g.line}>Drag the pink sideways Banished zone to where you keep your banished cards.</p>
            <div className={g.actions}>
              <button type="button" className={table.btn} disabled={locked||!banish} data-testid="banished-reset" onClick={()=>setBanish(undefined)}>Put Banished back</button>
            </div>
            <details className={g.help}><summary>How it works</summary>
              <p>The Banished zone lies sideways, like on the virtual board. Cards banished face-up or face-down, upright or sideways, are counted as Banished when they are inside it. Click the zone and use the arrow keys to move it in small steps. The rest of the grid stays where it is.</p>
            </details>
          </section>
          {error?<p role="alert" className={g.error}>{error}</p>:null}
        </div>
        <div className={g.stage}>
          {image?<div ref={imageBox} className={g.image} data-testid="field-calibration-image">
            <img src={image} alt="Your camera view with an adjustable field grid" draggable={false}/>
            <svg className={g.grid} viewBox={`0 0 1000 ${gridHeight}`} preserveAspectRatio="none" role="img" aria-label="Field grid viewed from your seat">
              {shown.map(({cell,points,left,top})=>{const lit=checking&&(cell.zone==='M1'||cell.zone==='S5')?'':undefined;return <g key={cell.zone}><polygon data-zone={cell.zone} data-lit={lit} points={points.map(point=>`${point.x*1000},${point.y*gridHeight}`).join(' ')}/><text data-lit={lit} x={left*1000+inset} y={top*gridHeight+inset*.8} style={{fontSize:label.px*label.unit,strokeWidth:label.px*label.unit*.28}}>{cell.label}</text></g>;})}
            </svg>
            <FieldMoveSurface tf={tf} disabled={locked}/>
            {preview&&banishedShown?<svg className={g.banishLayer} viewBox={`0 0 1000 ${gridHeight}`} preserveAspectRatio="none" aria-hidden={locked||undefined}>
              <polygon className={g.banished} data-testid="banished-handle" data-moved={banish?'':undefined} points={banishedShown.points.map(point=>`${point.x*1000},${point.y*gridHeight}`).join(' ')} role="button" tabIndex={locked?-1:0} aria-label="Banished zone. Drag it, or use the arrow keys, to move it." aria-disabled={locked||undefined}
                onPointerDown={event=>{if(locked||event.button>0)return;const at=matUnder(event);if(!at)return;event.stopPropagation();event.currentTarget.setPointerCapture(event.pointerId);banishBase.current={rect:currentBanished(),at};}}
                onPointerMove={event=>{const base=banishBase.current,at=base&&matUnder(event);if(!base||!at)return;event.stopPropagation();moveBanished(at.x-base.at.x,at.y-base.at.y,base.rect);}}
                onPointerUp={event=>{banishBase.current=null;if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);}}
                onPointerCancel={()=>{banishBase.current=null;}}
                onKeyDown={event=>{
                  const step=event.shiftKey?.03:.01,dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
                  if(locked||!dx&&!dy)return;
                  // The arrow keys follow the picture, whatever side the mat is turned to.
                  event.preventDefault();event.stopPropagation();
                  const from=currentBanished(),c={x:from.x+from.w/2,y:from.y+from.h/2},at=matPoint(c.x,c.y),to=onMat({x:at.x+dx,y:at.y+dy},preview);
                  moveBanished(to.x-c.x,to.y-c.y,from);
                }}/>
            </svg>:null}
            {calibrationCards.map((card,i)=>{const x=card.quad.reduce((sum,p)=>sum+p.x,0)/4,y=card.quad.reduce((sum,p)=>sum+p.y,0)/4;return <button key={i} type="button" className={g.cardChoice} style={{left:`${x*100}%`,top:`${y*100}%`}} onClick={()=>chooseMonster(i)}>This is the monster</button>;})}
          </div>:<p className={g.empty}>Start your camera before calibrating.</p>}
        </div>
      </div>
      <footer className={g.foot}><span role="status" className={g.footNote}>Save once for this seat and camera on this device.</span>
        <div className={g.footActions}>
          <button type="button" className={`${table.btn} ${table.go}`} disabled={!image||busy||!orientation||!!calibrationCards.length} onClick={()=>{try{onSave(withBanished(createFieldCalibration(tf.corners,orientation),banish));}catch(e){setError((e as Error).message);}}}>Save calibration</button>
          <button type="button" className={`${table.btn} ${table.q}`} onClick={onCancel}>Cancel calibration</button>
        </div>
      </footer>
    </div>
  </div>,document.body);
}

/** A numbered step title; the number is decoration, the heading is the label. */
function StepHead({number,title}:{number:number;title:string}) {
  return <div className={g.stepHead}><span className={g.num} aria-hidden="true">{number}</span><h3>{title}</h3></div>;
}
const sameRect=(a:ZoneRect,b:ZoneRect)=>[a.x-b.x,a.y-b.y,a.w-b.w,a.h-b.h].every(d=>Math.abs(d)<1e-4);

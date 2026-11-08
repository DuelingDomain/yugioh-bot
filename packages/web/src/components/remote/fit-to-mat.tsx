"use client";

import {useEffect,useRef,useState} from 'react';
import {createFieldCalibration,matFitCalibration,type FieldCalibration,type MatFitResult,type PlayerSide} from '@yugidraft/vision';
import table from './ui/remote-ui.module.css';

const attempted=new WeakSet<HTMLVideoElement>();
const fallback="We could not see your mat's zones clearly. Turn on the zone grid and place it on your mat.";
interface Props {
  video:HTMLVideoElement|null; auto:boolean; defaultSide?:PlayerSide; disabled?:boolean; calibration?:FieldCalibration;
  onApply(grid:FieldCalibration):void; onBusy(value:boolean):void; onCapture(frame:HTMLCanvasElement):void;
}
/** One automatic attempt per camera element on first setup; subsequent fits are explicit. Pixels never leave this device. */
export function FitToMatControl(props:Props) {
  const latest=useRef(props);latest.current=props;
  const request=useRef<AbortController|null>(null),lastApplied=useRef<FieldCalibration|null>(null);
  const [busy,setBusy]=useState(false),[note,setNote]=useState(''),[fit,setFit]=useState<MatFitResult|null>(null),[flipped,setFlipped]=useState(false);
  async function run(){
    const {video,disabled,onBusy}=latest.current;
    if(request.current||disabled||!video?.videoWidth||video.readyState<2)return;
    const controller=new AbortController();request.current=controller;
    setBusy(true);onBusy(true);setNote('Looking for printed zones…');setFit(null);setFlipped(false);
    let frame:ImageBitmap|undefined;
    try{
      frame=await createImageBitmap(video);
      if(controller.signal.aborted){frame.close();return;}
      const canvas=document.createElement('canvas'),scale=Math.min(1,960/frame.width);
      canvas.width=Math.round(frame.width*scale);canvas.height=Math.round(frame.height*scale);
      canvas.getContext('2d')!.drawImage(frame,0,0,canvas.width,canvas.height);
      // Transfer raw pixels to the worker; only the small local preview is encoded asynchronously.
      const {fitToMat}=await import('@yugidraft/vision');
      controller.signal.throwIfAborted();
      const prior=latest.current.calibration?.orientation;
      const result=await fitToMat(frame,{signal:controller.signal,playerSide:prior?.playerSide??latest.current.defaultSide??'bottom',mirrored:prior?.mirrored});
      if(controller.signal.aborted)return;
      const calibration=matFitCalibration(result);
      if(!calibration){setNote(`${result.flags.colWindowAmbiguous?'Show the whole mat width, including Deck and GY. ':''}${fallback}`);return;}
      lastApplied.current=calibration;latest.current.onCapture(canvas);latest.current.onApply(calibration);setFit(result);
      setNote(result.flags.sideByPrior?'Preview only. Your side is unsure: check M1 and S5, use Flip if reversed, then Save calibration to confirm.':'Preview fitted to printed zones. Check it, then Save calibration to keep it.');
    }catch{if(!controller.signal.aborted)setNote(fallback);}
    finally{
      frame?.close();
      if(request.current===controller){request.current=null;setBusy(false);latest.current.onBusy(false);}
    }
  }
  const runRef=useRef(run);runRef.current=run;
  useEffect(()=>{
    const video=props.video;
    if(!video)return;
    const tryAuto=()=>{
      if(!latest.current.auto||attempted.has(video)||video.readyState<2||!video.videoWidth||latest.current.disabled)return;
      attempted.add(video);void runRef.current();
    };
    // Defer until after mount: React Strict Mode can clean up and replay this effect.
    const timer=setTimeout(tryAuto,0);video.addEventListener('loadeddata',tryAuto);
    return ()=>{
      clearTimeout(timer);video.removeEventListener('loadeddata',tryAuto);
      if(request.current){request.current.abort();request.current=null;attempted.delete(video);setBusy(false);latest.current.onBusy(false);}
    };
  },[props.video,props.auto]);
  // Derive this during render: a delayed effect from an earlier render could clear a newly flipped fit.
  const current=props.calibration,applied=lastApplied.current;
  const manuallyChanged=!!fit&&!!current&&!!applied&&(current.orientation?.playerSide!==applied.orientation?.playerSide
    ||current.orientation?.mirrored!==applied.orientation?.mirrored
    ||current.corners.some((p,i)=>Math.hypot(p.x-applied.corners[i].x,p.y-applied.corners[i].y)>=1e-8));
  function flip(){
    if(manuallyChanged||!fit?.corners||!fit.flipped)return;
    const next=!flipped,grid=next?fit.flipped:{corners:fit.corners,orientation:fit.orientation};
    const calibration=createFieldCalibration(grid.corners,grid.orientation);lastApplied.current=calibration;
    latest.current.onApply(calibration);setFlipped(next);
  }
  return <div data-testid="fit-to-mat" aria-busy={busy}>
    <button type="button" className={table.btn} disabled={props.disabled||busy||!props.video} onClick={()=>void run()}>{busy?'Fitting to mat…':'Fit to my mat'}</button>
    {!manuallyChanged&&fit?.flags.sideByPrior&&fit.flipped?<button type="button" className={table.btn} disabled={props.disabled||busy} aria-pressed={flipped} onClick={flip}>Flip</button>:null}
    <p role="status" aria-live="polite">{manuallyChanged?'Grid adjusted. Save calibration to keep your changes.':note}</p>
  </div>;
}

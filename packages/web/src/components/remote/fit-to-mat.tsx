"use client";

import {useEffect,useRef,useState} from 'react';
import {createFieldCalibration,matFitCalibration,type FieldCalibration,type MatFitResult} from '@yugidraft/vision';
import table from './ui/remote-ui.module.css';

const attempted=new WeakSet<HTMLVideoElement>();
const fallback="We could not see your mat's zones clearly. Turn on the zone grid and place it on your mat.";
interface Props {
  video:HTMLVideoElement|null; auto:boolean; disabled?:boolean; calibration?:FieldCalibration;
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
    try{
      const canvas=document.createElement('canvas');canvas.width=video.videoWidth;canvas.height=video.videoHeight;
      const context=canvas.getContext('2d',{willReadFrequently:true})!;
      context.drawImage(video,0,0); // Raw camera only: never capture the preview's SVG/grid or UI.
      const frame=context.getImageData(0,0,canvas.width,canvas.height);
      const {fitToMat}=await import('@yugidraft/vision');
      controller.signal.throwIfAborted();
      const prior=latest.current.calibration?.orientation;
      const result=await fitToMat(frame,{signal:controller.signal,playerSide:prior?.playerSide==='bottom'?'bottom':'top',mirrored:prior?.mirrored});
      if(controller.signal.aborted)return;
      const calibration=matFitCalibration(result);
      if(!calibration){setNote(`${result.flags.colWindowAmbiguous?'Show the whole mat width, including Deck and GY. ':''}${fallback}`);return;}
      lastApplied.current=calibration;latest.current.onCapture(canvas);latest.current.onApply(calibration);setFit(result);
      setNote(result.flags.sideByPrior?'Grid fitted and saved. Check M1 and S5; use Flip if your side is reversed.':'Grid fitted and saved to printed zones.');
    }catch{if(!controller.signal.aborted)setNote(fallback);}
    finally{
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

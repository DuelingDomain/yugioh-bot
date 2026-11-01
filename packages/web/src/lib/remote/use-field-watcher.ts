"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { createFieldCalibration, createFieldWatcher, type FieldCalibration, type FieldEvent, type FieldSnapshot, type FieldWatcher, type FieldWatcherOptions } from '@yugidraft/vision';

const initial:FieldSnapshot={status:'stopped',tracks:[],metrics:{detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0}};
export interface UseFieldWatcherOptions {
  owner:boolean; active:boolean; seatKey:string; sourceKey?:unknown;
  create():Promise<FieldWatcherOptions|null>; onEvent(event:FieldEvent):void;
}
/** Owner only. Preferences/calibration survive sessions; frames stay local; the caller may share identified public tracks. */
export function useFieldWatcher(options:UseFieldWatcherOptions) {
  const latest=useRef(options);latest.current=options;
  const watcher=useRef<FieldWatcher|null>(null);
  const [enabled,setOn]=useState(true),[loaded,setLoaded]=useState('');
  const [calibration,setGrid]=useState<FieldCalibration|undefined>();
  const [snapshot,setSnapshot]=useState<FieldSnapshot>(initial);
  const storageKey=`dd-field-watcher:v1:${options.seatKey}`;
  useEffect(()=>{
    let value:{enabled?:boolean;calibration?:FieldCalibration}={};
    try {const stored=JSON.parse(localStorage.getItem(storageKey)??'{}');if(stored&&typeof stored==='object')value=stored;}catch{/* Private mode/storage unavailable. */}
    setOn(value.enabled!==false);
    try {setGrid(value.calibration?createFieldCalibration(value.calibration.corners):undefined);}catch{setGrid(undefined);}
    setLoaded(storageKey);
  },[storageKey]);
  const save=useCallback((on:boolean,grid?:FieldCalibration)=>{try{localStorage.setItem(storageKey,JSON.stringify({enabled:on,calibration:grid}));}catch{/* Memory-only fallback. */}},[storageKey]);
  const setEnabled=useCallback((on:boolean)=>{setOn(on);save(on,calibration);},[save,calibration]);
  const setCalibration=useCallback((grid?:FieldCalibration)=>{setGrid(grid);watcher.current?.setCalibration(grid);save(enabled,grid);},[enabled,save]);
  useEffect(()=>{
    if(!options.owner||!options.active||!enabled||loaded!==storageKey){setSnapshot(initial);return;}
    let cancelled=false,reader:FieldWatcher|null=null;
    void latest.current.create().then(config=>{
      if(cancelled)return;
      if(!config){setSnapshot({...initial,status:'error',error:'Card reader assets are unavailable on this deployment.'});return;}
      reader=createFieldWatcher({...config,calibration});watcher.current=reader;
      reader.subscribe(event=>{if(!cancelled)latest.current.onEvent(event);});
      reader.subscribeState(()=>{if(!cancelled)setSnapshot(reader!.getSnapshot());});reader.start();
    }).catch(error=>{if(!cancelled)setSnapshot({...initial,status:'error',error:error instanceof Error?error.message:'Card watcher unavailable'});});
    return()=>{cancelled=true;reader?.dispose();if(watcher.current===reader)watcher.current=null;};
    // Calibration updates the running watcher without resetting physical IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[options.owner,options.active,options.sourceKey,enabled,loaded,storageKey]);
  return {enabled,setEnabled,calibration,setCalibration,snapshot,
    confirm:useCallback((id:string,cardId?:string)=>watcher.current?.confirm(id,cardId),[]),
    dismiss:useCallback((id:string)=>watcher.current?.dismiss(id),[]),
    forget:useCallback((id:string)=>watcher.current?.forget(id),[])};
}

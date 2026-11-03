"use client";

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultGridCalibration, isPlacedCalibration } from './zone-grid';
import { createFieldCalibration, createFieldWatcher, createFieldIdentityGallery, type FieldIdentityGallery, type FieldCalibration, type FieldEvent, type FieldSnapshot, type FieldWatcher, type FieldWatcherOptions } from '@yugidraft/vision';

const initial:FieldSnapshot={status:'stopped',tracks:[],metrics:{detectorMs:0,recognitionMs:0,dutyPercent:0,intervalMs:333,samples:0,skipped:0,placements:0,latencyMs:0,errors:0}};
export interface UseFieldWatcherOptions {
  owner:boolean; active:boolean; seatKey:string; duelKey?:string; sourceKey?:unknown; deviceKey?:string; deviceLabel?:string;
  create():Promise<FieldWatcherOptions|null>; onEvent(event:FieldEvent):void;
}
export const fieldCalibrationKey=(seatKey:string,deviceKey?:string)=>`dd-field-watcher:v1:${seatKey}${deviceKey?`:device:${encodeURIComponent(deviceKey)}`:''}`;
interface SavedRecord {enabled?:boolean;calibration?:FieldCalibration;cameraId?:string;cameraLabel?:string;placed?:boolean}
const parseRecord=(raw:string|null):SavedRecord|undefined=>{
  if(!raw)return undefined;
  try{const value=JSON.parse(raw);return value&&typeof value==='object'&&!Array.isArray(value)?value:undefined;}catch{return undefined;}
};
const seatPrefix=(seatKey:string)=>/^(.+:.+:)\d+$/.exec(seatKey)?.[1];
/** The other seat keys of the same user and guild: the mat and the camera do not change with the seat number. */
function siblingSeatKeys(seatKey:string):string[] {
  const prefix=seatPrefix(seatKey),base=fieldCalibrationKey(prefix??'');
  if(!prefix)return [];
  const seen=new Set<string>();
  for(let i=0;i<localStorage.length;i++){
    const rest=localStorage.key(i)?.startsWith(base)?localStorage.key(i)!.slice(base.length):'';
    const seat=/^(\d+)(:device:.*)?$/.exec(rest)?.[1];
    if(seat&&prefix+seat!==seatKey)seen.add(prefix+seat);
  }
  return [...seen];
}
/** One seat's record for this camera. A new camera id keeps the corners only when it is the same camera by label. */
function pickRecord(seatKey:string,deviceKey?:string,label?:string):SavedRecord|undefined {
  const exact=parseRecord(localStorage.getItem(fieldCalibrationKey(seatKey,deviceKey)));
  if(exact||!deviceKey)return exact;
  // Phone pairings never inherit a webcam's geometry.
  if(deviceKey.startsWith('phone:'))return undefined;
  const last=parseRecord(localStorage.getItem(fieldCalibrationKey(seatKey)));
  if(!last||!last.cameraId||last.cameraId===deviceKey)return last;
  if(String(last.cameraId).startsWith('phone:'))return undefined;
  if(label&&last.cameraLabel===label)return last;
  // Another camera for the same seat: keep which side the player sits on, but not the other camera's corners.
  const orientation=last.calibration?.orientation;
  if(!orientation)return undefined;
  try{return {enabled:last.enabled,calibration:createFieldCalibration(defaultGridCalibration().corners,orientation,last.calibration?.zoneSpacing),placed:false};}catch{return undefined;}
}
function readSaved(seatKey:string,deviceKey?:string,label?:string):SavedRecord {
  try {
    let value=pickRecord(seatKey,deviceKey,label);
    if(!value)for(const other of siblingSeatKeys(seatKey)){value=pickRecord(other,deviceKey,label);if(value)break;}
    return value??{};
  }catch{return {};}
}
/** A record made before the saved flag counts as placed when its corners left the first guess. */
const isPlaced=(saved:SavedRecord,calibration?:FieldCalibration)=>saved.placed??isPlacedCalibration(calibration);
/** Zone spacing lives in the saved calibration (`zoneSpacing`), so lobby and table read the same value. */
export const ZONE_SPACING={min:.85,max:1.4,step:.05,default:1} as const;
/** Lobby and table share the same seat + camera record, including orientation and whether the zones were placed. */
export function loadFieldCalibrationRecord(seatKey:string,deviceKey?:string,label?:string):{calibration?:FieldCalibration;placed:boolean} {
  try {
    const saved=readSaved(seatKey,deviceKey,label),calibration=saved.calibration?createFieldCalibration(saved.calibration.corners,saved.calibration.orientation,saved.calibration.zoneSpacing):undefined;
    return {calibration,placed:!!calibration?.orientation&&isPlaced(saved,calibration)};
  }catch{return {placed:false};}
}
export function loadFieldCalibration(seatKey:string,deviceKey?:string,label?:string):FieldCalibration|undefined {
  return loadFieldCalibrationRecord(seatKey,deviceKey,label).calibration;
}
/** `placed` marks a save from the calibration dialog; a side flip leaves it as it was. */
export function saveFieldCalibration(seatKey:string,grid:FieldCalibration,cameraId?:string,meta:{label?:string;placed?:boolean}={}) {
  try {
    const before=readSaved(seatKey,cameraId,meta.label);
    const value={...before,calibration:grid,cameraId,cameraLabel:meta.label??before.cameraLabel,placed:meta.placed??isPlaced(before,before.calibration)};
    localStorage.setItem(fieldCalibrationKey(seatKey,cameraId),JSON.stringify(value));
    // Retain the last-camera pointer for older clients and the lobby summary.
    if(cameraId)localStorage.setItem(fieldCalibrationKey(seatKey),JSON.stringify(value));
  }catch{/* Memory-only fallback. */}
}
/** Owner only. Preferences/calibration survive sessions; frames stay local; the caller may share identified public tracks. */
export function useFieldWatcher(options:UseFieldWatcherOptions) {
  const latest=useRef(options);latest.current=options;
  const watcher=useRef<FieldWatcher|null>(null);
  const gallery=useRef<{key:string;value:FieldIdentityGallery}|null>(null);
  const galleryKey=`dd-field-gallery:v1:${options.seatKey}:${options.duelKey??'lab'}`;
  const [enabled,setOn]=useState(true),[loaded,setLoaded]=useState('');
  const [calibration,setGrid]=useState<FieldCalibration|undefined>();
  const [placed,setPlaced]=useState(false);
  const placedRef=useRef(placed);placedRef.current=placed;
  const gridRef=useRef(calibration);gridRef.current=calibration;
  const [snapshot,setSnapshot]=useState<FieldSnapshot>(initial);
  const storageKey=fieldCalibrationKey(options.seatKey,options.deviceKey);
  const hasCalibration=!!calibration?.orientation;
  // Ready = a side is saved AND the zones were placed on the mat (the lobby reads the same rule).
  const calibrationNeeded=options.owner&&options.active&&enabled&&loaded===storageKey&&!(hasCalibration&&placed);
  useEffect(()=>{
    const value=readSaved(options.seatKey,options.deviceKey,options.deviceLabel),record=loadFieldCalibrationRecord(options.seatKey,options.deviceKey,options.deviceLabel);
    setOn(value.enabled!==false);
    setGrid(record.calibration);setPlaced(record.placed);
    setLoaded(storageKey);
  },[storageKey,options.seatKey,options.deviceKey,options.deviceLabel]);
  const save=useCallback((on:boolean,grid?:FieldCalibration,isPlacedNow=placedRef.current)=>{try{const value=JSON.stringify({enabled:on,calibration:grid,cameraId:options.deviceKey,cameraLabel:options.deviceLabel,placed:isPlacedNow});localStorage.setItem(storageKey,value);
    // Same last-camera pointer the lobby writes, so a flip made at the table shows in the lobby and the reverse.
    if(options.deviceKey&&!options.deviceKey.startsWith('phone:'))localStorage.setItem(fieldCalibrationKey(options.seatKey),value);}catch{/* Memory-only fallback. */}},[storageKey,options.deviceKey,options.deviceLabel,options.seatKey]);
  const setEnabled=useCallback((on:boolean)=>{setOn(on);save(on,calibration);},[save,calibration]);
  // `placed` is true from the calibration dialog; a side flip keeps it, and a grid moved off the first guess counts too.
  const setCalibration=useCallback((grid?:FieldCalibration,markPlaced?:boolean)=>{
    const next=!!grid&&(markPlaced??(placedRef.current||isPlacedCalibration(grid)));
    gridRef.current=grid;setGrid(grid);setPlaced(next);placedRef.current=next;watcher.current?.setCalibration(grid);save(enabled,grid,next);
  },[enabled,save]);
  useEffect(()=>{
    if(!options.owner||!options.active||!enabled||loaded!==storageKey){setSnapshot(initial);return;}
    let cancelled=false,reader:FieldWatcher|null=null;
    void latest.current.create().then(async config=>{
      if(cancelled)return;
      if(!config){setSnapshot({...initial,status:'error',error:'Card reader assets are unavailable on this deployment.'});return;}
      if(gallery.current?.key!==galleryKey){
        let saved:unknown=[];try{saved=JSON.parse(sessionStorage.getItem(galleryKey)??'[]');}catch{/* Memory-only in private mode. */}
        const value=createFieldIdentityGallery(saved,()=>{try{sessionStorage.setItem(galleryKey,JSON.stringify(value.entries()));}catch{/* Memory-only fallback. */}});
        gallery.current={key:galleryKey,value};
      }
      // Preload confirmed appearances and the seat deck while calibration is
      // open, before the first watcher sample can request recognition.
      if(!gridRef.current?.orientation){
        await config.recognizer.prepare?.({priors:config.getPriors?.(),sessionGallery:gallery.current.value.entries().flatMap(entry=>entry.cardId&&entry.embedding.values.length===config.profile.embedding.dim?[{cardId:entry.cardId,embedding:entry.embedding}]:[]).slice(-512)});
        return;
      }
      reader=createFieldWatcher({...config,calibration:gridRef.current,gallery:gallery.current.value});watcher.current=reader;
      reader.subscribe(event=>{if(!cancelled)latest.current.onEvent(event);});
      reader.subscribeState(()=>{if(!cancelled)setSnapshot(reader!.getSnapshot());});reader.start();
    }).catch(error=>{if(!cancelled)setSnapshot({...initial,status:'error',error:error instanceof Error?error.message:'Card watcher unavailable'});});
    return()=>{cancelled=true;reader?.dispose();if(watcher.current===reader)watcher.current=null;};
    // Calibration updates the running watcher without resetting physical IDs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[options.owner,options.active,options.sourceKey,enabled,loaded,storageKey,hasCalibration,galleryKey]);
  return {placed,getTrack:useCallback((id:string)=>watcher.current?.getSnapshot().tracks.find(t=>t.id===id),[]),enabled,setEnabled,calibration,setCalibration,calibrationNeeded,snapshot,
    isRemoved:useCallback((id:string)=>watcher.current?.getSnapshot().tracks.some(t=>t.id===id&&t.removed)??false,[]),
    confirm:useCallback((id:string,cardId?:string,ref?:string,human=true)=>watcher.current?.confirm(id,cardId,ref,human),[]),
    dismiss:useCallback((id:string)=>watcher.current?.dismiss(id),[]),
    forget:useCallback((id:string)=>watcher.current?.forget(id),[])};
}

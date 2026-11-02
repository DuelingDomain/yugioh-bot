import type {FieldCalibration,FieldFormat,FieldZone} from '../src/field-zones';
export type EventKind='placed'|'moved'|'removed'|'flipped'|'defense';
export type Zone=FieldZone|'HAND'|'UNKNOWN';
export interface Box {x:number;y:number;w:number;h:number}
export interface DetectorFrame {atMs:number;reviewed:boolean;cards:{instanceId:string;box:Box}[]}
export interface CardEvent {id:string;instanceId:string;atMs:number;kind:EventKind;cardId?:string;zone:Zone;fromZone?:Zone;faceDown?:boolean;position?:'attack'|'defense';box?:Box;reviewed:boolean}
export interface LabelledSession {
  version:1;id:string;source:'real'|'synthetic';video:string;durationMs:number;width:number;height:number;decklist:string[];
  format:FieldFormat;calibration?:FieldCalibration;reviewed:boolean;events:CardEvent[];detectorFrames?:DetectorFrame[];
  negatives:{startMs:number;endMs:number;kind:'hands'|'empty'}[];
  log:{atMs:number;type:string;detail?:string}[];capture?:{frameRate?:number;mimeType?:string;bytes?:number;createdAt?:string};
}
export interface PredictedEvent {atMs:number;frameAtMs?:number;kind:EventKind|'prompt';trackId:string;cardId?:string;zone:Zone;box:Box;candidates?:string[];tier?:string;faceDown?:boolean;position?:'attack'|'defense'}
export interface DetectionSample {atMs:number;cards:{box:Box;confidence:number}[]}
export type Variant='baseline'|'efficient';
export interface ReplayResult {
  variant:Variant;requestedBackend:'wasm'|'webgpu';events:PredictedEvent[];detections:DetectionSample[];wallMs:number;warmMs:number;inferenceMs:number;
  errors:string[];backends:string[];runtime:{crossOriginIsolated:boolean;wasmThreads:number;simd:boolean}[];stats:Record<string,number>;
}
const zones=new Set(['HAND','UNKNOWN','FIELD','EMZ1','EMZ2','GY','BANISHED','DECK','EXTRA',...Array.from({length:5},(_,i)=>`M${i+1}`),...Array.from({length:5},(_,i)=>`S${i+1}`)]);
export function validBox(box:Box):boolean {return [box.x,box.y,box.w,box.h].every(Number.isFinite)&&box.x>=0&&box.y>=0&&box.w>0&&box.h>0&&box.x+box.w<=1.001&&box.y+box.h<=1.001;}
export function validateSession(input:unknown):LabelledSession {
  const s=input as LabelledSession;
  if(!s||s.version!==1||typeof s.id!=='string'||!s.id||!['real','synthetic'].includes(s.source)||typeof s.video!=='string'||!s.video||/[\\/]/.test(s.video)||s.video==='..'||!s.video.toLowerCase().endsWith('.webm')&&!s.video.toLowerCase().endsWith('.mp4'))throw Error('Invalid session header or video filename');
  if(!Number.isFinite(s.durationMs)||s.durationMs<=0||s.durationMs>301000||![s.width,s.height].every(n=>Number.isInteger(n)&&n>0&&n<=4096)||!['normal','domain','genesys','genesys-domain'].includes(s.format)||typeof s.reviewed!=='boolean'||!Array.isArray(s.decklist)||!s.decklist.every(v=>typeof v==='string')||!Array.isArray(s.events)||s.events.length>10000||!Array.isArray(s.negatives)||!Array.isArray(s.log))throw Error('Invalid session dimensions, duration or collections');
  const ids=new Set<string>();
  for(const e of s.events){
    if(!e||typeof e.id!=='string'||ids.has(e.id)||typeof e.instanceId!=='string'||!e.instanceId||!Number.isFinite(e.atMs)||e.atMs<0||e.atMs>s.durationMs||!['placed','moved','removed','flipped','defense'].includes(e.kind)||!zones.has(e.zone)||e.fromZone!==undefined&&!zones.has(e.fromZone)||typeof e.reviewed!=='boolean'||e.cardId!==undefined&&typeof e.cardId!=='string'||e.box&&!validBox(e.box)||e.position!==undefined&&!['attack','defense'].includes(e.position)||e.faceDown!==undefined&&typeof e.faceDown!=='boolean')throw Error('Invalid or duplicate labelled event');ids.add(e.id);
  }
  for(const n of s.negatives)if(!n||!['hands','empty'].includes(n.kind)||!Number.isFinite(n.startMs)||!Number.isFinite(n.endMs)||n.startMs<0||n.endMs<=n.startMs||n.endMs>s.durationMs)throw Error('Invalid negative interval');
  if(s.detectorFrames!==undefined){
    if(!Array.isArray(s.detectorFrames)||s.detectorFrames.length>2000)throw Error('Invalid detector frames');
    for(const f of s.detectorFrames)if(!Number.isFinite(f.atMs)||f.atMs<0||f.atMs>s.durationMs||typeof f.reviewed!=='boolean'||!Array.isArray(f.cards)||f.cards.length>60||f.cards.some(c=>!c.instanceId||!validBox(c.box))||new Set(f.cards.map(c=>c.instanceId)).size!==f.cards.length)throw Error('Invalid detector frame');
  }
  if(s.calibration&&(s.calibration.version!==1||s.calibration.corners?.length!==4||s.calibration.corners.some(p=>![p.x,p.y].every(Number.isFinite)||p.x<0||p.x>1||p.y<0||p.y>1)))throw Error('Invalid calibration');
  return s;
}
export function boxIou(a:Box,b:Box) {const area=Math.max(0,Math.min(a.x+a.w,b.x+b.w)-Math.max(a.x,b.x))*Math.max(0,Math.min(a.y+a.h,b.y+b.h)-Math.max(a.y,b.y));return area/(a.w*a.h+b.w*b.h-area||1);}
export function distribution(values:number[]) {const v=[...values].sort((a,b)=>a-b);return {n:v.length,p50Ms:v.length?v[Math.ceil(v.length*.5)-1]:null,p95Ms:v.length?v[Math.ceil(v.length*.95)-1]:null,maxMs:v.at(-1)??null};}

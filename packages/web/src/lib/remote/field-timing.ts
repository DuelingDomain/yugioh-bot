import type {FieldTiming} from '@yugidraft/vision';
import type {RemoteRoom} from '@yugidraft/shared/remote';

// Local timing only. No card identity, pixels, or extra network requests.
const actions=new Map<string,{slug:string;timing:FieldTiming;seq?:number;rendered?:boolean}>();
export function markFieldTiming(timing:FieldTiming|undefined,stage:string,extra:Record<string,unknown>={}) {
  if(!timing||typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent('remote-field-latency',{detail:{...timing,stage,elapsedMs:Math.max(0,performance.timeOrigin+performance.now()-timing.originAt),...extra}}));
}
export function bindFieldTiming(id:string,slug:string,timing:FieldTiming|undefined) {
  if(!timing)return;
  actions.set(id,{slug,timing});
  while(actions.size>128)actions.delete(actions.keys().next().value!);
}
export function markFieldAction(id:string,stage:string,extra:Record<string,unknown>={}) {
  const value=actions.get(id);if(value)markFieldTiming(value.timing,stage,{actionId:id,...extra});
}
export function markFieldState(room:RemoteRoom,stage:'httpState'|'wsState'|'render') {
  for(const [id,value] of actions){
    if(value.slug!==room.slug)continue;
    if(room.state.undo?.actionId===id)value.seq??=room.lastSeq;
    if(value.seq!==room.lastSeq)continue;
    if(stage==='render'&&value.rendered)continue;
    if(stage==='render')value.rendered=true;
    markFieldTiming(value.timing,stage,{actionId:id,seq:room.lastSeq});
  }
}

// Geometry delivery shares the physical ref; no timing fields enter the wire format.
const backEvents=new Map<string,{timing:FieldTiming;at:number}>();
export function bindBackTiming(ref:string,timing:FieldTiming|undefined){
  if(!timing)return;backEvents.set(ref,{timing,at:performance.now()});
  while(backEvents.size>128)backEvents.delete(backEvents.keys().next().value!);
}
export function markBackTiming(ref:string,stage:string,extra:Record<string,unknown>={}){
  const value=backEvents.get(ref);if(!value)return;
  if(performance.now()-value.at<=30000)markFieldTiming(value.timing,stage,extra);
  if(stage==='backRender'||performance.now()-value.at>30000)backEvents.delete(ref);
}

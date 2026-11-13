import type {FieldTiming} from '@yugidraft/vision';
import type {RemoteRoom,RemoteCameraStamp,RemoteActionProposal} from '@yugidraft/shared/remote';

// Local timing only. No card identity, pixels, or extra network requests.
const actions=new Map<string,{slug:string;timing:FieldTiming;seq?:number;rendered?:boolean}>();
export function markFieldTiming(timing:FieldTiming|undefined,stage:string,extra:Record<string,unknown>={}) {
  if(!timing||typeof window==='undefined')return;
  window.dispatchEvent(new CustomEvent('remote-field-latency',{detail:{...timing,stage,elapsedMs:Math.max(0,performance.timeOrigin+performance.now()-timing.originAt),...extra}}));
}
/**
 * Camera timing for the saved event. All three times are on one clock, `performance.timeOrigin + performance.now()` (what the watcher uses),
 * so they line up with the recorder start the test recording sends on the same clock: the detector's first outline of the card, the end of the
 * last read (the name), and now (the board write). With `v`, the build id. `by` and `ui` say who made the change and with which control
 * (evidence only; the default is the camera on its own).
 */
export function fieldCameraStamp(timing:FieldTiming|undefined,by:'camera'|'player'='camera',ui?:string):RemoteCameraStamp {
  const stages=timing?.stagesMs,named=stages?.searchDoneLast??stages?.searchDone,v=process.env.NEXT_PUBLIC_SENTRY_RELEASE?.slice(0,12);
  return {...(timing?{seenAt:Math.round(timing.originAt+(stages?.firstOutline??0))}:{}),...(timing&&named!==undefined?{namedAt:Math.round(timing.originAt+named)}:{}),sentAt:Math.round(performance.timeOrigin+performance.now()),...(v?{v}:{}),by,...(ui?{ui}:{})};
}
/** A person's change: the same clock as the watcher stamps, no build id (small). */
export const playerStamp=(ui?:string):RemoteCameraStamp=>({sentAt:Math.round(performance.timeOrigin+performance.now()),by:'player',...(ui?{ui}:{})});
/** The control, when the proposal itself tells it. Most player actions give no name; that is fine. */
const uiOf=(p:RemoteActionProposal):string|undefined=>{
  if(p.type==='undo')return 'undo';
  const source=(p as {source?:string}).source;
  return source==='voice'||source==='typed'?source:p.type==='card.identified'&&source==='click'?'identify':undefined;
};
/**
 * The stamp a table action carries. It is made ONCE per idempotency key and the same object comes back for every retry of that key:
 * the server compares a repeated key with the saved action field by field, so a stamp with a new `sentAt` would be refused (409).
 * `by` is only set when the code knows: a write with `source: 'auto'` or from a phone scan (key `phone:...`) is the camera's reading, not a choice
 * (`camera`); an action for a test bot seat has no person behind it, so `by` is left out; everything else comes from a person (`player`).
 * A timer (`side.timeout`) is no person's choice and stays unstamped. A proposal that already has a stamp (the watcher's, or a call site's) keeps it.
 */
const stamps=new Map<string,RemoteCameraStamp|null>();
export function stampedProposal<T extends RemoteActionProposal>(payload:T,key:string,botSeat=false):T {
  if(!stamps.has(key)){
    const sentAt=Math.round(performance.timeOrigin+performance.now());
    const automatic=(payload as {source?:string}).source==='auto'||key.startsWith('phone:');
    stamps.set(key,payload.cam??(payload.type==='side.timeout'?null:automatic?{sentAt,by:'camera'}:botSeat?{sentAt}:playerStamp(uiOf(payload))));
    while(stamps.size>256)stamps.delete(stamps.keys().next().value!);
  }
  const cam=stamps.get(key);return cam?{...payload,cam}:payload;
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

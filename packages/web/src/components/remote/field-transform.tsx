"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { FIELD_ROTATION_MAX, IDENTITY_FIELD_TRANSFORM, straightenFieldCorners, transformFieldCorners, type FieldTransform } from '@yugidraft/vision';
import { DEFAULT_GRID_CORNERS } from '@/lib/remote/zone-grid';
import s from './field-transform.module.css';

type Point={x:number;y:number};
/** `size` is the size the owner asked for; `t.scale` can be smaller while a turn leaves no room, and it grows back to `size` when the turn eases. */
interface State {base:Point[];t:FieldTransform;size:number}
/** Slider limits. A step that would push the field out of the picture is ignored, so the thumb stops there. */
export const FIELD_SIZE={min:.5,max:1.6,step:.01} as const;
export const FIELD_STRETCH={min:.6,max:1.5,step:.01} as const;
export const FIELD_ROTATE={min:-FIELD_ROTATION_MAX,max:FIELD_ROTATION_MAX,step:.5} as const;
/** Fine steps for the buttons and keys: 1% of the picture to move, half a degree to turn. */
export const MOVE_STEP=.01,ROTATE_STEP=.5;
const clampTurn=(degrees:number)=>Math.max(-FIELD_ROTATION_MAX,Math.min(FIELD_ROTATION_MAX,degrees));
const fresh=():State=>({base:DEFAULT_GRID_CORNERS.map(p=>({...p})),t:IDENTITY_FIELD_TRANSFORM,size:1});
/** A saved quad opens at the turn it already has (the record holds only the corners), so 0 degrees straightens it and turns never pile up. */
const startState=(corners:Point[]|undefined,aspect:number):State=>{
  if(corners?.length!==4)return fresh();
  const {base,rotation}=straightenFieldCorners(corners,aspect);
  return {base,t:{...IDENTITY_FIELD_TRANSFORM,rotation},size:1};
};

/**
 * The whole-field calibration: one quad (the base) plus move, turn, size, width and height. The zones inside keep their fixed
 * proportions; nothing here edits a single zone. Undo keeps the last few states (changes within half a second count as one).
 * Only the resulting corners are saved (the saved record is the quad), so the turn shown at the start is read back from the quad's
 * edges. A turn that leaves no room makes the grid smaller for as long as it lasts; other changes that do not fit are ignored.
 * `aspect` is picture width / height, so a turn is not sheared.
 */
export function useFieldTransform(initial?:Point[],onCorners?:(corners:Point[])=>void,aspect=16/9) {
  const aspectRef=useRef(aspect);aspectRef.current=aspect;
  const [state,setState]=useState<State>(()=>startState(initial,aspect));
  const ref=useRef(state);ref.current=state;
  const history=useRef<State[]>([]),lastPush=useRef(0),[depth,setDepth]=useState(0);
  const notify=useRef(onCorners);notify.current=onCorners;
  const seed=useRef({initial,aspect,touched:false});seed.current.initial=initial;
  // The picture's real size can arrive after the first render; until the owner changes something, read the turn again with it.
  useEffect(()=>{
    if(seed.current.touched||seed.current.aspect===aspect)return;
    seed.current.aspect=aspect;const next=startState(seed.current.initial,aspect);ref.current=next;setState(next);
  },[aspect]);
  const result=useMemo(()=>transformFieldCorners(state.base,state.t,aspect,true),[state,aspect]);
  const corners=result?.corners??state.base;
  const commit=useCallback((next:State,push:boolean)=>{
    seed.current.touched=true;
    if(push){
      const now=Date.now();
      if(now-lastPush.current>500){history.current=[...history.current.slice(-19),ref.current];setDepth(history.current.length);}
      lastPush.current=now;
    }
    ref.current=next;setState(next);
    notify.current?.(transformFieldCorners(next.base,next.t,aspectRef.current)?.corners??next.base);
  },[]);
  const patch=useCallback((change:(t:FieldTransform)=>FieldTransform,resize=false)=>{
    const before=ref.current,out=transformFieldCorners(before.base,change(before.t),aspectRef.current);
    if(!out)return;
    commit({base:before.base,t:out.applied,size:resize?out.applied.scale:before.size},true);
  },[commit]);
  const turn=useCallback((rotation:(t:FieldTransform)=>number)=>{
    const before=ref.current,out=transformFieldCorners(before.base,{...before.t,scale:before.size,rotation:clampTurn(rotation(before.t))},aspectRef.current,true);
    if(!out)return;
    commit({base:before.base,t:out.applied,size:before.size},true);
  },[commit]);
  return {
    corners,t:state.t,canUndo:depth>0,
    move:useCallback((dx:number,dy:number)=>patch(t=>({...t,dx:t.dx+dx,dy:t.dy+dy})),[patch]),
    /** Turn the grid clockwise by `degrees` (negative = anticlockwise); it stops at the limit. */
    rotateBy:useCallback((degrees:number)=>turn(t=>(t.rotation??0)+degrees),[turn]),
    setRotation:useCallback((rotation:number)=>turn(()=>rotation),[turn]),
    setScale:useCallback((scale:number)=>patch(t=>({...t,scale}),true),[patch]),
    setWidth:useCallback((width:number)=>patch(t=>({...t,width})),[patch]),
    setHeight:useCallback((height:number)=>patch(t=>({...t,height})),[patch]),
    /** A new base quad (for example from the two-card setup); the sliders start over from it. */
    rebase:useCallback((next:Point[])=>{lastPush.current=0;commit(startState(next,aspectRef.current),true);},[commit]),
    reset:useCallback(()=>{lastPush.current=0;commit(fresh(),true);},[commit]),
    undo:useCallback(()=>{
      const previous=history.current.pop();setDepth(history.current.length);
      if(previous){lastPush.current=0;commit(previous,false);}
    },[commit]),
  };
}
export type FieldTransformState=ReturnType<typeof useFieldTransform>;

/**
 * Drag anywhere on the picture to move the whole grid; arrow keys move it 1% (Shift = 3%), [ and ] turn it half a degree (Shift = 2 degrees).
 * Turn it with the round handle above the grid, or with two fingers on a touch screen.
 */
export function FieldMoveSurface({tf,disabled=false}:{tf:FieldTransformState;disabled?:boolean}) {
  const drag=useRef<{x:number;y:number}|null>(null),fingers=useRef(new Map<number,{x:number;y:number}>()),twist=useRef<number|null>(null),handle=useRef<number|null>(null);
  const point=(event:PointerEvent<HTMLElement>)=>({x:event.clientX,y:event.clientY});
  const angleOf=(a:{x:number;y:number},b:{x:number;y:number})=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
  const wrap=(degrees:number)=>degrees>180?degrees-360:degrees<-180?degrees+360:degrees;
  const onKey=(event:KeyboardEvent)=>{
    const big=event.shiftKey;
    if(event.key==='['||event.key===']'){event.preventDefault();tf.rotateBy((event.key==='['?-1:1)*(big?4*ROTATE_STEP:ROTATE_STEP));return;}
    const step=big?3*MOVE_STEP:MOVE_STEP;
    const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    if(!dx&&!dy)return;
    event.preventDefault();tf.move(dx,dy);
  };
  const centre=tf.corners.reduce((sum,p)=>({x:sum.x+p.x/4,y:sum.y+p.y/4}),{x:0,y:0}),top={x:(tf.corners[0].x+tf.corners[1].x)/2,y:(tf.corners[0].y+tf.corners[1].y)/2};
  const knob={x:Math.max(.05,Math.min(.95,top.x+(top.x-centre.x)*.25)),y:Math.max(.06,Math.min(.94,top.y+(top.y-centre.y)*.25))};
  const clientCentre=(box:DOMRect)=>({x:box.left+centre.x*box.width,y:box.top+centre.y*box.height});
  return <div className={s.surface} tabIndex={disabled?-1:0} role="group" aria-label="Move field grid. Drag it, or use the arrow keys; hold Shift for larger steps. Turn it with the round handle, two fingers, or the [ and ] keys." data-testid="field-move" style={disabled?{pointerEvents:'none'}:undefined}
    onKeyDown={onKey}
    onPointerDown={event=>{
      if(event.button>0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);event.currentTarget.focus({preventScroll:true});
      fingers.current.set(event.pointerId,point(event));
      if(fingers.current.size===2){const [a,b]=[...fingers.current.values()];twist.current=angleOf(a,b);drag.current=null;}
      else if(fingers.current.size===1)drag.current=point(event);
    }}
    onPointerMove={event=>{
      if(fingers.current.has(event.pointerId))fingers.current.set(event.pointerId,point(event));
      if(fingers.current.size===2&&twist.current!==null){
        const [a,b]=[...fingers.current.values()],next=angleOf(a,b);
        tf.rotateBy(wrap(next-twist.current));twist.current=next;return;
      }
      const from=drag.current;if(!from||fingers.current.size>1)return;
      const box=event.currentTarget.getBoundingClientRect(),now=point(event);
      if(box.width&&box.height)tf.move((now.x-from.x)/box.width,(now.y-from.y)/box.height);
      drag.current=now;
    }}
    onPointerUp={event=>{fingers.current.delete(event.pointerId);drag.current=null;twist.current=null;}} onPointerCancel={event=>{fingers.current.delete(event.pointerId);drag.current=null;twist.current=null;}}>
    {disabled?null:<button type="button" className={s.knob} style={{left:`${knob.x*100}%`,top:`${knob.y*100}%`}} data-testid="field-rotate-handle" aria-label="Turn the grid. Drag around the grid, or use the Turn slider."
      onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();tf.rotateBy((event.key==='ArrowLeft'?-1:1)*ROTATE_STEP);}}}
      onPointerDown={event=>{
        if(event.button>0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);
        const box=event.currentTarget.parentElement!.getBoundingClientRect(),c=clientCentre(box);handle.current=angleOf(c,point(event));
      }}
      onPointerMove={event=>{
        if(handle.current===null)return;event.stopPropagation();
        const box=event.currentTarget.parentElement!.getBoundingClientRect(),next=angleOf(clientCentre(box),point(event));
        tf.rotateBy(wrap(next-handle.current));handle.current=next;
      }}
      onPointerUp={event=>{event.stopPropagation();handle.current=null;}} onPointerCancel={()=>{handle.current=null;}}/>}
  </div>;
}

function Slider({label,testId,value,range,onChange,disabled,show=v=>`${Math.round(v*100)}%`}:{label:string;testId:string;value:number;range:{min:number;max:number;step:number};onChange(value:number):void;disabled:boolean;show?(value:number):string}) {
  return <label className={s.slider}><span>{label}</span><output>{show(value)}</output>
    <input type="range" min={range.min} max={range.max} step={range.step} value={value} disabled={disabled} data-testid={testId} aria-valuetext={show(value)} onChange={event=>onChange(Number(event.currentTarget.value))}/></label>;
}
const degrees=(value:number)=>`${value>0?'+':''}${value.toFixed(1)}°`;

/** Move and turn buttons (1% and half a degree), then Size, Width and Height sliders with Undo and Reset. Flip lives in the side controls next to it. */
export function FieldTransformControls({tf,disabled=false}:{tf:FieldTransformState;disabled?:boolean}) {
  const turn=tf.t.rotation??0;
  return <div className={s.controls} data-testid="field-transform" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <div className={s.nudges}>
      <div className={s.nudge} role="group" aria-label="Move the grid 1 percent">
        <span>Move</span>
        <button type="button" disabled={disabled} aria-label="Move grid left" data-testid="field-move-left" onClick={()=>tf.move(-MOVE_STEP,0)}>←</button>
        <button type="button" disabled={disabled} aria-label="Move grid up" data-testid="field-move-up" onClick={()=>tf.move(0,-MOVE_STEP)}>↑</button>
        <button type="button" disabled={disabled} aria-label="Move grid down" data-testid="field-move-down" onClick={()=>tf.move(0,MOVE_STEP)}>↓</button>
        <button type="button" disabled={disabled} aria-label="Move grid right" data-testid="field-move-right" onClick={()=>tf.move(MOVE_STEP,0)}>→</button>
      </div>
      <div className={s.nudge} role="group" aria-label="Turn the grid half a degree">
        <span>Turn</span>
        <button type="button" disabled={disabled} aria-label="Turn grid anticlockwise" data-testid="field-turn-left" onClick={()=>tf.rotateBy(-ROTATE_STEP)}>↺</button>
        <output data-testid="field-turn-value">{degrees(turn)}</output>
        <button type="button" disabled={disabled} aria-label="Turn grid clockwise" data-testid="field-turn-right" onClick={()=>tf.rotateBy(ROTATE_STEP)}>↻</button>
      </div>
    </div>
    <div className={s.sliders}>
      <Slider label="Turn" testId="field-rotate" value={turn} range={FIELD_ROTATE} onChange={tf.setRotation} disabled={disabled} show={degrees}/>
      <Slider label="Size" testId="field-size" value={tf.t.scale} range={FIELD_SIZE} onChange={tf.setScale} disabled={disabled}/>
      <Slider label="Width" testId="field-width" value={tf.t.width} range={FIELD_STRETCH} onChange={tf.setWidth} disabled={disabled}/>
      <Slider label="Height" testId="field-height" value={tf.t.height} range={FIELD_STRETCH} onChange={tf.setHeight} disabled={disabled}/>
    </div>
    <div className={s.row}>
      <button type="button" disabled={disabled||!tf.canUndo} data-testid="field-undo" onClick={tf.undo}>Undo</button>
      <button type="button" disabled={disabled} data-testid="field-reset" onClick={tf.reset}>Reset</button>
    </div>
    <p className={s.hint}>Drag the grid to move it. Turn it with the round handle or two fingers. Arrow keys move 1%; [ and ] turn half a degree. The zones keep their shape.</p>
  </div>;
}

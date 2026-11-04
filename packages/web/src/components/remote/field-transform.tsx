"use client";

import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { IDENTITY_FIELD_TRANSFORM, transformFieldCorners, type FieldTransform } from '@yugidraft/vision';
import { DEFAULT_GRID_CORNERS } from '@/lib/remote/zone-grid';
import s from './field-transform.module.css';

type Point={x:number;y:number};
interface State {base:Point[];t:FieldTransform}
/** Slider limits. A step that would push the field out of the picture is ignored, so the thumb stops there. */
export const FIELD_SIZE={min:.5,max:1.6,step:.01} as const;
export const FIELD_STRETCH={min:.6,max:1.5,step:.01} as const;
const fresh=():State=>({base:DEFAULT_GRID_CORNERS.map(p=>({...p})),t:IDENTITY_FIELD_TRANSFORM});

/**
 * The whole-field calibration: one quad (the base) plus move, size, width and height. The zones inside keep their fixed
 * proportions; nothing here edits a single zone. Undo keeps the last few states (changes within half a second count as one).
 */
export function useFieldTransform(initial?:Point[],onCorners?:(corners:Point[])=>void) {
  const [state,setState]=useState<State>(()=>initial?.length===4?{base:initial.map(p=>({...p})),t:IDENTITY_FIELD_TRANSFORM}:fresh());
  const ref=useRef(state);ref.current=state;
  const history=useRef<State[]>([]),lastPush=useRef(0),[depth,setDepth]=useState(0);
  const notify=useRef(onCorners);notify.current=onCorners;
  const result=useMemo(()=>transformFieldCorners(state.base,state.t),[state]);
  const corners=result?.corners??state.base;
  const commit=useCallback((next:State,push:boolean)=>{
    if(push){
      const now=Date.now();
      if(now-lastPush.current>500){history.current=[...history.current.slice(-19),ref.current];setDepth(history.current.length);}
      lastPush.current=now;
    }
    ref.current=next;setState(next);
    notify.current?.(transformFieldCorners(next.base,next.t)?.corners??next.base);
  },[]);
  const patch=useCallback((change:(t:FieldTransform)=>FieldTransform)=>{
    const before=ref.current,out=transformFieldCorners(before.base,change(before.t));
    if(!out)return;
    commit({base:before.base,t:out.applied},true);
  },[commit]);
  return {
    corners,t:state.t,canUndo:depth>0,
    move:useCallback((dx:number,dy:number)=>patch(t=>({...t,dx:t.dx+dx,dy:t.dy+dy})),[patch]),
    setScale:useCallback((scale:number)=>patch(t=>({...t,scale})),[patch]),
    setWidth:useCallback((width:number)=>patch(t=>({...t,width})),[patch]),
    setHeight:useCallback((height:number)=>patch(t=>({...t,height})),[patch]),
    /** A new base quad (for example from the two-card setup); the sliders start over from it. */
    rebase:useCallback((next:Point[])=>{lastPush.current=0;commit({base:next.map(p=>({...p})),t:IDENTITY_FIELD_TRANSFORM},true);},[commit]),
    reset:useCallback(()=>{lastPush.current=0;commit(fresh(),true);},[commit]),
    undo:useCallback(()=>{
      const previous=history.current.pop();setDepth(history.current.length);
      if(previous){lastPush.current=0;commit(previous,false);}
    },[commit]),
  };
}
export type FieldTransformState=ReturnType<typeof useFieldTransform>;

/** Drag anywhere on the picture, or focus it and press the arrow keys (Shift = larger steps), to move the whole grid. */
export function FieldMoveSurface({tf,disabled=false}:{tf:FieldTransformState;disabled?:boolean}) {
  const drag=useRef<{x:number;y:number}|null>(null);
  const point=(event:PointerEvent<HTMLElement>)=>({x:event.clientX,y:event.clientY});
  const onKey=(event:KeyboardEvent)=>{
    const step=event.shiftKey?.02:.005;
    const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    if(!dx&&!dy)return;
    event.preventDefault();tf.move(dx,dy);
  };
  return <div className={s.surface} tabIndex={disabled?-1:0} role="group" aria-label="Move field grid. Drag it, or use the arrow keys; hold Shift for larger steps." data-testid="field-move" style={disabled?{pointerEvents:'none'}:undefined}
    onKeyDown={onKey}
    onPointerDown={event=>{if(event.button>0)return;event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);event.currentTarget.focus({preventScroll:true});drag.current=point(event);}}
    onPointerMove={event=>{
      const from=drag.current;if(!from)return;
      const box=event.currentTarget.getBoundingClientRect(),now=point(event);
      if(box.width&&box.height)tf.move((now.x-from.x)/box.width,(now.y-from.y)/box.height);
      drag.current=now;
    }}
    onPointerUp={()=>{drag.current=null;}} onPointerCancel={()=>{drag.current=null;}}/>;
}

function Slider({label,testId,value,range,onChange,disabled}:{label:string;testId:string;value:number;range:{min:number;max:number;step:number};onChange(value:number):void;disabled:boolean}) {
  return <label className={s.slider}><span>{label}</span><output>{Math.round(value*100)}%</output>
    <input type="range" min={range.min} max={range.max} step={range.step} value={value} disabled={disabled} data-testid={testId} aria-valuetext={`${Math.round(value*100)} percent`} onChange={event=>onChange(Number(event.currentTarget.value))}/></label>;
}

/** Size, width and height sliders with Undo and Reset. Flip lives in the side controls next to it. */
export function FieldTransformControls({tf,disabled=false}:{tf:FieldTransformState;disabled?:boolean}) {
  return <div className={s.controls} data-testid="field-transform" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <div className={s.sliders}>
      <Slider label="Size" testId="field-size" value={tf.t.scale} range={FIELD_SIZE} onChange={tf.setScale} disabled={disabled}/>
      <Slider label="Width" testId="field-width" value={tf.t.width} range={FIELD_STRETCH} onChange={tf.setWidth} disabled={disabled}/>
      <Slider label="Height" testId="field-height" value={tf.t.height} range={FIELD_STRETCH} onChange={tf.setHeight} disabled={disabled}/>
    </div>
    <div className={s.row}>
      <button type="button" disabled={disabled||!tf.canUndo} data-testid="field-undo" onClick={tf.undo}>Undo</button>
      <button type="button" disabled={disabled} data-testid="field-reset" onClick={tf.reset}>Reset</button>
    </div>
    <p className={s.hint}>Drag the grid, or press the arrow keys, to move it. The zones keep their shape.</p>
  </div>;
}

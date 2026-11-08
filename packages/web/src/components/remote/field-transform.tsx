"use client";

import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { fieldQuadEnvelope, type FieldQuadEnvelope, fieldQuadPoint, fieldQuadTurn, moveFieldQuad, pinchFieldQuad, resizeFieldQuad, turnFieldQuad, type FieldHandle } from '@yugidraft/vision';
import { DEFAULT_GRID_CORNERS } from '@/lib/remote/zone-grid';
import s from './field-transform.module.css';

type Point={x:number;y:number};
/**
 * `quad` is the grid as saved (clockwise from the mat's top-left corner). `angle` is its turn in degrees (0 up to 360), read from the quad
 * when the screen opens. `restore` is how much smaller a turn made the grid than the owner asked for; turning back grows it again.
 * `limits` retains the initial fitted envelope through edits and undo, including any inferred off-camera EMZ row.
 */
interface State {quad:Point[];angle:number;restore:number;limits:FieldQuadEnvelope}
export type FieldGrab=State;
/** Fine steps for the buttons and keys: 1% of the picture to move, a degree to turn (Shift: three times the move, five times the turn). */
export const MOVE_STEP=.01,ROTATE_STEP=1,ROTATE_BIG=5;
/** A drag near a quarter turn sticks to it. */
export const SNAP_DEGREES=3;
const wrapTurn=(degrees:number)=>((degrees%360)+360)%360;
const fresh=():State=>({quad:DEFAULT_GRID_CORNERS.map(p=>({...p})),angle:0,restore:1,limits:fieldQuadEnvelope(DEFAULT_GRID_CORNERS)});
/** A saved quad opens at the turn it already has (the record holds only the corners), so a turn adds to it instead of piling on. */
const startState=(corners:Point[]|undefined,aspect:number):State=>corners?.length===4?{quad:corners.map(p=>({...p})),angle:fieldQuadTurn(corners,aspect),restore:1,limits:fieldQuadEnvelope(corners)}:fresh();

/**
 * The whole-field calibration, edited like a picture: move it, drag a corner or edge to resize it (the opposite side stays put), turn it
 * to any angle. The zones inside keep their fixed proportions; nothing here edits a single zone. Undo keeps the last few states (changes
 * within half a second count as one). Only the quad is saved. A turn that leaves no room makes the grid smaller for as long as it lasts;
 * a resize or move that does not fit stops at the picture's edge. Drags work from the state `grab()` gave at the start, so they never drift.
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
  const commit=useCallback((next:State,push:boolean)=>{
    seed.current.touched=true;
    if(push){
      const now=Date.now();
      if(now-lastPush.current>500){history.current=[...history.current.slice(-19),ref.current];setDepth(history.current.length);}
      lastPush.current=now;
    }
    ref.current=next;setState(next);
    notify.current?.(next.quad);
  },[]);
  const turnFrom=useCallback((from:State,degrees:number)=>{
    const out=turnFieldQuad(from.quad,degrees,aspectRef.current,from.restore,from.limits);
    if(out)commit({...from,quad:out.corners,angle:wrapTurn(from.angle+degrees),restore:out.restore},true);
  },[commit]);
  const pinchFrom=useCallback((from:State,factor:number,degrees:number)=>{
    const quad=pinchFieldQuad(from.quad,factor,degrees,aspectRef.current,from.limits);
    if(quad)commit({...from,quad,angle:wrapTurn(from.angle+degrees),restore:1},true);
  },[commit]);
  return {
    corners:state.quad,angle:state.angle,aspect,canUndo:depth>0,
    /** The state a drag starts from; pass it back to the `...From` calls. */
    grab:useCallback(()=>ref.current,[]),
    move:useCallback((dx:number,dy:number)=>{const quad=moveFieldQuad(ref.current.quad,dx,dy,ref.current.limits);if(quad)commit({...ref.current,quad},true);},[commit]),
    /** Turn the grid clockwise by `degrees` (negative = anticlockwise), any amount. */
    turnBy:useCallback((degrees:number)=>turnFrom(ref.current,degrees),[turnFrom]),
    turnFrom,pinchFrom,
    /** Grow or shrink about the centre by `factor`. */
    scaleBy:useCallback((factor:number)=>pinchFrom(ref.current,factor,0),[pinchFrom]),
    /** Drag a corner or edge handle to a picture point; the opposite side stays where it was. */
    resizeFrom:useCallback((from:State,handle:FieldHandle,pointer:Point,keepAspect:boolean)=>{
      const quad=resizeFieldQuad(from.quad,handle,pointer,keepAspect,from.limits);
      if(quad)commit({...from,quad,angle:from.angle,restore:1},true);
    },[commit]),
    /** A new quad (for example from the two-card setup); the turn is read from it. */
    rebase:useCallback((next:Point[])=>{lastPush.current=0;commit(startState(next,aspectRef.current),true);},[commit]),
    reset:useCallback(()=>{lastPush.current=0;commit(fresh(),true);},[commit]),
    undo:useCallback(()=>{
      const previous=history.current.pop();setDepth(history.current.length);
      if(previous){lastPush.current=0;commit(previous,false);}
    },[commit]),
  };
}
export type FieldTransformState=ReturnType<typeof useFieldTransform>;

const HANDLES:{id:string;at:FieldHandle;cursor:string;label:string}[]=[
  {id:'nw',at:{x:0,y:0},cursor:'nwse-resize',label:'top-left corner'},{id:'n',at:{x:.5,y:0},cursor:'ns-resize',label:'top edge'},
  {id:'ne',at:{x:1,y:0},cursor:'nesw-resize',label:'top-right corner'},{id:'e',at:{x:1,y:.5},cursor:'ew-resize',label:'right edge'},
  {id:'se',at:{x:1,y:1},cursor:'nwse-resize',label:'bottom-right corner'},{id:'s',at:{x:.5,y:1},cursor:'ns-resize',label:'bottom edge'},
  {id:'sw',at:{x:0,y:1},cursor:'nesw-resize',label:'bottom-left corner'},{id:'w',at:{x:0,y:.5},cursor:'ew-resize',label:'left edge'},
];
const angleOf=(a:Point,b:Point)=>Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI;
const wrap=(degrees:number)=>degrees>180?degrees-360:degrees<-180?degrees+360:degrees;
/** Stick to a quarter turn when the drag comes within a few degrees of it. */
export const snapTurn=(degrees:number)=>{const quarter=Math.round(degrees/90)*90;return Math.abs(degrees-quarter)<=SNAP_DEGREES?quarter:degrees;};
/** The angle a knob drag lands on: the start angle until the drag has turned a snap's worth (a grid that reads 2 degrees off stays put), then quarter turns stick. */
export const dragTurn=(start:number,total:number)=>Math.abs(total)<SNAP_DEGREES?start:snapTurn(start+total);

/**
 * Edit the grid on the picture. Drag the grid to move it; drag a corner or edge handle to resize (Shift on a corner keeps the shape);
 * turn it with the round handle above it (it sticks at quarter turns) or two fingers, which also pinch to resize.
 * Arrow keys move 1% (Shift 3%), [ and ] turn a degree (Shift 5), + and - resize (Alt for bigger steps).
 */
export function FieldMoveSurface({tf,disabled=false}:{tf:FieldTransformState;disabled?:boolean}) {
  const drag=useRef<Point|null>(null),fingers=useRef(new Map<number,Point>()),pinch=useRef<{from:FieldGrab;distance:number;angle:number}|null>(null);
  const turning=useRef<{id:number;from:FieldGrab;last:number;total:number;centre:Point}|null>(null),resizing=useRef<{id:number;from:FieldGrab;at:FieldHandle;dx:number;dy:number}|null>(null);
  const [showAngle,setShowAngle]=useState(false),[size,setSize]=useState({w:0,h:0}),surfaceRef=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const el=surfaceRef.current;if(!el)return;
    const read=()=>{const r=el.getBoundingClientRect();setSize(old=>old.w===r.width&&old.h===r.height?old:{w:r.width,h:r.height});};
    read();if(typeof ResizeObserver==='undefined')return;
    const watcher=new ResizeObserver(read);watcher.observe(el);return()=>watcher.disconnect();
  },[]);
  const point=(event:PointerEvent<HTMLElement>)=>({x:event.clientX,y:event.clientY});
  const onKey=(event:KeyboardEvent)=>{
    if(event.ctrlKey||event.metaKey)return;// browser zoom and other shortcuts
    const big=event.shiftKey;
    if(event.key==='['||event.key===']'){event.preventDefault();tf.turnBy((event.key==='['?-1:1)*(big?ROTATE_BIG:ROTATE_STEP));return;}
    // "+" is Shift plus the Equal key on a US keyboard, so Shift cannot mean "bigger" here: Alt does.
    const grow=event.code==='Equal'||event.code==='NumpadAdd'||event.key==='+'||event.key==='=',shrink=event.code==='Minus'||event.code==='NumpadSubtract'||event.key==='-'||event.key==='_';
    if(grow||shrink){event.preventDefault();const f=event.altKey?1.1:1.02;tf.scaleBy(shrink?1/f:f);return;}
    const step=big?3*MOVE_STEP:MOVE_STEP;
    const dx=event.key==='ArrowLeft'?-step:event.key==='ArrowRight'?step:0,dy=event.key==='ArrowUp'?-step:event.key==='ArrowDown'?step:0;
    if(!dx&&!dy)return;
    event.preventDefault();tf.move(dx,dy);
  };
  const centre=fieldQuadPoint(tf.corners,{x:.5,y:.5});
  // The round handle sits a fixed distance outside the grid's top edge, whatever the angle. With no room there it goes outside the
  // bottom edge instead, and inside the grid as a last resort, so it never lands on an edge handle.
  const reach=38,edgeSpot=(at:Point,sign:number)=>{
    const edge=fieldQuadPoint(tf.corners,at),out={x:(edge.x-centre.x)*tf.aspect*sign,y:(edge.y-centre.y)*sign},length=Math.hypot(out.x,out.y)||1;
    return {edge,dx:out.x/length*reach,dy:out.y/length*reach};
  };
  const fits=(spot:{edge:Point;dx:number;dy:number})=>!size.w||!size.h||(()=>{const x=spot.edge.x*size.w+spot.dx,y=spot.edge.y*size.h+spot.dy;return x>=22&&x<=size.w-22&&y>=22&&y<=size.h-22;})();
  const above=edgeSpot({x:.5,y:0},1),below=edgeSpot({x:.5,y:1},-1);
  const spot=fits(above)?above:fits(below)?below:null;
  const inside=fieldQuadPoint(tf.corners,{x:.5,y:.22});
  const knobStyle=spot
    ?{left:`clamp(22px, calc(${spot.edge.x*100}% + ${spot.dx}px), calc(100% - 22px))`,top:`clamp(22px, calc(${spot.edge.y*100}% + ${spot.dy}px), calc(100% - 22px))`}
    :{left:`${inside.x*100}%`,top:`${inside.y*100}%`};
  const surfaceBox=(event:PointerEvent<HTMLElement>)=>event.currentTarget.parentElement!.getBoundingClientRect();
  const stop=(event:PointerEvent<HTMLElement>)=>{event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);};
  // One gesture owns the grid at a time: a handle or the knob drags alone, and a second finger elsewhere is ignored (it would commit from a stale snapshot).
  const busy=()=>!!resizing.current||!!turning.current;
  const refuse=(event:PointerEvent<HTMLElement>)=>{event.preventDefault();event.stopPropagation();};
  // A finger on the grid body, or a second finger on a handle or the knob while one is already down: it joins the move or the pinch.
  const startFinger=(event:PointerEvent<HTMLElement>,focus:boolean)=>{
    event.preventDefault();event.stopPropagation();event.currentTarget.setPointerCapture?.(event.pointerId);if(focus)event.currentTarget.focus({preventScroll:true});
    fingers.current.set(event.pointerId,point(event));
    if(fingers.current.size===2){const [a,b]=[...fingers.current.values()];pinch.current={from:tf.grab(),distance:Math.hypot(b.x-a.x,b.y-a.y),angle:angleOf(a,b)};drag.current=null;}
    else if(fingers.current.size===1)drag.current=point(event);
  };
  const finish=(event:PointerEvent<HTMLElement>)=>{fingers.current.delete(event.pointerId);drag.current=null;pinch.current=null;};
  return <div ref={surfaceRef} className={s.surface} tabIndex={disabled?-1:0} role="group" aria-label="Edit field grid. Drag it to move; drag a corner or edge to resize; turn it with the round handle or two fingers. Arrow keys move, [ and ] turn, plus and minus resize; hold Shift (Alt for resize) for larger steps." data-testid="field-move" aria-disabled={disabled||undefined}
    onKeyDown={disabled?undefined:onKey}
    onPointerDown={event=>{
      if(disabled||event.button>0)return;if(busy()){refuse(event);return;}startFinger(event,true);
    }}
    onPointerMove={event=>{
      if(!fingers.current.has(event.pointerId))return;
      fingers.current.set(event.pointerId,point(event));
      const two=pinch.current;
      if(fingers.current.size===2&&two){
        const [a,b]=[...fingers.current.values()],distance=Math.hypot(b.x-a.x,b.y-a.y);
        if(two.distance>8)tf.pinchFrom(two.from,distance/two.distance,wrap(angleOf(a,b)-two.angle));
        return;
      }
      const from=drag.current;if(!from||fingers.current.size>1)return;
      const box=event.currentTarget.getBoundingClientRect(),now=point(event);
      if(box.width&&box.height)tf.move((now.x-from.x)/box.width,(now.y-from.y)/box.height);
      drag.current=now;
    }}
    onPointerUp={finish} onPointerCancel={finish}>
    {disabled?null:<>
      {HANDLES.map(h=>{
        const at=fieldQuadPoint(tf.corners,h.at),corner=h.at.x!==.5&&h.at.y!==.5;
        return <button key={h.id} type="button" tabIndex={-1} className={`${s.handle} ${corner?s.corner:s.edge}`} style={{left:`clamp(22px, ${at.x*100}%, calc(100% - 22px))`,top:`clamp(22px, ${at.y*100}%, calc(100% - 22px))`,cursor:h.cursor}} data-testid={`field-handle-${h.id}`} aria-label={`Resize from the ${h.label}`}
          onPointerDown={event=>{if(event.button>0)return;if(busy()){refuse(event);return;}if(fingers.current.size>0){startFinger(event,false);return;}stop(event);
            // A handle at the picture's edge is drawn a little inside it; remember how far the finger is from the true edge so the drag does not jump.
            const box=surfaceBox(event);resizing.current={id:event.pointerId,from:tf.grab(),at:h.at,dx:box.width?(event.clientX-box.left)/box.width-at.x:0,dy:box.height?(event.clientY-box.top)/box.height-at.y:0};}}
          onPointerMove={event=>{
            const active=resizing.current;if(!active||active.id!==event.pointerId)return;event.stopPropagation();
            const box=surfaceBox(event);if(!box.width||!box.height)return;
            tf.resizeFrom(active.from,active.at,{x:(event.clientX-box.left)/box.width-active.dx,y:(event.clientY-box.top)/box.height-active.dy},event.shiftKey);
          }}
          onPointerUp={event=>{if(resizing.current?.id===event.pointerId){event.stopPropagation();resizing.current=null;}}} onPointerCancel={event=>{if(resizing.current?.id===event.pointerId)resizing.current=null;}}/>;
      })}
      <button type="button" className={s.knob} style={knobStyle} data-testid="field-rotate-handle" aria-label="Turn the grid to any angle. Drag around the grid; it sticks at quarter turns. Arrow keys turn it a degree."
        onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();event.stopPropagation();tf.turnBy((event.key==='ArrowLeft'?-1:1)*(event.shiftKey?ROTATE_BIG:ROTATE_STEP));}}}
        onPointerDown={event=>{
          if(event.button>0)return;if(busy()){refuse(event);return;}if(fingers.current.size>0){startFinger(event,false);return;}stop(event);
          const box=surfaceBox(event),from=tf.grab(),mid=fieldQuadPoint(from.quad,{x:.5,y:.5}),c={x:box.left+mid.x*box.width,y:box.top+mid.y*box.height};
          turning.current={id:event.pointerId,from,last:angleOf(c,point(event)),total:0,centre:c};setShowAngle(true);
        }}
        onPointerMove={event=>{
          const active=turning.current;if(!active||active.id!==event.pointerId)return;event.stopPropagation();
          const next=angleOf(active.centre,point(event));active.total+=wrap(next-active.last);active.last=next;
          tf.turnFrom(active.from,dragTurn(active.from.angle,active.total)-active.from.angle);
        }}
        onPointerUp={event=>{if(turning.current?.id===event.pointerId){event.stopPropagation();turning.current=null;setShowAngle(false);}}} onPointerCancel={event=>{if(turning.current?.id===event.pointerId){turning.current=null;setShowAngle(false);}}}/>
      {showAngle?<output className={s.angle} style={knobStyle} data-testid="field-angle-bubble">{Math.round(tf.angle)}°</output>:null}
    </>}
  </div>;
}

const degrees=(value:number)=>`${value.toFixed(1)}°`;

/** Move buttons (1%), quarter-turn buttons with the angle, Undo and Reset. Flip lives in the side controls next to it. */
export function FieldTransformControls({tf,disabled=false}:{tf:FieldTransformState;disabled?:boolean}) {
  return <div className={s.controls} data-testid="field-transform" onPointerDown={event=>event.stopPropagation()} onClick={event=>event.stopPropagation()}>
    <div className={s.nudges}>
      <div className={s.nudge} role="group" aria-label="Move the grid 1 percent">
        <span>Move</span>
        <button type="button" disabled={disabled} aria-label="Move grid left" data-testid="field-move-left" onClick={()=>tf.move(-MOVE_STEP,0)}>←</button>
        <button type="button" disabled={disabled} aria-label="Move grid up" data-testid="field-move-up" onClick={()=>tf.move(0,-MOVE_STEP)}>↑</button>
        <button type="button" disabled={disabled} aria-label="Move grid down" data-testid="field-move-down" onClick={()=>tf.move(0,MOVE_STEP)}>↓</button>
        <button type="button" disabled={disabled} aria-label="Move grid right" data-testid="field-move-right" onClick={()=>tf.move(MOVE_STEP,0)}>→</button>
      </div>
      <div className={s.nudge} role="group" aria-label="Turn the grid a quarter turn">
        <span>Turn</span>
        <button type="button" disabled={disabled} aria-label="Turn grid 90 degrees anticlockwise" data-testid="field-turn-left" onClick={()=>tf.turnBy(-90)}>↺</button>
        <output data-testid="field-turn-value">{degrees(tf.angle)}</output>
        <button type="button" disabled={disabled} aria-label="Turn grid 90 degrees clockwise" data-testid="field-turn-right" onClick={()=>tf.turnBy(90)}>↻</button>
      </div>
    </div>
    <div className={s.row}>
      <button type="button" disabled={disabled||!tf.canUndo} data-testid="field-undo" onClick={tf.undo}>Undo</button>
      <button type="button" disabled={disabled} data-testid="field-reset" onClick={tf.reset}>Reset</button>
    </div>
    <p className={s.hint}>Drag the grid to move it, a corner or edge to resize it, the round handle to turn it. Arrow keys move 1%; [ and ] turn a degree; + and - resize. The zones keep their shape.</p>
  </div>;
}

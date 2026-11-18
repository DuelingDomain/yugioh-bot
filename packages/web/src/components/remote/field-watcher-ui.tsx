"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { duelFontClasses } from '@/components/duel/fonts';
import { placePopup, type Rect } from './ui/popup';
import table from './ui/remote-ui.module.css';
import s from './field-watcher-ui.module.css';

export type FieldWatcherPrompt={
  id:string;revision?:number;zone:string;title?:string;presence?:boolean;quad?:readonly {x:number;y:number}[];
  candidates:readonly {id:string;label:string;disabled?:boolean}[];emptyMessage?:string;
};
export type FieldWatcherUIProps={
  changes?: readonly string[];onChanged?(zone:string):void;
  zoneSeat?:number;keepUnresolved?:boolean;onWrong?(promptId:string):void;onNotACard?(promptId:string):void;
  host:HTMLElement|null;enabled:boolean;onEnabledChange(enabled:boolean):void;
  statusLabel:string;statusTitle?:string;/** Something waits for the player: the chip is drawn loud, and with `onStatusAction` it is a button (open the notices, or resume). */attention?:boolean;onStatusAction?():void;statusExtra?:ReactNode;calibrated:boolean;calibrationDisabled:boolean;onCalibrate():void;
  prompts:readonly FieldWatcherPrompt[];pending:boolean;onChoose(promptId:string,cardId:string):void;onDismiss(promptId:string):void;
  notice?:ReactNode;noticeTestId?:string;
  /** The notification stack beside the field. Prompts and notices go there, never over the camera. */
  dock?:HTMLElement|null;
};
const stop=(event:SyntheticEvent)=>event.stopPropagation();
const promptKey=(prompt:FieldWatcherPrompt)=>`${prompt.id}:${prompt.revision??0}`;
/** The controls keep only the keys they use. Table shortcuts (W, S, V, Ctrl+Z) still work with focus on them. */
const keepControlKey=(event:KeyboardEvent)=>{if(event.key==='Enter'||event.key===' '||event.key==='Tab')event.stopPropagation();};
function zoneName(zone:string):string {
  if(/^M[1-5]$/.test(zone))return `Main Monster Zone ${zone.slice(1)}`;
  if(/^S[1-5]$/.test(zone))return `Spell/Trap Zone ${zone.slice(1)}`;
  return ({EMZ1:'Extra Monster Zone, left',EMZ2:'Extra Monster Zone, right',FIELD:'Field Spell Zone',GY:'Graveyard',DECK:'Deck',EXTRA:'Extra Deck',BANISHED:'Banished cards'} as Record<string,string>)[zone]??zone;
}
function promptAnchor(host:HTMLElement,quad:FieldWatcherPrompt['quad']):{anchor:Rect|null;feed:Rect} {
  const feed=host.getBoundingClientRect(),video=host.querySelector('video');
  if(!quad?.length)return {anchor:null,feed};
  const rect=video?.getBoundingClientRect()??feed;
  const scale=video?.videoWidth?Math.min(rect.width/video.videoWidth,rect.height/video.videoHeight):1;
  const width=video?.videoWidth?video.videoWidth*scale:rect.width,height=video?.videoHeight?video.videoHeight*scale:rect.height;
  const left=rect.left+(rect.width-width)/2,top=rect.top+(rect.height-height)/2;
  return {feed,anchor:{left:left+Math.min(...quad.map(p=>p.x))*width,right:left+Math.max(...quad.map(p=>p.x))*width,top:top+Math.min(...quad.map(p=>p.y))*height,bottom:top+Math.max(...quad.map(p=>p.y))*height}};
}

/** The "?" on a zone that still needs a look. The choices open in a floating panel: the field is tilted and clipped, so nothing can open inside it. */
function ZonePrompt({prompt,first,zone,pending,onChoose,onWrong,onNotACard}:{prompt:FieldWatcherPrompt;first:FieldWatcherPrompt['candidates'][number]|undefined;zone:string;pending:boolean;onChoose(id:string,cardId:string):void;onWrong?(id:string):void;onNotACard(id:string):void}) {
  const [open,setOpen]=useState(false),badge=useRef<HTMLButtonElement>(null),panel=useRef<HTMLDivElement>(null);
  const [style,setStyle]=useState<CSSProperties>({visibility:'hidden'});
  const close=(refocus=false)=>{setOpen(false);if(refocus)badge.current?.focus();};
  useLayoutEffect(()=>{
    const cell=badge.current?.parentElement,node=panel.current;
    if(!open||!cell||!node)return;
    const place=()=>{
      const box=cell.getBoundingClientRect(),w=node.offsetWidth,h=node.offsetHeight,vw=window.innerWidth,vh=window.innerHeight;
      const left=Math.max(8,Math.min(box.left+box.width/2-w/2,vw-w-8));
      const below=box.bottom+6,top=below+h<=vh-8?below:Math.max(8,box.top-6-h);
      setStyle({left,top});
    };
    place();window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    const outside=(event:PointerEvent)=>{if(!node.contains(event.target as Node)&&!badge.current?.contains(event.target as Node))setOpen(false);};
    document.addEventListener('pointerdown',outside);
    node.querySelector('button')?.focus();
    return()=>{window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);document.removeEventListener('pointerdown',outside);};
  },[open]);
  const run=(act:()=>void)=>()=>{act();close();};
  const others=prompt.candidates.filter(c=>!c.disabled&&c!==first).slice(0,2);
  return <>
    <button ref={badge} type="button" className={s.zoneBadge} data-testid="zone-uncertainty" aria-haspopup="dialog" aria-expanded={open} aria-label={`Check card in ${zone}`} title="Check this card" onClick={event=>{event.stopPropagation();setOpen(o=>!o);}} onPointerDown={stop} onKeyDown={event=>{event.stopPropagation();}}>?</button>
    {open?createPortal(<div ref={panel} className={`${duelFontClasses} ${s.theme} ${s.zonePanel}`} style={style} role="group" aria-label={`Check ${zone}`} data-testid="zone-uncertainty-choices" onClick={stop} onPointerDown={stop} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'){event.preventDefault();close(true);}}}>
      <p>{first?<>Is this <b>{first.label}</b>?</>:`Which card is in ${zone}?`}</p>
      <div className={s.zoneActions}>
        <button type="button" className={`${table.btn} ${table.go}`} disabled={pending||!first} onClick={run(()=>{if(first)onChoose(prompt.id,first.id);})}>Confirm</button>
        <button type="button" className={table.btn} disabled={pending||!onWrong} onClick={run(()=>onWrong?.(prompt.id))}>Wrong card</button>
        <button type="button" className={table.btn} disabled={pending} onClick={run(()=>onNotACard(prompt.id))}>Not a card</button>
      </div>
      {others.length?<div className={s.zoneActions}>{others.map(c=><button key={c.id} type="button" className={table.btn} disabled={pending} title={c.label} onClick={run(()=>onChoose(prompt.id,c.id))}>{c.label.split(' · ')[0]}</button>)}</div>:null}
    </div>,document.body):null}
  </>;
}

/** Feed watcher presentation, independent of recognition and table actions. */
export function FieldWatcherUI({host,enabled,onEnabledChange,statusLabel,statusTitle,statusExtra,attention,onStatusAction,calibrated,calibrationDisabled,onCalibrate,prompts,pending,onChoose,onDismiss,notice,noticeTestId,dock,zoneSeat,keepUnresolved=false,onWrong,onNotACard,changes=[],onChanged}:FieldWatcherUIProps) {
  const [collapsed,setCollapsed]=useState<ReadonlySet<string>>(new Set());
  const prompt=enabled?prompts.find(p=>!collapsed.has(promptKey(p))):undefined,description=useId();
  const ignored=prompts.filter(p=>collapsed.has(promptKey(p)));
  const ignore=(id:string)=>{if(keepUnresolved){const p=prompts.find(p=>p.id===id);if(p)setCollapsed(before=>new Set([...before,promptKey(p)]));}else onDismiss(id);};
  const bubble=useRef<HTMLDivElement>(null),toast=useRef<HTMLDivElement>(null);
  const [promptStyle,setPromptStyle]=useState<CSSProperties>({visibility:'hidden'}),[noticeStyle,setNoticeStyle]=useState<CSSProperties>({visibility:'hidden'});
  const anchorKey=prompt?.quad?.map(point=>`${point.x},${point.y}`).join('|');
  const hasNotice=!!notice;
  useLayoutEffect(()=>{
    if(!host||dock)return;
    const toolbar=host.querySelector<HTMLElement>('[data-feed-toolbar]');
    const place=()=>{
      const node=bubble.current;
      if(node){
        const rect=node.getBoundingClientRect();
        const placed=placePopup(promptAnchor(host,prompt?.quad),rect.width,rect.height,window.innerWidth,window.innerHeight);
        setPromptStyle({left:placed.left,top:placed.top});
      }
      const notification=toast.current;
      if(notification){
        const rect=notification.getBoundingClientRect(),feed=host.getBoundingClientRect(),bar=toolbar?.getBoundingClientRect();
        setNoticeStyle({left:Math.max(8,Math.min(feed.left+8,window.innerWidth-rect.width-8)),top:Math.max(8,Math.min((bar?.top??feed.bottom-34)-rect.height-8,window.innerHeight-rect.height-8))});
      }
    };
    place();
    const observer=typeof ResizeObserver==='undefined'?null:new ResizeObserver(place);
    for(const node of [host,toolbar,bubble.current,toast.current])if(node)observer?.observe(node);
    window.addEventListener('resize',place);window.addEventListener('scroll',place,true);
    return ()=>{observer?.disconnect();window.removeEventListener('resize',place);window.removeEventListener('scroll',place,true);};
    // The scalar key represents the physical quad without restarting on new view objects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[host,dock,prompt?.id,anchorKey,hasNotice]);
  if(!host||typeof document==='undefined')return null;
  const controls=host.querySelector('[data-field-watcher-controls]'),status=host.querySelector('[data-field-watcher-status-slot]');
  const tooltip=[statusTitle,statusLabel,enabled&&!calibrated?'Calibrate zones for exact columns':null].filter(Boolean).join(' · ');
  return <>
    {enabled && zoneSeat !== undefined ? changes.map(zone => {
      const key=zone.startsWith('EMZ')?`e${zone.slice(3)}`:zone==='FIELD'?'f':zone.toLowerCase();
      const cell=document.querySelector(`[data-testid="field-${zoneSeat}"] [data-zone="${key}"]`);
      return cell ? createPortal(<button type="button" className={s.changedCue} data-changed-cue="" data-testid="zone-changed" aria-label={`Changed here: ${zoneName(zone)}`} title="Changed here" onPointerDown={stop} onKeyDown={keepControlKey} onClick={event=>{event.stopPropagation();onChanged?.(zone);}}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11a8 8 0 0 1 14-4l2 2"/><path d="M20 4v5h-5"/><path d="M20 13a8 8 0 0 1-14 4l-2-2"/><path d="M4 20v-5h5"/></svg></button>,cell,`changed:${zone}`) : null;
    }) : null}
    {enabled&&keepUnresolved&&ignored.length?createPortal(<div className={`${s.theme} ${s.notice} ${dock?s.docked:''}`} data-testid="field-unresolved" onClick={stop} onPointerDown={stop}><b>Unresolved ({ignored.length})</b>{ignored.map(p=><button type="button" key={promptKey(p)} onClick={()=>setCollapsed(before=>{const next=new Set(before);next.delete(promptKey(p));return next;})}>Check {zoneName(p.zone)}</button>)}</div>,dock??document.body):null}
    {enabled&&zoneSeat!==undefined?prompts.map(p=>{
      const key=p.zone.startsWith('EMZ')?`e${p.zone.slice(3)}`:p.zone==='FIELD'?'f':p.zone.toLowerCase();
      const cell=document.querySelector(`[data-testid="field-${zoneSeat}"] [data-zone="${key}"]`);
      if(!cell)return null;
      const first=p.candidates.find(c=>!c.disabled);
      return createPortal(<ZonePrompt prompt={p} first={first} zone={zoneName(p.zone)} pending={pending} onChoose={onChoose} onWrong={onWrong} onNotACard={onNotACard??onDismiss}/>,cell,p.id);
    }):null}
    {controls?createPortal(<div className={s.controls} onClick={stop} onPointerDown={stop} onKeyDown={keepControlKey}>
      <label className={`${table.fzbtn} ${s.toggle}`}><input type="checkbox" checked={enabled} onChange={event=>onEnabledChange(event.target.checked)}/>Auto-detect cards</label>
      <button type="button" className={table.fzbtn} disabled={calibrationDisabled} onClick={onCalibrate}>{calibrated?'Recalibrate':'Calibrate zones'}</button>
    </div>,controls):null}
    {status?createPortal(<div className={table.statusRow}>{attention&&onStatusAction?<button type="button" className={s.chip} data-attention="" title={`${tooltip} · Click to ${statusLabel.startsWith('Auto-detect paused')?'sync the board and resume':'open the card notices'}`} data-testid="field-watcher-status" onClick={event=>{event.stopPropagation();onStatusAction();}} onPointerDown={stop}>{statusLabel}</button>:<span className={s.chip} role="status" title={tooltip} data-attention={attention?'':undefined} data-testid="field-watcher-status">{statusLabel}</span>}{statusExtra}</div>,status):null}
    {createPortal(<div className={`${duelFontClasses} ${s.theme} ${s.announcement}`} role="status" aria-label="Card detection updates" aria-atomic="true">{prompt?`New card needs a choice in ${zoneName(prompt.zone)}. ${prompts.length>1?`${prompts.length-1} more waiting.`:''}`:''}</div>,document.body)}
    {prompt?createPortal(<div ref={bubble} className={`${duelFontClasses} ${s.theme} ${s.prompt} ${dock?s.docked:''}`} style={dock?undefined:promptStyle} role="group" aria-label={prompt.title??'New card?'} aria-describedby={description} aria-busy={pending} data-testid="field-watcher-prompt" onClick={stop} onPointerDown={stop} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!pending&&!prompt.presence){event.preventDefault();ignore(prompt.id);}}}>
      <header><strong>{prompt.title??'New card?'}</strong>{prompts.length>1?<span className={s.queue}>+{prompts.length-1} more</span>:null}</header>
      <p id={description} className={s.zone}>Detected in {zoneName(prompt.zone)}. {prompt.presence?'Is this a Set card?':'Choose a card or dismiss.'}</p>
      <div className={s.choices}>{prompt.candidates.slice(0,5).map(candidate=><button type="button" className={table.btn} key={candidate.id} disabled={pending||candidate.disabled} onClick={()=>onChoose(prompt.id,candidate.id)} title={candidate.label}>{candidate.label}</button>)}</div>
      {!prompt.candidates.length?<p className={s.zone}>{prompt.emptyMessage??'Use the feed reader to confirm this card.'}</p>:null}
      <div className={s.promptActions}>
      {onWrong?<button type="button" className={`${table.btn} ${table.q}`} disabled={pending} onClick={()=>onWrong(prompt.id)}>Wrong card</button>:null}
      {!prompt.presence&&onNotACard?<button type="button" className={`${table.btn} ${table.q}`} disabled={pending} onClick={()=>onNotACard(prompt.id)}>Not a card</button>:null}
      <button type="button" className={`${table.btn} ${table.q} ${s.dismiss}`} disabled={pending} onClick={()=>prompt.presence?onDismiss(prompt.id):ignore(prompt.id)}>{prompt.presence?'Not a card':keepUnresolved?'Later':'Dismiss'}</button>
      {prompt.presence&&keepUnresolved?<button type="button" className={`${table.btn} ${table.q}`} disabled={pending} onClick={()=>ignore(prompt.id)}>Later</button>:null}
      </div>
    </div>,dock??document.body):null}
    {notice?createPortal(<div ref={toast} className={`${duelFontClasses} ${s.theme} ${s.notice} ${dock?s.docked:''}`} style={dock?undefined:noticeStyle} role="status" data-testid={noticeTestId} onClick={stop} onPointerDown={stop} onKeyDown={stop}>{notice}</div>,dock??document.body):null}
  </>;
}

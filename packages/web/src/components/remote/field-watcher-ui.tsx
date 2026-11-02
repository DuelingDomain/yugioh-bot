"use client";

import { useId, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode, type SyntheticEvent } from 'react';
import { createPortal } from 'react-dom';
import { duelFontClasses } from '@/components/duel/fonts';
import { placePopup, type Rect } from './ui/popup';
import table from './ui/remote-ui.module.css';
import s from './field-watcher-ui.module.css';

export type FieldWatcherPrompt={
  id:string;zone:string;title?:string;quad?:readonly {x:number;y:number}[];
  candidates:readonly {id:string;label:string}[];emptyMessage?:string;
};
export type FieldWatcherUIProps={
  host:HTMLElement|null;enabled:boolean;onEnabledChange(enabled:boolean):void;
  statusLabel:string;statusTitle?:string;calibrated:boolean;calibrationDisabled:boolean;onCalibrate():void;
  prompts:readonly FieldWatcherPrompt[];pending:boolean;onChoose(promptId:string,cardId:string):void;onDismiss(promptId:string):void;
  notice?:ReactNode;noticeTestId?:string;
};
const stop=(event:SyntheticEvent)=>event.stopPropagation();
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

/** Feed watcher presentation, independent of recognition and table actions. */
export function FieldWatcherUI({host,enabled,onEnabledChange,statusLabel,statusTitle,calibrated,calibrationDisabled,onCalibrate,prompts,pending,onChoose,onDismiss,notice,noticeTestId}:FieldWatcherUIProps) {
  const prompt=enabled?prompts[0]:undefined,description=useId();
  const bubble=useRef<HTMLDivElement>(null),toast=useRef<HTMLDivElement>(null);
  const [promptStyle,setPromptStyle]=useState<CSSProperties>({visibility:'hidden'}),[noticeStyle,setNoticeStyle]=useState<CSSProperties>({visibility:'hidden'});
  const anchorKey=prompt?.quad?.map(point=>`${point.x},${point.y}`).join('|');
  const hasNotice=!!notice;
  useLayoutEffect(()=>{
    if(!host)return;
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
  },[host,prompt?.id,anchorKey,hasNotice]);
  if(!host||typeof document==='undefined')return null;
  const controls=host.querySelector('[data-field-watcher-controls]'),status=host.querySelector('[data-field-watcher-status-slot]');
  const tooltip=[statusTitle,statusLabel,!calibrated?'Calibrate zones for exact columns':null].filter(Boolean).join(' · ');
  return <>
    {controls?createPortal(<div className={s.controls} onClick={stop} onPointerDown={stop} onKeyDown={stop}>
      <label className={`${table.fzbtn} ${s.toggle}`}><input type="checkbox" checked={enabled} onChange={event=>onEnabledChange(event.target.checked)}/>Auto-detect cards</label>
      <button type="button" className={table.fzbtn} disabled={calibrationDisabled} onClick={onCalibrate}>{calibrated?'Recalibrate':'Calibrate zones'}</button>
    </div>,controls):null}
    {status&&enabled?createPortal(<span className={s.chip} role="status" title={tooltip} data-testid="field-watcher-status">{statusLabel}</span>,status):null}
    {createPortal(<div className={`${duelFontClasses} ${s.theme} ${s.announcement}`} role="status" aria-label="Card detection updates" aria-atomic="true">{prompt?`New card needs a choice in ${zoneName(prompt.zone)}. ${prompts.length>1?`${prompts.length-1} more waiting.`:''}`:''}</div>,document.body)}
    {prompt?createPortal(<div ref={bubble} className={`${duelFontClasses} ${s.theme} ${s.prompt}`} style={promptStyle} role="group" aria-label={prompt.title??'New card?'} aria-describedby={description} aria-busy={pending} data-testid="field-watcher-prompt" onClick={stop} onPointerDown={stop} onKeyDown={event=>{event.stopPropagation();if(event.key==='Escape'&&!pending){event.preventDefault();onDismiss(prompt.id);}}}>
      <header><strong>{prompt.title??'New card?'}</strong>{prompts.length>1?<span className={s.queue}>+{prompts.length-1} more</span>:null}</header>
      <p id={description} className={s.zone}>Detected in {zoneName(prompt.zone)}. Choose a card or dismiss.</p>
      <div className={s.choices}>{prompt.candidates.slice(0,5).map(candidate=><button type="button" className={table.btn} key={candidate.id} disabled={pending} onClick={()=>onChoose(prompt.id,candidate.id)}>{candidate.label}</button>)}</div>
      {!prompt.candidates.length?<p className={s.zone}>{prompt.emptyMessage??'Use the feed reader to confirm this card.'}</p>:null}
      <button type="button" className={`${table.btn} ${table.q} ${s.dismiss}`} disabled={pending} onClick={()=>onDismiss(prompt.id)}>Dismiss</button>
    </div>,document.body):null}
    {notice?createPortal(<div ref={toast} className={`${duelFontClasses} ${s.theme} ${s.notice}`} style={noticeStyle} role="status" data-testid={noticeTestId} onClick={stop} onPointerDown={stop} onKeyDown={stop}>{notice}</div>,document.body):null}
  </>;
}

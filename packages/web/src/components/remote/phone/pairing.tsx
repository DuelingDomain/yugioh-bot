"use client";
import { useEffect, useRef, useState } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { Icon } from "../ui/icons";
import { useVideoHub } from "../ui/video-hub";
import s from "./phone.module.css";
export function PhonePairing({room}:{room:RemoteRoom}){
  const hub=useVideoHub();const [open,setOpen]=useState(false);const [pair,setPair]=useState<{code:string;token:string;expiresAt:number}|null>(null);
  const [qr,setQr]=useState("");const [error,setError]=useState("");const [busy,setBusy]=useState(false);const [now,setNow]=useState(Date.now());
  const trigger=useRef<HTMLButtonElement>(null);const dialog=useRef<HTMLDivElement>(null);
  const phone=hub.phones.find(p=>p.seat===room.mySeat);
  const pairLabel=phone?.paired?"Re-pair phone":"Use phone as camera";
  const url=pair&&typeof location!=="undefined"?`${location.origin}/duels/remote/${room.slug}/cam?pair=${encodeURIComponent(pair.token)}`:"";
  useEffect(()=>{if(!url){setQr("");return;}let live=true;void import("qrcode").then(q=>q.toDataURL(url,{width:260,margin:2,errorCorrectionLevel:"L"})).then(value=>{if(live)setQr(value);}).catch(()=>setError("Could not draw the QR. Open the camera link or use the short code."));return()=>{live=false;};},[url]);
  useEffect(()=>{if(!open)return;const timer=setInterval(()=>setNow(Date.now()),1000);const before=document.activeElement as HTMLElement|null;
    dialog.current?.querySelector<HTMLButtonElement>("button")?.focus();
    const key=(e:KeyboardEvent)=>{if(e.key==="Escape")setOpen(false);if(e.key==="Tab"){const items=dialog.current?.querySelectorAll<HTMLElement>("button,a[href],input");if(!items?.length)return;const first=items[0],last=items[items.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}}};document.addEventListener("keydown",key);return()=>{clearInterval(timer);document.removeEventListener("keydown",key);before?.focus();};},[open]);
  useEffect(()=>{if(phone?.paired){setOpen(false);setPair(null);}},[phone?.paired]);
  async function issue(){setBusy(true);setError("");try{const response=await fetch(`/api/remote/${room.slug}/phone`,{method:"POST",headers:{"content-type":"application/json"},body:"{}"});const data=await response.json();if(!response.ok)throw new Error(data.error);setPair(data);setNow(Date.now());setOpen(true);await hub.refreshPhones();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function revoke(){setBusy(true);setError("");try{const response=await fetch(`/api/remote/${room.slug}/phone`,{method:"DELETE"});if(!response.ok)throw new Error((await response.json()).error);setPair(null);setOpen(false);hub.clearPhoneScan("Phone pairing revoked");await hub.refreshPhones();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  async function manual(){setBusy(true);setError("");try{const response=await fetch(`/api/remote/${room.slug}/phone`,{method:"PATCH",headers:{"content-type":"application/json"},body:JSON.stringify({mode:"manual"})});if(!response.ok)throw new Error((await response.json()).error);await hub.disableCamera();await hub.refreshPhones();if(!room.solo)await hub.receivePhone();}catch(e){setError((e as Error).message);}finally{setBusy(false);}}
  const mode=hub.manual(room.mySeat)?"manual":phone?"phone":"webcam";
  const pick=(id:string,label:string,icon:"cam"|"phone"|"hand",on:()=>void,extra?:Record<string,string>)=><button type="button" role="radio" aria-checked={mode===id} className={`${s.cbtn} ${s.mode} ${mode===id?s.modeOn:""}`} disabled={busy||room.status==="ended"} onClick={on} aria-label={label} title={label} {...extra}><Icon name={icon} /><span data-lbl>{label}</span></button>;
  return <div className={s.pairing} data-testid="phone-pairing" onClick={e=>e.stopPropagation()}>
    <div className={s.modes} role="radiogroup" aria-label="Camera source">
      {pick("webcam","Use webcam","cam",()=>{setBusy(true);setError("");void hub.useWebcam().finally(()=>setBusy(false));},{"data-testid":"webcam-camera"})}
      <button ref={trigger} type="button" role="radio" aria-checked={mode==="phone"} className={`${s.cbtn} ${s.mode} ${mode==="phone"?s.modeOn:""}`} disabled={busy||room.status==="ended"} onClick={()=>void issue()} data-testid="pair-phone" aria-label={pairLabel} title={pairLabel}><Icon name="phone" /><span data-lbl>{pairLabel}</span></button>
      {pick("manual","No camera (manual)","hand",()=>void manual(),{"data-testid":"manual-camera"})}
    </div>
    {phone?<button type="button" className={s.cbtn} disabled={busy} onClick={()=>void revoke()} data-testid="revoke-phone" aria-label="Revoke phone" title="Revoke phone"><Icon name="x" /><span data-lbl>Revoke phone</span></button>:null}
    {phone?.paired?<span className={s.paired}>Phone paired</span>:null}
    {error?<span role="alert">{error}</span>:null}
    {open&&pair?<div className={s.veil} onPointerDown={e=>{if(e.target===e.currentTarget)setOpen(false);}}><div ref={dialog} className={s.dialog} role="dialog" aria-modal="true" aria-labelledby="phone-pair-title" data-testid="phone-pair-dialog">
      <h2 id="phone-pair-title">Your phone is the camera</h2><p>Scan this QR with your phone. Keep this table open on your desktop for card recognition.</p>
      {qr?<img src={qr} alt="QR code to connect your phone camera" data-testid="phone-qr"/>:<p>Drawing QR…</p>}
      <div className={s.code} data-testid="phone-pair-code">{pair.code}</div>
      <p>Or open <a href={`/duels/remote/${room.slug}/cam`} target="_blank" rel="noreferrer">the phone camera page</a> and enter this code.</p>
      <p role="status">{now<pair.expiresAt?`One use · expires in ${Math.max(0,Math.ceil((pair.expiresAt-now)/1000))} seconds` : "Code expired. Get a new one."}</p>
      <a href={url} data-testid="phone-pair-url" target="_blank" rel="noreferrer">Open camera link</a>
      <footer><button type="button" onClick={()=>setOpen(false)}>Close</button><button type="button" disabled={busy} onClick={()=>void revoke()}>Revoke</button><button type="button" className={s.primary} disabled={busy} onClick={()=>void issue()}>New code</button></footer>
    </div></div>:null}
  </div>;
}

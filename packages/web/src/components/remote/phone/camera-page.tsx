"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { PhoneCamera, initialPhoneState } from "@/lib/remote/phone-capture";
import { PHONE_ZONES, type PhoneZone } from "@/lib/remote/phone-protocol";
import { duelFontClasses } from "@/components/duel/fonts";
import s from "./phone.module.css";
export function PhoneCameraPage({slug}:{slug:string}){
  const [camera,setCamera]=useState<PhoneCamera|null>(null);const [code,setCode]=useState("");const [zone,setZone]=useState<PhoneZone>("M1");
  const [torch,setTorch]=useState(false);const [locked,setLocked]=useState(false);const video=useRef<HTMLVideoElement>(null);
  const state=useSyncExternalStore(camera?.subscribe??(()=>()=>undefined),camera?.getSnapshot??(()=>initialPhoneState),()=>initialPhoneState);
  const pair=useRef<string|undefined>(undefined);
  useEffect(()=>{pair.current=new URL(location.href).searchParams.get("pair")??undefined;const cam=new PhoneCamera(slug);setCamera(cam);if(!pair.current&&sessionStorage.getItem(`remote-phone:${slug}`))void cam.connect();return()=>cam.dispose();},[slug]);
  useEffect(()=>{const el=video.current;if(!el)return;el.srcObject=state.stream;if(state.stream)void el.play().catch(()=>undefined);return()=>{el.srcObject=null;};},[state.stream]);
  const paired=state.connection==="connected" || state.connection==="reconnecting" || state.connection==="Reconnecting…";
  const hint=state.light<25?"Too dark · add a lamp beside the field.":state.sharpness<60?"Too blurry or too far · move closer and hold steady.":"Clear frame · keep the whole field visible.";
  return <main className={`${duelFontClasses} ${s.phone}`} data-testid="phone-camera-page">
    <header className={s.header}><span className={s.gem} aria-hidden="true"/><div><p className={s.eyebrow}>DUELING DOMAIN / FIELD CAMERA</p><h1>Your phone. Your field.</h1></div><span className={s.seat}>{slug}</span></header>
    <div className={s.status} role="status" data-testid="phone-connection"><i data-on={paired}/>{state.connection}{paired?" · camera only":""}</div>
    {!paired ? <form className={s.pairForm} onSubmit={e=>{e.preventDefault();const token=pair.current;pair.current=undefined;void camera?.connect(token,code.trim().toUpperCase()||undefined);}}>
      <h2>Connect to your desktop</h2><p>Scan its QR code, or enter the 8-character code here. No sign-in needed.</p>
      <label>Pairing code<input aria-label="Pairing code" autoCapitalize="characters" autoComplete="off" maxLength={8} placeholder="ABCD2345" value={code} onChange={e=>setCode(e.target.value.toUpperCase())}/></label>
      <button className={s.primary} disabled={!camera||state.busy} data-testid="phone-connect">{state.busy?"Connecting…":"Connect camera"}</button>
    </form>:null}
    {state.error?<p role="alert" className={s.error}>{state.error}</p>:null}
    <section className={s.workspace}>
      <div className={s.preview} data-testid="phone-preview">
        <video ref={video} autoPlay muted playsInline/>
        {!state.stream?<div className={s.rest}><span aria-hidden="true">◇</span><b>{state.mode === "scan"?"Ready when you play a card":"A better angle starts here"}</b><p>{state.mode === "scan"?"The camera wakes for each scan, then rests.":"Your rear camera preview appears here."}</p></div>:null}
        <div className={`${s.guide} ${state.mode==="scan"?s.cardGuide:""}`} aria-hidden="true"><i/><i/><i/><i/></div>
        <span className={s.frameLabel}>{state.mode === "scan"?"HOLD ONE FACE-UP CARD INSIDE THE GUIDE":"FIT YOUR WHOLE FIELD IN THE FRAME"}</span>
        {state.resolution?<span className={s.resolution}>{state.resolution} · rear camera preferred</span>:null}
      </div>
      <div className={s.controls}>
        <div className={s.tabs} aria-label="Camera mode"><button aria-pressed={state.mode==="video"} disabled={!paired} onClick={()=>void camera?.setMode("video")}>Field camera</button><button aria-pressed={state.mode==="scan"} disabled={!paired} onClick={()=>void camera?.setMode("scan")} data-testid="phone-scan-mode">Scan mode</button></div>
        <p className={s.help}>{state.mode==="scan"?"No stand? Scan cards as you play. Everyone follows your board twin and log. Live video is off.":"Set your phone above the mat. Use landscape for a wider field. Keep this page open."}</p>
        <div className={s.meters}><label>LIGHT <meter min={0} max={100} low={25} value={state.light}/><b>{state.light}%</b></label><label>SHARPNESS <meter min={0} max={600} low={60} value={state.sharpness}/><b>{state.sharpness}</b></label></div>
        <p className={s.hint}>{state.stream?hint:"Move closer for scans. Keep the whole card visible and avoid glare."}</p>
        <label className={s.selectLabel}>Camera<select aria-label="Rear camera picker" disabled={!paired} value={state.deviceId} onChange={e=>{setTorch(false);setLocked(false);void camera?.setCamera(e.target.value);}}>
          {!state.devices.length?<option value="">Rear camera (automatic)</option>:state.devices.map((d,i)=><option key={d.deviceId} value={d.deviceId}>{/ultra|0[.,]5/.test(d.label.toLowerCase())?"0.5× Ultra-wide · ":""}{d.label||`Camera ${i+1}`}</option>)}</select></label>
        <div className={s.hardware}>
          {state.caps.torch?<button aria-pressed={torch} onClick={()=>{setTorch(!torch);void camera?.constraint({torch:!torch});}}>Torch {torch?"on":"off"}</button>:null}
          {state.caps.focusMode?.includes("manual")||state.caps.exposureMode?.includes("manual")?<button aria-pressed={locked} onClick={()=>{setLocked(!locked);void camera?.lockCamera(!locked);}}>{locked?"Unlock":"Lock"} focus / exposure</button>:null}
          {state.caps.zoom && state.caps.zoom.min<1?<button onClick={()=>void camera?.constraint({zoom:state.caps.zoom!.min})}>0.5× / widest view</button>:null}
        </div>
        <label className={s.selectLabel}>Place this scan in<select aria-label="Scan zone" value={zone} onChange={e=>setZone(e.target.value as PhoneZone)}>{PHONE_ZONES.map(z=><option key={z}>{z}</option>)}</select></label>
        <button className={s.scan} disabled={!paired||!state.ownerReady||state.busy} onClick={()=>void camera?.scan(zone)} data-testid="phone-scan"><span aria-hidden="true">⌖</span>{state.busy?"Reading card…":"Scan card"}<small>SHARPEST OF 5 · READ ON YOUR DESKTOP</small></button>
        {state.busy&&paired?<button className={s.disconnect} onClick={()=>camera?.cancelScan()}>Cancel scan</button>:null}
        <p className={s.note} role="status" data-testid="phone-note">{paired&&!state.ownerReady?"Waiting for your desktop. Keep the table open there.":state.note}</p>
        <p className={s.help}>{state.wake} {state.battery}</p>
        {paired?<button className={s.disconnect} onClick={()=>void camera?.disconnect()}>Disconnect camera</button>:null}
      </div>
    </section>
  </main>;
}

"use client";
import { useEffect, useState } from 'react';
import { SvButton } from '@/components/sheet';
import styles from './duel-view-toggle.module.css';
export interface FeedbackPreference {enabled:boolean;askedAt:number|null;collectionEnabled:boolean}
export function VisionFeedbackSetting({onChange,promptOnly=false}:{onChange?:(value:FeedbackPreference)=>void;promptOnly?:boolean}) {
  const [value,setValue]=useState<FeedbackPreference|null>(null),[prompt,setPrompt]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  useEffect(()=>{
    let alive=true;
    void (async()=>{
      try {
        const reply=await fetch('/api/remote-vision/feedback',{cache:'no-store'});if(!reply.ok)return;
        let pref=await reply.json() as FeedbackPreference;
        if(!alive)return;
        if(pref.askedAt===null&&pref.collectionEnabled){
          const marked=await fetch('/api/remote-vision/feedback',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({asked:true})});
          if(marked.ok){const body=await marked.json();pref=body;if(alive)setPrompt(body.prompted===true);}
        }
        if(alive){setValue(pref);onChange?.(pref);}
      }catch{/* Anonymous public lab continues with collection off. */}
    })();return()=>{alive=false;};
  },[onChange]);
  async function update(enabled:boolean) {
    const previous=value;
    setBusy(true);setMessage('');if(previous)setValue({...previous,enabled});
    try {
      const res=await fetch('/api/remote-vision/feedback',{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({enabled})});
      if(!res.ok)throw new Error();const pref=await res.json();setValue(pref);onChange?.(pref);setPrompt(false);setMessage(enabled?'Recognition feedback enabled.':'Recognition feedback disabled.');
    }catch{setValue(previous);setMessage('Your choice could not be saved. Try again.');}finally{setBusy(false);}
  }
  async function remove() {
    setBusy(true);setMessage('');
    try {const res=await fetch('/api/remote-vision/feedback',{method:'DELETE'});if(!res.ok)throw new Error();const body=await res.json();setMessage(`Deleted ${body.deleted} recognition samples.`);}
    catch{setMessage('Samples could not be deleted. Try again.');}finally{setBusy(false);}
  }
  if(!value)return null;
  if(promptOnly&&!prompt)return <p><a href="/settings/account">Recognition feedback settings</a></p>;
  return <section className="set-sec" aria-labelledby={promptOnly?'vision-feedback-prompt':'vision-feedback-setting'}>
    <div className="set-intro"><h2 id={promptOnly?'vision-feedback-prompt':'vision-feedback-setting'}>Help improve card recognition</h2>
      <p>Share only the small card crop and your confirmed answer to improve recognition for everyone; full camera frames are never stored.</p>
    </div>
    <div className={styles.block}>
    {promptOnly?<div><button type="button" disabled={busy} onClick={()=>void update(true)}>Yes, share card crops</button> <button type="button" disabled={busy} onClick={()=>void update(false)}>No thanks</button></div>:
      <label style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16}}><span className={styles.title}>Help improve card recognition</span><input className={styles.switch} type="checkbox" checked={value.enabled} disabled={busy} onChange={e=>void update(e.target.checked)} /></label>}
    {!value.collectionEnabled?<p>Collection is currently disabled by the owner.</p>:null}
    {!promptOnly?<><p className={styles.note}>Crops and recognition results are kept for up to 30 days. You can turn sharing off or delete your samples at any time.</p><div><SvButton variant="quiet" disabled={busy} onClick={()=>void remove()}>Delete my recognition samples</SvButton></div></>:null}
    {message?<p role="status">{message}</p>:null}
    </div>
  </section>;
}

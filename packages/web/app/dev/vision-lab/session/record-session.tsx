'use client';
import {useEffect,useRef,useState} from 'react';
import {validateSession,type LabelledSession} from '../../../../../vision/bench/session';
import {chooseSessionDirectory,recordLocalSession,type LocalDirectory} from './local-files';
import {SessionEditor} from './session-editor';
import {GPUCheck} from './gpu-check';
import styles from './session.module.css';
export default function RecordSession() {
  const video=useRef<HTMLVideoElement>(null),folder=useRef<LocalDirectory|undefined>(undefined),recorder=useRef<Awaited<ReturnType<typeof recordLocalSession>>|undefined>(undefined),alive=useRef(true),camera=useRef<MediaStream|undefined>(undefined);
  const [importRevision,setImportRevision]=useState(0);
  const [resolution,setResolution]=useState('1280x720'),[folderName,setFolderName]=useState(''),[recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[elapsed,setElapsed]=useState(0),[error,setError]=useState(''),[session,setSession]=useState<LabelledSession>(),[file,setFile]=useState<File>();
  useEffect(()=>{alive.current=true;return()=>{alive.current=false;recorder.current?.stop('tab-closed');camera.current?.getTracks().forEach(t=>t.stop());};},[]);
  async function choose(){try{folder.current=await chooseSessionDirectory();setFolderName(folder.current.name);setError('');}catch(e){setError(String(e));}}
  async function start(){
    if(!folder.current)return;setBusy(true);setError('');
    try {
      const [width,height]=resolution.split('x').map(Number),stream=await navigator.mediaDevices.getUserMedia({audio:false,video:{width:{ideal:width},height:{ideal:height},frameRate:{ideal:24,max:30}}});
      camera.current=stream;if(!alive.current){stream.getTracks().forEach(t=>t.stop());return;}
      if(video.current){video.current.srcObject=stream;await video.current.play();}
      if(!alive.current){stream.getTracks().forEach(t=>t.stop());return;}
      const created=await recordLocalSession(folder.current,stream,{onTick:ms=>{if(alive.current)setElapsed(ms);},onDone:(s,f)=>{recorder.current=undefined;if(alive.current){setSession(s);setFile(f);setRecording(false);}},onError:e=>{recorder.current=undefined;if(alive.current){setError(e.message);setRecording(false);}}});
      if(!alive.current){created.stop('tab-closed-during-start');return;}
      recorder.current=created;setRecording(true);setElapsed(0);
    }catch(e){camera.current?.getTracks().forEach(t=>t.stop());setError(String(e));}finally{if(alive.current)setBusy(false);}
  }
  return <main className={styles.root}>
    <header><span className={styles.eyebrow}>Local vision sessions</span><h1>Record, review, measure.</h1><p>Choose your DATA folder. Video and labels are saved in its vision-sessions folder on this machine. No audio is recorded.</p></header>
    <section className={styles.capture} aria-label="Session recorder">
      <div className={styles.controls}>
        <button onClick={()=>void choose()} disabled={recording||busy}>Choose DATA folder</button><span>{folderName?'Saving to vision-sessions/':'No folder selected'}</span>
        <label>Resolution <select aria-label="Resolution" value={resolution} disabled={recording||busy} onChange={e=>setResolution(e.target.value)}><option value="640x480">640 × 480</option><option value="1280x720">1280 × 720</option><option value="1920x1080">1920 × 1080</option></select></label>
        <button className={styles.primary} disabled={!folderName||recording||busy} onClick={()=>void start()}>Start recording</button>
        <button disabled={!recording} onClick={()=>recorder.current?.stop()}>Stop & save</button>
        <button disabled={!recording} onClick={()=>recorder.current?.mark('Owner event marker')}>Mark moment</button>
        <output aria-label="Recording time">{(elapsed/1000).toFixed(1)}s / 300s</output>
      </div>
      <video ref={video} muted playsInline className={styles.live} hidden={!recording&&!busy}/>
      <p className={styles.note}>Chrome or Edge on localhost · stops at five minutes or about 150 MiB · the camera’s actual resolution is saved in the session. Keep a few seconds of clear mat before and after each action.</p>
      <div className={styles.controls}>
        <label>Open local video <input type="file" accept="video/webm,video/mp4" disabled={recording||busy} onChange={e=>{const f=e.target.files?.[0];if(f){setFile(f);setSession(undefined);}}}/></label>
        <label>Open session JSON <input type="file" accept="application/json,.json" disabled={recording||busy} onChange={e=>{const f=e.target.files?.[0];if(f)void f.text().then(text=>{setSession(validateSession(JSON.parse(text)));setImportRevision(n=>n+1);setError('');}).catch(e=>setError(String(e)));}}/></label>
      </div>
    </section>
    <GPUCheck/>
    {error?<p role="alert" className={styles.error}>{error}</p>:null}
    {file&&!recording?<SessionEditor key={file.name+file.lastModified+(session?.id??'')+importRevision} file={file} initial={session} folder={folder.current}/>:<p className={styles.empty}>Record a short play sequence, or open a local recording to begin labelling.</p>}
  </main>;
}

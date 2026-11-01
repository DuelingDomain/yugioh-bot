"use client";
import { useState } from 'react';
import { useAdminSection, refreshSection } from '../use-admin-section';
import { SectionHead, Notice } from '../parts';
import { LineChart } from '../charts';
import styles from '../admin-console.module.css';
const percent=(n:number,d:number)=>d?`${(100*n/d).toFixed(1)}%`:'—';
export function VisionView() {
  const s=useAdminSection('vision'),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState('');
  const result=s.result,data=result?.state==='ok'?result.data:null;
  async function mutate(id:string,review:'approved'|'rejected'|'delete') {
    setBusy(id);setError('');
    try {
      const res=await fetch(`/api/admin/console/vision/${id}`,{method:review==='delete'?'DELETE':'PATCH',headers:{'content-type':'application/json'},...(review==='delete'?{}:{body:JSON.stringify({review})})});
      if(!res.ok)throw new Error();refreshSection('vision');
    }catch{setError('The sample could not be updated. Try again.');}finally{setBusy(null);}
  }
  if(!data)return <Notice tone="info" title="Recognition feedback">{s.failure?'Feedback could not be loaded.':result&&result.state!=='ok'?result.message:'Loading feedback…'}</Notice>;
  const sure=data.accuracy.filter(m=>m.tier==='sure'),sureTotal=sure.reduce((n,m)=>n+m.total,0),wrong=sure.reduce((n,m)=>n+m.sureWrong,0);
  const days=[...new Set(data.accuracy.map(m=>m.day))].sort();
  return <>
    <div className={styles.toolbar}><span className={styles.aside}>{data.collectionEnabled?'Collection enabled':'Collection disabled'} · {data.total} samples · {(data.bytes/1048576).toFixed(2)} MiB · {data.learnedCount} learned references</span></div>
    <SectionHead title="Sure but wrong" aside={`${wrong} / ${sureTotal} (${percent(wrong,sureTotal)})`} />
    <p className={styles.aside}>Among submitted confirmations and corrections only. This is not accuracy across all scans. Rejected samples are excluded. Days are UTC; retention is 30 days.</p>
    {days.length?<LineChart labels={days} series={[{name:'Sure but wrong %',color:'var(--crit)',values:days.map(day=>{const m=sure.find(m=>m.day===day);return m?100*m.sureWrong/m.total:0;})}]} axis unit="%" className={styles.chart} label="Sure-but-wrong rate among submitted feedback by day" />:null}
    <div className={styles.visionTable}><table><caption>Accuracy by original tier and day</caption><thead><tr><th>UTC day</th><th>Tier</th><th>Samples</th><th>Top 1</th><th>Top 5</th><th>Sure but wrong</th></tr></thead><tbody>{data.accuracy.map(m=><tr key={`${m.day}:${m.tier}`}><td>{m.day}</td><td>{m.tier}</td><td>{m.total}</td><td>{m.top1}/{m.total} · {percent(m.top1,m.total)}</td><td>{m.top5}/{m.total} · {percent(m.top5,m.total)}</td><td>{m.tier==='sure'?`${m.sureWrong}/${m.total} · ${percent(m.sureWrong,m.total)}`:'—'}</td></tr>)}</tbody></table></div>
    <SectionHead title="Confusion pairs" n={data.confusions.length} />
    <p className={styles.aside}>At least two different players must report a pair. These trigger extra visual checks and stricter certainty.</p>
    <ul>{data.confusions.map((p,i)=><li key={i}>{p.a} ↔ {p.b} · {p.count} corrections from {p.users} players · {p.gameId} / {p.modelId}</li>)}</ul>
    <SectionHead title="Recent confirmations and corrections" n={data.total} aside="Newest 100" />
    {error?<p role="alert">{error}</p>:null}
    {!data.samples.length?<p className={styles.empty}>No shared recognition samples yet.</p>:<ul className={styles.visionSamples}>{data.samples.map(sample=><li key={sample.id} className={styles.visionSample}>
      <img src={`/api/admin/console/vision/${sample.id}/crop`} width="78" height="114" loading="lazy" alt={`Warped card crop labelled ${sample.chosenCardId}`} />
      <div><strong>{sample.top5[0]?.cardId===sample.chosenCardId?'Confirmed':'Corrected'}: {sample.top5[0]?.cardId} → {sample.chosenCardId}</strong>
        <p>{sample.tier} · {sample.source} · {sample.review} · player {sample.userId} · {new Date(sample.createdAt).toLocaleString()}</p>
        <p className={styles.aside}>{sample.gameId} · {sample.modelId} · {sample.space} · {sample.frameClass??'unknown frame'} · sharpness {sample.sharpness.toFixed(1)}</p>
        <details><summary>Original top 5 and index</summary><ol>{sample.top5.map(c=><li key={c.cardId}>{c.cardId} · {c.score.toFixed(4)}</li>)}</ol><p className={styles.hd}>{sample.indexVersion}</p></details>
        <div className={styles.btns}><button className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy!==null||sample.review==='approved'} onClick={()=>void mutate(sample.id,'approved')}>Approve reference</button><button className={styles.btn} disabled={busy!==null||sample.review==='rejected'} onClick={()=>void mutate(sample.id,'rejected')}>Reject reference</button><button className={`${styles.btn} ${styles.btnDanger}`} disabled={busy!==null} onClick={()=>void mutate(sample.id,'delete')}>Delete sample</button></div>
      </div>
    </li>)}</ul>}
  </>;
}

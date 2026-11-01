"use client";

import {catalogCardId} from "@yugidraft/vision";
import { useEffect, useState } from 'react';
import { yugioh, type IndexEntry, type RecognitionResult } from '@yugidraft/vision';
import type { CardSummary } from '@/lib/card-types';
import styles from './vision-lab.module.css';

/** Catalog text is independent of recognition: a failed lookup never loses a read. */
export function VisionResult({result,cards,busy,error,onConfirm}:{
  result:RecognitionResult|null;cards:Map<string,IndexEntry>;busy:boolean;error:string|null;onConfirm:(cardId:string)=>void;
}) {
  const [details,setDetails]=useState<CardSummary[]|null>(null);
  const top=result?.candidates[0],entry=top?cards.get(top.cardId):undefined;
  const back=top?.cardId===yugioh.cardBack.cardId;
  useEffect(()=>{
    setDetails(null);
    if(!result?.candidates.length)return;
    const ids=[...new Set(result.candidates.slice(0,result.tier==='sure'?1:5).map(c=>catalogCardId(cards.get(c.cardId))).filter((id):id is number=>!!id))];
    if(!ids.length){setDetails([]);return;}
    const controller=new AbortController();
    void fetch('/api/cards/resolve',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({customCardIds:ids}),signal:controller.signal})
      .then(async response=>{if(!response.ok)throw new Error();const body=await response.json();if(!controller.signal.aborted)setDetails(Array.isArray(body.cards)?body.cards:[]);})
      .catch(()=>{if(!controller.signal.aborted)setDetails([]);});
    return ()=>controller.abort();
  },[result,cards]);

  if(busy)return <div className={styles.resultLayout} aria-label="Loading card reading">
    <div className={`${styles.resultArt} ${styles.skeletonArt}`} aria-hidden="true" />
    <div className={styles.resultDetails}><span className={styles.eyebrow}>Live card inspection</span><h2>Reading card…</h2><p>Finding the card and comparing its artwork.</p>
      <div className={styles.skeletonText} aria-hidden="true" /><div className={styles.skeletonText} aria-hidden="true" /><div className={styles.skeletonText} aria-hidden="true" /></div>
  </div>;
  if(error)return <div className={styles.resultDetails}><h2>Could not read this card</h2><p>{error}</p><p>Keep the card steady, then click its center to try again.</p></div>;
  if(!top)return <div className={styles.resultDetails}><h2>No matches returned</h2><p>Try a clearer image with the card artwork visible.</p></div>;
  const detail=details?.find(card=>card.id===catalogCardId(entry));
  const name=entry?.name??(back?'Card back':top.cardId);
  const image=back?yugioh.cardBack.imageUrl:entry?.passcode?`/api/cards/${entry.imageId??entry.passcode}/image`:undefined;
  return <>
    <div className={styles.resultLayout}>
      {image?<img className={styles.resultArt} src={image} width={360} height={524} alt={name} />:<div className={styles.resultArt}>Image unavailable</div>}
      <div className={styles.resultDetails}>
        <span className={styles.eyebrow}>Card inspection</span><h2>{name}</h2>
        <p className={styles.tier} data-tier={result!.tier}>{result!.tier}</p>
        {detail?<>
          <p className={styles.cardType}>{[detail.type,detail.attribute].filter(Boolean).join(' · ')}</p>
          <div className={styles.cardStats}>
            {detail.level!=null?<span>Level {detail.level}</span>:null}
            {detail.atk!=null?<span>ATK {detail.atk<0?'?':detail.atk}</span>:null}
            {detail.def!=null?<span>DEF {detail.def<0?'?':detail.def}</span>:null}
          </div>
          <p className={styles.cardText}>{detail.effectText||'No card text in the catalog.'}</p>
        </>:back?<p>Face-down card. Reveal it to read its details.</p>:<p>{details===null?'Loading full card text…':'Full card text is unavailable. You can still confirm the artwork match.'}</p>}
        <button type="button" className={styles.primary} disabled={!catalogCardId(entry)} onClick={()=>onConfirm(top.cardId)}>Confirm</button>
        <span className={styles.hint}>Confirm if this is the card in view.</span>
      </div>
    </div>
    {result!.tier!=='sure'?<section className={styles.popupAlternatives} aria-label="Top five card choices">
      <h3>Not the right card? Pick a match</h3>
      {result!.candidates.slice(0,5).map((candidate,index)=><button key={candidate.cardId} type="button" aria-label={`Pick match ${index+1}: ${cards.get(candidate.cardId)?.name??candidate.cardId}`} disabled={!catalogCardId(cards.get(candidate.cardId))} onClick={()=>onConfirm(candidate.cardId)}>
        <span className={styles.rank}>{index+1}</span><strong>{cards.get(candidate.cardId)?.name??candidate.cardId}</strong><span>{candidate.score.toFixed(3)}</span>
      </button>)}
    </section>:null}
    <p className={styles.hint}>1–5 confirm · ↑/↓ move · Escape closes</p>
  </>;
}

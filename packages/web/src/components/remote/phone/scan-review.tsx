"use client";
import { useRef, useState } from "react";
import type { RemoteRoom } from "@yugidraft/shared/remote";
import { scanLocation } from "@/lib/remote/phone-protocol";
import type { RoomController } from "../ui/use-remote-room";
import { useVideoHub } from "../ui/video-hub";
import { cardArt } from "../ui/catalog";
import s from "./phone.module.css";
/** The scoped phone cannot write actions: its signed-in owner reviews and submits both authoritative actions. */
export function PhoneScanReview({ctl,room}:{ctl:RoomController;room:RemoteRoom}){
  const hub=useVideoHub();const scan=hub.phoneScan;const [busy,setBusy]=useState(false);const [error,setError]=useState("");
  const chosen=useRef<{id:string;cardId:number}|null>(null);
  if(!scan)return null;
  async function choose(card:{cardId:number;name:string}){
    if(!scan||busy)return;setBusy(true);setError("");
    try{
      const location=scanLocation(scan.zone);const actorSeat=room.mySeat;
      const identified=await ctl.action({type:"card.identified",actorSeat,seat:actorSeat,cardId:card.cardId,name:card.name,source:"click",...location},`phone:${scan.id}:identify`);
      if(!identified)throw new Error("The table changed. Review this scan and try again.");
      chosen.current={id:scan.id,cardId:card.cardId};
      // Stable ref prevents a repeated confirm/retry from adding another physical instance.
      const ref=`phone:${scan.id}`;
      const placed=await ctl.action({type:"twin.place",actorSeat,seat:actorSeat,zone:location.zone,card:{ref,cardId:card.cardId,name:card.name,slot:location.slot,faceUp:true,position:"attack"}},`phone:${scan.id}:place`);
      if(!placed)throw new Error("Card announced. Placement failed; retry to place it.");
      hub.clearPhoneScan(`${card.name} announced and placed in ${scan.zone}.`);
    }catch(e){setError((e as Error).message);}finally{setBusy(false);}
  }
  return <section className={s.scanReview} role="dialog" aria-label="Confirm phone scan" data-testid="phone-scan-review">
    <h2>Phone scan → {scan.zone}</h2><p>{scan.reading.tier??"Choose a card"} · {scan.ms} ms · read on your desktop</p>
    <p>Choose the card to announce it and place it on your board twin.</p>
    <div className={s.choices}>{scan.reading.guesses.map(g=><button key={g.cardId} disabled={busy||room.status!=="active"||(chosen.current?.id===scan.id&&chosen.current.cardId!==g.cardId)} onClick={()=>void choose(g)} data-testid={`phone-confirm-${g.cardId}`}><img src={cardArt(g.cardId)} alt=""/>{g.name||`Card ${g.cardId}`}<b>{g.score===null?"":Math.round(g.score*100)+"%"}</b></button>)}</div>
    {!scan.reading.guesses.length?<p>{scan.reading.note || "No card found. Move closer, add light and scan again."}</p>:null}
    {room.status!=="active"?<p>Start the table before announcing a card.</p>:null}
    {error?<p role="alert">{error}</p>:null}
    <footer><button disabled={busy} onClick={()=>hub.clearPhoneScan()}>Cancel scan</button></footer>
  </section>;
}

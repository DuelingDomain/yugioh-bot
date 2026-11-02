"use client";

import type { RemoteActionProposal, RemoteEffectOrigin, RemoteRoom } from "@yugidraft/shared/remote";
import { PopupFrame, type PopAt } from "./popup";
import s from "./remote-ui.module.css";

type Act = (action:RemoteActionProposal)=>Promise<RemoteRoom|null>;
export function EffectControls({room,act,onOpen}:{room:RemoteRoom;act:Act;onOpen:(id:string)=>void}) {
  const tracking=room.state.effectTracking;
  if(!tracking) return null;
  const owns=(seat:number)=>room.solo || seat===room.mySeat;
  const active=Object.entries(tracking.contexts).filter(([seat])=>owns(Number(seat)));
  const hand=tracking.origins.filter(origin=>origin.destination==="hand" && owns(origin.seat) && (!origin.chosenCardId || room.state.seats[origin.seat].twin.some(c=>c.ref===origin.ref && c.zone==="hand")));
  const notes=tracking.notes.filter(note=>!note.dismissed);
  const announcements=tracking.origins.filter(origin=>origin.destination==="hand" && origin.announcedCard);
  if(!active.length && !hand.length && !notes.length && !announcements.length) return null;
  async function setCard(seat:number) {
    const context=tracking?.contexts[seat]; if(!context) return;
    const monster=context.plan.filters.some(f=>f.kinds.includes("monster") && f.kinds.length===1);
    const zone=monster ? "monster" : "spell-trap";
    const occupied=new Set(room.state.seats[seat].twin.filter(c=>c.zone===zone).map(c=>c.slot));
    const slot=[1,2,3,4,5].find(n=>!occupied.has(n)); if(!slot) return;
    await act({type:"twin.place",actorSeat:seat,seat,zone,card:{ref:crypto.randomUUID(),faceUp:false,position:monster ? "defense" : "attack",slot}});
  }
  return <aside className={s.effectControls} aria-label="Effect context and private hand">
    {active.map(([seat,context])=><div key={seat}>
      <span>{context.source.name} · next Set</span>
      <button className={s.btn} type="button" onClick={()=>void setCard(Number(seat))}>Set face-down</button>
      <button className={s.btn} type="button" onClick={()=>void act({type:"effect.context.clear",actorSeat:Number(seat)})}>Clear effect</button>
    </div>)}
    {hand.map(origin=><div key={origin.id}>
      <button className={s.btn} type="button" onClick={()=>onOpen(origin.id)}>{origin.announcedCard?.name ?? (origin.chosenCardId ? origin.pool?.find(c=>c.cardId===origin.chosenCardId)?.name ?? "Chosen card" : "Choose searched card")} · from {origin.source.name}</button>
      {origin.chosenCardId && !origin.announcedCard ? <button type="button" className={s.btn} onClick={()=>void act({type:"effect.announce",actorSeat:origin.seat,originId:origin.id})}>Announce searched card</button> : null}
    </div>)}
    {announcements.map(origin=><p key={origin.id} role="status">{origin.announcedCard!.name} added to hand by {origin.source.name}</p>)}
    {notes.map(note=><div key={note.id} role="status"><span>{note.message}</span><button type="button" className={s.btn} onClick={()=>void act({type:"effect.note.dismiss",actorSeat:room.mySeat,noteId:note.id})}>Dismiss note</button></div>)}
  </aside>;
}
export function EffectPicker({origin,showCardsSetFromDeck,at,onPick,onClose,onReveal,onRecognize,onActivate,alternatives,onOrigin}:{origin:RemoteEffectOrigin;showCardsSetFromDeck:boolean;at:PopAt;onPick:(id:number)=>void;onClose:()=>void;onReveal?:()=>void;onRecognize?:()=>void;onActivate?:()=>void;alternatives?:{id:string;label:string}[];onOrigin?:(id:string)=>void}) {
  const label=origin.destination==="set" ? `Face-down · Set by ${origin.source.name}` : `${showCardsSetFromDeck ? "Search" : "Private hand"} · from ${origin.source.name}`;
  return <PopupFrame at={at} layer="effect" label={label} testid="effect-picker" className={s.effectPicker}>
    <h3>{label}</h3>
    {alternatives && alternatives.length>1 ? <label>Choose the physical card <select aria-label="Choose face-down card" value={origin.id} onChange={event=>onOrigin?.(event.target.value)}>{alternatives.map(item=><option key={item.id} value={item.id}>{item.label}</option>)}</select></label> : null}
    <p>{showCardsSetFromDeck ? "Only you see these candidates. Your chosen card is shown to all players." : "Only you see these candidates and your choice."}{!showCardsSetFromDeck && origin.destination==="hand" && origin.announceRecommended ? " Reveal the searched card to the table when resolving the effect." : ""}</p>
    {origin.announcedCard ? <p>Shown to all: {origin.announcedCard.name}</p> : <>
      <div className={s.effectCandidates}>{(origin.candidates ?? []).map(candidate=><button className={s.btn} type="button" key={candidate.cardId} onClick={()=>onPick(candidate.cardId)}>{candidate.name} <small>×{candidate.copies}</small></button>)}</div>
      {!origin.candidates?.length ? <p>No matching copies remain in your registered deck. Resolve the physical effect normally.</p> : null}
    </>}
    <div>{onActivate ? <button className={s.btn} type="button" onClick={onActivate}>Activate chosen card</button> : null}{onReveal ? <button className={s.btn} type="button" onClick={onReveal}>Reveal chosen card</button> : null}
      {onRecognize ? <button className={s.btn} type="button" onClick={onRecognize}>{showCardsSetFromDeck ? "Identify shown card" : "Identify revealed card"}</button> : null}
      <button className={s.btn} type="button" onClick={onClose}>Close candidates</button></div>
  </PopupFrame>;
}

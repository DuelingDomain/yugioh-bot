"use client";

import { useId, useState } from "react";
import { Icon } from "./icons";
import s from "./remote-ui.module.css";

/** One line above a seat's field: two public cards of one seat look like the same card. Merge fixes it in one click. */
export function DupBanner({ seat, name, count, more, busy, canAct, onMerge, onTwo }: {
  seat: number; name: string; count: number; more: number; busy: boolean;
  /** Only the owner of the field can merge. Others see the badge and the line, with no buttons. */
  canAct: boolean; onMerge: () => void; onTwo: () => void;
}) {
  return <div className={s.dupbar} role="group" aria-label={`${name} appears ${count === 2 ? "twice" : `${count} times`}`} data-testid={`dup-banner-${seat}`}>
    <Icon name="warn" />
    <span className={s.duptx}><b>{name}</b> appears {count === 2 ? "twice" : `${count} times`}{canAct ? " — Same card?" : ""}{more ? ` (+${more} more)` : ""}</span>
    {canAct ? <>
      <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={busy} onClick={onMerge} data-testid={`dup-merge-${seat}`}>Merge</button>
      <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onTwo} data-testid={`dup-two-${seat}`}>Two copies</button>
    </> : null}
  </div>;
}

/** The table placed a card the seat already has on the field and asks: the same card (merge) or another copy? */
export function CopyAsk({ seat, message, place, busy, onMove, onCopy, onCancel }: {
  seat: number; message: string; place: string; busy: boolean; onMove: () => void; onCopy: () => void; onCancel: () => void;
}) {
  return <div className={s.dupbar} role="group" aria-label={message} data-testid={`copy-ask-${seat}`}
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); onCancel(); } }}>
    <Icon name="warn" />
    <span className={s.duptx}>{message}</span>
    <button type="button" className={`${s.btn} ${s.sm} ${s.go}`} disabled={busy} autoFocus onClick={onMove} data-testid={`copy-move-${seat}`} title={`Keep the new card at ${place} and remove the old one`}>Move it here</button>
    <button type="button" className={`${s.btn} ${s.sm}`} disabled={busy} onClick={onCopy} data-testid={`copy-another-${seat}`}>Another copy</button>
    <button type="button" className={`${s.btn} ${s.sm} ${s.q}`} onClick={onCancel} data-testid={`copy-cancel-${seat}`}>Cancel</button>
  </div>;
}

/** Only field/pile or pile/new origins are ambiguous. First option is the default. */
export function OriginAsk({seat,message,options,busy,onChoose}:{
  seat:number;message:string;options:readonly {ref?:string;label:string}[];busy:boolean;
  onChoose(option:{ref?:string;label:string}):void;
}) {
  const group = useId(), [selected,setSelected] = useState(0);
  return <form className={s.dupbar} aria-label={message} data-testid={`copy-ask-${seat}`}
    onSubmit={event=>{event.preventDefault();if(!busy&&options[selected])onChoose(options[selected]);}}>
    <Icon name="warn" /><span className={s.duptx}>{message}</span>
    <div role="radiogroup" aria-label="Card origin">{options.map((option,index)=><label key={option.ref??'new'}>
      <input type="radio" name={group} checked={selected===index} disabled={busy} autoFocus={index===0}
        onChange={()=>setSelected(index)}/>{option.label}
    </label>)}</div>
    <button type="submit" className={`${s.btn} ${s.sm} ${s.go}`} disabled={busy}>Confirm</button>
  </form>;
}

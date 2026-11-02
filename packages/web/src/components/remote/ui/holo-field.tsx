"use client";

import { useState, type KeyboardEvent } from "react";
import { hasExtraMonsterZones, type FieldFormat } from '@yugidraft/vision';
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, EXTRA_ZONES, EMZ_KEYS, frameOf, hueOf, isPile, isMonsterZone, ZK, ZN, zoneLabel, type TwinCard, type ZoneKey } from "./model";
import s from "./remote-ui.module.css";

const SHAPE = "polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)";
const FRAME_CLASS = { tNormal: s.tNormal, tEffect: s.tEffect, tSpell: s.tSpell, tTrap: s.tTrap } as const;

/** A small card face. Real art loads on top of the CSS placeholder and hides itself on error. */
export function CardFace({ card, info }: { card: TwinCard; info?: CardInfo }) {
  const [broken, setBroken] = useState(false);
  const code = cardCode(card);
  const monster = isMonsterInfo(info);
  return <div className={`${s.cd} ${FRAME_CLASS[frameOf(info)]}`} style={{ "--h": hueOf(code ?? 1), "--shape": SHAPE } as React.CSSProperties}>
    <div className={s.nm} title={card.bestMatch?'Best match · use Wrong card? to correct':undefined}>{card.bestMatch?'Best match · ':''}{cardName(card, info)}</div>
    <div className={s.art}>{code && !broken ? <img className={s.artImg} src={cardArt(code, "cropped")} alt="" loading="lazy" onError={() => setBroken(true)} /> : null}</div>
    <div className={s.st}>{monster ? <><b>{info?.atk ?? "?"}</b><b>{info?.def ?? "?"}</b></> : <b>{/trap/i.test(info?.type ?? "") ? "TRAP" : /spell/i.test(info?.type ?? "") ? "SPELL" : "?"}</b>}</div>
  </div>;
}

export type FieldTarget = { seat: number; key: ZoneKey; ref?: string };

export function HoloField({ seat, name, twin, info, format='normal', rv, onRv, picking, selectedRef, targetRef, freshRef, warnRefs, onActivate, onAttack, onInspect }: {
  seat: number; name: string; twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined;
  format?:FieldFormat;
  rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean; selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
}) {
  const cells = cellsFor(twin);
  const emz=hasExtraMonsterZones(format),keys:readonly ZoneKey[]=emz?[...EMZ_KEYS,...ZK]:ZK;
  const coordinate=(key:ZoneKey)=>key==='emz1'?[0,2]:key==='emz2'?[0,4]:[1+Math.floor(ZK.indexOf(key as typeof ZK[number])/7),ZK.indexOf(key as typeof ZK[number])%7];
  function move(event: KeyboardEvent<HTMLDivElement>, key: ZoneKey) {
    const [row,col]=coordinate(key);
    const next=keys.filter(k=>{const [r,c]=coordinate(k);return event.key==='ArrowRight'?r===row&&c>col:event.key==='ArrowLeft'?r===row&&c<col:event.key==='ArrowDown'?c===col&&r>row:event.key==='ArrowUp'?c===col&&r<row:false;}).sort((a,b)=>{const [ar,ac]=coordinate(a),[br,bc]=coordinate(b);return Math.abs(ar-row)+Math.abs(ac-col)-Math.abs(br-row)-Math.abs(bc-col);})[0];
    if (next) {
      event.preventDefault(); onRv(next);
      const root = event.currentTarget.parentElement;
      requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-zone="${next}"]`)?.focus());
      return;
    }
    const card = cells[key].card;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(key, card); }
    else if ((event.key === "a" || event.key === "A") && !event.ctrlKey && !event.metaKey && card) { event.preventDefault(); onAttack(key, card); }
    else if ((event.key === "i" || event.key === "I") && card) { event.preventDefault(); onInspect(card); }
  }
  const extras = EXTRA_ZONES.map(zone => ({ ...zone, cards: twin.filter(card => card.zone === zone.id) })).filter(zone => zone.cards.length);
  return <>
    <div className={s.field} data-emz={emz} role="group" aria-label={`${name}'s virtual field`} data-testid={`field-${seat}`}>
      {keys.map(key => {
        const cell = cells[key]; const card = cell.card; const pile = isPile(key);
        const cardInfo = card ? info(cardCode(card)) : undefined;
        const unknown = !!card && card.faceUp && !cardCode(card);
        const down = !!card && !card.faceUp;
        const defense = !!card && card.position === "defense" && !pile;
        const monsterZone = isMonsterZone(key);
        const classes = [s.zc, card && !down ? s.clk : "", defense ? s.def : "", card && card.ref === selectedRef ? s.sel : "", card && card.ref === targetRef ? s.tgt : "",
          picking && monsterZone && card ? s.pickTarget : "", card && card.ref === freshRef ? s.scanin : ""].filter(Boolean).join(" ");
        let desc = "empty"; let inner: React.ReactNode = <span className={s.zl}>{zoneLabel(key)}</span>;
        if (pile && cell.count) { desc = `${cell.count} cards`; inner = <><div className={`${s.cd} ${s.back}`} /><span className={s.cnt}>{cell.count}</span></>; }
        else if (unknown) { desc = "unidentified card. Press Enter to identify"; inner = <div className={`${s.cd} ${s.unk}`}><span>?</span></div>; }
        else if (down) { desc = "face-down card"; inner = <div className={`${s.cd} ${s.back}`} />; }
        else if (card) { desc = cardName(card, cardInfo) + (isMonsterInfo(cardInfo) ? (defense ? ", defense position" : ", attack position") : ""); inner = <CardFace card={card} info={cardInfo} />; }
        return <div key={key} className={classes} role="button" tabIndex={rv === key ? 0 : -1} data-z={key} data-zone={key} data-seat={seat}
          style={{gridRow:coordinate(key)[0]+(emz?1:0),gridColumn:coordinate(key)[1]+1}}
          aria-label={`${name}, ${ZN[key]}: ${desc}`} onFocus={() => onRv(key)} onKeyDown={event => move(event, key)} onClick={() => onActivate(key, card)}>
          {inner}{card && warnRefs.has(card.ref) ? <span className={s.nidm} title="Not in decklist">!</span> : null}
        </div>;
      })}
    </div>
    {extras.length ? <div className={s.xstrip} aria-label={`${name}'s other zones`}>
      {extras.map(zone => <span key={zone.id}>{zone.label}: {zone.cards.map(card => <button type="button" key={card.ref} onClick={() => onInspect(card)}>{cardName(card, info(cardCode(card)))}</button>)}</span>)}
    </div> : null}
  </>;
}

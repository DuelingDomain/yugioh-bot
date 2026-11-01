"use client";

import { useState, type KeyboardEvent } from "react";
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, EXTRA_ZONES, frameOf, hueOf, isPile, ZK, ZN, zoneLabel, type TwinCard, type ZoneKey } from "./model";
import s from "./remote-ui.module.css";

const SHAPE = "polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)";
const FRAME_CLASS = { tNormal: s.tNormal, tEffect: s.tEffect, tSpell: s.tSpell, tTrap: s.tTrap } as const;

/** A small card face. Real art loads on top of the CSS placeholder and hides itself on error. */
export function CardFace({ card, info }: { card: TwinCard; info?: CardInfo }) {
  const [broken, setBroken] = useState(false);
  const code = cardCode(card);
  const monster = isMonsterInfo(info);
  return <div className={`${s.cd} ${FRAME_CLASS[frameOf(info)]}`} style={{ "--h": hueOf(code ?? 1), "--shape": SHAPE } as React.CSSProperties}>
    <div className={s.nm}>{cardName(card, info)}</div>
    <div className={s.art}>{code && !broken ? <img className={s.artImg} src={cardArt(code, "cropped")} alt="" loading="lazy" onError={() => setBroken(true)} /> : null}</div>
    <div className={s.st}>{monster ? <><b>{info?.atk ?? "?"}</b><b>{info?.def ?? "?"}</b></> : <b>{/trap/i.test(info?.type ?? "") ? "TRAP" : /spell/i.test(info?.type ?? "") ? "SPELL" : "?"}</b>}</div>
  </div>;
}

export type FieldTarget = { seat: number; key: ZoneKey; ref?: string };

export function HoloField({ seat, name, twin, info, rv, onRv, picking, selectedRef, targetRef, freshRef, warnRefs, onActivate, onAttack, onInspect }: {
  seat: number; name: string; twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined;
  rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean; selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
}) {
  const cells = cellsFor(twin);
  function move(event: KeyboardEvent<HTMLDivElement>, key: ZoneKey) {
    const i = ZK.indexOf(key); let next = -1;
    if (event.key === "ArrowRight" && i % 7 < 6) next = i + 1;
    else if (event.key === "ArrowLeft" && i % 7 > 0) next = i - 1;
    else if (event.key === "ArrowDown" && i < 7) next = i + 7;
    else if (event.key === "ArrowUp" && i >= 7) next = i - 7;
    if (next >= 0) {
      event.preventDefault(); onRv(ZK[next]);
      const root = event.currentTarget.parentElement;
      requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-zone="${ZK[next]}"]`)?.focus());
      return;
    }
    const card = cells[key].card;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(key, card); }
    else if ((event.key === "a" || event.key === "A") && !event.ctrlKey && !event.metaKey && card) { event.preventDefault(); onAttack(key, card); }
    else if ((event.key === "i" || event.key === "I") && card) { event.preventDefault(); onInspect(card); }
  }
  const extras = EXTRA_ZONES.map(zone => ({ ...zone, cards: twin.filter(card => card.zone === zone.id) })).filter(zone => zone.cards.length);
  return <>
    <div className={s.field} role="group" aria-label={`${name}'s virtual field`} data-testid={`field-${seat}`}>
      {ZK.map(key => {
        const cell = cells[key]; const card = cell.card; const pile = isPile(key);
        const cardInfo = card ? info(cardCode(card)) : undefined;
        const unknown = !!card && card.faceUp && !cardCode(card);
        const down = !!card && !card.faceUp;
        const defense = !!card && card.position === "defense" && !pile;
        const monsterZone = key[0] === "m";
        const classes = [s.zc, card && !down ? s.clk : "", defense ? s.def : "", card && card.ref === selectedRef ? s.sel : "", card && card.ref === targetRef ? s.tgt : "",
          picking && monsterZone && card ? s.pickTarget : "", card && card.ref === freshRef ? s.scanin : ""].filter(Boolean).join(" ");
        let desc = "empty"; let inner: React.ReactNode = <span className={s.zl}>{zoneLabel(key)}</span>;
        if (pile && cell.count) { desc = `${cell.count} cards`; inner = <><div className={`${s.cd} ${s.back}`} /><span className={s.cnt}>{cell.count}</span></>; }
        else if (unknown) { desc = "unidentified card. Press Enter to identify"; inner = <div className={`${s.cd} ${s.unk}`}><span>?</span></div>; }
        else if (down) { desc = "face-down card"; inner = <div className={`${s.cd} ${s.back}`} />; }
        else if (card) { desc = cardName(card, cardInfo) + (isMonsterInfo(cardInfo) ? (defense ? ", defense position" : ", attack position") : ""); inner = <CardFace card={card} info={cardInfo} />; }
        return <div key={key} className={classes} role="button" tabIndex={rv === key ? 0 : -1} data-z={key} data-zone={key} data-seat={seat}
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

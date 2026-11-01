"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, EK, EXTRA_ZONES, frameOf, hueOf, isMonsterZone, isPendulumCell, isPile, mirrorEmz, ZK, ZN, zoneLabel, type FrameKind, type TwinCard, type ZoneKey } from "./model";
import s from "./remote-ui.module.css";

const SHAPE = "polygon(50% 0,100% 38%,82% 100%,18% 100%,0 38%)";
const FRAME_CLASS: Record<FrameKind, string> = {
  normal: s.tNormal ?? "", effect: s.tEffect ?? "", ritual: s.tRitual ?? "", fusion: s.tFusion ?? "", synchro: s.tSynchro ?? "", xyz: s.tXyz ?? "",
  link: s.tLink ?? "", pendulum: s.tPendulum ?? "", spell: s.tSpell ?? "", trap: s.tTrap ?? "", token: s.tToken ?? "",
};

/** The level, Rank or Link rating chip. The printed number is too small to read at field size. */
function ratingOf(kind: FrameKind, info: CardInfo | undefined): string | null {
  if (!info?.level || !isMonsterInfo(info)) return null;
  return kind === "xyz" ? `R${info.level}` : kind === "link" ? `L${info.level}` : `\u2605${info.level}`;
}

/**
 * A card on the field. It shows the same printed card image as the online duel board, so the frame, Rank stars and Link
 * arrows come from the card. The CSS frame under the image has the colour of the card type and stays when the image fails.
 * ATK / DEF come from the catalog data (a Link monster has ATK only).
 */
export function CardFace({ card, info }: { card: TwinCard; info?: CardInfo }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  const code = cardCode(card);
  const kind = frameOf(info);
  const monster = isMonsterInfo(info);
  const link = kind === "link";
  const rating = ratingOf(kind, info);
  const stat = (value: number | undefined) => (value === undefined || value < 0 ? "?" : String(value));
  return <div className={`${s.cd} ${FRAME_CLASS[kind]}`} data-frame={kind} data-art={state} style={{ "--h": hueOf(code ?? 1), "--shape": SHAPE } as React.CSSProperties}>
    <div className={s.nm}>{cardName(card, info)}</div>
    <div className={s.art} />
    <div className={s.st}>{monster ? <><b>{stat(info?.atk)}</b>{link ? null : <b>{stat(info?.def)}</b>}</> : <b>{kind === "trap" ? "TRAP" : kind === "spell" ? "SPELL" : "\u2026"}</b>}</div>
    {code && state !== "broken" ? <img className={s.fimg} src={cardArt(code, "small")} alt="" draggable={false} onLoad={() => setState("ok")} onError={() => setState("broken")} /> : null}
    {monster && info && state === "ok" ? <div className={s.plate} data-testid="card-plate"><b>{stat(info.atk)}</b>{link ? null : <><i>/</i><b>{stat(info.def)}</b></>}</div> : null}
    {rating && state === "ok" ? <span className={s.rate} data-testid="card-rating">{rating}</span> : null}
  </div>;
}

const LAND_MS = 900;
/** Refs that landed on this field a moment ago. Cards present at mount, and those of the first state load, do not count. */
function useLanded(twin: readonly TwinCard[]): ReadonlySet<string> {
  const seen = useRef<Set<string> | null>(null);
  const born = useRef(0);
  const [landed, setLanded] = useState<ReadonlySet<string>>(new Set());
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const now = Date.now();
    if (!seen.current) { seen.current = new Set(); born.current = now; }
    const fresh = twin.filter(card => !seen.current!.has(card.ref));
    for (const card of fresh) seen.current.add(card.ref);
    // The first second after mount is the state load, not play.
    if (!fresh.length || now - born.current < 1000) return;
    const refs = fresh.map(card => card.ref);
    setLanded(prev => new Set([...prev, ...refs]));
    timers.current.push(setTimeout(() => setLanded(prev => { const next = new Set(prev); for (const ref of refs) next.delete(ref); return next; }), LAND_MS));
  }, [twin]);
  useEffect(() => () => { for (const timer of timers.current) clearTimeout(timer); }, []);
  return landed;
}

export type FieldTarget = { seat: number; key: ZoneKey; ref?: string };

export function HoloField({ seat, name, twin, info, extraZones, facing, rv, onRv, picking, selectedRef, targetRef, freshRef, warnRefs, onActivate, onAttack, onInspect }: {
  seat: number; name: string; twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined;
  /** Master Rule 5: draw the two Extra Monster Zones and the Pendulum label on the outer Spell/Trap zones. */
  extraZones?: boolean;
  /** The seat that faces this one and shares its Extra Monster Zones. */
  facing?: { name: string; twin: readonly TwinCard[] } | null;
  rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean; selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
}) {
  const cells = cellsFor(twin, !!extraZones);
  const landed = useLanded(twin);
  function move(event: KeyboardEvent<HTMLDivElement>, key: ZoneKey) {
    let next: ZoneKey | null = null;
    if (key === "e1" || key === "e2") {
      // The Extra Monster Zones sit above Main Monster Zone 2 and 4.
      if (event.key === "ArrowRight" && key === "e1") next = "e2"; else if (event.key === "ArrowLeft" && key === "e2") next = "e1";
      else if (event.key === "ArrowDown") next = key === "e1" ? "m2" : "m4";
    } else {
      const i = ZK.indexOf(key as (typeof ZK)[number]);
      if (event.key === "ArrowRight" && i % 7 < 6) next = ZK[i + 1];
      else if (event.key === "ArrowLeft" && i % 7 > 0) next = ZK[i - 1];
      else if (event.key === "ArrowDown" && i < 7) next = ZK[i + 7];
      else if (event.key === "ArrowUp" && i >= 7) next = ZK[i - 7];
      else if (event.key === "ArrowUp" && extraZones && (key === "m2" || key === "m4")) next = key === "m2" ? "e1" : "e2";
    }
    if (next) {
      const target = next; event.preventDefault(); onRv(target);
      const root = event.currentTarget.parentElement;
      requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-zone="${target}"]`)?.focus());
      return;
    }
    const card = cells[key].card;
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(key, card); }
    else if ((event.key === "a" || event.key === "A") && !event.ctrlKey && !event.metaKey && card) { event.preventDefault(); onAttack(key, card); }
    else if ((event.key === "i" || event.key === "I") && card) { event.preventDefault(); onInspect(card); }
  }
  const drawn = new Set(Object.values(cells).map(cell => cell.card?.ref).filter(Boolean));
  const extras = EXTRA_ZONES.map(zone => ({ ...zone, cards: twin.filter(card => card.zone === zone.id && !drawn.has(card.ref)) })).filter(zone => zone.cards.length);
  const keys: ZoneKey[] = extraZones ? [...EK, ...ZK] : [...ZK];
  return <>
    <div className={s.field} role="group" aria-label={`${name}'s virtual field`} data-testid={`field-${seat}`} data-emz={extraZones ? "on" : undefined}>
      {keys.map(key => {
        const cell = cells[key]; const card = cell.card; const pile = isPile(key);
        const cardInfo = card ? info(cardCode(card)) : undefined;
        const unknown = !!card && card.faceUp && !cardCode(card);
        const down = !!card && !card.faceUp;
        const defense = !!card && card.position === "defense" && !pile;
        const monsterZone = isMonsterZone(key); const emzCell = key === "e1" || key === "e2";
        const taken = emzCell && !card ? facing?.twin.find(other => other.zone === "extra-monster" && other.slot === mirrorEmz(Number(key[1]))) : undefined;
        const classes = [s.zc, emzCell ? s.ez : "", taken ? s.taken : "", card && !down ? s.clk : "", defense ? s.def : "", card && card.ref === selectedRef ? s.sel : "", card && card.ref === targetRef ? s.tgt : "",
          picking && monsterZone && card ? s.pickTarget : "", card && card.ref === freshRef ? s.scanin : "", card && landed.has(card.ref) ? s.land : ""].filter(Boolean).join(" ");
        let desc = taken ? `shared with ${facing!.name}: taken by their monster` : "empty";
        let inner: React.ReactNode = <span className={s.zl}>{taken ? <>EMZ<small>{facing!.name} has it</small></> : key === "ex" ? <>EXTRA<small>DECK</small></> : zoneLabel(key)}{extraZones && isPendulumCell(key) ? <small>PZ</small> : null}</span>;
        if (pile && cell.count) { desc = `${cell.count} cards`; inner = <><div className={`${s.cd} ${s.back} ${key === "ex" ? s.backEx : ""}`} /><span className={s.cnt}>{cell.count}</span><span className={s.pl}>{key === "ex" ? "EXTRA DECK" : zoneLabel(key)}</span></>; }
        else if (unknown) { desc = "unidentified card. Press Enter to identify"; inner = <div className={`${s.cd} ${s.unk}`}><span>?</span></div>; }
        else if (down) {
          const origin=card.publicIdentity && card.setBy && cardCode(card) ? `Set from Deck by ${card.setBy.name}: ${cardName(card,cardInfo)}` : card.setBy ? `Set by ${card.setBy.name}` : "";
          desc = `Face-down${origin ? " · "+origin : ""}${cardCode(card) && !card.publicIdentity ? " · "+cardName(card,cardInfo) : ""}`;
          inner = <>{cardCode(card) ? <div className={s.knownDown}><CardFace card={card} info={cardInfo} /></div> : <div className={`${s.cd} ${s.back}`} />}
            <span className={s.originLabel}>{desc}</span></>;
        }
        else if (card) { desc = cardName(card, cardInfo) + (isMonsterInfo(cardInfo) ? (defense ? ", defense position" : ", attack position") : ""); inner = <CardFace card={card} info={cardInfo} />; }
        return <div key={key} className={classes} role="button" tabIndex={rv === key ? 0 : -1} data-z={key} data-zone={key} data-seat={seat} data-row={emzCell ? undefined : ZK.indexOf(key as (typeof ZK)[number]) < 7 ? 1 : 2}
          aria-label={`${name}, ${ZN[key]}${extraZones && isPendulumCell(key) ? " (Pendulum zone)" : ""}: ${desc}`} onFocus={() => onRv(key)} onKeyDown={event => move(event, key)} onClick={() => onActivate(key, card)}>
          {inner}{card && warnRefs.has(card.ref) ? <span className={s.nidm} title="Not in decklist">!</span> : null}
        </div>;
      })}
    </div>
    {extras.length ? <div className={s.xstrip} aria-label={`${name}'s other zones`}>
      {extras.map(zone => <span key={zone.id}>{zone.label}: {zone.cards.map(card => <button type="button" key={card.ref} onClick={() => onInspect(card)}>{cardName(card, info(cardCode(card)))}</button>)}</span>)}
    </div> : null}
  </>;
}

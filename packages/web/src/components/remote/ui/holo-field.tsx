"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cardArt, isMonsterInfo, type CardInfo } from "./catalog";
import { cardCode, cardName, cellsFor, EK, EXTRA_ZONES, frameOf, hueOf, isMonsterZone, isPendulumCell, isPile, mirrorEmz, ZK, ZN, zoneLabel, type FrameKind, type TwinCard, type ZoneKey } from "./model";
import type { Verdict } from "./placement";
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

/** Drag and drop of the owner's own cards. The table decides what a verdict means (move, ask, or say why not). */
export type FieldDrag = {
  can: (card: TwinCard) => boolean;
  judge: (card: TwinCard, key: ZoneKey) => Verdict;
  drop: (card: TwinCard, key: ZoneKey, verdict: Verdict) => void;
};
const VERDICT_CLASS: Record<Verdict["kind"], string> = { ok: s.dropOk ?? "", same: "", confirm: s.dropAsk ?? "", refuse: s.dropNo ?? "" };

export type FieldTarget = { seat: number; key: ZoneKey; ref?: string };

export function HoloField({ seat, name, twin, info, extraZones, facing, rv, onRv, picking, selectedRef, targetRef, freshRef, warnRefs, onActivate, onAttack, onInspect, drag: dnd, rotated }: {
  /** Another player's field: turned 180 degrees as on the online board, so it reads from across the table. */
  rotated?: boolean;
  seat: number; name: string; twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined;
  /** Master Rule 5: draw the two Extra Monster Zones and the Pendulum label on the outer Spell/Trap zones. */
  extraZones?: boolean;
  /** The seat that faces this one and shares its Extra Monster Zones. */
  facing?: { name: string; twin: readonly TwinCard[] } | null;
  rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean; selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
  drag?: FieldDrag;
}) {
  const cells = cellsFor(twin, !!extraZones);
  const landed = useLanded(twin);
  const [dragging, setDragging] = useState<{ ref: string; x: number; y: number; over: ZoneKey | null; verdict: Verdict["kind"] | null } | null>(null);
  const [carry, setCarry] = useState<string | null>(null);
  const swallow = useRef(false);
  const stop = useRef<(() => void) | null>(null);
  useEffect(() => () => stop.current?.(), []);
  /** Pointer drag (mouse, pen and touch). A press that moves less than 6 px stays a normal click. */
  function begin(event: ReactPointerEvent<HTMLDivElement>, card: TwinCard) {
    if (!dnd?.can(card) || (event.pointerType === "mouse" && event.button !== 0)) return;
    const start = { x: event.clientX, y: event.clientY }; const id = event.pointerId; let started = false;
    const hit = (x: number, y: number): ZoneKey | null => {
      const el = document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-zone][data-seat]");
      return el && Number(el.dataset.seat) === seat ? (el.dataset.zone as ZoneKey) : null;
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId !== id) return;
      if (!started) { if (Math.hypot(e.clientX - start.x, e.clientY - start.y) < 6) return; started = true; }
      const over = hit(e.clientX, e.clientY);
      setDragging({ ref: card.ref, x: e.clientX, y: e.clientY, over, verdict: over ? dnd.judge(card, over).kind : null });
    };
    const finish = (e: PointerEvent, cancelled: boolean) => {
      if (e.pointerId !== id) return;
      cleanup();
      if (!started) return;
      swallow.current = true; setTimeout(() => { swallow.current = false; }, 60);
      setDragging(null);
      const over = cancelled ? null : hit(e.clientX, e.clientY);
      if (over) dnd.drop(card, over, dnd.judge(card, over));
    };
    const up = (e: PointerEvent) => finish(e, false); const cancel = (e: PointerEvent) => finish(e, true);
    const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); stop.current = null; };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel);
    stop.current = cleanup;
  }
  const carried = carry ? twin.find(card => card.ref === carry) : undefined;
  function dropCarried(key: ZoneKey) {
    const card = carried; setCarry(null);
    if (card && dnd) dnd.drop(card, key, dnd.judge(card, key));
  }
  function move(event: KeyboardEvent<HTMLDivElement>, key: ZoneKey) {
    let next: ZoneKey | null = null;
    // A turned field: the arrow keys follow what the player sees.
    const turned: Record<string, string> = { ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft", ArrowUp: "ArrowDown", ArrowDown: "ArrowUp" };
    const arrow = rotated ? turned[event.key] ?? event.key : event.key;
    if (key === "e1" || key === "e2") {
      // The Extra Monster Zones sit above Main Monster Zone 2 and 4.
      if (arrow === "ArrowRight" && key === "e1") next = "e2"; else if (arrow === "ArrowLeft" && key === "e2") next = "e1";
      else if (arrow === "ArrowDown") next = key === "e1" ? "m2" : "m4";
    } else {
      const i = ZK.indexOf(key as (typeof ZK)[number]);
      if (arrow === "ArrowRight" && i % 7 < 6) next = ZK[i + 1];
      else if (arrow === "ArrowLeft" && i % 7 > 0) next = ZK[i - 1];
      else if (arrow === "ArrowDown" && i < 7) next = ZK[i + 7];
      else if (arrow === "ArrowUp" && i >= 7) next = ZK[i - 7];
      else if (arrow === "ArrowUp" && extraZones && (key === "m2" || key === "m4")) next = key === "m2" ? "e1" : "e2";
    }
    if (next) {
      const target = next; event.preventDefault(); onRv(target);
      const root = event.currentTarget.parentElement;
      requestAnimationFrame(() => root?.querySelector<HTMLElement>(`[data-zone="${target}"]`)?.focus());
      return;
    }
    const card = cells[key].card;
    if (carried && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setCarry(null); return; }
    if (carried && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); dropCarried(key); return; }
    if ((event.key === "m" || event.key === "M") && !event.ctrlKey && !event.metaKey && !event.altKey && card && dnd?.can(card) && !isPile(key)) { event.preventDefault(); setCarry(card.ref); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onActivate(key, card); }
    else if ((event.key === "a" || event.key === "A") && !event.ctrlKey && !event.metaKey && card) { event.preventDefault(); onAttack(key, card); }
    else if ((event.key === "i" || event.key === "I") && card) { event.preventDefault(); onInspect(card); }
  }
  const drawn = new Set(Object.values(cells).map(cell => cell.card?.ref).filter(Boolean));
  const extras = EXTRA_ZONES.map(zone => ({ ...zone, cards: twin.filter(card => card.zone === zone.id && !drawn.has(card.ref)) })).filter(zone => zone.cards.length);
  const banished = twin.filter(card => card.zone === "banished").length;
  const keys: ZoneKey[] = extraZones ? [...EK, ...ZK] : [...ZK];
  return <>
    <div className={s.field} role="group" onClickCapture={event => { if (swallow.current) { event.stopPropagation(); event.preventDefault(); } }} aria-label={`${name}'s virtual field`} data-testid={`field-${seat}`} data-emz={extraZones ? "on" : undefined} data-rotated={rotated ? "on" : undefined}>
      {keys.map(key => {
        const cell = cells[key]; const card = cell.card; const pile = isPile(key);
        const cardInfo = card ? info(cardCode(card)) : undefined;
        const unknown = !!card && card.faceUp && !cardCode(card);
        const down = !!card && !card.faceUp;
        const defense = !!card && card.position === "defense" && !pile;
        const monsterZone = isMonsterZone(key); const emzCell = key === "e1" || key === "e2";
        const taken = emzCell && !card ? facing?.twin.find(other => other.zone === "extra-monster" && other.slot === mirrorEmz(Number(key[1]))) : undefined;
        const carriedHere = !!carried && rv === key;
        const dropClass = dragging?.over === key && dragging.verdict ? VERDICT_CLASS[dragging.verdict] : carriedHere && dnd ? VERDICT_CLASS[dnd.judge(carried!, key).kind] : "";
        const classes = [s.zc, dropClass, card && dnd?.can(card) && !isPile(key) ? s.drg : "", card && (dragging?.ref === card.ref || carry === card.ref) ? s.dragSrc : "", emzCell ? s.ez : "", taken ? s.taken : "", card && !down ? s.clk : "", defense ? s.def : "", card && card.ref === selectedRef ? s.sel : "", card && card.ref === targetRef ? s.tgt : "",
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
          aria-label={`${name}, ${ZN[key]}${extraZones && isPendulumCell(key) ? " (Pendulum zone)" : ""}: ${desc}`} onFocus={() => onRv(key)} onKeyDown={event => move(event, key)} onClick={() => { if (carried) dropCarried(key); else onActivate(key, card); }} onPointerDown={card ? event => begin(event, card) : undefined}>
          {inner}{key === "gy" && banished ? <span className={s.ban} data-testid="banished-count" title={`${banished} banished`}>BAN {banished}</span> : null}{card && warnRefs.has(card.ref) ? <span className={s.nidm} title="Not in decklist">!</span> : null}
        </div>;
      })}
    </div>
    {carried ? <div className={s.carryHint} role="status" data-testid="carry-hint">Moving {cardName(carried, info(cardCode(carried)))}. Arrow keys choose a zone, Enter drops, Esc cancels.
      {dnd && cells[rv] ? <b>{(() => { const v = dnd.judge(carried, rv); return v.kind === "refuse" || v.kind === "confirm" ? v.message : ""; })()}</b> : null}</div> : null}
    {dragging && typeof document !== "undefined" ? createPortal(<DragGhost card={twin.find(card => card.ref === dragging.ref)} info={info} x={dragging.x} y={dragging.y} verdict={dragging.verdict} />, document.body) : null}
    {extras.length ? <div className={s.xstrip} aria-label={`${name}'s other zones`}>
      {extras.map(zone => <span key={zone.id}>{zone.label}: {zone.cards.map(card => <button type="button" key={card.ref} onClick={() => onInspect(card)}>{cardName(card, info(cardCode(card)))}</button>)}</span>)}
    </div> : null}
  </>;
}

/** The card that follows the pointer while it is dragged. */
function DragGhost({ card, info, x, y, verdict }: { card: TwinCard | undefined; info: (id: number | undefined) => CardInfo | undefined; x: number; y: number; verdict: Verdict["kind"] | null }) {
  if (!card) return null;
  const code = cardCode(card);
  return <div className={`${s.ghost} ${verdict ? VERDICT_CLASS[verdict] : ""}`} data-testid="drag-ghost" style={{ left: x, top: y }} aria-hidden="true">
    {code && card.faceUp ? <img src={cardArt(code, "small")} alt="" draggable={false} /> : <div className={`${s.cd} ${s.back}`} />}
    <span>{card.faceUp ? cardName(card, info(code)) : "Face-down card"}</span>
  </div>;
}

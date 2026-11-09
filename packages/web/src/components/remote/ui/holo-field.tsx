"use client";

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { cardArt, hasBattleStats, isMonsterInfo, type CardInfo } from "./catalog";
import { BK, cardCode, cardName, cellsFor, EK, EXTRA_ZONES, frameOf, hueOf, isMonsterZone, isPendulumCell, isPile, mirrorEmz, ZK, ZN, zoneLabel, type FrameKind, type TwinCard, type ZoneKey } from "./model";
import type { Verdict } from "./placement";
import {useFieldBacks} from './video-hub';
import {useFieldMotion} from './field-motion';
import {ghostTwins, useFieldGhosts} from '@/lib/remote/field-ghosts';
import {useMissingPiles} from '@/lib/remote/zone-grid';
import s from "./remote-ui.module.css";
import z from "./zone-rules.module.css";
import { equipSourceOnField, fieldZoneCheck } from "@/lib/remote/field-legality";
import { StatPlate, statsOf, statsText } from "./card-stats";

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
export function CardFace({ card, info, stats = "inline" }: { card: TwinCard; info?: CardInfo; /** "none": the field draws the numbers itself, upright (StatPlate), so the card carries none. */ stats?: "inline" | "none" }) {
  const [state, setState] = useState<"loading" | "ok" | "broken">("loading");
  const token = card.token;
  // A token borrows the art of its catalog card; a generic token has none.
  const code = cardCode(card) ?? token?.artId;
  const kind: FrameKind = token ? "token" : frameOf(info);
  const monster = !!token || isMonsterInfo(info);
  const link = kind === "link";
  const rating = token ? null : ratingOf(kind, info);
  const stat = (value: number | undefined | null) => (value === undefined || value === null || value < 0 ? "?" : String(value));
  const atk = token ? token.atk : info?.atk, def = token ? token.def : info?.def;
  return <div className={`${s.cd} ${FRAME_CLASS[kind]}`} data-frame={kind} data-art={state} style={{ "--h": hueOf(code ?? 1), "--shape": SHAPE } as React.CSSProperties}>
    <div className={s.nm} title={card.bestMatch?'Best match · use Wrong card? to correct':undefined}>{card.bestMatch?'Best match · ':''}{cardName(card, info)}</div>
    <div className={s.art} />
    {stats === "none" && monster ? (token ? <div className={s.st}><b>TOKEN</b></div> : null)
      : <div className={s.st}>{monster ? <><b>{stat(atk)}</b>{link ? null : <b>{stat(def)}</b>}</> : <b>{kind === "trap" ? "TRAP" : kind === "spell" ? "SPELL" : "\u2026"}</b>}</div>}
    {code && state !== "broken" ? <img className={s.fimg} src={cardArt(code, "small")} alt="" draggable={false} onLoad={() => setState("ok")} onError={() => setState("broken")} /> : null}
    {stats === "inline" && monster && (info || token) && state === "ok" ? <div className={s.plate} data-testid="card-plate"><b>{stat(atk)}</b>{link ? null : <><i>/</i><b>{stat(def)}</b></>}</div> : null}
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
  judge: (card: TwinCard, key: ZoneKey | "hand") => Verdict;
  drop: (card: TwinCard, key: ZoneKey | "hand", verdict: Verdict) => void;
};
export const VERDICT_CLASS: Record<Verdict["kind"], string> = { ok: s.dropOk ?? "", same: "", confirm: s.dropAsk ?? "", refuse: s.dropNo ?? "" };

export type FieldTarget = { seat: number; key: ZoneKey; ref?: string };

export function HoloField({ seat, name, twin, info, extraZones, facing, rv, onRv, picking, selectedRef, targetRef, freshRef, warnRefs, onActivate, onAttack, onInspect, onPile, onDeck, drag: dnd, rotated, twinCounts, deckListSizes, deckRegistered, boardSeats }: {
  /** Every seat's cards, so an Equip link can name a monster on another field. */
  boardSeats?: readonly { seat: number; twin: readonly TwinCard[] }[];
  deckListSizes?:{deck:number;extra:number}; deckRegistered?:boolean;
  /** Cards that share an identity with another public card of this seat (copies seen). They get a "2×" badge. */
  twinCounts?: ReadonlyMap<string, number>;
  /** Another player's field: turned 180 degrees as on the online board, so it reads from across the table. */
  rotated?: boolean;
  seat: number; name: string; twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined;
  /** Master Rule 5: draw the two Extra Monster Zones and the Pendulum label on the outer Spell/Trap zones. */
  extraZones?: boolean;
  /** The seat that faces this one and shares its Extra Monster Zones. */
  facing?: { name: string; twin: readonly TwinCard[] } | null;
  rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean; selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
  /** Opens the Graveyard or Banished pile viewer. The opener gets focus back when the viewer closes. */
  onPile?: (zone: "graveyard" | "banished", opener: HTMLElement | null) => void;
  /** My own Deck pile was clicked: opens the deck menu. */
  onDeck?: (opener: HTMLElement) => void;
  drag?: FieldDrag;
}) {
  const cells = cellsFor(twin, !!extraZones);
  // A still outline the watcher has not read yet: shown at once as a ghost card, replaced by the real card when it arrives.
  const ghosts = useFieldGhosts(String(seat));
  const ghostCards = ghosts.length ? ghostTwins(ghosts, twin) : [];
  const ghostRefs = new Set(ghostCards.map(card => card.ref));
  const view = ghostCards.length ? cellsFor([...twin, ...ghostCards], !!extraZones) : cells;
  const fieldRef = useRef<HTMLDivElement>(null);
  const dropped = useRef<{ ref: string; at: number } | null>(null);
  useFieldMotion(fieldRef, twin, dropped);
  // Cells that showed a ghost or the "Reading" card last time: the card that replaces it takes over without a drop-in,
  // and a read card fades in over the reading look.
  const shown = useRef<{ ghost: ReadonlySet<string>; reading: ReadonlySet<string> }>({ ghost: new Set(), reading: new Set() });
  const reading = (card: TwinCard | undefined) => !!card && card.faceUp && !cardCode(card) && card.ref.startsWith("fw-");
  const swapped = new Set([...shown.current.ghost].filter(key => cells[key as ZoneKey]?.card));
  const revealed = new Set([...shown.current.reading].filter(key => cells[key as ZoneKey]?.card && !reading(cells[key as ZoneKey].card)));
  useEffect(() => {
    const keys = Object.keys(view) as ZoneKey[];
    shown.current = {
      ghost: new Set(keys.filter(key => !cells[key].card && view[key].card && !isPile(key))),
      reading: new Set(keys.filter(key => !isPile(key) && (reading(cells[key].card) || (!cells[key].card && view[key].card?.faceUp)))),
    };
  });
  const backs=useFieldBacks(seat),missingPiles=useMissingPiles(seat);
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
      return el && Number(el.dataset.seat) === seat && !el.dataset.ghost ? (el.dataset.zone as ZoneKey) : null;
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
      if (over) { dropped.current = { ref: card.ref, at: Date.now() }; dnd.drop(card, over, dnd.judge(card, over)); }
    };
    const up = (e: PointerEvent) => finish(e, false); const cancel = (e: PointerEvent) => finish(e, true);
    // A long press opens the card menu. It wins over a drag that starts after the pause.
    const menu = () => { cleanup(); if (started) setDragging(null); };
    const cleanup = () => { window.removeEventListener("pointermove", onMove); window.removeEventListener("pointerup", up); window.removeEventListener("pointercancel", cancel); window.removeEventListener("contextmenu", menu); stop.current = null; };
    window.addEventListener("pointermove", onMove); window.addEventListener("pointerup", up); window.addEventListener("pointercancel", cancel); window.addEventListener("contextmenu", menu);
    stop.current = cleanup;
  }
  const carried = carry ? twin.find(card => card.ref === carry) : undefined;
  /** A click or Enter on a cell. The Graveyard and Banished cells open the pile viewer (they have no card of their own). */
  function activate(key: ZoneKey, card: TwinCard | undefined, opener: HTMLElement | null) {
    if ((key === "gy" || key === "ban") && onPile) onPile(key === "gy" ? "graveyard" : "banished", opener); else if (key === "deck" && onDeck && opener) onDeck(opener); else onActivate(key, card);
  }
  function dropCarried(key: ZoneKey) {
    const card = carried; setCarry(null);
    if (card && dnd) { dropped.current = { ref: card.ref, at: Date.now() }; dnd.drop(card, key, dnd.judge(card, key)); }
  }
  function move(event: KeyboardEvent<HTMLDivElement>, key: ZoneKey) {
    let next: ZoneKey | null = null;
    // A turned field: the arrow keys follow what the player sees.
    const turned: Record<string, string> = { ArrowLeft: "ArrowRight", ArrowRight: "ArrowLeft", ArrowUp: "ArrowDown", ArrowDown: "ArrowUp" };
    const arrow = rotated ? turned[event.key] ?? event.key : event.key;
    if (key === "e1" || key === "e2") {
      // The Extra Monster Zones sit above Main Monster Zone 2 and 4.
      if (arrow === "ArrowRight" && key === "e1") next = "e2"; else if (arrow === "ArrowRight" && key === "e2") next = "ban"; else if (arrow === "ArrowLeft" && key === "e2") next = "e1";
      else if (arrow === "ArrowDown") next = key === "e1" ? "m2" : "m4";
    } else if (key === "ban") {
      // Banished sits above the Graveyard, at the right end of the Extra Monster row.
      if (arrow === "ArrowDown") next = "gy"; else if (arrow === "ArrowLeft" && extraZones) next = "e2";
    } else {
      const i = ZK.indexOf(key as (typeof ZK)[number]);
      if (key === "gy" && arrow === "ArrowUp") next = "ban";
      else if (arrow === "ArrowRight" && i % 7 < 6) next = ZK[i + 1];
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
    if (carried && !event.currentTarget.dataset.ghost && (event.key === "Enter" || event.key === " ")) { event.preventDefault(); event.stopPropagation(); dropCarried(key); return; }
    if ((event.key === "m" || event.key === "M") && !event.ctrlKey && !event.metaKey && !event.altKey && card && dnd?.can(card) && !isPile(key)) { event.preventDefault(); setCarry(card.ref); return; }
    if (event.key === "Enter" || event.key === " ") { event.preventDefault(); if (event.currentTarget.dataset.ghost) return; activate(key, card, event.currentTarget); }
    else if ((event.key === "a" || event.key === "A") && !event.ctrlKey && !event.metaKey && card) { event.preventDefault(); onAttack(key, card); }
    else if ((event.key === "i" || event.key === "I") && card) { event.preventDefault(); onInspect(card); }
  }
  const drawn = new Set(Object.values(cells).map(cell => cell.card?.ref).filter(Boolean));
  const extras = EXTRA_ZONES.filter(zone => zone.id !== "hand" && zone.id !== "hand-reveal").map(zone => ({ ...zone, cards: twin.filter(card => card.zone === zone.id && !drawn.has(card.ref)) })).filter(zone => zone.cards.length);
  // Zone rules (docs/remote-duels/zone-rules.md): soft marks, Trap Monster zones and Equip links.
  const equipSource = equipSourceOnField(twin, card => info(cardCode(card)));
  const nameOf = (card: TwinCard) => card.faceUp || card.publicIdentity ? cardName(card, info(cardCode(card))) : "a face-down card";
  const seatsOnBoard = boardSeats ?? [{ seat, twin }];
  const linkTarget = (link: { seat: number; ref: string }) => seatsOnBoard.find(other => other.seat === link.seat)?.twin.find(card => card.ref === link.ref);
  const keys: ZoneKey[] = [...(extraZones ? EK : []), ...ZK, ...BK];
  return <>
    <div ref={fieldRef} className={s.field} role="group" onClickCapture={event => { if (swallow.current) { event.stopPropagation(); event.preventDefault(); } }} aria-label={`${name}'s virtual field`} data-testid={`field-${seat}`} data-rows="3" data-emz={extraZones ? "on" : undefined} data-rotated={rotated ? "on" : undefined}>
      {keys.map(key => {
        const cell = cells[key]; const card = cell.card; const pile = isPile(key);
        const ghost = !card && !pile ? view[key].card : undefined;
        const cardInfo = card ? info(cardCode(card)) : undefined;
        const unknown = !!card && card.faceUp && !cardCode(card) && !card.token;
        const down = !!card && !card.faceUp;
        const monsterZone = isMonsterZone(key); const emzCell = key === "e1" || key === "e2";
        // The board mirrors the mat: a sideways card is drawn sideways in any cell. Moves out of a Monster Zone reset the position (leavePosition).
        const defense = (!!card && card.position === "defense" && !pile) || ghost?.position === "defense";
        const taken = emzCell && !card ? facing?.twin.find(other => other.zone === "extra-monster" && other.slot === mirrorEmz(Number(key[1]))) : undefined;
        const carriedHere = !!carried && rv === key;
        const trapHolder = !card && /^s[1-5]$/.test(key) ? twin.find(other => other.trapZone === Number(key[1]) && (other.zone === "monster" || other.zone === "extra-monster")) : undefined;
        const zoneCheck = card && !pile && cardCode(card) && (card.faceUp || card.publicIdentity) ? fieldZoneCheck(cardInfo, card.zone, card.slot, { faceDown: !card.faceUp, equipSource, equipped: !!card.equippedTo }) : undefined;
        const equipped = card && !pile ? seatsOnBoard.flatMap(other => other.twin.filter(item => item.equippedTo?.seat === seat && item.equippedTo.ref === card.ref)) : [];
        const target = card?.equippedTo ? linkTarget(card.equippedTo) : undefined;
        const dropClass = dragging?.over === key && dragging.verdict ? VERDICT_CLASS[dragging.verdict] : carriedHere && dnd ? VERDICT_CLASS[dnd.judge(carried!, key).kind] : "";
        const stacked=pile&&(cell.count>=2||((key==='deck'||key==='ex')&&((deckListSizes?.[key==='deck'?'deck':'extra']??0)>=2||deckRegistered)));
        const classes = [s.zc, stacked?s.pileStack:'', dropClass, card && dnd?.can(card) && !isPile(key) ? s.drg : "", card && (dragging?.ref === card.ref || carry === card.ref) ? s.dragSrc : "", emzCell ? s.ez : "", taken ? s.taken : "", card && !down ? s.clk : "", defense ? s.def : "", card && card.ref === selectedRef ? s.sel : "", card && card.ref === targetRef ? s.tgt : "",
          picking && monsterZone && card ? s.pickTarget : "", card && card.ref === freshRef && !swapped.has(key) ? s.scanin : "", card && landed.has(card.ref) && !swapped.has(key) ? s.land : "", ghost ? s.ghosted : "", card && revealed.has(key) ? s.reveal : "", zoneCheck || card?.equippedTo || equipped.length ? z.cell : ""].filter(Boolean).join(" ");
        let desc = taken ? `shared with ${facing!.name}: taken by their monster` : trapHolder ? `occupied by ${nameOf(trapHolder)} (Trap Monster)` : "empty";
        if (ghost) desc = ghost.faceUp ? "reading a card" : "a face-down card";
        let inner: React.ReactNode = ghost ? <GhostCard faceUp={ghost.faceUp} /> : <span className={s.zl}>{taken ? <>EMZ<small>{facing!.name} has it</small></> : key === "ex" ? <>EXTRA<small>DECK</small></> : zoneLabel(key)}{extraZones && isPendulumCell(key) ? <small>PZ</small> : null}</span>;
        const deckPile=key==='deck'||key==='ex';
        const listed=deckPile?deckListSizes?.[key==='deck'?'deck':'extra']:undefined;
        const observedPile=deckPile&&backs.some(back=>back.zone===(key==='deck'?'DECK':'EXTRA'));
        const offMat=deckPile&&missingPiles.includes(key==='deck'?'DECK':'EXTRA');
        if (pile && (cell.count||observedPile||deckPile&&deckRegistered||(listed??0)>0)) {
          const topZone = key === "gy" ? "graveyard" : key === "ban" ? "banished" : undefined;
          const top = topZone ? [...twin].reverse().find(item => item.zone === topZone) : undefined;
          const topInfo = top && top.faceUp && cardCode(top) ? info(cardCode(top)) : undefined;
          const count=deckPile?undefined:(cell.count||undefined);
          desc = deckPile ? (offMat?'Not on the mat (camera)':listed!==undefined?`Face-down pile. Registered deck: ${listed} cards`:"Face-down pile") : topZone && top ? `${cell.count} cards, top card ${top.faceUp ? cardName(top, topInfo) : "face-down"}. Press Enter to open the pile` : count===undefined?'Face-down pile':`${count} cards`;
          inner = <>{top && top.faceUp && cardCode(top) ? <CardFace card={top} info={topInfo} /> : <div data-testid={deckPile?'deck-pile':undefined} className={`${s.cd} ${s.back} ${key === "ex" ? s.backEx : ""}`} />}{count!==undefined?<span className={s.cnt}>{count}</span>:null}<span className={s.pl}>{key === "ex" ? "EXTRA DECK" : zoneLabel(key)}</span></>; }
        else if (unknown) {
          const reading = card.ref.startsWith("fw-");
          desc = reading ? "reading a card. Press Enter to identify" : "unidentified card. Press Enter to identify"; inner = <div className={`${s.cd} ${s.unk} ${reading ? s.reading : ""}`}><span>{reading ? "Reading\u2026" : "?"}</span></div>;
        }
        else if (down) {
          const origin=card.publicIdentity && card.setBy && cardCode(card) ? `Set from Deck by ${card.setBy.name}: ${cardName(card,cardInfo)}` : card.setBy ? `Set by ${card.setBy.name}` : "";
          desc = `Face-down${card.bestMatch && cardCode(card)?" · Best match":""}${card.publicIdentity && cardCode(card) && !card.setBy ? " · Revealed" : ""}${origin ? " · "+origin : ""}${cardCode(card) && (!card.publicIdentity || !card.setBy) ? " · "+cardName(card,cardInfo) : ""}`;
          inner = <>{cardCode(card) ? <div className={s.knownDown}><CardFace card={card} info={cardInfo} /></div> : <div className={`${s.cd} ${s.back}`} />}
            <span className={`${s.originLabel} ${!origin&&card.publicIdentity?s.revealedChip:""}`} data-testid={!origin&&card.publicIdentity?"revealed-chip":undefined}>{origin || (card.publicIdentity?"Revealed":"Face-down")}</span></>;
        }
        else if (card) {
          const stats = statsOf(card, cardInfo);
          desc = cardName(card, cardInfo) + (card.token ? " (token)" : "") + (hasBattleStats(cardInfo) || card.token ? (defense ? ", defense position" : ", attack position") : "") + (stats ? `, ${statsText(stats)}` : "");
          inner = <><CardFace card={card} info={cardInfo} stats="none" />{stats ? <StatPlate stats={stats} turned={rotated} /> : null}</>; }
        else if (trapHolder) inner = <div className={z.held} data-testid="trap-zone-held"><small>{zoneLabel(key)} · TRAP MONSTER</small><b>{nameOf(trapHolder)}</b></div>;
        if (card && zoneCheck) desc += `. Check zone: ${zoneCheck}`;
        if (card?.equippedTo) desc += `. Equipped to ${target ? nameOf(target) : "a monster"}`;
        if (equipped.length) desc += `. Equipped with ${equipped.map(nameOf).join(", ")}`;
        return <div key={key} className={classes} style={offMat?{opacity:.35}:undefined} data-off-mat={offMat?'on':undefined} role="button" tabIndex={rv === key ? 0 : -1} data-z={key} data-zone={key} data-seat={seat} data-ref={card && !pile ? card.ref : undefined} data-up={card?.faceUp ? "1" : "0"} data-def={defense ? "1" : "0"} data-ghost={ghost ? "on" : undefined} data-row={emzCell || key === "ban" ? undefined : ZK.indexOf(key as (typeof ZK)[number]) < 7 ? 1 : 2}
          title={desc} aria-label={`${name}, ${ZN[key]}${extraZones && isPendulumCell(key) ? " (Pendulum zone)" : ""}: ${desc}`} onFocus={() => onRv(key)} onKeyDown={event => move(event, key)} onClick={event => { if (ghost) return; if (carried) dropCarried(key); else activate(key, card, event.currentTarget); }} onPointerDown={card ? event => begin(event, card) : undefined}>
          {inner}
          {zoneCheck ? <span className={`${z.check} ${down ? z.checkHigh : ""}`} data-testid="zone-check" title={`${zoneCheck} Click the card for details.`}><span aria-hidden="true" className={z.checkIcon}>?</span><span className={z.checkText}>Check zone?</span></span> : null}
          {card?.equippedTo ? <span className={z.link} data-testid="equip-link" title={`Equipped to ${target ? nameOf(target) : "a monster"}`}>Equip → {target ? nameOf(target) : "monster"}</span>
            : equipped.length ? <span className={z.link} data-testid="equip-link" title={`Equipped with ${equipped.map(nameOf).join(", ")}`}>+{equipped.length} Equip</span> : null}
          {key === "gy" && cells.gy.count && twinCounts && twin.some(card => card.zone === "graveyard" && twinCounts.has(card.ref)) ? <span className={s.dupb} data-testid="dup-badge" title="A card here has a copy on the field">{Math.max(...twin.filter(card => card.zone === "graveyard").map(card => twinCounts.get(card.ref) ?? 0))}×</span> : null}{card && twinCounts?.has(card.ref) ? <span className={s.dupb} data-testid="dup-badge" title={`${twinCounts.get(card.ref)} cards with this name`}>{twinCounts.get(card.ref)}×</span> : null}{card && warnRefs.has(card.ref) ? <span className={s.nidm} title="Not in decklist">!</span> : null}{card?.materials?.length ? <span className={s.matb} data-testid="material-badge" title={`${card.materials.length} Xyz material${card.materials.length === 1 ? "" : "s"}. Open the card to detach one`}>{card.materials.length} mat.</span> : null}
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

/** The first look at a card the watcher sees but has not read: a card back with a soft shimmer, turned as the card lies. */
function GhostCard({ faceUp }: { faceUp: boolean }) {
  return faceUp ? <div className={`${s.cd} ${s.unk} ${s.reading}`}><span>Reading{"\u2026"}</span></div> : <div className={`${s.cd} ${s.back} ${s.shimmer}`} />;
}

/** The card that follows the pointer while it is dragged. */
export function DragGhost({ card, info, x, y, verdict }: { card: TwinCard | undefined; info: (id: number | undefined) => CardInfo | undefined; x: number; y: number; verdict: Verdict["kind"] | null }) {
  if (!card) return null;
  const code = cardCode(card);
  return <div className={`${s.ghost} ${verdict ? VERDICT_CLASS[verdict] : ""}`} data-testid="drag-ghost" style={{ left: x, top: y }} aria-hidden="true">
    {code && card.faceUp ? <img src={cardArt(code, "small")} alt="" draggable={false} /> : <div className={`${s.cd} ${s.back}`} />}
    <span>{card.faceUp ? cardName(card, info(code)) : "Face-down card"}</span>
  </div>;
}

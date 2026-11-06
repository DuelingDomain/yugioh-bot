"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type MouseEvent, type ReactNode } from "react";
import { ScanLine } from "lucide-react";
import { useFieldScan, useMissingPiles } from "@/lib/remote/zone-grid";
import { Feed, type BoardReading, type FeedHit, type FeedMark, type FeedPoint, type FeedReticle, type FeedStart } from "./feed";
import { HoloField, type FieldDrag } from "./holo-field";
import { Icon } from "./icons";
import { cardCode, cardName, cellsFor, isPile, sg, MINUS, ZN, type TwinCard, type ZoneKey } from "./model";
import type { CardInfo } from "./catalog";
import type { Health } from "./video-hub";
import { NotifyDock } from "./notify-dock";
import { HandCount, HandStrip, type HandProps } from "./hand-ui";
import s from "./remote-ui.module.css";

export const LP_STEPS: { delta: number; kind: string }[] = [
  { delta: -1000, kind: `${s.m} ${s.x}` }, { delta: -500, kind: s.m }, { delta: -100, kind: s.m }, { delta: 100, kind: s.p }, { delta: 500, kind: `${s.p} ${s.x}` },
];

/** Parses the custom LP box. A bare number takes LP away. A leading plus adds LP. */
export function parseLpInput(raw: string): number | null {
  const text = raw.trim().replace(/[−–]/g, "-"); if (!text) return null;
  const amount = parseInt(text.replace(/[^\d]/g, ""), 10); if (!amount) return null;
  return text.startsWith("+") ? amount : -amount;
}

export type SeatUndo = { label: string; enabled: boolean; reason?: string; onUndo: () => void };

export type SeatPanelProps = {
  /** Called with this seat's notification slot (a portal target) when it mounts and unmounts. Not rendered in webcam only. */
  onDock?: (seat: number, node: HTMLElement | null) => void;
  index: number; seat: number; name: string; color: string; you: boolean; turn: boolean; next: boolean; speaking: boolean; frozen: boolean; eliminated: boolean;
  lp: number; startingLp: number; health: Health; healthOpen: boolean; onHealth: (button: HTMLElement) => void;
  marks: FeedMark[]; reticles: FeedReticle[]; onBegin: (seat: number, start: FeedStart) => number; readLive: (id: number) => boolean; onAbort: (seat: number, id: number) => void; onMiss: (seat: number) => void; onSearch: (seat: number, start: FeedStart) => void; onPoint: (seat: number, x: number, y: number, extra: FeedPoint) => void; onSelect: (seat: number, hit: FeedHit) => void; holdSelection: boolean; onAdd: (mark: FeedMark) => void; onReset: (seat: number) => void; onReadBoard?: (seat: number, reading: BoardReading) => Promise<string>;
  twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined; extraZones?: boolean; facing?: { name: string; twin: readonly TwinCard[] } | null; boardSeats?: readonly { seat: number; twin: readonly TwinCard[] }[]; rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean;
  selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>; pickPlate: boolean; plateRef?: (el: HTMLButtonElement | null) => void;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
  onPile?: (zone: "graveyard" | "banished", opener: HTMLElement | null) => void;
  drag?: FieldDrag;
  /** Cards with a same-identity twin on this field (ref to count). */
  twinCounts?: ReadonlyMap<string, number>; deckListSizes?:{deck:number;extra:number}; deckRegistered?:boolean;
  onPlate: () => void; onLp: (delta: number) => void; canLp: boolean;
  /** Names the table shape (2, 3 or 4 seats) so the remembered view is per viewer, seat and shape. */ viewScope?: string;
  /** Undo on the player's own seat. Same action as the dock Undo. Set only for the viewer's seat. */
  undo?: SeatUndo;
  /** The virtual field is hidden (the default). The camera feed takes its space. */ webcamOnly?: boolean;
  /** Switches Both and Webcam only (shortcut W). */ onToggleView?: () => void;
  /** A camera click on a card the table knows (both views). Webcam only also uses the camera for hover info and piles. Right click or long press opens the card actions (always). Same shapes as on the feed. */
  onZoneCard?: ComponentProps<typeof Feed>["onZoneCard"]; onCamPick?: ComponentProps<typeof Feed>["onPick"]; hoverTip?: ComponentProps<typeof Feed>["hoverTip"]; onCardMenu?: ComponentProps<typeof Feed>["onCardMenu"];
  /** Revealed in hand: cards added by effects or returned from the field, the hand count and (own seat) the add chip. */
  hand?: HandProps;
  deckWarning?: string; onDeckFlag?: (button: HTMLElement) => void; cameraControl?: ReactNode; emptyFeedText: string; emptyFeedAction?: ReactNode; turnIn: boolean;
};

/** Camera first (default) or enlarged field, per viewer and seat. Remembered in this browser only. */
function useFieldView(key: string) {
  const [field, setField] = useState(false); const [swapping, setSwapping] = useState(false);
  useEffect(() => { try { setField(localStorage.getItem(key) === "field"); } catch { /* storage blocked: stay camera first */ } }, [key]);
  useEffect(() => { if (!swapping) return; const timer = setTimeout(() => setSwapping(false), 420); return () => clearTimeout(timer); }, [swapping]);
  const set = useCallback((next: boolean) => {
    setField(next); setSwapping(true);
    try { if (next) localStorage.setItem(key, "field"); else localStorage.removeItem(key); } catch { /* storage blocked: not remembered */ }
  }, [key]);
  return [field, set, swapping] as const;
}

export function SeatPanel(p: SeatPanelProps) {
  const [fieldViewPref, setFieldView, swapping] = useFieldView(`dd-remote-view:${p.viewScope ?? "x"}:${p.seat}`);
  const fieldView = fieldViewPref && !p.webcamOnly;
  const scan = useFieldScan(p.seat), missingPiles = useMissingPiles(p.seat);
  // Webcam only, while this seat can be attacked: the list of its monsters is on the feed, because a feed without a camera or outlines cannot be clicked.
  const targeting = !!p.webcamOnly && p.picking && !p.eliminated;
  const listed = p.webcamOnly ? (Object.entries(cellsFor(p.twin, !!p.extraZones)) as [ZoneKey, { card?: TwinCard } | undefined][]).flatMap(([key, cell]) =>
    cell?.card && !isPile(key) && (!targeting || cell.card.zone === "monster" || cell.card.zone === "extra-monster") ? [{ key, card: cell.card }] : []) : [];
  const cardList = p.webcamOnly ? <ul className={`${s.wclist} ${targeting ? s.wctargets : ""}`} aria-label={targeting ? `Attack targets on ${p.name}'s field` : `${p.name}'s cards on the field`} data-testid={`wc-cards-${p.seat}`} data-targets={targeting || undefined}>
    {targeting ? <li className={s.wclab}>{listed.length ? "Attack target:" : "No monsters on this field"}</li> : null}
    {listed.map(({ key, card }) => <li key={card.ref}><button type="button" onClick={() => { if (targeting) p.onActivate(key, card); else p.onInspect(card); }}>{`${ZN[key]}: ${cardName(card, p.info(cardCode(card)))}`}</button></li>)}
  </ul> : null;
  // A click on the empty field or its frame enlarges it. Cards, zones that hold a card, buttons and a pending attack pick keep their own click.
  const enlargeFromField = (event: MouseEvent<HTMLElement>) => {
    if (fieldView || p.picking) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, a, input, select, textarea")) return;
    const zone = target.closest("[data-zone]");
    if (zone && zone.querySelector(`.${s.cd}`)) return;
    setFieldView(true);
  };
  const previous = useRef(p.lp); const [delta, setDelta] = useState(0); const [input, setInput] = useState("");
  useEffect(() => {
    if (previous.current === p.lp) return;
    setDelta(p.lp - previous.current); previous.current = p.lp;
    const timer = setTimeout(() => setDelta(0), 2400); return () => clearTimeout(timer);
  }, [p.lp]);
  const gy = p.twin.filter(card => card.zone === "graveyard").length; const banished = p.twin.filter(card => card.zone === "banished").length;
  const low = p.lp < 2500; const width = Math.min(100, Math.max(0, (p.lp / Math.max(1, p.startingLp)) * 100));
  const label = (value: number) => `${p.name} ${value < 0 ? "minus" : "plus"} ${Math.abs(value)}`;
  const classes = [s.seat, s[`s${p.index}`], p.turn ? s.turn : "", p.turn && p.turnIn ? s.turnIn : "", p.next ? s.next : "", p.speaking ? s.speak : "", p.frozen ? s.frozen : "", p.eliminated ? s.out : ""].filter(Boolean).join(" ");
  return <section className={classes} aria-label={`${p.name}'s seat`} style={{ "--c": p.color } as React.CSSProperties} data-testid={`seat-${p.seat}`} data-turn={p.turn || undefined} data-view={fieldView ? "field" : "camera"} data-wc={p.webcamOnly || undefined} data-swapping={swapping || undefined}>
    <header className={s.sh}>
      <span className={s.pip} /><h2 className={s.nm} style={{ margin: 0 }}>{p.name}</h2>
      {p.you ? <span className={`${s.tag} ${s.you}`}>YOU</span> : null}
      {p.webcamOnly && p.onPile ? <span className={s.wcpiles} role="group" aria-label="Piles" data-testid={`wc-piles-${p.seat}`}>
        <button type="button" onClick={event => p.onPile?.("graveyard", event.currentTarget)} aria-label={`${p.name} Graveyard: ${gy} cards. Open`}>GY <b className={s.num}>{gy}</b></button>
        <button type="button" onClick={event => p.onPile?.("banished", event.currentTarget)} aria-label={`${p.name} Banished: ${banished} cards. Open`}>BAN <b className={s.num}>{banished}</b></button>
      </span> : null}
      {p.webcamOnly && p.pickPlate ? <button type="button" className={`${s.btn} ${s.go} ${s.sm} ${s.wcdirect}`} data-testid={`wc-direct-${p.seat}`} onClick={p.onPlate} aria-label={`Attack ${p.name} directly`}>Attack directly</button> : null}
      <span className={`${s.tag} ${s.turnt}`}>TURN</span><span className={`${s.tag} ${s.nextt}`}>NEXT</span>
      {p.eliminated ? <span className={s.tag}>OUT</span> : null}
      <span className={s.micI}><Icon name="mic" /></span><span className={s.sp} />
      {p.undo ? <button type="button" className={s.sundo} disabled={!p.undo.enabled} onClick={p.undo.onUndo} data-testid="seat-undo"
        aria-label={p.undo.enabled ? `Undo: ${p.undo.label}. ${p.undo.reason ? p.undo.reason + ". " : ""}Shortcut Ctrl Z` : "Nothing to undo"}
        title={p.undo.enabled ? (p.undo.reason ?? "Undo your last action (Ctrl+Z)") : "Nothing to undo"}>
        <Icon name="undo" /><span className={s.sul} data-testid="seat-undo-label">{p.undo.enabled ? `Undo: ${p.undo.label}` : "Nothing to undo"}</span></button> : null}
      {p.onToggleView ? <button type="button" className={`${s.vtog} ${s.vhide}`} data-testid={`field-toggle-${p.seat}`} onClick={p.onToggleView} aria-keyshortcuts="W"
        title={p.webcamOnly ? "Show the virtual fields (beta) (W). Card recognition does not need them." : "Hide the virtual fields (beta). The camera takes the screen (W)"}>
        <span>{p.webcamOnly ? "Show" : "Hide"} <span className={s.vlong}>virtual </span>field</span> <span className={s.vbeta}>Beta</span> <kbd>W</kbd></button> : null}
      {p.webcamOnly ? null : <button type="button" className={s.vtog} data-testid={`view-toggle-${p.seat}`} onClick={() => setFieldView(!fieldView)}
        title={fieldView ? "Show the camera large again" : "Show the virtual field large and the camera small"}>{fieldView ? "Camera view" : "Enlarge field"}</button>}
      <button type="button" className={`${s.hl} ${s[p.health.q] ?? ""}`} aria-haspopup="dialog" aria-expanded={p.healthOpen} data-hl={p.seat}
        aria-label={`${p.name} feed: ${p.health.label}${p.health.detail ? `, ${p.health.detail}` : ""}. Open feed health`} onClick={event => p.onHealth(event.currentTarget)}>
        <span className={s.sig}><i /><i /><i /><i /></span><i className={s.hlt}>{p.health.label}</i>
      </button>
    </header>
    {p.onDock ? <NotifyDock seat={p.seat} onSlot={p.onDock} view={`${p.webcamOnly ? "webcam" : "both"}:${fieldView ? "field" : "camera"}`} /> : null}
    <div className={s.sbody}>
      <Feed seat={p.seat} name={p.name} you={p.you} health={p.health} marks={p.marks} reticles={p.reticles} onBegin={p.onBegin} readLive={p.readLive} onAbort={p.onAbort} onMiss={p.onMiss} onSearch={p.onSearch} onPoint={p.onPoint} onSelect={p.onSelect} holdSelection={p.holdSelection} onAdd={p.onAdd} onReset={p.onReset} onReadBoard={p.onReadBoard} onZoneCard={p.onZoneCard} onPick={p.webcamOnly ? p.onCamPick : undefined} hoverTip={p.webcamOnly ? p.hoverTip : undefined} onCardMenu={p.onCardMenu} emptyText={p.emptyFeedText} emptyAction={p.emptyFeedAction}
        below={p.cameraControl}
        extra={<>
          {fieldView ? <button type="button" className={s.swapcam} tabIndex={-1} aria-label="Camera view: show the camera large again" data-testid={`swap-cam-${p.seat}`} onClick={() => setFieldView(false)} /> : null}
          {targeting ? cardList : null}
          {p.webcamOnly && missingPiles.length ? <div className={s.wcoffmat} role="status" data-testid={`wc-off-mat-${p.seat}`}>{`${missingPiles.map(zone => zone === "DECK" ? "Deck" : "Extra Deck").join(" and ")} not on the mat`}</div> : null}
          {p.webcamOnly && p.hand ? <HandStrip seat={p.seat} name={p.name} hand={{ ...p.hand, overlay: true }} /> : null}
          <div className={s.fz} aria-live="off">FEED FROZEN<small>Last good frame shown</small></div>
          <div className={`${s.dwarn} ${p.deckWarning ? s.on : ""}`} data-testid="deck-warning" role={p.deckWarning ? "status" : undefined}>
            {p.deckWarning ? <><Icon name="warn" /><span><b>Deck no longer valid:</b> {p.deckWarning}</span>
              {p.onDeckFlag ? <button type="button" className={s.dwbtn} data-layer-opener data-testid="deck-warning-open" onClick={event => p.onDeckFlag?.(event.currentTarget)}>Review</button> : null}</> : null}
          </div>
        </>} />
      <div className={s.fside}>
        {targeting ? null : cardList}
        <div className={s.fboard}>
        {scan ? <button type="button" className={s.scanbtn} aria-disabled={scan.scanning || !scan.ready} aria-keyshortcuts="S" aria-label={scan.scanning ? "Scanning field" : scan.ready ? "Scan field" : "Scan field, camera off"} onClick={() => { if (scan.ready && !scan.scanning) scan.scan?.(); }} data-testid="field-scan"
          title={scan.ready ? "Compare the camera with the board now and fix differences (S)" : "Turn the camera on to scan the field"}>
          <ScanLine size={15} strokeWidth={1.8} aria-hidden="true" /><span>{scan.scanning ? "Scanning…" : "Scan field"}</span>
          {scan.ready ? <kbd aria-hidden="true">S</kbd> : <small>Camera off</small>}</button> : null}
        <div className={s.fwrap} onClick={enlargeFromField} data-rail={scan ? "" : undefined} data-testid={`fwrap-${p.seat}`}>
          <div className={s.holo}>
            <i className={`${s.corner} ${s.a}`} /><i className={`${s.corner} ${s.b}`} /><i className={`${s.corner} ${s.c}`} /><i className={`${s.corner} ${s.d}`} />
            <button type="button" ref={p.plateRef} className={`${s.fplate} ${p.pickPlate ? s.pick : ""}`} tabIndex={p.pickPlate ? 0 : -1} data-plate={p.seat} onClick={p.onPlate}
              aria-label={p.pickPlate ? `Attack ${p.name} directly` : `${p.name}, ${p.lp} life points`}><span className={s.pip} />{p.name} <span className={s.num}>{p.lp}</span></button>
            <HoloField seat={p.seat} name={p.name} twin={p.twin} info={p.info} extraZones={p.extraZones} facing={p.facing} rv={p.rv} onRv={p.onRv} picking={p.picking} selectedRef={p.selectedRef} targetRef={p.targetRef}
              freshRef={p.freshRef} warnRefs={p.warnRefs} onActivate={p.onActivate} onAttack={p.onAttack} onInspect={p.onInspect} onPile={p.onPile} drag={p.drag} rotated={!p.you} twinCounts={p.twinCounts} deckListSizes={p.deckListSizes} deckRegistered={p.deckRegistered} boardSeats={p.boardSeats} />
          </div>
          <div className={s.projector} />
        </div>
        </div>
        {p.hand ? (p.webcamOnly ? <HandCount seat={p.seat} hand={p.hand} /> : <HandStrip seat={p.seat} name={p.name} hand={p.hand} />) : null}
        <div className={s.lp} data-testid={`lp-${p.seat}`}>
          <div className={s.lpmain}>
            <span className={s.lpl}>LP</span>
            <span className={`${s.lpn} ${s.num} ${low ? s.low : ""} ${delta < 0 ? s.loss : delta > 0 ? s.gain : ""}`} data-testid={`lp-value-${p.seat}`} data-lp-seat={p.seat}>{p.lp}</span>
            <span className={`${s.lpd} ${s.num} ${delta ? s.show : ""} ${delta > 0 ? s.gain : ""}`} aria-hidden="true">{delta ? sg(delta) : ""}</span>
            <input className={s.lpin} inputMode="numeric" placeholder={`${MINUS}/+ amount`} aria-label={`Custom LP change for ${p.name}. A plus sign adds. A number alone takes away. Press Enter.`}
              value={input} disabled={!p.canLp} onChange={event => setInput(event.target.value)}
              onKeyDown={event => { if (event.key !== "Enter") return; const value = parseLpInput(input); if (value === null) return; p.onLp(value); setInput(""); }} />
          </div>
          <div className={`${s.lpbar} ${low ? s.low : ""}`}><i style={{ width: `${width}%` }} /></div>
          <div className={s.lpbtn}>
            {LP_STEPS.map(step => <button type="button" key={step.delta} className={step.kind} disabled={!p.canLp} aria-label={label(step.delta)} onClick={() => p.onLp(step.delta)}>{sg(step.delta)}</button>)}
          </div>
        </div>
      </div>
    </div>
  </section>;
}

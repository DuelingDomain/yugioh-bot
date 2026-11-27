"use client";

import { useCallback, useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { CircleHelp, Hand, Pencil, ScanLine } from "lucide-react";
import { useFieldScan, useMissingPiles } from "@/lib/remote/zone-grid";
import { useScanAdvice } from "@/lib/remote/scan-advice";
import { CameraToolsMenu, type CameraMenuSetup } from "./camera-tools-menu";
import { Feed, type BoardReading, type FeedHit, type FeedMark, type FeedPoint, type FeedReticle, type FeedStart } from "./feed";
import { HoloField, type FieldDrag } from "./holo-field";
import { Icon } from "./icons";
import { cardCode, cardName, cellsFor, isPile, sg, MINUS, ZN, type TwinCard, type ZoneKey } from "./model";
import type { CardInfo } from "./catalog";
import type { Health } from "./video-hub";
import { NotifyDock } from "./notify-dock";
import { HandStrip, type HandProps } from "./hand-ui";
import { TapBoardNote } from "./tap-mode-banner";
import { SeatSplitter, clampSplit, readSplit, writeSplit, type SplitBox } from "./seat-splitter";
import { modeLabel, modeShort, type TournamentMode } from "@/lib/remote/tournament-detection";
import { ThinkingChip } from "./think";
import { LifePoints } from "@/components/duel/life-points";
import { usePrefersReducedMotion } from "@/lib/motion";
import s from "./remote-ui.module.css";
import type { SeatFocus } from "./seat-focus";

export const LP_STEPS: { delta: number; kind: string }[] = [
  { delta: -1000, kind: `${s.m} ${s.x}` }, { delta: -500, kind: s.m }, { delta: -100, kind: s.m }, { delta: 100, kind: s.p }, { delta: 500, kind: `${s.p} ${s.x}` },
];

/** Parses the custom LP box. A bare number takes LP away. A leading plus adds LP. */
export function parseLpInput(raw: string): number | null {
  const text = raw.trim().replace(/[−–]/g, "-"); if (!text) return null;
  const amount = parseInt(text.replace(/[^\d]/g, ""), 10); if (!amount) return null;
  return text.startsWith("+") ? amount : -amount;
}

/** Tournament table: the mode a player announced, shown on the nameplate. */
export function DetectionBadge({ seat, name, mode }: { seat: number; name: string; mode?: TournamentMode }) {
  const Glyph = mode === "tap" ? Hand : mode === "auto" ? ScanLine : mode === "manual" ? Pencil : CircleHelp;
  return <span className={`${s.tag} ${s.dmode} ${mode === "auto" ? "" : s.tap}`} data-testid={`detection-mode-${seat}`} role="img" aria-label={`${name} detection: ${modeLabel(mode)}`} title={`${name} detection: ${modeLabel(mode)}`}>
    <Glyph size={11} strokeWidth={2} aria-hidden />{modeShort(mode)}</span>;
}

export type SeatPanelProps = {
  /** Called with this seat's notification slot (a portal target) when it mounts and unmounts. Not rendered in webcam only. */
  onDock?: (seat: number, node: HTMLElement | null) => void;
  index: number; seat: number; name: string; color: string; you: boolean; turn: boolean; next: boolean; speaking: boolean; frozen: boolean; eliminated: boolean;
  lp: number; startingLp: number; health: Health; healthOpen: boolean; onHealth: (button: HTMLElement) => void;
  marks: FeedMark[]; reticles: FeedReticle[]; onBegin: (seat: number, start: FeedStart) => number; readLive: (id: number) => boolean; onAbort: (seat: number, id: number) => void; onMiss: (seat: number) => void; onSearch: (seat: number, start: FeedStart) => void; onPoint: (seat: number, x: number, y: number, extra: FeedPoint) => void; onSelect: (seat: number, hit: FeedHit) => void; holdSelection: boolean; onAdd: (mark: FeedMark) => void; onReset: (seat: number) => void; onReadBoard?: (seat: number, reading: BoardReading) => Promise<string>;
  twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined; extraZones?: boolean; facing?: { name: string; twin: readonly TwinCard[] } | null; boardSeats?: readonly { seat: number; twin: readonly TwinCard[] }[]; owners?: readonly { seat: number; name: string; color: string }[]; rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean;
  selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>; pickPlate: boolean; plateRef?: (el: HTMLButtonElement | null) => void;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
  /** The table is live (not in a match break): only then is my own Deck and Extra shown as mine. */ live?: boolean;
  prereadScope?: string;
  onPile?: (zone: "graveyard" | "banished" | "deck" | "extra", opener: HTMLElement | null) => void;
  /** My own Deck pile on the virtual field was clicked. */ onDeck?: (opener: HTMLElement) => void;
  drag?: FieldDrag;
  /** A token is being placed: free Main Monster Zones glow and take the click. */ tokenSlots?: readonly ZoneKey[];
  /** Cards with a same-identity twin on this field (ref to count). */
  twinCounts?: ReadonlyMap<string, number>; deckListSizes?:{deck:number;extra:number}; deckRegistered?:boolean;
  onPlate: () => void;
  /** My Battle Phase, this seat is an opponent: its webcam gets a red outline and a hint, and a click on it or on its LP attacks directly. `atk` fills the LP box when an attacker is selected. */ direct?: { atk?: number };
  onLp: (delta: number) => void; canLp: boolean;
  /** Server time this player started Thinking (the T key). Shown in the status area under the field. */ thinkingSince?: number;
  /** Names the table shape (2, 3 or 4 seats) so the remembered view is per viewer, seat and shape. */ viewScope?: string;
  /** This player's phase boxes (`PhaseTrack`). They sit between the camera and the virtual field, in every view. */ track?: ReactNode;
  /** The virtual field is hidden (the default). The camera feed takes its space. */ webcamOnly?: boolean;
  /** 1v1 only: the switch for this seat's board (the header button and the webcam "..." menu), also for a seat with no camera. Absent on 3-way and 4-way tables. A seat whose board is off in Tap mode shows it locked. */ onBoard?: (on: boolean) => void;
  /** This player is in Tap mode, so the board is off for everyone: the seat shows its camera like Webcam only, plus a note. My own seat shows no note: the strip under my camera says it and has the Turn on button. */ boardOff?: Record<string, never>;
  /** A camera click on a card the table knows (both views). Webcam only also uses the camera for hover info and piles. Right click or long press opens the card actions (always). Same shapes as on the feed. */
  onHoverEnd?: ComponentProps<typeof Feed>["onHoverEnd"];
  onZoneCard?: ComponentProps<typeof Feed>["onZoneCard"]; onCamPick?: ComponentProps<typeof Feed>["onPick"]; hoverTip?: ComponentProps<typeof Feed>["hoverTip"]; onCardMenu?: ComponentProps<typeof Feed>["onCardMenu"];
  /** Revealed in hand: cards added by effects or returned from the field, the hand count and (own seat) the add chip. */
  hand?: HandProps;
  /** The mode this player announced. Tournament tables show it to the opponent. */ detectionMode?: TournamentMode | "unknown";
  /** Opponent seats only: asks that player's Auto-detect to Scan field again. Absent for my seat, bots and spectators. */ onRescan?: () => Promise<string>;
  /** A tournament table. */ tournamentTable?: boolean;
  /** Multi-seat tables: this seat is the large one (3-way desktop) or a tile (phone focus view), and how a click makes it the large one. */ focus?: SeatFocus;
  deckWarning?: string; onDeckFlag?: (button: HTMLElement) => void; /** My camera menu: camera choice, side and admin tools (my own seat only). */ cameraSetup?: CameraMenuSetup; /** Opens the token dialog for this seat's field (the camera "..." menu). */ onToken?: () => void; emptyFeedText: string; emptyFeedAction?: ReactNode; turnIn: boolean;
};

/** Camera first (default) or enlarged field, per viewer and seat. Remembered in this browser only. */
function useFieldView(key: string) {
  const [field, setField] = useState(false); const [swapping, setSwapping] = useState(false);
  useEffect(() => { try { setField(localStorage.getItem(key) === "field"); } catch { /* storage blocked: stay camera first */ } }, [key]);
  useEffect(() => { if (!swapping) return; const timer = setTimeout(() => setSwapping(false), 420); return () => clearTimeout(timer); }, [swapping]);
  const set = useCallback((next: boolean, animate = true) => {
    setField(next); setSwapping(animate);
    try { if (next) localStorage.setItem(key, "field"); else localStorage.removeItem(key); } catch { /* storage blocked: not remembered */ }
  }, [key]);
  return [field, set, swapping] as const;
}

/** The webcam / board ratio of one seat, per viewer and seat. Null is the default layout. Remembered in this browser only. */
function useSplit(key: string) {
  const [split, setSplit] = useState<number | null>(null);
  useEffect(() => { setSplit(readSplit(key)); }, [key]);
  const set = useCallback((next: number | null) => { setSplit(next); writeSplit(key, next); }, [key]);
  return [split, set] as const;
}

export function SeatPanel(p: SeatPanelProps) {
  const [fieldViewPref, setFieldView, swapping] = useFieldView(`dd-remote-view:${p.viewScope ?? "x"}:${p.seat}`);
  const [split, setSplit] = useSplit(`dd-remote-split:${p.viewScope ?? "x"}:${p.seat}`);
  const [splitBox, setSplitBox] = useState<SplitBox | null>(null);
  const seatRef = useRef<HTMLElement | null>(null);
  // Board off (Tap mode) lays the seat out like Webcam only; the public-cards list stays.
  const compact = !!p.webcamOnly || !!p.boardOff;
  const fieldView = fieldViewPref && !compact;
  // The webcam / board seam: only where a webcam sits over a board (not Webcam only, not a focus seat of a 3-way or 4-way table).
  const splitOn = !compact && !p.focus; const splitShown = splitOn && split !== null ? clampSplit(split, splitBox ?? undefined) : null;
  const scan = useFieldScan(p.seat), missingPiles = useMissingPiles(p.seat), advice = useScanAdvice(p.seat);
  // The Scan button goes in Tap to identify; its space stays, so the camera does not move.
  // Webcam only, while this seat can be attacked: the list of its monsters is on the feed, because a feed without a camera or outlines cannot be clicked.
  const targeting = compact && p.picking && !p.eliminated;
  // Free zones that take the next click (token or give): on a camera feed they are marked on its zone grid.
  const openZones = (p.tokenSlots ?? []).map(key => key.toUpperCase()).filter(zone => /^[MS][1-5]$/.test(zone));
  const listing = !!p.webcamOnly || !!p.boardOff || targeting;
  const listed = listing ? (Object.entries(cellsFor(p.twin, !!p.extraZones)) as [ZoneKey, { card?: TwinCard } | undefined][]).flatMap(([key, cell]) =>
    cell?.card && !isPile(key) && (!targeting || cell.card.zone === "monster" || cell.card.zone === "extra-monster") ? [{ key, card: cell.card }] : []) : [];
  const cardList = listing ? <ul className={`${s.wclist} ${targeting ? s.wctargets : ""}`} aria-label={targeting ? `Attack targets on ${p.name}'s field` : `${p.name}'s cards on the field`} data-testid={`wc-cards-${p.seat}`} data-targets={targeting || undefined}>
    {targeting ? <li className={s.wclab}>{listed.length ? "Attack target:" : "No monsters on this field"}</li> : null}
    {listed.map(({ key, card }) => <li key={card.ref}><button type="button" onClick={() => { if (targeting) p.onActivate(key, card); else p.onInspect(card); }}>{`${ZN[key]}: ${cardName(card, p.info(cardCode(card)))}`}</button></li>)}
  </ul> : null;
  // The field never zooms by itself: only the Enlarge field button (and the small camera) changes the view.
  // Scan field (S) lives in the camera "..." menu only. The main area has no scan row.
  const previous = useRef(p.lp); const [delta, setDelta] = useState(0); const [input, setInput] = useState("");
  // Click the LP number to type an amount. Enter applies it, Escape or leaving the box cancels.
  const reduced = usePrefersReducedMotion(); const [typing, setTyping] = useState(false); const lpField = useRef<HTMLInputElement>(null);
  const startTyping = (prefill = "") => { setInput(prefill); setTyping(true); };
  // A click on the opponent's LP or on the hint: with an attacker picked it declares the direct attack, else the LP box opens with the attacker's ATK.
  const onDirect = () => { if (p.pickPlate) p.onPlate(); else if (p.canLp) startTyping(p.direct?.atk ? `-${p.direct.atk}` : ""); };
  // An attacker is picked (any table, also a solo one or outside the Battle Phase), or it is my Battle Phase: the field says how to attack directly.
  const directive = !!p.direct || p.pickPlate;
  const [badLp, setBadLp] = useState(false);
  const stopTyping = () => { setTyping(false); setInput(""); setBadLp(false); };
  useEffect(() => { if (typing) lpField.current?.focus(); }, [typing]);
  useEffect(() => {
    if (previous.current === p.lp) return;
    setDelta(p.lp - previous.current); previous.current = p.lp;
    const timer = setTimeout(() => setDelta(0), 2400); return () => clearTimeout(timer);
  }, [p.lp]);
  const deckHeld = p.twin.filter(card => card.zone === "deck").length, extraHeld = p.twin.filter(card => card.zone === "extra").length;
  const gy = p.twin.filter(card => card.zone === "graveyard").length; const banished = p.twin.filter(card => card.zone === "banished").length;
  const piles = compact && p.onPile ? <span className={s.wcpiles} role="group" aria-label="Piles" data-testid={`wc-piles-${p.seat}`}>
        <button type="button" onClick={event => p.onPile?.("graveyard", event.currentTarget)} aria-label={`${p.name} Graveyard: ${gy} cards. Open`}>GY <b className={s.num}>{gy}</b></button>
        <button type="button" onClick={event => p.onPile?.("banished", event.currentTarget)} aria-label={`${p.name} Banished: ${banished} cards. Open`}>BAN <b className={s.num}>{banished}</b></button>
        {p.you && p.live ? <>
          <button type="button" onClick={event => p.onPile?.("deck", event.currentTarget)} aria-label={`${p.name} Deck: ${deckHeld} cards the table holds. Open`} title={p.deckListSizes ? `Registered deck: ${p.deckListSizes.deck} cards` : undefined}>DECK <b className={s.num}>{deckHeld}</b></button>
          <button type="button" onClick={event => p.onPile?.("extra", event.currentTarget)} aria-label={`${p.name} Extra Deck: ${extraHeld} cards the table holds. Open`} title={p.deckListSizes ? `Registered Extra Deck: ${p.deckListSizes.extra} cards` : undefined}>EX <b className={s.num}>{extraHeld}</b></button>
        </> : null}
  </span> : null;
  const low = p.lp < 2500; const width = Math.min(100, Math.max(0, (p.lp / Math.max(1, p.startingLp)) * 100));
  const label = (value: number) => `${p.name} ${value < 0 ? "minus" : "plus"} ${Math.abs(value)}`;
  const classes = [s.seat, s[`s${p.index}`], p.turn ? s.turn : "", p.you ? s.mine : "", p.turn && p.turnIn ? s.turnIn : "", p.next ? s.next : "", p.speaking ? s.speak : "", p.frozen ? s.frozen : "", p.eliminated ? s.out : ""].filter(Boolean).join(" ");
  return <section ref={seatRef} className={classes} aria-label={`${p.name}'s seat`} style={{ "--c": p.color, ...(splitShown !== null ? { "--split": splitShown.toFixed(4) } : {}) } as React.CSSProperties} data-testid={`seat-${p.seat}`} data-mine={p.you || undefined} data-turn={p.turn || undefined} data-split={splitShown !== null ? "" : undefined} data-view={fieldView ? "field" : "camera"} data-wc={compact || undefined} data-nocam={(!compact && !!p.focus) || undefined} data-big={p.focus?.big || undefined} data-tile={p.focus?.tile || undefined} data-swapping={swapping || undefined}>
    <header className={s.sh}>
      <span className={s.pip} /><h2 className={s.nm} style={{ margin: 0 }} data-pick={p.focus && !p.focus.big ? "" : undefined} onClick={p.focus && !p.focus.big ? p.focus.onPick : undefined}>{p.name}</h2>
      {p.you ? <span className={`${s.tag} ${s.you}`}>YOU</span> : null}
      {p.hand ? null : piles}
      {p.tournamentTable && p.detectionMode ? <DetectionBadge seat={p.seat} name={p.name} mode={p.detectionMode === "unknown" ? undefined : p.detectionMode} /> : null}
      <span className={`${s.tag} ${s.turnt}`}>TURN</span><span className={`${s.tag} ${s.nextt}`}>NEXT</span>
      {p.eliminated ? <span className={s.tag}>OUT</span> : null}
      <span className={s.micI}><Icon name="mic" /></span><span className={s.sp} />
      {p.onBoard ? <button type="button" className={`${s.vtog} ${s.vboard}`} data-testid={`seat-board-${p.seat}`} aria-pressed={!compact} disabled={!!p.boardOff} onClick={() => p.onBoard?.(compact)}
        title={p.boardOff ? "This seat uses Tap mode, so its board is off for everyone." : compact ? `Show the virtual board under ${p.you ? "my" : `${p.name}'s`} webcam` : `Hide the virtual board under ${p.you ? "my" : `${p.name}'s`} webcam. The board keeps running`}>Board <b>{compact ? "Off" : "On"}</b></button> : null}
      {compact || p.focus ? null : <button type="button" className={s.vtog} data-testid={`view-toggle-${p.seat}`} onClick={() => setFieldView(!fieldView)}
        title={fieldView ? "Show the camera large again" : "Show the virtual field large and the camera small"}>{fieldView ? "Camera view" : "Enlarge field"}</button>}
      <button type="button" className={`${s.hl} ${s[p.health.q] ?? ""}`} aria-haspopup="dialog" aria-expanded={p.healthOpen} data-hl={p.seat} title={`${p.health.label}${p.health.detail ? `, ${p.health.detail}` : ""}`}
        aria-label={`${p.name} feed: ${p.health.label}${p.health.detail ? `, ${p.health.detail}` : ""}. Open feed health`} onClick={event => p.onHealth(event.currentTarget)}>
        <span className={s.sig}><i /><i /><i /><i /></span><i className={s.hlt}>{p.health.label}</i>
      </button>
    </header>
    {p.focus?.tile ? <button type="button" className={s.tileTap} aria-label={`Show ${p.name}`} onClick={p.focus.onPick} /> : null}
    {p.onDock ? <NotifyDock seat={p.seat} onSlot={p.onDock} view={`${compact ? "webcam" : "both"}:${fieldView ? "field" : "camera"}`} /> : null}
    <div className={s.sbody}>
      <Feed seat={p.seat} name={p.name} you={p.you} health={p.health} marks={p.marks} reticles={p.reticles} onBegin={p.onBegin} readLive={p.readLive} onAbort={p.onAbort} onMiss={p.onMiss} onSearch={p.onSearch} onPoint={p.onPoint} onSelect={p.onSelect} holdSelection={p.holdSelection} onAdd={p.onAdd} onReset={p.onReset} onReadBoard={p.onReadBoard} onZoneCard={p.onZoneCard} onPick={compact ? p.onCamPick : undefined} openZones={compact ? openZones : undefined} hoverTip={p.hoverTip} onHoverEnd={p.onHoverEnd} silentHover={!p.webcamOnly} onCardMenu={p.onCardMenu} emptyText={p.emptyFeedText} emptyAction={p.emptyFeedAction} tournament={p.tournamentTable} prereadScope={compact && p.live ? p.prereadScope : undefined} announcedMode={p.detectionMode === "unknown" ? undefined : p.detectionMode}
        extra={<>
          <CameraToolsMenu seat={p.seat} name={p.name} you={p.you} board={p.onBoard ? { on: !compact, onChange: p.onBoard, locked: !!p.boardOff } : undefined} scan={scan} advice={advice} warn={p.health.q === "bad"} onToken={p.onToken} onRescan={p.you ? undefined : p.onRescan} setup={p.you ? p.cameraSetup : undefined} />
          {fieldView ? <button type="button" className={s.swapcam} tabIndex={-1} aria-label="Camera view: show the camera large again" data-testid={`swap-cam-${p.seat}`} onClick={() => setFieldView(false)} /> : null}
          {directive ? <button type="button" className={s.directHint} onClick={onDirect} data-testid={`direct-hint-${p.seat}`} aria-label={`Attack ${p.name} directly`}><Icon name="bolt" />{p.pickPlate ? "Attack directly" : "Click webcam or LP to attack directly"}</button> : null}
          {targeting ? cardList : null}
          {compact && missingPiles.length ? <div className={s.wcoffmat} role="status" data-testid={`wc-off-mat-${p.seat}`}>{`${missingPiles.map(zone => zone === "DECK" ? "Deck" : "Extra Deck").join(" and ")} not on the mat`}</div> : null}
          {compact && p.hand ? <HandStrip seat={p.seat} name={p.name} hand={{ ...p.hand, overlay: true }} /> : null}
          <div className={s.fz} aria-live="off">FEED FROZEN<small>Last good frame shown</small></div>
          <div className={`${s.dwarn} ${p.deckWarning ? s.on : ""}`} data-testid="deck-warning" role={p.deckWarning ? "status" : undefined}>
            {p.deckWarning ? <><Icon name="warn" /><span><b>Deck no longer valid:</b> {p.deckWarning}</span>
              {p.onDeckFlag ? <button type="button" className={s.dwbtn} data-layer-opener data-testid="deck-warning-open" onClick={event => p.onDeckFlag?.(event.currentTarget)}>Review</button> : null}</> : null}
          </div>
        </>} />
      <div className={s.fside}>
        {splitOn ? <SeatSplitter seat={p.seat} name={p.name} seatRef={seatRef} box={splitBox} split={splitShown} onMeasure={setSplitBox} onSplit={setSplit} onGrab={() => { if (!fieldView) return; setFieldView(false, false); return () => setFieldView(true, false); }} /> : null}
        {p.track}
        {p.boardOff && !p.you ? <TapBoardNote /> : null}
        {targeting ? null : cardList}
        <div className={s.fboard}>
        <div className={s.fwrap} data-testid={`fwrap-${p.seat}`}>
          <div className={s.holo}>
            <i className={`${s.corner} ${s.a}`} /><i className={`${s.corner} ${s.b}`} /><i className={`${s.corner} ${s.c}`} /><i className={`${s.corner} ${s.d}`} />
            <button type="button" ref={p.plateRef} className={`${s.fplate} ${p.pickPlate ? s.pick : ""}`} tabIndex={p.pickPlate ? 0 : -1} data-plate={p.seat} onClick={p.onPlate}
              aria-label={p.pickPlate ? `Attack ${p.name} directly` : `${p.name}, ${p.lp} life points`}><span className={s.pip} />{p.name} <span className={s.num}>{p.lp}</span></button>
            <HoloField seat={p.seat} name={p.name} twin={p.twin} info={p.info} extraZones={p.extraZones} facing={p.facing} rv={p.rv} onRv={p.onRv} picking={p.picking} selectedRef={p.selectedRef} targetRef={p.targetRef}
              freshRef={p.freshRef} warnRefs={p.warnRefs} onActivate={p.onActivate} onAttack={p.onAttack} onInspect={p.onInspect} onPile={p.onPile} onDeck={p.onDeck} drag={p.drag} tokenSlots={p.tokenSlots} rotated={!p.you} twinCounts={p.twinCounts} deckListSizes={p.deckListSizes} deckRegistered={p.deckRegistered} boardSeats={p.boardSeats} owners={p.owners} />
          </div>
          <div className={s.projector} />
        </div>
        </div>
        {p.hand ? <HandStrip seat={p.seat} name={p.name} hand={compact ? { ...p.hand, tray: true, trail: piles } : p.hand} /> : null}
        <div className={s.lp} data-testid={`lp-${p.seat}`}>
          {p.thinkingSince !== undefined ? <div className={s.thinkrow}><ThinkingChip since={p.thinkingSince} seat={p.seat} who={p.name} /></div> : null}
          <div className={s.lpmain}>
            <span className={s.lpl}>LP</span>
            {typing ? <input ref={lpField} className={s.lpin} inputMode="numeric" placeholder={`${MINUS}/+ amount`} aria-label={`Custom LP change for ${p.name}. A plus sign adds. A number alone takes away. Press Enter.`}
              value={input} aria-invalid={badLp || undefined} aria-describedby={badLp ? `lp-bad-${p.seat}` : undefined} onChange={event => { setInput(event.target.value); setBadLp(false); }} onBlur={stopTyping}
              onKeyDown={event => { event.stopPropagation(); if (event.key === "Escape") { stopTyping(); return; } if (event.key !== "Enter") return; const value = parseLpInput(input); if (value === null) { setBadLp(true); return; } p.onLp(value); stopTyping(); }} />
              : <button type="button" className={`${s.lpn} ${low ? s.low : ""} ${delta < 0 ? s.loss : delta > 0 ? s.gain : ""}`} data-lp-seat={p.seat} disabled={!p.canLp} title={directive ? "Attack directly" : "Click to type an amount"} aria-label={`Type an LP change for ${p.name}. Life points ${p.lp}`} onClick={directive ? onDirect : () => startTyping()}>
                <LifePoints value={p.lp} reducedMotion={reduced} showChange={false} />
                <span className={s.lpt} aria-hidden="true" data-testid={`lp-value-${p.seat}`}>{p.lp}</span>
              </button>}
            {typing && badLp ? <span className={s.lpbad} id={`lp-bad-${p.seat}`} role="alert" data-testid={`lp-bad-${p.seat}`}>Type a number, like 500 or +500</span> : null}
            <span className={`${s.lpd} ${s.num} ${delta ? s.show : ""} ${delta > 0 ? s.gain : ""}`} aria-hidden="true">{delta ? sg(delta) : ""}</span>
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

"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Feed, type BoardReading, type FeedHit, type FeedMark, type FeedPoint, type FeedReticle, type FeedStart } from "./feed";
import { HoloField } from "./holo-field";
import { Icon } from "./icons";
import { sg, MINUS, type TwinCard, type ZoneKey } from "./model";
import type { CardInfo } from "./catalog";
import type { Health } from "./video-hub";
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

export type SeatPanelProps = {
  index: number; seat: number; name: string; color: string; you: boolean; turn: boolean; next: boolean; speaking: boolean; frozen: boolean; eliminated: boolean;
  lp: number; startingLp: number; health: Health; healthOpen: boolean; onHealth: (button: HTMLElement) => void;
  marks: FeedMark[]; reticles: FeedReticle[]; onBegin: (seat: number, start: FeedStart) => void; onPoint: (seat: number, x: number, y: number, extra: FeedPoint) => void; onSelect: (seat: number, hit: FeedHit) => void; holdSelection: boolean; onAdd: (mark: FeedMark) => void; onReadBoard?: (seat: number, reading: BoardReading) => Promise<string>;
  twin: TwinCard[]; info: (id: number | undefined) => CardInfo | undefined; rv: ZoneKey; onRv: (key: ZoneKey) => void; picking: boolean;
  selectedRef?: string; targetRef?: string; freshRef?: string; warnRefs: ReadonlySet<string>; pickPlate: boolean; plateRef?: (el: HTMLButtonElement | null) => void;
  onActivate: (key: ZoneKey, card: TwinCard | undefined) => void; onAttack: (key: ZoneKey, card: TwinCard) => void; onInspect: (card: TwinCard) => void;
  onPlate: () => void; onLp: (delta: number) => void; canLp: boolean;
  deckWarning?: string; cameraControl?: ReactNode; emptyFeedText: string; turnIn: boolean;
};

export function SeatPanel(p: SeatPanelProps) {
  const previous = useRef(p.lp); const [delta, setDelta] = useState(0); const [input, setInput] = useState("");
  useEffect(() => {
    if (previous.current === p.lp) return;
    setDelta(p.lp - previous.current); previous.current = p.lp;
    const timer = setTimeout(() => setDelta(0), 2400); return () => clearTimeout(timer);
  }, [p.lp]);
  const low = p.lp < 2500; const width = Math.min(100, Math.max(0, (p.lp / Math.max(1, p.startingLp)) * 100));
  const label = (value: number) => `${p.name} ${value < 0 ? "minus" : "plus"} ${Math.abs(value)}`;
  const classes = [s.seat, s[`s${p.index}`], p.turn ? s.turn : "", p.turn && p.turnIn ? s.turnIn : "", p.next ? s.next : "", p.speaking ? s.speak : "", p.frozen ? s.frozen : "", p.eliminated ? s.out : ""].filter(Boolean).join(" ");
  return <section className={classes} aria-label={`${p.name}'s seat`} style={{ "--c": p.color } as React.CSSProperties} data-testid={`seat-${p.seat}`} data-turn={p.turn || undefined}>
    <header className={s.sh}>
      <span className={s.pip} /><h2 className={s.nm} style={{ margin: 0 }}>{p.name}</h2>
      {p.you ? <span className={`${s.tag} ${s.you}`}>YOU</span> : null}
      <span className={`${s.tag} ${s.turnt}`}>TURN</span><span className={`${s.tag} ${s.nextt}`}>NEXT</span>
      {p.eliminated ? <span className={s.tag}>OUT</span> : null}
      <span className={s.micI}><Icon name="mic" /></span><span className={s.sp} />
      <button type="button" className={`${s.hl} ${s[p.health.q] ?? ""}`} aria-haspopup="dialog" aria-expanded={p.healthOpen} data-hl={p.seat}
        aria-label={`${p.name} feed: ${p.health.label}${p.health.detail ? `, ${p.health.detail}` : ""}. Open feed health`} onClick={event => p.onHealth(event.currentTarget)}>
        <span className={s.sig}><i /><i /><i /><i /></span><i className={s.hlt}>{p.health.label}</i>
      </button>
    </header>
    <div className={s.sbody}>
      <Feed seat={p.seat} name={p.name} you={p.you} health={p.health} marks={p.marks} reticles={p.reticles} onBegin={p.onBegin} onPoint={p.onPoint} onSelect={p.onSelect} holdSelection={p.holdSelection} onAdd={p.onAdd} onReadBoard={p.onReadBoard} emptyText={p.emptyFeedText}
        extra={<>
          {p.cameraControl}
          <div className={s.fz} aria-live="off">FEED FROZEN<small>Last good frame shown</small></div>
          <div className={`${s.dwarn} ${p.deckWarning ? s.on : ""}`} data-testid="deck-warning" role={p.deckWarning ? "status" : undefined}>
            {p.deckWarning ? <><Icon name="warn" /><span><b>Deck no longer valid:</b> {p.deckWarning}</span></> : null}
          </div>
        </>} />
      <div className={s.fside}>
        <div className={s.fwrap}>
          <div className={s.holo}>
            <i className={`${s.corner} ${s.a}`} /><i className={`${s.corner} ${s.b}`} /><i className={`${s.corner} ${s.c}`} /><i className={`${s.corner} ${s.d}`} />
            <button type="button" ref={p.plateRef} className={`${s.fplate} ${p.pickPlate ? s.pick : ""}`} tabIndex={p.pickPlate ? 0 : -1} data-plate={p.seat} onClick={p.onPlate}
              aria-label={p.pickPlate ? `Attack ${p.name} directly` : `${p.name}, ${p.lp} life points`}><span className={s.pip} />{p.name} <span className={s.num}>{p.lp}</span></button>
            <HoloField seat={p.seat} name={p.name} twin={p.twin} info={p.info} rv={p.rv} onRv={p.onRv} picking={p.picking} selectedRef={p.selectedRef} targetRef={p.targetRef}
              freshRef={p.freshRef} warnRefs={p.warnRefs} onActivate={p.onActivate} onAttack={p.onAttack} onInspect={p.onInspect} />
          </div>
          <div className={s.projector} />
        </div>
        <div className={s.lp} data-testid={`lp-${p.seat}`}>
          <div className={s.lpmain}>
            <span className={s.lpl}>LP</span>
            <span className={`${s.lpn} ${s.num} ${low ? s.low : ""} ${delta < 0 ? s.loss : delta > 0 ? s.gain : ""}`} data-testid={`lp-value-${p.seat}`}>{p.lp}</span>
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

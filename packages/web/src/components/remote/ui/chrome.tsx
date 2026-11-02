"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import { PHASES, PHASE_LONG, PHASE_SHORT, phaseIndex } from "./model";
import s from "./remote-ui.module.css";

export type Player = { seat: number; name: string; color: string; eliminated: boolean };

export function TopBar({ crumb, chip, health, healthOpen, cardOpen, logOpen, logDot, onHealth, onCard, onLog, webcamOnly, onView }: {
  crumb: string; chip: string; health: { q: "good" | "warn" | "bad" | "off"; text: string }; healthOpen: boolean; cardOpen: boolean; logOpen: boolean; logDot: boolean;
  onHealth: (el: HTMLElement) => void; onCard: (el: HTMLElement) => void; onLog: (el: HTMLElement) => void;
  /** True when the virtual fields are hidden and the camera feeds take the space. */ webcamOnly: boolean; onView: (webcamOnly: boolean) => void;
}) {
  const dot = health.q === "warn" ? s.warn : health.q === "bad" ? s.bad : "";
  const tone = health.q === "warn" ? s.warnc : health.q === "bad" ? s.badc : "";
  return <header className={s.top}>
    <a className={s.logo} href="/duels/remote" aria-label="Leave the table and return to the Remote Duels lobby"><span className={s.gem} /><b>Dueling Domain</b></a>
    <span className={s.crumb}><b>Remote Duel</b> · {crumb}</span>
    <span className={s.cchip}>{chip}</span>
    <span className={s.sp} />
    <div className={`${s.seg} ${s.viewseg}`} role="group" aria-label="Table view" data-testid="table-view">
      <button type="button" aria-pressed={!webcamOnly} data-testid="view-both" aria-label="Show cameras and virtual fields" onClick={() => onView(false)} title="Show the cameras and the virtual fields">Both</button>
      <button type="button" aria-pressed={webcamOnly} data-testid="view-webcam" aria-label="Webcam only: hide the virtual fields" onClick={() => onView(true)} title="Hide the virtual fields. The cameras get the space.">Webcam<span className={s.vlong}> only</span></button>
    </div>
    <button type="button" className={`${s.tb} ${tone}`} aria-haspopup="dialog" aria-expanded={healthOpen} data-layer-opener data-testid="health-chip" onClick={e => onHealth(e.currentTarget)}>
      <span className={`${s.hdot} ${dot}`} /><span>{health.text}</span></button>
    <button type="button" className={s.tb} aria-haspopup="dialog" aria-expanded={cardOpen} data-layer-opener data-testid="card-button" onClick={e => onCard(e.currentTarget)}>
      <Icon name="card" /><span className={s.lbl}>Card</span></button>
    <button type="button" className={s.tb} aria-haspopup="dialog" aria-expanded={logOpen} data-layer-opener data-testid="log-button" onClick={e => onLog(e.currentTarget)}>
      <Icon name="log" /><span className={s.lbl}>Log</span><span className={`${s.nb} ${logDot ? s.on : ""}`} /></button>
  </header>;
}

export function Rail({ players, turnSeat, turn, phase, canAct, nextSeat, passHot, onPhase, onPhaseBack, onPass, turnIn, backTo }: {
  players: Player[]; turnSeat: number; turn: number; phase: string; canAct: boolean; nextSeat: number; passHot: boolean;
  onPhase: (id: string) => void; onPhaseBack: (id: string) => void; onPass: () => void; turnIn: boolean;
  /** The phase before this one in this turn (`previousYgoPhase`), or null on the first phase. */ backTo: string | null;
}) {
  const current = players.find(p => p.seat === turnSeat); const next = players.find(p => p.seat === nextSeat);
  const at = phaseIndex(phase);
  // Going to an earlier phase of this turn asks once first. `ask` holds the phase the player is about to return to.
  const [ask, setAsk] = useState<string | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { setAsk(null); }, [phase, turn, turnSeat]);
  useEffect(() => { if (ask) confirmRef.current?.focus(); }, [ask]);
  useEffect(() => {
    if (!ask) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setAsk(null); } };
    document.addEventListener("keydown", onKey, true); return () => document.removeEventListener("keydown", onKey, true);
  }, [ask]);
  const click = (id: string, i: number) => { if (i < at) setAsk(id); else onPhase(id); };
  return <div className={s.rail} data-testid="rail">
    <div className={s.tbox}><span className={s.pip} style={{ "--c": current?.color } as React.CSSProperties} />
      <div className={s.tn}><b data-testid="turn-name">{current?.name ?? "Table"}&apos;s turn</b><span className={s.tm}>Turn {turn}</span></div></div>
    <div className={s.order} aria-label="Turn order">
      {players.map(p => <i key={p.seat} className={`${p.seat === turnSeat ? s.on : p.seat === nextSeat ? s.nx : ""}`}><span className={s.pip} style={{ "--c": p.color } as React.CSSProperties} />{p.name}</i>)}
    </div>
    <ol className={s.phases} aria-label="Phases">
      {PHASES.map((p, i) => <li key={p.id}>
        <button type="button" className={`${s.ph} ${i < at ? s.done : ""} ${i === at ? s.on : ""}`} aria-current={i === at ? "step" : undefined} data-phase={p.id} data-testid={`phase-${p.id}`}
          disabled={!canAct} aria-label={`${PHASE_LONG[p.id] ?? p.id}${i === at ? ", current" : i < at ? ", go back to this phase" : ""}`} onClick={() => click(p.id, i)}>
          <span className={s.dot} />{PHASE_SHORT[p.id] ?? p.id}</button>
      </li>)}
    </ol>
    <button type="button" className={s.pback} disabled={!canAct || !backTo} data-testid="phase-back" onClick={() => backTo && setAsk(backTo)}
      aria-label={backTo ? `Back to ${PHASE_LONG[backTo] ?? backTo}` : "No earlier phase"} title={backTo ? `Back to ${PHASE_LONG[backTo] ?? backTo}` : "No earlier phase"}>
      <span aria-hidden="true">◀</span> Back</button>
    <button type="button" className={`${s.pass} ${passHot ? s.hot : ""}`} disabled={!canAct} data-testid="pass-turn" onClick={onPass} data-turn-in={turnIn || undefined}>
      <span>Pass turn</span><Icon name="next" /><span className={s.pip} style={{ "--c": next?.color } as React.CSSProperties} /><span>{next?.name ?? ""}</span></button>
    {ask ? <div className={s.pconfirm} role="alertdialog" aria-label="Go back a phase" data-testid="phase-confirm">
      <span>Go back to <b>{PHASE_LONG[ask] ?? ask}</b>?</span>
      <button type="button" ref={confirmRef} className={`${s.btn} ${s.sm} ${s.go}`} data-testid="phase-confirm-yes" onClick={() => { const id = ask; setAsk(null); onPhaseBack(id); }}>Go back</button>
      <button type="button" className={`${s.btn} ${s.sm}`} data-testid="phase-confirm-no" onClick={() => setAsk(null)}>Cancel</button>
    </div> : null}
  </div>;
}

/** Mobile strip with every player's life points. A tap scrolls to that seat. */
export function LpStrip({ players, turnSeat, lp, onJump }: { players: Player[]; turnSeat: number; lp: (seat: number) => number; onJump: (seat: number) => void }) {
  return <div className={s.lpstrip} style={{ "--n": players.length } as React.CSSProperties} aria-label="Life points">
    {players.map(p => <button type="button" key={p.seat} className={p.seat === turnSeat ? s.on : ""} onClick={() => onJump(p.seat)} aria-label={`${p.name}, ${lp(p.seat)} life points`}>
      <small><span className={s.pip} style={{ "--c": p.color } as React.CSSProperties} />{p.name}</small><b>{lp(p.seat)}</b></button>)}
  </div>;
}

"use client";

import { Icon } from "./icons";
import { PHASES, PHASE_LONG, PHASE_SHORT, phaseIndex } from "./model";
import s from "./remote-ui.module.css";

export type Player = { seat: number; name: string; color: string; eliminated: boolean };

export function TopBar({ crumb, chip, health, healthOpen, cardOpen, logOpen, logDot, onHealth, onCard, onLog }: {
  crumb: string; chip: string; health: { q: "good" | "warn" | "bad" | "off"; text: string }; healthOpen: boolean; cardOpen: boolean; logOpen: boolean; logDot: boolean;
  onHealth: (el: HTMLElement) => void; onCard: (el: HTMLElement) => void; onLog: (el: HTMLElement) => void;
}) {
  const dot = health.q === "warn" ? s.warn : health.q === "bad" ? s.bad : "";
  const tone = health.q === "warn" ? s.warnc : health.q === "bad" ? s.badc : "";
  return <header className={s.top}>
    <a className={s.logo} href="/duels/remote" aria-label="Leave the table and return to the Remote Duels lobby"><span className={s.gem} /><b>Dueling Domain</b></a>
    <span className={s.crumb}><b>Remote Duel</b> · {crumb}</span>
    <span className={s.cchip}>{chip}</span>
    <span className={s.sp} />
    <button type="button" className={`${s.tb} ${tone}`} aria-haspopup="dialog" aria-expanded={healthOpen} data-layer-opener data-testid="health-chip" onClick={e => onHealth(e.currentTarget)}>
      <span className={`${s.hdot} ${dot}`} /><span>{health.text}</span></button>
    <button type="button" className={s.tb} aria-haspopup="dialog" aria-expanded={cardOpen} data-layer-opener data-testid="card-button" onClick={e => onCard(e.currentTarget)}>
      <Icon name="card" /><span className={s.lbl}>Card</span></button>
    <button type="button" className={s.tb} aria-haspopup="dialog" aria-expanded={logOpen} data-layer-opener data-testid="log-button" onClick={e => onLog(e.currentTarget)}>
      <Icon name="log" /><span className={s.lbl}>Log</span><span className={`${s.nb} ${logDot ? s.on : ""}`} /></button>
  </header>;
}

export function Rail({ players, turnSeat, turn, phase, canAct, nextSeat, passHot, onPhase, onPass, turnIn }: {
  players: Player[]; turnSeat: number; turn: number; phase: string; canAct: boolean; nextSeat: number; passHot: boolean;
  onPhase: (id: string) => void; onPass: () => void; turnIn: boolean;
}) {
  const current = players.find(p => p.seat === turnSeat); const next = players.find(p => p.seat === nextSeat);
  const at = phaseIndex(phase);
  return <div className={s.rail} data-testid="rail">
    <div className={s.tbox}><span className={s.pip} style={{ "--c": current?.color } as React.CSSProperties} />
      <div className={s.tn}><b data-testid="turn-name">{current?.name ?? "Table"}&apos;s turn</b><span className={s.tm}>Turn {turn}</span></div></div>
    <div className={s.order} aria-label="Turn order">
      {players.map(p => <i key={p.seat} className={`${p.seat === turnSeat ? s.on : p.seat === nextSeat ? s.nx : ""}`}><span className={s.pip} style={{ "--c": p.color } as React.CSSProperties} />{p.name}</i>)}
    </div>
    <ol className={s.phases} aria-label="Phases">
      {PHASES.map((p, i) => <li key={p.id}>
        <button type="button" className={`${s.ph} ${i < at ? s.done : ""} ${i === at ? s.on : ""}`} aria-current={i === at ? "step" : undefined} data-phase={p.id} data-testid={`phase-${p.id}`}
          disabled={!canAct} aria-label={`${PHASE_LONG[p.id] ?? p.id}${i === at ? ", current" : ""}`} onClick={() => onPhase(p.id)}>
          <span className={s.dot} />{PHASE_SHORT[p.id] ?? p.id}</button>
      </li>)}
    </ol>
    <button type="button" className={`${s.pass} ${passHot ? s.hot : ""}`} disabled={!canAct} data-testid="pass-turn" onClick={onPass} data-turn-in={turnIn || undefined}>
      <span>Pass turn</span><Icon name="next" /><span className={s.pip} style={{ "--c": next?.color } as React.CSSProperties} /><span>{next?.name ?? ""}</span></button>
  </div>;
}

/** Mobile strip with every player's life points. A tap scrolls to that seat. */
export function LpStrip({ players, turnSeat, lp, onJump }: { players: Player[]; turnSeat: number; lp: (seat: number) => number; onJump: (seat: number) => void }) {
  return <div className={s.lpstrip} style={{ "--n": players.length } as React.CSSProperties} aria-label="Life points">
    {players.map(p => <button type="button" key={p.seat} className={p.seat === turnSeat ? s.on : ""} onClick={() => onJump(p.seat)} aria-label={`${p.name}, ${lp(p.seat)} life points`}>
      <small><span className={s.pip} style={{ "--c": p.color } as React.CSSProperties} />{p.name}</small><b>{lp(p.seat)}</b></button>)}
  </div>;
}

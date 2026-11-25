"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { PHASES, PHASE_ABBR, PHASE_LONG, PHASE_SHORT, phaseIndex } from "./model";
import s from "./remote-ui.module.css";

/**
 * Going back to an earlier phase of this turn asks once first. `ask` holds the phase the player is about to return to.
 * One state for every phase track and the Back button, so one confirm dialog serves all of them. It resets when the phase, turn or turn owner changes.
 */
export function usePhaseAsk(phase: string, turn: number, turnSeat: number, onPhase: (id: string) => void) {
  const [ask, setAsk] = useState<string | null>(null);
  useEffect(() => { setAsk(null); }, [phase, turn, turnSeat]);
  const at = phaseIndex(phase);
  const pick = useCallback((id: string) => { if (PHASES.findIndex(p => p.id === id) < at) setAsk(id); else onPhase(id); }, [at, onPhase]);
  return { ask, setAsk, pick };
}

/** The confirm dialog for going back a phase. Escape cancels. The Go back button takes focus. */
export function PhaseConfirm({ ask, onYes, onNo }: { ask: string; onYes: (id: string) => void; onNo: () => void }) {
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { confirmRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); onNo(); } };
    document.addEventListener("keydown", onKey, true); return () => document.removeEventListener("keydown", onKey, true);
  }, [onNo]);
  return <div className={s.pconfirm} role="alertdialog" aria-label="Go back a phase" data-testid="phase-confirm">
    <span>Go back to <b>{PHASE_LONG[ask] ?? ask}</b>?</span>
    <button type="button" ref={confirmRef} className={`${s.btn} ${s.sm} ${s.go}`} data-testid="phase-confirm-yes" onClick={() => onYes(ask)}>Go back</button>
    <button type="button" className={`${s.btn} ${s.sm}`} data-testid="phase-confirm-no" onClick={onNo}>Cancel</button>
  </div>;
}

/**
 * One player's phase boxes, between the webcam and the virtual field. The turn player's track shows the current phase in gold and its boxes
 * can be clicked (by the turn player, or by anyone at a solo table). Every other track is quiet: it shows the same boxes, with no phase lit.
 * Only the turn seat's boxes carry the `phase-<id>` test ids, so each id exists once. Left, Right, Home and End move between the boxes.
 */
export function PhaseTrack({ seat, name, turn, phase, canAct, onPick }: { seat: number; name: string; turn: boolean; phase: string; canAct: boolean; onPick: (id: string) => void }) {
  const at = turn ? phaseIndex(phase) : -1;
  const onKeys = (event: React.KeyboardEvent<HTMLOListElement>) => {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "Home" ? -99 : event.key === "End" ? 99 : 0;
    if (!step) return;
    const buttons = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>("button")); if (!buttons.length) return;
    const from = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const to = Math.abs(step) > 1 ? (step < 0 ? 0 : buttons.length - 1) : Math.min(buttons.length - 1, Math.max(0, from + step));
    event.preventDefault(); buttons[to]?.focus();
  };
  const live = turn && canAct;
  return <ol className={`${s.ptrack} ${turn ? s.pton : ""}`} aria-label={`${name}: phases`} data-testid={`phase-track-${seat}`} data-turn={turn || undefined} onKeyDown={onKeys}>
    {PHASES.map((p, i) => <li key={p.id}>
      <button type="button" className={`${s.pbox} ${i < at ? s.done : ""} ${i === at ? s.on : ""}`} aria-current={i === at ? "step" : undefined} data-phase={p.id} data-testid={turn ? `phase-${p.id}` : `phase-${seat}-${p.id}`}
        tabIndex={turn ? 0 : -1} aria-disabled={!live || undefined}
        aria-label={`${PHASE_LONG[p.id] ?? p.id}${i === at ? ", current" : i < at ? ", go back to this phase" : ""}${!turn ? `, not ${name}'s turn` : canAct ? "" : ", not your turn"}`}
        onClick={event => { if (event.detail > 0) event.currentTarget.blur(); if (live) onPick(p.id); }}><span className={s.pfull}>{PHASE_SHORT[p.id] ?? p.id}</span><span className={s.pabbr} aria-hidden="true">{PHASE_ABBR[p.id] ?? p.id}</span></button>
    </li>)}
  </ol>;
}

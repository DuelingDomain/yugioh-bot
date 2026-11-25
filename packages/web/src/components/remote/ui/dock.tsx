"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "./icons";
import type { MicState } from "./use-voice";
import s from "./remote-ui.module.css";

export type Transcript = { text: string; live: boolean; result: string; ignored: boolean };
export type Proposal = { id: number; title: string; sub: string; confirmLabel: string };

const BARS = 9;

export function VoxSection({ recognition = true, transcript, proposal, samples, onConfirm, onCancel, onSample, children }: {
  recognition?: boolean; transcript: Transcript; proposal: Proposal | null; samples: string[]; onConfirm: () => void; onCancel: () => void; onSample: (text: string) => void; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  const suggest = samples.length > 0 && transcript.ignored && transcript.result === "Not understood";
  const expanded = samples.length > 0 && (open || suggest);
  // The list floats over the field on small screens. Any press or key outside it closes it, and the press still reaches the field.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]);
  return <section ref={root} className={`${s.dk} ${s.vox} ${proposal ? s.has : ""} ${expanded ? s.sopen : ""}`} aria-label="Voice commands">
    {!recognition ? <div className={`${s.chip} ${s.tr}`} data-testid="voice-off"><span className={s.note}>Voice commands are off. Use the phase bar, the buttons and the keyboard.</span></div>
    : <div className={`${s.chip} ${s.tr}`} data-testid="transcript" aria-live="polite">
      <span className={s.who}><Icon name="mic" />Heard</span>
      <q className={transcript.live ? s.live : ""}>{transcript.text || "Say a phase or end turn."}</q>
      {transcript.result ? <span className={`${s.res} ${transcript.ignored ? s.ig : ""}`}>{transcript.result}</span> : null}
    </div>}
    {children}
    {proposal ? <div className={`${s.chip} ${s.prop}`} role="group" aria-label="Confirm voice command" data-testid="proposal">
      <Icon name="check" className={s.pi} />
      <div className={s.pm}><div className={s.pt}>{proposal.title}</div><div className={s.ps}>{proposal.sub}</div></div>
      <div className={s.pb}>
        <button type="button" className={`${s.btn} ${s.go}`} onClick={onConfirm} data-testid="proposal-confirm">{proposal.confirmLabel} <kbd>Enter</kbd></button>
        <button type="button" className={`${s.btn} ${s.q}`} onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
      </div>
    </div> : null}
    {proposal || !samples.length ? null : <button type="button" className={`${s.btn} ${s.sm} ${s.q} ${s.trybtn}`} aria-expanded={expanded} onClick={() => setOpen(v => !v)}>{suggest ? "Did you mean…?" : "Try saying…"}</button>}
    {proposal || !samples.length ? null : <div className={`${s.samples} ${expanded ? s.open : ""} ${suggest ? s.suggest : ""}`} data-testid={suggest ? "voice-suggestions" : undefined} role={suggest ? "group" : undefined} aria-label={suggest ? "Did you mean" : undefined}><span>{suggest ? "Did you mean…?" : "Try saying…"}</span>
      {samples.map(text => <button type="button" key={text} onClick={() => { setOpen(false); onSample(text); }}>{text}</button>)}</div>}
  </section>;
}

export function UndoSection({ recognition = true, spokenUndo = true, label, enabled, reason, flash, histOpen, onUndo, onHist }: {
  recognition?: boolean; spokenUndo?: boolean; label: string; enabled: boolean; reason?: string; flash: number; histOpen: boolean; onUndo: () => void; onHist: (el: HTMLElement) => void;
}) {
  return <section className={`${s.dk} ${s.undo}`} aria-label="Undo">
    <button type="button" className={`${s.ubtn} ${flash ? s.flash : ""}`} key={flash} disabled={!enabled} onClick={onUndo} data-testid="undo">
      <Icon name="undo" /><span className={s.ut}><span className={s.ul} data-testid="undo-label">{enabled ? `Undo: ${label}` : "Nothing to undo"}</span>
        <span className={s.usub}>{reason ? `${reason} · ` : ""}<kbd>Ctrl</kbd> <kbd>Z</kbd>{recognition && spokenUndo ? " · or say “undo”" : ""}</span></span>
    </button>
    <button type="button" className={s.hbtn} aria-haspopup="dialog" aria-expanded={histOpen} aria-label="Show recent actions" data-layer-opener data-testid="history-button"
      onClick={event => onHist(event.currentTarget)}><Icon name="hist" /></button>
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { MicState } from "./use-voice";
import s from "./remote-ui.module.css";

export type Transcript = { text: string; live: boolean; result: string; ignored: boolean };
export type Proposal = { id: number; title: string; sub: string; confirmLabel: string };

const BARS = 9;

export function MicSection({ state, level, speaking, muted, ptt, held, service, error, onMute, onPtt, offTurn }: {
  state: MicState; level: number; speaking: boolean; muted: boolean; ptt: boolean; held: boolean; service: string; error: string;
  onMute: () => void; onPtt: () => void; offTurn: boolean;
}) {
  const label = state === "muted" ? "Muted" : state === "off" ? "Voice off" : ptt ? (held ? "Listening" : "Push to talk") : state === "listen" ? "Listening" : "Idle";
  const sub = error ? error
    : service === "closed" && state !== "muted" ? "Speech service offline. Use the buttons and the keyboard."
    : state === "muted" ? "Nobody hears you. Unmute to use voice."
    : ptt ? "Hold V and speak."
    : state === "listen" ? "Say a phase, an LP change or an attack."
    : offTurn ? "Waiting for your turn. Say “chain” or “respond” to speak out of turn." : "Say “chain” to speak.";
  return <section className={`${s.dk} ${s.mic} ${s[state] ?? ""}`} aria-label="Voice control" data-testid="mic" data-mic={state}>
    <button type="button" className={s.micb} aria-label={muted ? "Unmute microphone" : "Mute microphone"} onClick={onMute}><Icon name={state === "muted" ? "micoff" : "mic"} /></button>
    <div className={s.mstat}>
      <span className={s.mrow}><span className={s.mlab} data-testid="mic-label">{label}</span>
        <span className={s.meter} aria-hidden="true">{Array.from({ length: BARS }, (_, i) => <i key={i} style={{ height: state === "muted" || state === "off" ? 3 : Math.max(3, Math.round(level * 16 * (0.45 + 0.55 * Math.sin((i + 1) * 1.7 + (speaking ? 1 : 0)) ** 2))) }} />)}</span></span>
      <span className={s.msub}>{sub}</span>
    </div>
    <div className={s.mctl}>
      <button type="button" className={`${s.btn} ${s.q} ${s.mute}`} aria-pressed={muted} onClick={onMute}><Icon name={muted ? "micoff" : "mic"} />{muted ? "Unmute" : "Mute"}</button>
      <button type="button" className={`${s.btn} ${s.q}`} aria-pressed={ptt} onClick={onPtt} title="Optional setting. Off by default.">Push-to-talk: {ptt ? "on" : "off"}</button>
    </div>
  </section>;
}

export function VoxSection({ transcript, proposal, samples, onConfirm, onCancel, onSample }: {
  transcript: Transcript; proposal: Proposal | null; samples: string[]; onConfirm: () => void; onCancel: () => void; onSample: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLElement>(null);
  // The list floats over the field on small screens. Any press or key outside it closes it, and the press still reaches the field.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]);
  return <section ref={root} className={`${s.dk} ${s.vox} ${proposal ? s.has : ""} ${open ? s.sopen : ""}`} aria-label="Voice commands">
    {proposal ? null : <div className={`${s.chip} ${s.tr}`} data-testid="transcript">
      <span className={s.who}><Icon name="mic" />YOU</span>
      <q className={transcript.live ? s.live : ""}>{transcript.text || "Say a phase, an LP change or an attack."}</q>
      {transcript.result ? <span className={`${s.res} ${transcript.ignored ? s.ig : ""}`}>{transcript.result}</span> : null}
    </div>}
    {proposal ? <div className={`${s.chip} ${s.prop}`} role="group" aria-label="Confirm voice command" data-testid="proposal">
      <Icon name="check" className={s.pi} />
      <div className={s.pm}><div className={s.pt}>{proposal.title}</div><div className={s.ps}>{proposal.sub}</div></div>
      <div className={s.pb}>
        <button type="button" className={`${s.btn} ${s.go}`} onClick={onConfirm} data-testid="proposal-confirm">{proposal.confirmLabel} <kbd>Enter</kbd></button>
        <button type="button" className={`${s.btn} ${s.q}`} onClick={onCancel}>Cancel <kbd>Esc</kbd></button>
      </div>
    </div> : null}
    {proposal ? null : <button type="button" className={`${s.btn} ${s.sm} ${s.q} ${s.trybtn}`} aria-expanded={open} onClick={() => setOpen(v => !v)}>Try saying…</button>}
    {proposal ? null : <div className={`${s.samples} ${open ? s.open : ""}`}><span>Try saying…</span>
      {samples.map(text => <button type="button" key={text} onClick={() => { setOpen(false); onSample(text); }}>{text}</button>)}</div>}
  </section>;
}

export function UndoSection({ label, enabled, secondsLeft, flash, histOpen, onUndo, onHist }: {
  label: string; enabled: boolean; secondsLeft: number; flash: number; histOpen: boolean; onUndo: () => void; onHist: (el: HTMLElement) => void;
}) {
  return <section className={`${s.dk} ${s.undo}`} aria-label="Undo">
    <button type="button" className={`${s.ubtn} ${flash ? s.flash : ""}`} key={flash} disabled={!enabled} onClick={onUndo} data-testid="undo">
      <Icon name="undo" /><span className={s.ut}><span className={s.ul} data-testid="undo-label">{enabled ? `Undo: ${label}` : "Nothing to undo"}</span>
        <span className={s.usub}>{enabled ? `${Math.max(1, secondsLeft)} s left · ` : ""}<kbd>Ctrl</kbd> <kbd>Z</kbd> · or say “undo”</span></span>
    </button>
    <button type="button" className={s.hbtn} aria-haspopup="dialog" aria-expanded={histOpen} aria-label="Show last 5 actions" data-layer-opener data-testid="history-button"
      onClick={event => onHist(event.currentTarget)}><Icon name="hist" /></button>
  </section>;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "./icons";
import type { MicState } from "./use-voice";
import s from "./remote-ui.module.css";

export type Transcript = { text: string; live: boolean; result: string; ignored: boolean };
export type Proposal = { id: number; title: string; sub: string; confirmLabel: string };

const BARS = 9;

/** recognition=false: no voice commands. The mute control then only drives voice chat, or nothing at a solo table (chat="none"). */
export function MicSection({ recognition = true, chat = "on", state, level, speaking, muted, ptt, held, service, error, onMute, onPtt, offTurn }: {
  recognition?: boolean; chat?: "none" | "off" | "connecting" | "on"; state: MicState; level: number; speaking: boolean; muted: boolean; ptt: boolean; held: boolean; service: string; error: string;
  onMute: () => void; onPtt: () => void; offTurn: boolean;
}) {
  const noMute = !recognition && chat === "none";
  const label = state === "muted" ? "Muted" : state === "off" ? (recognition || chat === "none" ? "Voice off" : "Voice chat") : ptt ? (held ? "Listening" : "Push to talk") : state === "listen" ? "Listening" : "Idle";
  const sub = error ? error
    : !recognition && state === "off" ? (chat === "on" ? "Talk to the table." : chat === "connecting" ? "Connecting to voice chat…" : chat === "off" ? "Turn camera on to talk." : "No voice chat at a solo table.")
    : service === "closed" && state !== "muted" ? "Speech service offline. Use the buttons and the keyboard."
    : state === "muted" ? "Muted. Unmute to use voice commands."
    : ptt ? "Hold V and speak."
    : state === "listen" ? "Say a phase, an LP change or an attack."
    : offTurn ? "Waiting for your turn. Say “chain” or “respond” to speak out of turn." : "Say “chain” to speak.";
  return <section className={`${s.dk} ${s.mic} ${s[state] ?? ""}`} aria-label="Voice control" data-testid="mic" data-mic={state}>
    <button type="button" className={s.micb} disabled={noMute} aria-label={muted ? "Unmute microphone" : "Mute microphone"} onClick={onMute}><Icon name={state === "muted" ? "micoff" : "mic"} /></button>
    <div className={s.mstat}>
      <span className={s.mrow}><span className={s.mlab} data-testid="mic-label">{label}</span>
        <span className={s.meter} aria-hidden="true" style={recognition ? undefined : { visibility: "hidden" }}>{Array.from({ length: BARS }, (_, i) => <i key={i} style={{ height: state === "muted" || state === "off" ? 3 : Math.max(3, Math.round(level * 16 * (0.45 + 0.55 * Math.sin((i + 1) * 1.7 + (speaking ? 1 : 0)) ** 2))) }} />)}</span></span>
      <span className={s.msub}>{sub}</span>
    </div>
    <div className={s.mctl}>
      <button type="button" className={`${s.btn} ${s.q} ${s.mute}`} disabled={noMute} aria-pressed={muted} onClick={onMute}><Icon name={muted ? "micoff" : "mic"} />{muted ? "Unmute" : "Mute"}</button>
      <button type="button" className={`${s.btn} ${s.q}`} aria-pressed={ptt} onClick={onPtt} title="Optional setting. Off by default." style={recognition ? undefined : { visibility: "hidden" }}>Push-to-talk: {ptt ? "on" : "off"}</button>
    </div>
  </section>;
}

export function VoxSection({ recognition = true, transcript, proposal, samples, onConfirm, onCancel, onSample }: {
  recognition?: boolean; transcript: Transcript; proposal: Proposal | null; samples: string[]; onConfirm: () => void; onCancel: () => void; onSample: (text: string) => void;
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
    {proposal || !samples.length ? null : <button type="button" className={`${s.btn} ${s.sm} ${s.q} ${s.trybtn}`} aria-expanded={expanded} onClick={() => setOpen(v => !v)}>{suggest ? "Did you mean…?" : "Try saying…"}</button>}
    {proposal || !samples.length ? null : <div className={`${s.samples} ${expanded ? s.open : ""} ${suggest ? s.suggest : ""}`} data-testid={suggest ? "voice-suggestions" : undefined} role={suggest ? "group" : undefined} aria-label={suggest ? "Did you mean" : undefined}><span>{suggest ? "Did you mean…?" : "Try saying…"}</span>
      {samples.map(text => <button type="button" key={text} onClick={() => { setOpen(false); onSample(text); }}>{text}</button>)}</div>}
  </section>;
}

export function UndoSection({ recognition = true, label, enabled, reason, flash, histOpen, onUndo, onHist }: {
  recognition?: boolean; label: string; enabled: boolean; reason?: string; flash: number; histOpen: boolean; onUndo: () => void; onHist: (el: HTMLElement) => void;
}) {
  return <section className={`${s.dk} ${s.undo}`} aria-label="Undo">
    <button type="button" className={`${s.ubtn} ${flash ? s.flash : ""}`} key={flash} disabled={!enabled} onClick={onUndo} data-testid="undo">
      <Icon name="undo" /><span className={s.ut}><span className={s.ul} data-testid="undo-label">{enabled ? `Undo: ${label}` : "Nothing to undo"}</span>
        <span className={s.usub}>{reason ? `${reason} · ` : ""}<kbd>Ctrl</kbd> <kbd>Z</kbd>{recognition ? " · or say “undo”" : ""}</span></span>
    </button>
    <button type="button" className={s.hbtn} aria-haspopup="dialog" aria-expanded={histOpen} aria-label="Show recent actions" data-layer-opener data-testid="history-button"
      onClick={event => onHist(event.currentTarget)}><Icon name="hist" /></button>
  </section>;
}

"use client";

import { useEffect, useRef, useState, type ComponentProps, type ReactNode } from "react";
import { Icon } from "./icons";
import { PHASE_LONG } from "./model";
import { PhaseConfirm } from "./phase-track";
import type { Player } from "./chrome";
import { UndoSection } from "./dock";
import type { MicState } from "./use-voice";
import s from "./remote-ui.module.css";

export type BarVoice = {
  state: MicState; muted: boolean; onMute: () => void; level: number; recognition: boolean;
  /** A voice command waits for Enter. The popover opens by itself and stays open until it is answered. */ proposal: boolean;
  /** The voice details (mic status, push to talk, what was heard, sample commands). Shown in the popover. */ details: ReactNode;
  /** Open the drawer on its Settings tab (the voice settings live there). The popover then shows only a voice command that waits for Enter. */ onOpenSettings?: () => void;
};

/**
 * The one bottom bar of the table. Left: whose turn it is and Undo. Centre: the Think and OK signals. Right: the mic with its voice popover, Back and Pass turn.
 * The phases are not here: each player has their own phase boxes between their camera and their virtual field.
 */
export function BottomBar({ players, turnSeat, turn, phase, canAct, nextSeat, passHot, mine, turnIn, backTo, ask, onAsk, onAskYes, onAskNo, onPass, dockRef, undo, center, voice, voiceOff, settingsOpen, onSettings, onSurrender, onQuit }: {
  players: Player[]; turnSeat: number; turn: number; phase: string; canAct: boolean; nextSeat: number; passHot: boolean;
  /** The turn is mine (never true on a solo test table, where one person plays every seat). */ mine: boolean; turnIn: boolean;
  /** The phase before this one in this turn (`previousYgoPhase`), or null on the first phase. */ backTo: string | null;
  /** The phase the player is about to go back to (asks first). */ ask: string | null; onAsk: (id: string) => void; onAskYes: (id: string) => void; onAskNo: () => void;
  onPass: () => void; /** The table measures this bar (--dockh on a phone). */ dockRef?: React.Ref<HTMLDivElement>; undo: ComponentProps<typeof UndoSection>; center?: ReactNode;
  /** Null when there is no mic control (a spectator, or voice is not available at this table). */ voice: BarVoice | null;
  /** Voice commands are off for this player: the bar says so. */ voiceOff: boolean;
  /** The drawer is open on its Settings tab. */ settingsOpen: boolean; /** Opens the drawer on its Settings tab. */ onSettings: (el: HTMLElement) => void;
  /** Surrender and Quit match (the existing confirm flow, same gates). Each is undefined when the player may not use it. */ onSurrender?: (el: HTMLElement) => void; onQuit?: (el: HTMLElement) => void;
}) {
  const current = players.find(p => p.seat === turnSeat); const next = players.find(p => p.seat === nextSeat);
  const [open, setOpen] = useState(false);
  // Phone only: Undo, Think, OK, Settings, Surrender, Quit and Back sit in this "..." panel (on wider screens the wrapper is invisible).
  const [more, setMore] = useState(false);
  const voiceRef = useRef<HTMLDivElement>(null), moreRef = useRef<HTMLDivElement>(null);
  const shown = open || !!voice?.proposal;
  // The popover closes on a press outside it or on Escape. A press that closes it still reaches what was pressed.
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!voiceRef.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); setOpen(false); } };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [open]);
  useEffect(() => {
    if (!more) return;
    const away = (event: PointerEvent) => { if (!moreRef.current?.contains(event.target as Node)) setMore(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); event.preventDefault(); setMore(false); } };
    document.addEventListener("pointerdown", away, true); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away, true); document.removeEventListener("keydown", key); };
  }, [more]);
  const micLabel = voice ? (voice.muted ? "Unmute microphone" : "Mute microphone") : "";
  return <div ref={dockRef} className={`${s.bar} ${mine ? s.mine : ""}`} data-testid="rail" data-mine={mine || undefined} role="group" aria-label="Turn, undo and voice">
    <span className={s.sr} role="status" aria-live="polite" data-testid="rail-live">{mine ? "Your turn. " : ""}{current?.name ?? "Table"}&apos;s turn, turn {turn}, {PHASE_LONG[phase] ?? phase}.</span>
    <div className={s.bturn}>
      <span className={s.pip} style={{ "--c": current?.color } as React.CSSProperties} />
      <div className={s.tn}>
        <span className={s.tcap}>{mine ? <span className={s.you} data-testid="your-turn">Your turn</span> : null}<span className={s.tm}>Turn {turn}</span></span>
        <b data-testid="turn-name">{current?.name ?? "Table"}&apos;s turn</b></div>
    </div>
    <div ref={moreRef} className={s.bover} id="bar-more-panel" data-open={more || undefined} onClick={event => { if ((event.target as HTMLElement).closest("button:not(:disabled)")) setMore(false); }}>
    <UndoSection {...undo} />
    <div className={s.bsig}>{center}</div>
    <div className={s.bmenu} role="group" aria-label="Table menu">
      <button type="button" className={`${s.bmbtn} ${settingsOpen ? s.on : ""}`} aria-haspopup="dialog" aria-expanded={settingsOpen} data-layer-opener data-testid="settings-button" onClick={event => onSettings(event.currentTarget)}>
        <Icon name="gear" /><span>Settings</span></button>
      {onSurrender || onQuit ? <span className={s.bsep} aria-hidden="true" /> : null}
      {onSurrender ? <button type="button" className={`${s.bmbtn} ${s.bleave}`} aria-haspopup="dialog" data-layer-opener data-testid="surrender-button" onClick={event => onSurrender(event.currentTarget)}><Icon name="flag" /><span>Surrender</span></button> : null}
      {onQuit ? <button type="button" className={`${s.bmbtn} ${s.bleave}`} aria-haspopup="dialog" aria-label="Quit match" data-layer-opener data-testid="quit-button" onClick={event => onQuit(event.currentTarget)}><Icon name="x" /><span>Quit<span className={s.bmore}> match</span></span></button> : null}
    </div>
    <button type="button" className={s.pback} disabled={!canAct || !backTo} data-testid="phase-back" onClick={() => backTo && onAsk(backTo)}
      aria-label={backTo ? `Back to ${PHASE_LONG[backTo] ?? backTo}` : "No earlier phase"} title={backTo ? `Back to ${PHASE_LONG[backTo] ?? backTo}` : "No earlier phase"}>
      <span aria-hidden="true">◀</span> Back</button>
    </div>
    <button type="button" className={`${s.bmoreBtn} ${more ? s.on : ""}`} aria-haspopup="true" aria-expanded={more} aria-controls="bar-more-panel" aria-label="More: undo, signals, settings, surrender" data-testid="bar-more"
      onClick={() => setMore(v => !v)}><Icon name="dots" /></button>
    {voice ? <div className={s.bvoice} ref={voiceRef} data-testid="mic" data-mic={voice.state}>
      <button type="button" className={`${s.bmic} ${s[voice.state] ?? ""}`} aria-pressed={voice.muted} aria-label={micLabel} title={micLabel} data-testid="mic-button" onClick={voice.onMute}>
        <Icon name={voice.state === "muted" ? "micoff" : "mic"} /></button>
      {voice.recognition
        ? <button type="button" className={`${s.bvbtn} ${shown ? s.on : ""}`} aria-haspopup="dialog" aria-expanded={shown} data-layer-opener data-testid="voice-open" onClick={() => voice.onOpenSettings ? voice.onOpenSettings() : setOpen(v => !v)}>
          <span className={s.bvl}>{voice.state === "muted" ? "Muted" : voice.state === "listen" ? "Listening" : "Voice"}</span>
          <span className={s.meter} aria-hidden="true">{Array.from({ length: 5 }, (_, i) => <i key={i} style={{ height: voice.state === "muted" || voice.state === "off" ? 3 : Math.max(3, Math.round(voice.level * 14 * (0.45 + 0.55 * Math.sin((i + 1) * 1.7) ** 2))) }} />)}</span></button>
        : null}
      {shown && voice.recognition ? <div className={s.vpop} role="dialog" aria-label="Voice" data-testid="voice-popover">{voice.details}</div> : null}
    </div> : null}
    {voiceOff ? <span className={s.bvoff} data-testid="voice-off" title="Voice commands are off. Use the phase boxes, the buttons and the keyboard.">Voice off</span> : null}
    <button type="button" className={`${s.pass} ${passHot ? s.hot : ""}`} disabled={!canAct} data-testid="pass-turn" onClick={onPass} data-turn-in={turnIn || undefined}>
      <span>Pass turn</span><Icon name="next" /><span className={s.pip} style={{ "--c": next?.color } as React.CSSProperties} /><span>{next?.name ?? ""}</span></button>
    {ask ? <PhaseConfirm ask={ask} onYes={onAskYes} onNo={onAskNo} /> : null}
  </div>;
}

"use client";

import { useCallback, type CSSProperties, useEffect, useLayoutEffect, useReducer, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { REMOTE_EXTRA_TURNS, remoteMatchDeadline, type RemoteEvent, type RemoteMatch } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { useTableRoot } from "./coin-die";
import { Icon } from "./icons";
import { MATCH_TIME_RULE, matchClockDisplay } from "./match-model";
import r from "./remote-ui.module.css";
import m from "./match-timer.module.css";

/** How long the "Time!" banner shows on every screen. */
export const TIME_CALL_HOLD_MS = 4000;
export type TimeCallHold = { eventId: string; at: number; turn: number | null; seat: number | null; until: number };

/** A call older than this when the screen first sees it (a reload, a late join) shows no banner. */
const TIME_CALL_FRESH_MS = 15_000;

/**
 * The time call that still shows (null when none). `now` is on the server clock, like `event.at`.
 * The server settles a call a little after the deadline, so the hold runs from the later of the call and the moment this screen first saw it (`seenAt`).
 */
export function activeTimeCall(events: readonly RemoteEvent[], now: number, seenAt?: number): TimeCallHold | null {
  const event = events.findLast(item => item.action.type === "time.called");
  const action = event?.action;
  if (!event || action?.type !== "time.called") return null;
  if (seenAt !== undefined && seenAt - event.at > TIME_CALL_FRESH_MS) return null;
  const at = Math.max(event.at, seenAt ?? 0), until = at + TIME_CALL_HOLD_MS;
  return until > now ? { eventId: event.id, at, turn: action.turn, seat: action.seat, until } : null;
}

/** The time call that shows now, re-read when it runs out. */
export function useTimeCallHold(events: readonly RemoteEvent[]): TimeCallHold | null {
  const [beat, tick] = useReducer((n: number) => n + 1, 0);
  const seen = useRef<{ id: string; at: number } | null>(null);
  const last = events.findLast(item => item.action.type === "time.called");
  if (last && seen.current?.id !== last.id) seen.current = { id: last.id, at: serverNow() };
  const hold = activeTimeCall(events, serverNow(), seen.current?.at);
  const until = hold?.until;
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(tick, Math.max(0, until - serverNow()) + 20);
    return () => clearTimeout(timer);
  }, [until, hold?.eventId, beat]); // beat: a timer that fires a little early (clock skew) is set again
  return hold;
}

/** The one-time banner when time is called, centred on the table like the coin and die. It never takes clicks. */
export function TimeCallOverlay({ hold, name }: { hold: TimeCallHold | null; name: (seat: number) => string }) {
  const [root, marker] = useTableRoot("#stage");
  return <>
    <span ref={marker} hidden />
    {hold && root ? createPortal(<TimeCallView key={hold.eventId} hold={hold} name={name} floating={root === document.body} />, root) : null}
  </>;
}

function TimeCallView({ hold, name, floating }: { hold: TimeCallHold; name: (seat: number) => string; floating: boolean }) {
  // Read once: a changed delay would restart a running animation. A late or reloaded screen joins the same timeline.
  const [spent] = useState(() => Math.max(0, serverNow() - hold.at));
  const between = hold.turn === null;
  const line = between ? "The match is decided on games won." : `This is Turn 0${hold.seat === null ? "" : `, ${name(hold.seat)}’s turn`}.`;
  const next = between ? null : `${REMOTE_EXTRA_TURNS} extra turns follow, then Life Points decide.`;
  return <div className={m.overlay} role="status" aria-label={`Time! ${line} ${next ?? ""}`.trim()} style={{ "--spent": `${-spent}ms` } as CSSProperties}
    data-testid="time-call-overlay" data-floating={floating || undefined} data-between={between || undefined}>
    <div className={m.banner}>
      <small>Match time</small>
      <b>Time!</b>
      <p>{line}</p>
      {next ? <p className={m.next}>{next}</p> : null}
    </div>
  </div>;
}

/** The host's "Turn off match timer": one press asks, a second press confirms. */
export function MatchTimeOff({ onConfirm }: { onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  const yes = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (ask) yes.current?.focus(); }, [ask]);
  if (!ask) return <button type="button" className={`${r.btn} ${r.sm}`} data-testid="match-time-off" onClick={() => setAsk(true)}>Turn off match timer</button>;
  return <div className={m.confirm} role="alertdialog" aria-label="Turn off match timer" data-testid="match-time-off-confirm"
    onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setAsk(false); } }}>
    <p>Turn off the match timer for everyone? It stays off for the rest of this match.</p>
    <div className={m.confirmRow}>
      <button type="button" ref={yes} className={`${r.btn} ${r.sm} ${r.danger}`} data-testid="match-time-off-yes" onClick={() => { setAsk(false); onConfirm(); }}>Turn off timer</button>
      <button type="button" className={`${r.btn} ${r.sm} ${r.q}`} data-testid="match-time-off-no" onClick={() => setAsk(false)}>Keep timer</button>
    </div>
  </div>;
}

const POP_WIDTH = 300, EDGE = 8, GAP = 8;

/**
 * The match clock in the top bar: server time, amber under 5 min, red under 1 min. After time is called it reads "Time · Turn 0", then "Extra 1/3".
 * With `info` the chip opens a small panel with the Konami rule and, for the host (`onTurnOff`), Turn off match timer.
 */
export function MatchTimer({ match, turn, endedAt, info, onTurnOff }: { match: RemoteMatch; turn: number; endedAt?: number | null; info?: boolean; onTurnOff?: () => void }) {
  const clock = match.clock;
  const deadline = remoteMatchDeadline(clock);
  const [now, setNow] = useState(serverNow);
  const running = deadline !== undefined && !clock?.called && endedAt == null;
  useEffect(() => {
    if (!running) return;
    setNow(serverNow());
    const interval = window.setInterval(() => setNow(serverNow()), 250);
    return () => window.clearInterval(interval);
  }, [running]);
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; top: number } | null>(null);
  const [root, marker] = useTableRoot();
  const chip = useRef<HTMLButtonElement>(null), pop = useRef<HTMLDivElement>(null);
  const place = useCallback(() => {
    const box = chip.current?.getBoundingClientRect(); if (!box) return;
    const width = Math.min(POP_WIDTH, window.innerWidth - 2 * EDGE);
    setAt({ left: Math.max(EDGE, Math.min(box.left, window.innerWidth - width - EDGE)), top: box.bottom + GAP });
  }, []);
  useLayoutEffect(() => {
    if (!open) { setAt(null); return; }
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open, place]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { const node = event.target as Node; if (!chip.current?.contains(node) && !pop.current?.contains(node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); chip.current?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const display = matchClockDisplay(match, turn, endedAt ?? now);
  useEffect(() => { if (!display) setOpen(false); }, [display]);
  if (!display) return null;
  const { text, label, tone, rule } = display;
  const [prefix, rest] = text.startsWith("Time · ") ? ["Time · ", text.slice(7)] : ["", text];
  const body = <><Icon name="clock" /><b><span className={r.mpre}>{prefix}</span>{rest}</b></>;
  if (!info) return <span className={`${r.dtimer} ${r.mtimer}`} data-tone={tone} role="timer" aria-label={label} title={rule ? `${label}. ${rule}` : label} data-testid="match-timer">{body}</span>;
  return <>
    <span ref={marker} hidden />
    <button ref={chip} type="button" className={`${r.dtimer} ${r.mtimer} ${r.mbtn}`} data-tone={tone} role="timer" aria-live="off" aria-haspopup="dialog" aria-expanded={open} aria-label={label}
      title={rule ? `${label}. ${rule}` : label} data-testid="match-timer" onClick={() => setOpen(value => !value)}>{body}</button>
    {open && root ? createPortal(
      <div ref={pop} className={m.pop} role="dialog" aria-label="Match time" data-testid="match-timer-info" data-floating={root === document.body || undefined}
        style={{ left: at?.left ?? EDGE, top: at?.top ?? EDGE, width: Math.min(POP_WIDTH, window.innerWidth - 2 * EDGE), visibility: at ? "visible" : "hidden" }}>
        <h3>Match time</h3>
        <p className={m.state} data-tone={tone} data-testid="match-timer-state">{label}</p>
        {rule ? <p className={m.rule}>{rule}</p> : null}
        {onTurnOff && tone !== "muted" && !clock?.result ? <MatchTimeOff onConfirm={() => { setOpen(false); onTurnOff(); }} /> : null}
      </div>, root) : null}
  </>;
}

export { MATCH_TIME_RULE };

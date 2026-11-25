"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { cardName, type TwinCard } from "./model";
import type { CardInfo } from "./catalog";
import { activeOk, type OkHold } from "./think-model";
import s from "./think.module.css";

/** The "OK" that shows now (null when none), re-read when it runs out. */
export function useOkHold(events: readonly RemoteEvent[]): OkHold | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const hold = activeOk(events, serverNow());
  const until = hold?.until;
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(tick, Math.max(0, until - serverNow()) + 20);
    return () => clearTimeout(timer);
  }, [until, hold?.eventId]);
  return hold;
}

/** Whole seconds since `since` (server clock), counted up once a second. */
function useElapsed(since: number): number {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  useEffect(() => { const timer = setInterval(tick, 1000); return () => clearInterval(timer); }, []);
  return Math.max(0, Math.floor((serverNow() - since) / 1000));
}
const clock = (seconds: number) => seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

/** The thought cloud with three dots that blink in turn. */
function ThinkIcon({ className = s.icon }: { className?: string }) {
  return <svg className={className} viewBox="0 0 64 64" aria-hidden="true">
    <path className={s.cloud} d="M16 42a9 9 0 0 1-1-18 12 12 0 0 1 23-4 10 10 0 0 1 12 9 9 9 0 0 1-3 13z" />
    <g className={s.dots}><circle cx="23" cy="31" r="3" /><circle cx="32" cy="31" r="3" /><circle cx="41" cy="31" r="3" /></g>
    <circle cx="21" cy="51" r="3.4" fill="currentColor" /><circle cx="13" cy="58" r="2.2" fill="currentColor" />
  </svg>;
}

/** The state that stays beside a thinking player's field after the call-out: the thought icon and the seconds they have thought. */
export function ThinkingChip({ since, seat, who }: { since: number; seat: number; who?: string }) {
  const seconds = useElapsed(since);
  return <span className={s.chip} role="img" aria-label={`${who ?? "Player"} is thinking, ${seconds} seconds`} title={who ? `${who} is thinking` : "Thinking"} data-testid={`thinking-chip-${seat}`}><ThinkIcon />
    <b aria-hidden="true">{clock(seconds)}</b></span>;
}

/** The call-out plays this long (0.3 s in, 0.9 s hold, 0.3 s out) and only for a start that is this fresh, so a reload does not replay it. */
const CALLOUT_MS = 1500;
type Call = { key: string; seat: number; who: string; angle: number | null; side: "left" | "right" };

/** The direction from the middle of the screen to that player's field, or null when the field is not on this screen. */
function aimAt(seat: number): { angle: number; side: "left" | "right" } | null {
  if (typeof document === "undefined") return null;
  const el = document.querySelector(`[data-plate="${seat}"], [data-lp-seat="${seat}"]`); if (!el) return null;
  const rect = el.getBoundingClientRect(); if (rect.width < 2 && rect.height < 2) return null;
  const dx = rect.left + rect.width / 2 - window.innerWidth / 2, dy = rect.top + rect.height / 2 - window.innerHeight / 2;
  return { angle: Math.round(Math.atan2(dy, dx) * 180 / Math.PI), side: dx < 0 ? "left" : "right" };
}

/**
 * One short call-out per player who just started thinking, on every screen. It never takes clicks and goes by itself;
 * the lasting state is the chip in that player's own panel. `pointer` adds an arrow toward the thinker's side (3 and 4 players).
 */
export function ThinkingCallout({ thinking, name, pointer }: { thinking: ReadonlyMap<number, number>; name: (seat: number) => string; pointer: boolean }) {
  const [calls, setCalls] = useState<Call[]>([]);
  const seen = useRef(new Set<string>()); const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  const nameRef = useRef(name); nameRef.current = name;
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear(); }, []);
  useEffect(() => {
    const fresh: Call[] = [];
    for (const [seat, since] of thinking) {
      const key = `${seat}:${since}`;
      if (seen.current.has(key)) continue; seen.current.add(key);
      if (serverNow() - since > CALLOUT_MS - 300) continue;
      const aim = pointer ? aimAt(seat) : null;
      fresh.push({ key, seat, who: nameRef.current(seat), angle: aim?.angle ?? null, side: aim?.side ?? "right" });
    }
    if (!fresh.length) return;
    setCalls(old => [...old, ...fresh]);
    const timer = setTimeout(() => { timers.current.delete(timer); setCalls(old => old.filter(call => !fresh.includes(call))); }, CALLOUT_MS + 80);
    timers.current.add(timer);
  }, [thinking, pointer]);
  if (!calls.length) return null;
  return <div className={s.callouts} data-testid="thinking-callout">
    {calls.map(call => {
      const arrow = call.angle === null ? null : <span className={s.aim} style={{ transform: `rotate(${call.angle}deg)` }} aria-hidden="true" data-testid={`thinking-aim-${call.seat}`}>
        <svg viewBox="0 0 24 24"><path d="M4 12h13M12 5l7 7-7 7" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg></span>;
      return <div key={call.key} className={s.band} role="status" data-testid={`thinking-banner-${call.seat}`}>
        {call.side === "left" ? arrow : null}
        <div className={s.medal}><ThinkIcon className="" /></div>
        <div className={s.txt}><div className={s.who}><i>{call.seat + 1}</i>{call.who}</div><div className={s.word}>Thinking</div></div>
        {call.side === "right" ? arrow : null}
      </div>;
    })}
  </div>;
}

/** A short "OK" with the player's name for about a second and a half. */
export function OkBanner({ hold, name }: { hold: OkHold | null; name: (seat: number) => string }) {
  if (!hold) return null;
  return <div className={s.ok} key={hold.eventId} role="status" data-testid="ok-banner"><small>{name(hold.seat)}</small><b>OK</b></div>;
}

/** The numbered row for "E" when the card is unclear. A number key picks, Escape closes. */
export function ActivateRow({ cards, info, onPick, onClose }: { cards: readonly TwinCard[]; info: (id: number | undefined) => CardInfo | undefined; onPick: (card: TwinCard) => void; onClose: () => void }) {
  return <div className={s.row} role="group" aria-label="Activate which card? Press a number, or Escape to close" data-testid="activate-row">
    <span className={s.rowHead}>Activate which card?</span>
    <ol>{cards.map((card, index) => <li key={card.ref}>
      <button type="button" onClick={() => onPick(card)}><kbd>{index + 1}</kbd><span>{cardName(card, info(card.cardId ?? card.passcode))}</span></button>
    </li>)}</ol>
    <button type="button" className={s.rowClose} onClick={onClose} aria-label="Close">Esc</button>
  </div>;
}

"use client";

import { useEffect, useReducer } from "react";
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

/** A thin ring with one slow arc and a soft centre. Quiet on purpose. */
function ThinkIcon() {
  return <svg className={s.icon} viewBox="0 0 24 24" aria-hidden="true">
    <circle className={s.ring} cx="12" cy="12" r="9" />
    <path className={s.arc} d="M12 3a9 9 0 0 1 9 9" />
    <circle className={s.core} cx="12" cy="12" r="2.6" />
  </svg>;
}

/** The state in a player's own status area: "Thinking… 12s". */
export function ThinkingChip({ since, seat }: { since: number; seat: number }) {
  const seconds = useElapsed(since);
  return <span className={s.chip} role="status" data-testid={`thinking-chip-${seat}`}><ThinkIcon />Thinking… <b aria-hidden="true">{clock(seconds)}</b></span>;
}

/** One banner per thinking player, on every screen. It never takes clicks and never ends by itself. */
export function ThinkingBanner({ thinking, name, lowered }: { thinking: ReadonlyMap<number, number>; name: (seat: number) => string; lowered: boolean }) {
  const seats = [...thinking];
  if (!seats.length) return null;
  return <div className={`${s.stack} ${lowered ? s.low : ""}`} data-testid="thinking-banner">
    {seats.map(([seat, since]) => <ThinkingLine key={seat} seat={seat} since={since} who={name(seat)} />)}
  </div>;
}
function ThinkingLine({ seat, since, who }: { seat: number; since: number; who: string }) {
  const seconds = useElapsed(since);
  return <div className={s.line} role="status" data-testid={`thinking-banner-${seat}`}>
    <ThinkIcon /><small>{who}</small><b>Thinking…</b><time aria-hidden="true">{clock(seconds)}</time>
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

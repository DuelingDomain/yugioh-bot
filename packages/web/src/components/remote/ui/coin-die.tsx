"use client";

import { useEffect, useReducer, useRef, useState } from "react";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { activeRoll, rollWord, type RollHold } from "./roll-model";
import s from "./coin-die.module.css";

/** The roll that shows now (null when none), re-read when it runs out. */
export function useRollHold(events: readonly RemoteEvent[]): RollHold | null {
  const [, tick] = useReducer((n: number) => n + 1, 0);
  const hold = activeRoll(events, serverNow());
  const until = hold?.until;
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(tick, Math.max(0, until - serverNow()) + 20);
    return () => clearTimeout(timer);
  }, [until, hold?.eventId]);
  return hold;
}

/** A short toast with the roller's name and the result. The spin lasts under a second. */
export function RollBanner({ hold, name }: { hold: RollHold | null; name: (seat: number) => string }) {
  if (!hold) return null;
  const word = rollWord(hold.kind, hold.result);
  return <div className={s.toast} key={hold.eventId} role="status" data-testid="roll-banner" data-kind={hold.kind} data-seat={hold.seat} data-result={hold.result}>
    <span className={`${s.token} ${hold.kind === "coin" ? s.coin : s.die}`} aria-hidden="true">{hold.kind === "coin" ? word[0] : hold.result}</span>
    <span className={s.text}><small>{name(hold.seat)} {hold.kind === "coin" ? "flipped a coin" : "rolled a die"}</small><b>{word}</b></span>
  </div>;
}

/** "Coin / Die" in the bottom bar: a small menu with Flip coin and Roll die. The server picks the result. */
export function CoinDieControl({ onRoll, disabled }: { onRoll: (kind: "coin" | "die") => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { if (!box.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key); };
  }, [open]);
  const pick = (kind: "coin" | "die") => { setOpen(false); onRoll(kind); };
  return <div className={s.control} ref={box}>
    <button type="button" className={s.open} aria-haspopup="menu" aria-expanded={open} disabled={disabled} onClick={event => { setOpen(v => !v); event.currentTarget.blur(); }}
      title="Flip a coin or roll a die for a card effect" data-testid="coin-die-button">Coin / Die</button>
    {open ? <div className={s.menu} role="menu" data-testid="coin-die-menu">
      <button type="button" role="menuitem" onClick={() => pick("coin")} data-testid="flip-coin">Flip coin <small>Heads / Tails</small></button>
      <button type="button" role="menuitem" onClick={() => pick("die")} data-testid="roll-die">Roll die <small>1 to 6</small></button>
    </div> : null}
  </div>;
}

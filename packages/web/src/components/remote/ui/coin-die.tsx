"use client";

import { useEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { DiceDie } from "@/components/duel/dice-die";
import { DICE_TIMELINE, DICE_TIMELINE_REDUCED, dicePlan, landsAt, type DiceTimeline } from "@/components/duel/dice-model";
import { useDiceSkin } from "@/components/duel/dice-skins";
import { ROLL_SPIN_MS, activeRoll, rollWord, type RollHold } from "./roll-model";
import s from "./coin-die.module.css";

/** The roll that shows now (null when none), re-read when it runs out. */
export function useRollHold(events: readonly RemoteEvent[]): RollHold | null {
  const [beat, tick] = useReducer((n: number) => n + 1, 0);
  const hold = activeRoll(events, serverNow());
  const until = hold?.until;
  useEffect(() => {
    if (until === undefined) return;
    const timer = setTimeout(tick, Math.max(0, until - serverNow()) + 20);
    return () => clearTimeout(timer);
  }, [until, hold?.eventId, beat]); // beat: a timer that fires a little early (clock skew) is set again
  return hold;
}

/** The die of a roll: the duel dice die, thrown for the time that is left of the spin (a late screen shows it at rest). */
const ROLL_TIMELINE: DiceTimeline = { ...DICE_TIMELINE, tumbleMin: ROLL_SPIN_MS - 100, tumbleMax: ROLL_SPIN_MS - 100, stagger: 0 };

function RollDie({ hold, reduced }: { hold: RollHold; reduced: boolean }) {
  const skin = useDiceSkin();
  const timeline = reduced ? DICE_TIMELINE_REDUCED : ROLL_TIMELINE;
  const plan = dicePlan(1, hold.seat, timeline);
  // Read once when the overlay mounts: after the spin time there is nothing to throw.
  const [throwing] = useState(() => serverNow() - hold.at < landsAt(plan, timeline));
  return <div className={s.dieBox}>
    <DiceDie value={hold.result} skin={skin} throwRound={throwing ? 1 : null} plan={plan} timeline={timeline} landing="land" reduced={reduced} sampleElapsed={() => serverNow() - hold.at} />
  </div>;
}

/** A two-sided disc in brand purple and gold. The spin runs from the roll time, so a late screen shows the landed side. */
function RollCoin({ hold, spent }: { hold: RollHold; spent: number }) {
  const delay = -spent;
  const end = hold.result === 2 ? 180 : 0;
  return <div className={s.coinBox}>
    <div className={s.coinTilt}>
      <div className={s.coin3d} style={{ "--end": `${end}deg`, "--turns": `${1800 + end}deg`, animationDelay: `${delay}ms` } as CSSProperties}>
        <span className={`${s.face} ${s.heads}`}>H</span>
        <span className={`${s.face} ${s.tails}`}>T</span>
      </div>
    </div>
  </div>;
}

/** The roll in the middle of every screen: a coin or die that spins about 1.2 s, then the result with the roller's name for about 2 s, then a fade. It never takes clicks. */
export function RollOverlay({ hold, name }: { hold: RollHold | null; name: (seat: number) => string }) {
  return hold ? <RollView key={hold.eventId} hold={hold} name={name} /> : null;
}

function RollView({ hold, name }: { hold: RollHold; name: (seat: number) => string }) {
  const [reduced] = useState(() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } });
  // Read once: a changed delay would restart a running animation. The negative delays put a late or reloaded screen at the right moment of the same timeline.
  const [spent] = useState(() => Math.max(0, serverNow() - hold.at));
  const word = rollWord(hold.kind, hold.result);
  return <div className={s.overlay} role="status" aria-label={`${name(hold.seat)}: ${word}`} style={{ "--spent": `${-spent}ms` } as CSSProperties}
    data-testid="roll-overlay" data-kind={hold.kind} data-seat={hold.seat} data-result={hold.result} data-spun={spent >= ROLL_SPIN_MS ? "true" : "false"}>
    <div className={s.stage}>
      {hold.kind === "coin" ? <RollCoin hold={hold} spent={spent} /> : <RollDie hold={hold} reduced={reduced} />}
      <p className={s.result} data-testid="roll-result"><small>{hold.kind === "coin" ? "Coin flip" : "Die roll"}</small><b>{name(hold.seat)} &mdash; {word}</b></p>
    </div>
  </div>;
}

/** "Coin / Die" in the bottom bar: a small menu with Flip a coin and Roll a die. The server picks the result. */
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
      <button type="button" role="menuitem" onClick={() => pick("coin")} data-testid="flip-coin">Flip a coin <small>Heads / Tails</small></button>
      <button type="button" role="menuitem" onClick={() => pick("die")} data-testid="roll-die">Roll a die <small>1 to 6</small></button>
    </div> : null}
  </div>;
}

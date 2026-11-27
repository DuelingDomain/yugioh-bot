"use client";

import { useCallback, useEffect, useLayoutEffect, useReducer, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import type { RemoteEvent } from "@yugidraft/shared/remote";
import { serverNow } from "./api";
import { DiceDie } from "@/components/duel/dice-die";
import { DICE_TIMELINE, DICE_TIMELINE_REDUCED, dicePlan, landsAt, type DiceTimeline } from "@/components/duel/dice-model";
import { useDiceSkin } from "@/components/duel/dice-skins";
import { ROLL_SPIN_MS, activeRoll, rollWord, type RollHold } from "./roll-model";
import { Icon } from "./icons";
import { Row } from "./zone-actions";
import r from "./remote-ui.module.css";
import s from "./coin-die.module.css";

/**
 * The table root (`.app`), found from a hidden marker that sits where the caller renders. A roll or a menu drawn there is laid out against the screen, not against the
 * board or the bar around the marker (a transformed or pushed ancestor cannot move it), and it still has the table colours. Without a table root it is the page body.
 */
function useTableRoot() {
  const [root, setRoot] = useState<Element | null>(null);
  const marker = useCallback((node: HTMLElement | null) => { setRoot(node ? node.closest(`.${r.app}`) ?? document.body : null); }, []);
  return [root, marker] as const;
}

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
  const [root, marker] = useTableRoot();
  return <>
    <span ref={marker} hidden />
    {hold && root ? createPortal(<RollView key={hold.eventId} hold={hold} name={name} floating={root === document.body} />, root) : null}
  </>;
}

function RollView({ hold, name, floating }: { hold: RollHold; name: (seat: number) => string; floating: boolean }) {
  const [reduced] = useState(() => { try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { return false; } });
  // Read once: a changed delay would restart a running animation. The negative delays put a late or reloaded screen at the right moment of the same timeline.
  const [spent] = useState(() => Math.max(0, serverNow() - hold.at));
  const word = rollWord(hold.kind, hold.result);
  return <div className={s.overlay} role="status" aria-label={`${name(hold.seat)}: ${word}`} style={{ "--spent": `${-spent}ms` } as CSSProperties}
    data-testid="roll-overlay" data-floating={floating || undefined} data-kind={hold.kind} data-seat={hold.seat} data-result={hold.result} data-spun={spent >= ROLL_SPIN_MS ? "true" : "false"}>
    <div className={s.stage}>
      {hold.kind === "coin" ? <RollCoin hold={hold} spent={spent} /> : <RollDie hold={hold} reduced={reduced} />}
      <p className={s.result} data-testid="roll-result"><small>{name(hold.seat)} &middot; {hold.kind === "coin" ? "Coin flip" : "Die roll"}</small><b>{word}</b></p>
    </div>
  </div>;
}

const MENU_WIDTH = 224, MENU_GAP = 8, EDGE = 8;

/** "Coin / Die" in the bottom bar: a small menu with Flip a coin and Roll a die. The server picks the result. */
export function CoinDieControl({ onRoll, disabled }: { onRoll: (kind: "coin" | "die") => void; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [at, setAt] = useState<{ left: number; bottom: number } | null>(null);
  const [root, marker] = useTableRoot();
  const button = useRef<HTMLButtonElement>(null), menu = useRef<HTMLDivElement>(null);
  // The menu sits above the button, centred on it, and never leaves the screen. It is placed on open and again when the window changes.
  useLayoutEffect(() => {
    if (!open) { setAt(null); return; }
    const place = () => {
      const box = button.current?.getBoundingClientRect(); if (!box) return;
      const width = Math.min(MENU_WIDTH, window.innerWidth - 2 * EDGE);
      setAt({ left: Math.max(EDGE, Math.min(box.left + box.width / 2 - width / 2, window.innerWidth - width - EDGE)), bottom: Math.max(EDGE, window.innerHeight - box.top + MENU_GAP) });
    };
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const away = (event: PointerEvent) => { const node = event.target as Node; if (!button.current?.contains(node) && !menu.current?.contains(node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); button.current?.focus(); } };
    document.addEventListener("pointerdown", away); document.addEventListener("keydown", key, true);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", key, true); };
  }, [open]);
  const pick = (kind: "coin" | "die") => { setOpen(false); onRoll(kind); };
  return <div className={s.control}>
    <span ref={marker} hidden />
    {/* The press stays here: on a phone the bar's "..." panel would close on it and take the menu's anchor away. */}
    <button ref={button} type="button" className={`${r.btn} ${r.sm} ${r.q} ${s.open}`} aria-haspopup="menu" aria-expanded={open} disabled={disabled}
      onClick={event => { event.stopPropagation(); setOpen(v => !v); }}
      title="Flip a coin or roll a die for a card effect" data-testid="coin-die-button"><Icon name="coin" />Coin / Die</button>
    {open && root ? createPortal(
      <div ref={menu} className={s.menu} role="menu" aria-label="Coin or die" data-testid="coin-die-menu" data-floating={root === document.body || undefined}
        style={{ left: at?.left ?? EDGE, bottom: at?.bottom ?? EDGE, width: Math.min(MENU_WIDTH, window.innerWidth - 2 * EDGE), visibility: at ? "visible" : "hidden" }}>
        <Row icon="coin" role="menuitem" title="Heads or tails" onClick={() => pick("coin")} data-testid="flip-coin">Flip a coin</Row>
        <Row icon="refresh" role="menuitem" title="A number from 1 to 6" onClick={() => pick("die")} data-testid="roll-die">Roll a die</Row>
      </div>, root) : null}
  </div>;
}

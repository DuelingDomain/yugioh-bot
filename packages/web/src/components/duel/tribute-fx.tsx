"use client";

/**
 * The Tribute animation, one ghost per Tribute (a "move" plan of style "tribute", see move-plan.ts).
 *
 * The Tribute rises off its zone, its slices peel away from the top down and burn out, and as they go motes of
 * energy leave it, curve across the board and gather in the zone of the monster being summoned, where they flash.
 * The Graveyard pulses as the burned card is counted in. The summoned monster's own plan starts 40 ms before the
 * last energy lands (TRIBUTE_TIMING), so the summon plays straight out of the flash.
 *
 * Everything is driven by the engine's events, so the opponent sees the same thing with no prompt on screen.
 * Only transform and opacity animate. Reduced motion never gets here: the planner gives those Tributes the plain
 * "fade" style (a short fade at the Graveyard) and the summon a short beat.
 */
import { useLayoutEffect, useMemo, useRef, type CSSProperties } from "react";
import { cardArtUrl } from "./constants";
import { findMoveDestination, findZoneElement } from "./event-queue";
import { TRIBUTE_TIMING } from "./duel-timing";
import type { MovePlan } from "./move-plan";
import { Track } from "./summon-fx";
import styles from "./tribute-fx.module.css";

const CARD_ASPECT = 0.686;
/** The card is cut into this many bands that burn away from the top down. */
export const TRIBUTE_SLICES = 7;
/** Motes of energy per Tribute. */
export const TRIBUTE_ORBS = 6;
/** Time between one mote setting off and the next. */
const ORB_GAP_MS = 26;

type Props = {
  plan: MovePlan;
  overlay: HTMLElement;
  /** The burned card is counted into the Graveyard. */
  landed: () => void;
  done: () => void;
};

export type TributeTimeline = {
  /** The Tribute has burned and the Graveyard takes it. */
  graveAtMs: number;
  /** The last energy arrives. */
  energyEndMs: number;
  /** Everything has finished. */
  totalMs: number;
};

/** Pure: the moments of one Tribute's animation, from its start. */
export function tributeTimeline(): TributeTimeline {
  const energyStart = TRIBUTE_TIMING.liftMs + TRIBUTE_TIMING.orbDelayMs;
  const energyEndMs = energyStart + TRIBUTE_TIMING.orbMs;
  const graveAtMs = TRIBUTE_TIMING.liftMs + TRIBUTE_TIMING.dissolveMs;
  const gatherEnd = energyEndMs - TRIBUTE_TIMING.gatherMs * 0.45 + TRIBUTE_TIMING.gatherMs;
  const pulseEnd = graveAtMs + TRIBUTE_TIMING.pulseMs;
  return { graveAtMs, energyEndMs, totalMs: Math.max(energyEndMs, gatherEnd, pulseEnd) };
}

/** Deterministic spread of the motes across the card, so two Tributes do not burn identically. */
export function orbStart(index: number, id: number, w: number, h: number): { x: number; y: number } {
  const t = TRIBUTE_ORBS > 1 ? index / (TRIBUTE_ORBS - 1) : 0.5;
  const wobble = Math.sin(id * 12.9898 + index * 78.233) * 0.5;
  return { x: wobble * w * 0.7, y: (t - 0.5) * h * 0.8 };
}

export function TributeGhost({ plan, overlay, landed, done }: Props) {
  const root = useRef<HTMLDivElement>(null);
  const lift = useRef<HTMLDivElement>(null);
  const slices = useRef<Array<HTMLSpanElement | null>>([]);
  const burns = useRef<Array<HTMLElement | null>>([]);
  const orbs = useRef<Array<HTMLSpanElement | null>>([]);
  const flash = useRef<HTMLSpanElement>(null);
  const pulse = useRef<HTMLSpanElement>(null);
  const landedRef = useRef(landed);
  landedRef.current = landed;
  const doneRef = useRef(done);
  doneRef.current = done;
  const card = plan.event.card != null && plan.event.card.code > 0 ? plan.event.card : null;
  const bands = useMemo(() => Array.from({ length: TRIBUTE_SLICES }, (_, i) => i), []);
  const motes = useMemo(() => Array.from({ length: TRIBUTE_ORBS }, (_, i) => i), []);

  useLayoutEffect(() => {
    const el = root.current;
    const source = plan.source;
    const tribute = plan.tribute;
    const o = overlay.getBoundingClientRect();
    if (!el || !card || !source || !tribute || source.rect.width < 4 || source.rect.height < 4 || o.width < 4) {
      // Nothing to draw it from: the card is simply counted into the Graveyard.
      landedRef.current();
      doneRef.current();
      return undefined;
    }
    const z = source.rect;
    const h = z.height;
    const w = Math.min(z.width, h * CARD_ASPECT);
    const cx = z.left - o.left + z.width / 2;
    const cy = z.top - o.top + z.height / 2;
    el.style.left = `${cx - w / 2}px`;
    el.style.top = `${cy - h / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    el.style.setProperty("--fx-r", `${Math.max(2, w * 0.05)}px`);
    el.style.setProperty("--orb", `${Math.max(8, Math.min(18, w * 0.2))}px`);

    // A Defense Position card lies on its side; the opponent's side of the table is turned half way round.
    const turn = (source.side === "opp" ? 180 : 0) + (source.defense ? 90 : 0);
    const into = findZoneElement(tribute.to)?.getBoundingClientRect();
    const tx = into && into.width > 4 ? into.left - o.left + into.width / 2 - cx : 0;
    const ty = into && into.height > 4 ? into.top - o.top + into.height / 2 - cy : -h * 1.2;
    const grave = findMoveDestination(plan.event)?.getBoundingClientRect();
    const gx = grave && grave.width > 4 ? grave.left - o.left + grave.width / 2 - cx : 0;
    const gy = grave && grave.height > 4 ? grave.top - o.top + grave.height / 2 - cy : 0;
    const line = tributeTimeline();
    const T = TRIBUTE_TIMING;
    const track = new Track();
    let alive = true;

    // 1. The Tribute rises, then hangs while it burns.
    const total = T.liftMs + T.dissolveMs;
    track.play(lift.current, [
      { transform: `translate3d(0, 0, 0) rotate(${turn}deg) scale(1)`, offset: 0, easing: "cubic-bezier(0.2, 0.7, 0.2, 1)" },
      { transform: `translate3d(0, ${(-h * 0.14).toFixed(1)}px, 0) rotate(${turn}deg) scale(1.07)`, offset: T.liftMs / total },
      { transform: `translate3d(0, ${(-h * 0.19).toFixed(1)}px, 0) rotate(${turn}deg) scale(1.08)`, offset: 1 },
    ], { duration: total, easing: "linear", fill: "both" });
    track.play(el, [{ opacity: 1 }, { opacity: 1 }], { duration: line.totalMs, fill: "both" });

    // 2. The slices peel away from the top down and burn out.
    const sliceMs = T.dissolveMs * 0.55;
    const sliceGap = (T.dissolveMs - sliceMs) / Math.max(1, TRIBUTE_SLICES - 1);
    slices.current.forEach((slice, i) => {
      if (!slice) return;
      const side = i % 2 === 0 ? 1 : -1;
      const delay = T.liftMs + i * sliceGap;
      track.play(slice, [
        { opacity: 1, transform: "translate3d(0, 0, 0) rotate(0deg)", offset: 0, easing: "ease-in" },
        { opacity: 0.85, transform: `translate3d(${(side * w * 0.04).toFixed(1)}px, ${(-h * 0.03).toFixed(1)}px, 0) rotate(${side * 1.5}deg)`, offset: 0.45 },
        { opacity: 0, transform: `translate3d(${(side * w * 0.12).toFixed(1)}px, ${(-h * 0.09).toFixed(1)}px, 0) rotate(${side * 4}deg)`, offset: 1 },
      ], { duration: sliceMs, delay, easing: "ease-out", fill: "both" });
      track.play(burns.current[i], [
        { opacity: 0, offset: 0 }, { opacity: 1, offset: 0.35 }, { opacity: 0.4, offset: 1 },
      ], { duration: sliceMs, delay, easing: "ease-out", fill: "both" });
    });

    // 3. Motes of energy leave the burning card and gather in the zone of the summon.
    const orbMs = T.orbMs - (TRIBUTE_ORBS - 1) * ORB_GAP_MS;
    orbs.current.forEach((orb, i) => {
      if (!orb) return;
      const from = orbStart(i, plan.id, w, h);
      const sx = from.x;
      const sy = from.y - h * 0.16;
      const bend = (i % 2 === 0 ? 1 : -1) * Math.max(24, Math.hypot(tx, ty) * 0.18);
      const mx = (sx + tx) / 2 + bend;
      const my = (sy + ty) / 2 - Math.max(20, Math.hypot(tx, ty) * 0.12);
      track.play(orb, [
        { transform: `translate3d(${sx.toFixed(1)}px, ${sy.toFixed(1)}px, 0) scale(0.4)`, opacity: 0, offset: 0, easing: "cubic-bezier(0.3, 0, 0.6, 1)" },
        { transform: `translate3d(${(sx + (mx - sx) * 0.3).toFixed(1)}px, ${(sy + (my - sy) * 0.3 - h * 0.06).toFixed(1)}px, 0) scale(1)`, opacity: 1, offset: 0.2, easing: "cubic-bezier(0.45, 0, 0.7, 1)" },
        { transform: `translate3d(${mx.toFixed(1)}px, ${my.toFixed(1)}px, 0) scale(1)`, opacity: 1, offset: 0.55, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
        { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(0.5)`, opacity: 0.9, offset: 0.92 },
        { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(0.2)`, opacity: 0, offset: 1 },
      ], { duration: orbMs, delay: T.liftMs + T.orbDelayMs + i * ORB_GAP_MS, fill: "both" });
    });

    // 4. The energy gathers and flashes in the summon zone, peaking as the last mote lands.
    track.play(flash.current, [
      { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(0.3)`, opacity: 0, offset: 0, easing: "ease-out" },
      { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(1.15)`, opacity: 0.95, offset: 0.45, easing: "ease-in" },
      { transform: `translate3d(${tx.toFixed(1)}px, ${ty.toFixed(1)}px, 0) scale(1.5)`, opacity: 0, offset: 1 },
    ], { duration: T.gatherMs, delay: line.energyEndMs - T.gatherMs * 0.45, fill: "both" });

    // 5. The burned card is counted into the Graveyard, which pulses.
    track.play(pulse.current, [
      { transform: `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0) scale(0.85)`, opacity: 0, offset: 0, easing: "ease-out" },
      { transform: `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0) scale(1.05)`, opacity: 0.9, offset: 0.3, easing: "ease-out" },
      { transform: `translate3d(${gx.toFixed(1)}px, ${gy.toFixed(1)}px, 0) scale(1.35)`, opacity: 0, offset: 1 },
    ], { duration: T.pulseMs, delay: line.graveAtMs, fill: "both" });
    track.after(line.graveAtMs, () => {
      if (alive) landedRef.current();
    });

    void track.settled().then(() => {
      if (alive) doneRef.current();
    });
    return () => {
      alive = false;
      track.dispose();
    };
    // A Tribute is immutable for its whole life: set up once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div ref={root} className={styles.tribute} data-style="tribute" style={{ opacity: 0 } as CSSProperties}>
      <div ref={lift} className={styles.lift}>
        {card
          ? bands.map((i) => {
              const top = (i / TRIBUTE_SLICES) * 100;
              const bottom = 100 - ((i + 1) / TRIBUTE_SLICES) * 100;
              return (
                <span
                  key={i}
                  ref={(node) => { slices.current[i] = node; }}
                  className={styles.slice}
                  style={{ clipPath: `inset(${top}% 0 ${bottom}% 0)` }}
                >
                  <img className={styles.art} src={cardArtUrl(card.code, "small")} alt="" draggable={false} />
                  <i ref={(node) => { burns.current[i] = node; }} className={styles.burn} />
                </span>
              );
            })
          : null}
      </div>
      {motes.map((i) => (
        <span key={i} ref={(node) => { orbs.current[i] = node; }} className={styles.orb} style={{ opacity: 0 }} />
      ))}
      <span ref={flash} className={styles.flash} style={{ opacity: 0 }} />
      <span ref={pulse} className={styles.pulse} style={{ opacity: 0 }} />
    </div>
  );
}

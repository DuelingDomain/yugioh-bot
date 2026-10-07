"use client";

import { useLayoutEffect, useRef } from "react";
import type { DiceSkinId } from "./dice-skins";
import type { DiceLanding, DicePlan, DiceTimeline } from "./dice-model";
import { landsAt } from "./dice-model";
import styles from "./dice-die.module.css";

/** Cube orientation that shows face v at the front: [rotateX, rotateY] in degrees. */
export const DIE_TARGET: Readonly<Record<number, readonly [number, number]>> = { 1: [0, 0], 2: [-90, 0], 3: [0, -90], 4: [0, 90], 5: [90, 0], 6: [0, 180] };

/** Which of the nine cells of a face carry a pip. */
export const DIE_PIPS: Readonly<Record<number, readonly number[]>> = { 1: [5], 2: [1, 9], 3: [1, 5, 9], 4: [1, 3, 7, 9], 5: [1, 3, 5, 7, 9], 6: [1, 3, 4, 6, 7, 9] };

const FACES = [1, 2, 3, 4, 5, 6] as const;
const CELLS = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;

function transformAt(x: number, y: number, scaleX: number, scaleY = scaleX): string {
  return `translate(${x}px, ${y}px) scale(${scaleX}, ${scaleY})`;
}

/** The throw of one die: tumble to its face, drop in, and bounce twice. Returns the animations so they can be cancelled. */
function throwAnimations(parts: DieParts, value: number, plan: DicePlan, delay: number, reduced: boolean): Animation[] {
  const { drop, shadow, cube, slot } = parts;
  if (reduced) {
    return [
      drop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, delay, fill: "backwards" }),
      shadow.animate([{ opacity: 0 }, { opacity: 0.6 }], { duration: 160, delay, fill: "both" }),
    ];
  }
  const [tx, ty] = DIE_TARGET[value]!;
  const size = slot.getBoundingClientRect().width || 60;
  const sy = -size * 1.7;
  const options = { duration: plan.dur, delay, fill: "backwards" } as const;
  return [
    cube.animate([
      { transform: `rotateX(${tx + plan.spinX}deg) rotateY(${ty + plan.spinY}deg) rotateZ(${plan.spinZ}deg)` },
      { transform: `rotateX(${tx}deg) rotateY(${ty}deg) rotateZ(0deg)` },
    ], { ...options, easing: "cubic-bezier(0.12, 0.62, 0.2, 1)" }),
    // A heavy die: a hard first hit that squashes it, a low second hop, a small third, then it sits still.
    drop.animate([
      { transform: transformAt(0, sy, 0.7), opacity: 0, offset: 0, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
      { transform: transformAt(0, sy * 0.8, 0.8), opacity: 1, offset: 0.06, easing: "cubic-bezier(0.5, 0, 0.9, 0.6)" },
      { transform: transformAt(0, 0, 1), opacity: 1, offset: 0.5, easing: "ease-out" },
      { transform: transformAt(0, size * 0.035, 1.12, 0.84), opacity: 1, offset: 0.54, easing: "ease-out" },
      { transform: transformAt(0, -size * 0.15, 0.97, 1.04), opacity: 1, offset: 0.65, easing: "ease-in" },
      { transform: transformAt(0, size * 0.02, 1.06, 0.92), opacity: 1, offset: 0.75, easing: "ease-out" },
      { transform: transformAt(0, -size * 0.045, 1, 1), opacity: 1, offset: 0.86, easing: "ease-in" },
      { transform: transformAt(0, 0, 1), opacity: 1, offset: 1 },
    ], options),
    shadow.animate([
      { opacity: 0, scale: 0.5, offset: 0 }, { opacity: 0.75, scale: 1.15, offset: 0.5 }, { opacity: 0.25, scale: 0.7, offset: 0.65 },
      { opacity: 0.7, scale: 1.05, offset: 0.75 }, { opacity: 0.4, scale: 0.85, offset: 0.86 }, { opacity: 0.6, scale: 1, offset: 1 },
    ], { duration: plan.dur, delay, fill: "both" }),
  ];
}

/** The landing: a quick press and a glint; the top roll of the round adds a gold flash and ring (a 6 is brighter). */
function landAnimations(parts: DieParts, landing: DiceLanding, reduced: boolean): Animation[] {
  const { slot, flash, shock, glint } = parts;
  const top = landing !== "land";
  const big = landing === "big";
  if (reduced) return top ? [flash.animate([{ opacity: 0 }, { opacity: big ? 0.9 : 0.65 }, { opacity: 0 }], { duration: 420, easing: "linear" })] : [];
  const out: Animation[] = [
    slot.animate([{ scale: 1 }, { scale: top ? 1.2 : 1.1 }, { scale: 0.97 }, { scale: 1 }], { duration: top ? 420 : 280, easing: "ease-out" }),
    glint.animate([{ opacity: 0, backgroundPosition: "100% 0" }, { opacity: top ? 1 : 0.6, offset: 0.3 }, { opacity: 0, backgroundPosition: "0% 0" }], { duration: top ? 760 : 560, easing: "ease-out" }),
  ];
  if (top) {
    out.push(
      flash.animate([{ opacity: 0, scale: 0.5 }, { opacity: big ? 1 : 0.75, scale: 1, offset: 0.25 }, { opacity: 0, scale: big ? 1.7 : 1.35 }], { duration: big ? 900 : 700, easing: "ease-out" }),
      shock.animate([{ opacity: 0.95, scale: 0.55 }, { opacity: 0, scale: big ? 2.1 : 1.7 }], { duration: 700, easing: "cubic-bezier(0.1, 0.7, 0.3, 1)" }),
    );
  }
  return out;
}

interface DieParts {
  slot: HTMLElement;
  shadow: HTMLElement;
  drop: HTMLElement;
  cube: HTMLElement;
  flash: HTMLElement;
  shock: HTMLElement;
  glint: HTMLElement;
}

export interface DiceDieProps {
  value: number;
  skin: DiceSkinId;
  /** The round that throws this die; `null` for a die that keeps its roll. */
  throwRound: number | null;
  plan: DicePlan;
  timeline: DiceTimeline;
  landing: DiceLanding | null;
  /** The die is part of a tie: it pulses gold. */
  tied?: boolean;
  reduced: boolean;
  /** Milliseconds into the round by the server clock, read when a throw starts (a late joiner skips ahead). */
  sampleElapsed: () => number;
}

/** One die: a CSS cube with nine-cell faces, drawn in the chosen skin. The face on show is always `value`. */
export function DiceDie({ value, skin, throwRound, plan, timeline, landing, tied = false, reduced, sampleElapsed }: DiceDieProps) {
  const slot = useRef<HTMLDivElement>(null);
  const shadow = useRef<HTMLDivElement>(null);
  const drop = useRef<HTMLDivElement>(null);
  const cube = useRef<HTMLDivElement>(null);
  const flash = useRef<HTMLDivElement>(null);
  const shock = useRef<HTMLDivElement>(null);
  const glint = useRef<HTMLDivElement>(null);
  const latest = useRef({ sampleElapsed, plan, timeline, landing, reduced, value });
  // Layout timing and declared first: the throw effect below reads this on the same commit.
  useLayoutEffect(() => { latest.current = { sampleElapsed, plan, timeline, landing, reduced, value }; });

  // Starts the throw when a new round throws this die. Layout timing, so the die never flashes at rest before it drops.
  useLayoutEffect(() => {
    if (throwRound == null) return undefined;
    const parts = { slot: slot.current, shadow: shadow.current, drop: drop.current, cube: cube.current, flash: flash.current, shock: shock.current, glint: glint.current };
    if (!parts.slot || !parts.shadow || !parts.drop || !parts.cube || !parts.flash || !parts.shock || !parts.glint) return undefined;
    // jsdom has no Web Animations; the die just stays at rest there.
    if (typeof parts.drop.animate !== "function") return undefined;
    const now = latest.current;
    const elapsed = now.sampleElapsed();
    const lands = landsAt(now.plan, now.timeline);
    if (elapsed >= lands) return undefined;
    const animations: Animation[] = [];
    const timers: number[] = [];
    animations.push(...throwAnimations(parts as DieParts, now.value, now.plan, now.plan.delay - elapsed, now.reduced));
    if (now.landing) {
      const kind = now.landing;
      timers.push(window.setTimeout(() => {
        animations.push(...landAnimations(parts as DieParts, kind, latest.current.reduced));
      }, Math.max(0, lands - elapsed)));
    }
    return () => {
      for (const timer of timers) window.clearTimeout(timer);
      for (const animation of animations) animation.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- a throw starts once per round; everything else is read from `latest`.
  }, [throwRound]);

  const [rx, ry] = DIE_TARGET[value] ?? DIE_TARGET[1]!;
  return (
    <div ref={slot} className={styles.slot} data-skin={skin} data-tied={tied ? "true" : undefined} data-reduced={reduced ? "true" : undefined} data-testid="dice-die" data-value={value}>
      <div ref={shadow} className={styles.shadow} />
      <div ref={drop} className={styles.drop}>
        <div className={styles.tilt}>
          <div ref={cube} className={styles.cube} style={{ transform: `rotateX(${rx}deg) rotateY(${ry}deg)` }}>
            {FACES.map((face) => (
              <div key={face} className={`${styles.face} ${styles[`f${face}`]}`}>
                {CELLS.map((cell) => <i key={cell} className={styles.pip} data-on={DIE_PIPS[face]!.includes(cell) ? "true" : undefined} />)}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div ref={flash} className={styles.flash} />
      <div ref={shock} className={styles.shock} />
      <div ref={glint} className={styles.glint} />
    </div>
  );
}

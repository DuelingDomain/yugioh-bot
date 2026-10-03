"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { ANIMATION_SPEED_STEP, getAnimationSpeed, loadAnimationSpeed, MAX_ANIMATION_SPEED, MIN_ANIMATION_SPEED, setAnimationSpeed, subscribeAnimationSpeed } from "./animation-speed";
import { duelFxClock } from "./fx-clock";
import styles from "./animation-speed-control.module.css";

export function useDuelAnimationSpeed(reducedMotion = false): number {
  const speed = useSyncExternalStore(subscribeAnimationSpeed, getAnimationSpeed, () => 1);
  // Configuration only: the clock defers changes until the running presentation is finished.
  duelFxClock.setReducedMotion(reducedMotion);
  useEffect(() => { setAnimationSpeed(loadAnimationSpeed()); }, []);
  useEffect(() => {
    const retime = (target: Element) => {
      for (const anim of target.getAnimations?.() ?? []) {
        const cssAnimation = typeof CSSAnimation !== "undefined" && anim instanceof CSSAnimation;
        const cssTransition = typeof CSSTransition !== "undefined" && anim instanceof CSSTransition;
        if (!cssAnimation && !cssTransition) continue;
        const timing = anim.effect?.getComputedTiming();
        duelFxClock.rateAnimation(anim, Number(timing?.endTime ?? 0));
      }
    };
    const onStart = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-duel-fx-speed-root]")) retime(event.target);
    };
    // The room may initially render a loading state. Delegation also covers its later board mount.
    document.addEventListener("animationstart", onStart, true);
    document.addEventListener("transitionrun", onStart, true);
    for (const target of document.querySelectorAll("[data-duel-fx-speed-root], [data-duel-fx-speed-root] *")) retime(target);
    return () => {
      document.removeEventListener("animationstart", onStart, true);
      document.removeEventListener("transitionrun", onStart, true);
    };
  }, []);
  return speed;
}

export function DuelAnimationSpeedControl() {
  const id = useId();
  const speed = useSyncExternalStore(subscribeAnimationSpeed, getAnimationSpeed, () => 1);
  useEffect(() => { setAnimationSpeed(loadAnimationSpeed()); }, []);
  return <div className={styles.control}>
    <div className={styles.heading}>
      <label htmlFor={id}>Animation speed <span>{speed.toFixed(2)}x</span></label>
      <button type="button" onClick={() => setAnimationSpeed(1)} aria-label="Reset animation speed to 1x">Reset</button>
    </div>
    <input id={id} type="range" min={MIN_ANIMATION_SPEED} max={MAX_ANIMATION_SPEED} step={ANIMATION_SPEED_STEP}
      value={speed} aria-valuetext={`${speed.toFixed(2)}x`}
      onChange={(event) => setAnimationSpeed(Number(event.target.value))} />
    <div className={styles.ends} aria-hidden="true"><span>Slower · 0.50x</span><span>Faster · 2.00x</span></div>
    <p>Saved for this browser. Applies after current effects finish. Reduced motion takes priority.</p>
  </div>;
}

"use client";

import { useEffect, useId, useSyncExternalStore } from "react";
import { ANIMATION_SPEED_STEP, getAnimationSpeed, MAX_ANIMATION_SPEED, MIN_ANIMATION_SPEED, setAnimationSpeed, subscribeAnimationSpeed } from "./animation-speed";
import { duelFxClock } from "./fx-clock";
import styles from "./animation-speed-control.module.css";

export function useDuelAnimationSpeed(reducedMotion = false): number {
  const speed = useSyncExternalStore(subscribeAnimationSpeed, getAnimationSpeed, () => 1);
  // Configuration only: the clock defers changes until the running presentation is finished.
  duelFxClock.setReducedMotion(reducedMotion);
  useEffect(() => { duelFxClock.factor(); }, [speed, reducedMotion]);
  useEffect(() => {
    const loops = new Set<Animation>();
    const unsubscribe = duelFxClock.subscribeRate((rate) => {
      for (const animation of loops) {
        if (animation.playState === "idle" || animation.playState === "finished") loops.delete(animation);
        else animation.playbackRate = rate;
      }
    });
    const rated = new WeakSet<Animation>();
    const retimeAnimation = (anim: Animation) => {
      const cssAnimation = typeof CSSAnimation !== "undefined" && anim instanceof CSSAnimation;
      // UI hover, focus and input transitions keep real-time feedback and take no FX lease.
      if (!cssAnimation) return;
      const endTime = Number(anim.effect?.getComputedTiming().endTime ?? 0);
      if (endTime === Infinity) {
        if (!loops.has(anim)) {
          loops.add(anim);
          void anim.finished?.then(() => loops.delete(anim), () => loops.delete(anim));
        }
        anim.playbackRate = duelFxClock.factor();
      } else if (!rated.has(anim)) {
        rated.add(anim);
        duelFxClock.rateAnimation(anim, endTime);
      }
    };
    const retime = (target: Element) => {
      for (const anim of target.getAnimations?.() ?? []) retimeAnimation(anim);
    };
    const onStart = (event: Event) => {
      if (event.target instanceof Element && event.target.closest("[data-duel-fx-speed-root]")) retime(event.target);
    };
    // The room may initially render a loading state. Delegation also covers its later board mount.
    document.addEventListener("animationstart", onStart, true);
    // Element.getAnimations() walks every document animation, so asking per element is quadratic. One document sweep per batch is enough.
    const sweep = () => {
      for (const anim of document.getAnimations?.() ?? []) {
        if (rated.has(anim) || loops.has(anim)) continue;
        const target = (anim.effect as KeyframeEffect | null)?.target;
        if (target?.closest("[data-duel-fx-speed-root]")) retimeAnimation(anim);
      }
    };
    // Capture positive CSS delays when styles are created, before animationstart fires.
    const observer = new MutationObserver(sweep);
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "data-status", "data-reduced"] });
    sweep();
    return () => {
      unsubscribe();
      loops.clear();
      observer.disconnect();
      document.removeEventListener("animationstart", onStart, true);
    };
  }, []);
  return speed;
}

export function DuelAnimationSpeedControl() {
  const id = useId();
  const speed = useSyncExternalStore(subscribeAnimationSpeed, getAnimationSpeed, () => 1);
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

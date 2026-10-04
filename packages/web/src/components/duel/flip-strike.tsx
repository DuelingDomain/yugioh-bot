"use client";

import { useLayoutEffect, useRef } from "react";
import { safeFxAnimate } from "./safe-animate";
import type { FxCut } from "./attack-fx";

type Box = { left: number; top: number; width: number; height: number };

export type FlipStrikePlan = {
  seq: number;
  from: Box;
  to: Box;
  /** The attacker's art, read before the board updates. */
  cut: FxCut | null;
  /** The attack beat length (virtual ms; the FX clock scales it). */
  ms: number;
  /** Virtual ms until the beat starts (the attack waits for the chain that came before it). */
  delayMs: number;
  reduced: boolean;
};

/** The point of the strike: the middle of the target's box, pulled back to the near edge. */
function strikePoint(from: Box, to: Box): { x: number; y: number } {
  const fx = from.left + from.width / 2;
  const fy = from.top + from.height / 2;
  const tx = to.left + to.width / 2;
  const ty = to.top + to.height / 2;
  // Stop short of the target, a card height away from its middle, so the attacker is seen to hit it.
  const dx = tx - fx;
  const dy = ty - fy;
  const dist = Math.hypot(dx, dy) || 1;
  const stop = Math.min(dist, Math.max(0, dist - to.height * 0.55));
  return { x: (dx / dist) * stop, y: (dy / dist) * stop };
}

/**
 * The attack beat of a flip-effect sequence (flip-sequence.ts): the attacker lunges at its face-down
 * target and comes back, and the target flashes where it is struck. The real attacker cannot do it,
 * since the snapshot already holds the board after the fight, so the lunge is made with a copy of its
 * picture. Reduced motion has no travel: only the flash on the target.
 */
export function FlipStrike({ plan }: { plan: FlipStrikePlan }) {
  const rootRef = useRef<HTMLDivElement | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const animations: Array<Animation | null> = [];
    const { from, to, cut, ms, delayMs, reduced } = plan;
    const flash = root.querySelector<HTMLElement>("[data-strike-flash]");
    const body = root.querySelector<HTMLElement>("[data-strike-body]");
    const hitAt = 0.5;
    if (body && cut && !reduced) {
      const { x, y } = strikePoint(from, to);
      animations.push(safeFxAnimate(body, [
        { transform: "translate(0px, 0px) scale(1)", opacity: 0, offset: 0 },
        { transform: "translate(0px, 0px) scale(1.04)", opacity: 1, offset: 0.08, easing: "ease-in" },
        { transform: `translate(${x}px, ${y}px) scale(1.1)`, opacity: 1, offset: hitAt, easing: "cubic-bezier(0.5, 0, 0.9, 0.4)" },
        { transform: `translate(${x * 0.9}px, ${y * 0.9}px) scale(1.08)`, opacity: 1, offset: hitAt + 0.08, easing: "ease-out" },
        { transform: "translate(0px, 0px) scale(1)", opacity: 0, offset: 1 },
      ], { delay: delayMs, duration: ms, fill: "both", easing: "linear" }));
    }
    if (flash) {
      animations.push(safeFxAnimate(flash, [
        { opacity: 0, transform: "scale(0.7)", offset: 0 },
        { opacity: 0, transform: "scale(0.7)", offset: hitAt },
        { opacity: 0.95, transform: "scale(1)", offset: hitAt + 0.12 },
        { opacity: 0, transform: "scale(1.25)", offset: 1 },
      ], { delay: delayMs, duration: ms, fill: "both" }));
    }
    return () => {
      for (const animation of animations) animation?.cancel();
    };
  }, [plan]);

  const { from, to, cut } = plan;
  return (
    <div ref={rootRef} aria-hidden data-flip-strike="true" data-reduced={plan.reduced ? "true" : "false"}>
      {cut && !plan.reduced ? (
        <div
          data-strike-body
          style={{ position: "absolute", left: from.left, top: from.top, width: from.width, height: from.height, opacity: 0, filter: "drop-shadow(0 0 14px rgb(190 140 255 / 0.85))", willChange: "transform, opacity" }}
        >
          <div
            style={{ position: "absolute", top: "50%", left: "50%", width: cut.innerW, height: cut.innerH, translate: "-50% -50%", rotate: cut.turn ? `${cut.turn}deg` : undefined }}
            dangerouslySetInnerHTML={{ __html: cut.html }}
          />
        </div>
      ) : null}
      <div
        data-strike-flash
        style={{
          position: "absolute", left: to.left - 6, top: to.top - 6, width: to.width + 12, height: to.height + 12, opacity: 0, borderRadius: 10,
          background: "radial-gradient(closest-side, rgb(255 246 226 / 0.9), rgb(190 140 255 / 0.45) 55%, transparent 100%)",
          boxShadow: "0 0 24px rgb(190 140 255 / 0.7)",
        }}
      />
    </div>
  );
}

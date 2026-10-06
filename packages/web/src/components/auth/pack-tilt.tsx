"use client";

import { useEffect, useRef, type ReactNode } from "react";
import styles from "./sign-in-shell.module.css";

/** The supplied mock has lighting variables but no pointer handler. */
export function PackTilt({ children }: { children: ReactNode }) {
  const hitRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const hit = hitRef.current;
    const tilt = tiltRef.current;
    if (!hit || !tilt) return;

    const enabled = window.matchMedia("(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)");
    function reset() {
      if (!tilt) return;
      tilt.style.removeProperty("transform");
      tilt.style.removeProperty("--sx");
      tilt.style.removeProperty("--sy");
    }
    function move(event: PointerEvent) {
      if (!enabled.matches || event.pointerType === "touch" || !hit || !tilt) return;
      const rect = hit.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const x = Math.max(-0.5, Math.min(0.5, (event.clientX - rect.left) / rect.width - 0.5));
      const y = Math.max(-0.5, Math.min(0.5, (event.clientY - rect.top) / rect.height - 0.5));
      tilt.style.setProperty("--sx", String(x));
      tilt.style.setProperty("--sy", String(y));
      tilt.style.transform = `rotateX(${-y * 12}deg) rotateY(${x * 16}deg)`;
    }

    hit.addEventListener("pointermove", move);
    hit.addEventListener("pointerleave", reset);
    hit.addEventListener("pointercancel", reset);
    enabled.addEventListener("change", reset);
    return () => {
      hit.removeEventListener("pointermove", move);
      hit.removeEventListener("pointerleave", reset);
      hit.removeEventListener("pointercancel", reset);
      enabled.removeEventListener("change", reset);
      reset();
    };
  }, []);

  return (
    <div className={styles["pack-hit"]} ref={hitRef}>
      <div className={styles["pack-tilt"]} ref={tiltRef}>{children}</div>
    </div>
  );
}

"use client";

import { Minus, Plus } from "lucide-react";
import { MAX_REPLAY_SPEED, MIN_REPLAY_SPEED, SPEEDS, sliderToSpeed, speedToSlider, stepReplaySpeed } from "./replay-controller";
import styles from "./replay-speed.module.css";

/** "1×", "0.5×", "1.37×": two decimals at most, no trailing zeros. */
export function speedLabel(speed: number): string {
  return `${Number(speed.toFixed(2))}×`;
}

/**
 * The replay speed: a slider from 0.25× to 4× with 1× in the middle (the thumb snaps to it), buttons for the next
 * preset down and up, and the current speed, which sets it back to 1×. The same control is used by every replay layout.
 */
export function ReplaySpeedControl({ speed, onChange, compact = false }: { speed: number; onChange: (speed: number) => void; compact?: boolean }) {
  if (compact) {
    // The narrow strips of the Tag and free-for-all replays: one button that steps through the preset speeds.
    const next = SPEEDS.find((value) => value > speed + 1e-9) ?? SPEEDS[0];
    return (
      <button type="button" className={styles.readout} aria-label={`Speed ${speedLabel(speed)}. Change to ${speedLabel(next)}`}
        title="Playback speed (the + and - keys also change it)" onClick={() => onChange(next)}>{speedLabel(speed)}</button>
    );
  }
  return (
    <div className={styles.speed} role="group" aria-label="Playback speed controls">
      <button type="button" className={styles.step} aria-label="Slower" disabled={speed <= MIN_REPLAY_SPEED}
        onClick={() => onChange(stepReplaySpeed(speed, -1))}><Minus size={14} aria-hidden /></button>
      <input type="range" className={styles.range} aria-label="Playback speed" min={-100} max={100} step={1}
        value={speedToSlider(speed)} aria-valuetext={speedLabel(speed)} data-speed={speed}
        onChange={(event) => onChange(sliderToSpeed(Number(event.target.value)))}
        // The pointer snaps near 1x; the arrow keys walk the preset speeds, or the thumb could never leave 1x.
        onKeyDown={(event) => {
          const step = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : event.key === "ArrowRight" || event.key === "ArrowUp" ? 1 : 0;
          if (step === 0) return;
          event.preventDefault();
          onChange(stepReplaySpeed(speed, step));
        }} />
      <button type="button" className={styles.step} aria-label="Faster" disabled={speed >= MAX_REPLAY_SPEED}
        onClick={() => onChange(stepReplaySpeed(speed, 1))}><Plus size={14} aria-hidden /></button>
      <button type="button" className={styles.readout} aria-label={`Speed ${speedLabel(speed)}. Reset to 1×`} title="Reset to 1×"
        onClick={() => onChange(1)}>{speedLabel(speed)}</button>
    </div>
  );
}

"use client";

import { useMemo } from "react";
import type { ReplayMarker } from "./replay-timeline";
import styles from "./replay-scrubber.module.css";

/**
 * The replay position slider with its marks: a gold tick where each turn starts and a red or green dot where a
 * player's life points change sharply (a key moment). The marks only draw; the slider still owns the position.
 */
export function ReplayScrubber({ markers, index, last, onSeek, label = "Replay position" }: {
  markers: readonly ReplayMarker[];
  index: number;
  last: number;
  onSeek: (target: number) => void;
  label?: string;
}) {
  const at = (frame: number) => `${last > 0 ? (frame / last) * 100 : 0}%`;
  return (
    <div className={styles.scrubber}>
      <input type="range" className={styles.slider} aria-label={label} min={0} max={last} step={1} value={index}
        aria-valuetext={`Move ${index} of ${last}`} onChange={(event) => onSeek(Number(event.target.value))} />
      <div className={styles.marks} aria-hidden="true" data-replay-marks>
        {markers.map((marker, i) => marker.kind === "turn" ? (
          <i key={`t${i}`} className={styles.turn} style={{ left: at(marker.index) }} title={`Turn ${marker.turn}`} />
        ) : (
          <i key={`s${i}`} className={styles.swing} data-gain={marker.delta > 0 || undefined} style={{ left: at(marker.index) }}
            title={`${marker.delta > 0 ? "+" : "−"}${Math.abs(marker.delta).toLocaleString("en-US")} LP`} />
        ))}
      </div>
    </div>
  );
}

/** Pick a turn to jump to. The turn the replay is in shows as selected. */
export function ReplayTurnJump({ markers, turn, onSeek }: { markers: readonly ReplayMarker[]; turn: number; onSeek: (target: number) => void }) {
  const turns = useMemo(() => markers.filter((marker): marker is Extract<ReplayMarker, { kind: "turn" }> => marker.kind === "turn"), [markers]);
  if (turns.length < 2) return null;
  const current = turns.find((marker) => marker.turn === turn)?.index ?? "";
  return (
    <label className={styles.jump}>
      <span>Turn</span>
      <select className={styles.select} aria-label="Jump to turn" value={current}
        onChange={(event) => { if (event.target.value !== "") onSeek(Number(event.target.value)); }}>
        {current === "" ? <option value="">–</option> : null}
        {turns.map((marker) => <option key={marker.index} value={marker.index}>Turn {marker.turn}</option>)}
      </select>
    </label>
  );
}


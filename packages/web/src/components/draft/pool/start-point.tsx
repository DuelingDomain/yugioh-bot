"use client";

import * as React from "react";
import type { Mode } from "./use-pool-editor";
import styles from "./pool.module.css";

/** "Use a cube" or "Start from scratch". With no cubes on the server only scratch is open. */
export function StartPoint({ mode, hasCubes, onChange }: { mode: Mode; hasCubes: boolean; onChange: (mode: Mode) => void }) {
  const labelId = React.useId();
  return (
    <div className={styles.start}>
      <span className="label" id={labelId}>
        Starting point
      </span>
      <div className="seg" role="group" aria-labelledby={labelId}>
        <button type="button" aria-pressed={mode === "cube"} disabled={!hasCubes} onClick={() => onChange("cube")}>
          Use a cube
        </button>
        <button type="button" aria-pressed={mode === "scratch"} onClick={() => onChange("scratch")}>
          Start from scratch
        </button>
      </div>
      {!hasCubes && <p className="hint">Cubes you save show up here.</p>}
    </div>
  );
}

"use client";

import type { CSSProperties } from "react";
import { Minimize2 } from "lucide-react";
import styles from "./view-zoom.module.css";

/** The small "Reset view" control of a zoomed board, with the zoom it resets. Hidden while the board is not zoomed. */
export function ViewReset({ zoomed, scale, onReset, style }: { zoomed: boolean; scale: number; onReset: () => void; style?: CSSProperties }) {
  if (!zoomed) return null;
  return (
    <button
      type="button"
      className={styles.reset}
      style={style}
      data-view-reset
      data-testid="view-reset"
      title="Reset view (or double-click the board)"
      onClick={onReset}
    >
      <Minimize2 size={13} strokeWidth={2} aria-hidden />
      Reset view <b>{Math.round(scale * 100)}%</b>
    </button>
  );
}

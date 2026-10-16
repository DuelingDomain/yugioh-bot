import styles from "./field-frame.module.css";

/** The class names of the shared field frame. See `field-frame.module.css` for the tokens and the markup. */
export const fieldFrame = {
  frame: styles.frame,
  topBar: styles.topBar,
  bottomBar: styles.bottomBar,
  area: styles.area,
  fit: styles.fit,
} as const;

export interface FieldFrameVars {
  /** Natural field size in zone units, gaps included. */
  cols: number;
  rows: number;
  /** Slim bar heights, any CSS length. */
  barTop?: string;
  barBottom?: string;
  pad?: string;
  zMin?: string;
}

/** Inline custom properties for `.frame`. Use `data-bars` on the frame when a bar is left out. */
export function fieldFrameVars(vars: FieldFrameVars): Record<string, string> {
  const out: Record<string, string> = { "--bf-cols": String(vars.cols), "--bf-rows": String(vars.rows) };
  if (vars.barTop) out["--bf-bar-top"] = vars.barTop;
  if (vars.barBottom) out["--bf-bar-bottom"] = vars.barBottom;
  if (vars.pad) out["--bf-pad"] = vars.pad;
  if (vars.zMin) out["--bf-z-min"] = vars.zMin;
  return out;
}

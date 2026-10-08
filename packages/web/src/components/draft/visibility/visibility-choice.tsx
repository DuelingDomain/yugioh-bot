"use client";

import * as React from "react";
import type { DraftVisibility } from "@yugidraft/shared/types";
import { VISIBILITY_HELP, VISIBILITY_LABEL } from "@/lib/draft-invite";
import styles from "./visibility.module.css";

const ORDER: DraftVisibility[] = ["private", "open"];

/**
 * The create forms' choice of who can join. Private is the default the forms start with. `compact` is the narrow
 * rail version (one column, tighter rows).
 */
export function VisibilityChoice({
  value,
  onChange,
  compact = false,
  className,
}: {
  value: DraftVisibility;
  onChange: (value: DraftVisibility) => void;
  compact?: boolean;
  className?: string;
}) {
  const name = `visibility-${React.useId()}`;
  return (
    <fieldset className={`${styles.choice}${className ? ` ${className}` : ""}`} data-compact={compact || undefined}>
      <legend>Who can join</legend>
      <div className={styles.opts}>
        {ORDER.map((option) => (
          <label key={option} className={styles.opt}>
            <input type="radio" name={name} value={option} checked={value === option} onChange={() => onChange(option)} />
            <span className={styles.optT}>{VISIBILITY_LABEL[option]}</span>
            <span className={styles.optP}>{VISIBILITY_HELP[option]}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

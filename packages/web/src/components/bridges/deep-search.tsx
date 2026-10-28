"use client";

import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEEP_STEPS, countdownText, stepIndex } from "./bridges-model";
import type { Deep } from "./use-bridges";
import styles from "./bridges.module.css";

/** The progress of a running deep search: a bar, its step names and the current step marked. */
export function DeepProgress({ deep }: { deep: Deep }) {
  const current = stepIndex(deep.step);
  const failed = deep.phase === "failed";
  return (
    <div className={styles.progress} data-state={failed ? "failed" : undefined} data-testid="deep-progress">
      <p className={styles.progressText}>Searching all possible bridges...</p>
      <div className={styles.bar} role="progressbar" aria-label="Searching all possible bridges" aria-valuemin={0} aria-valuemax={100} aria-valuenow={deep.progress}>
        <span style={{ width: `${deep.progress}%` }} />
      </div>
      <ol className={styles.steps} aria-live="polite">
        {DEEP_STEPS.map((step, index) => (
          <li key={step.id} data-state={index < current || deep.phase === "done" ? "done" : index === current ? "current" : "todo"} aria-current={index === current && !failed ? "step" : undefined}>{step.label}</li>
        ))}
      </ol>
    </div>
  );
}

/**
 * The Deep search button. It stays off while a search runs and during the cooldown, which shows its countdown.
 * The hook sends one request per click, so a double click is safe even before this button is disabled.
 */
export function DeepSearchButton({ deep, cooldown, blocked, disabled, describedBy, onStart }: {
  deep: Deep;
  cooldown: number;
  blocked: boolean;
  /** No archetype to search from. */
  disabled: boolean;
  /** The id of the hint under the button. */
  describedBy: string;
  onStart: () => void;
}) {
  const running = deep.phase === "starting" || deep.phase === "running";
  const label = running ? "Searching…" : cooldown > 0 ? `Deep search in ${countdownText(cooldown)}` : deep.phase === "failed" ? "Try again" : deep.phase === "done" ? "Search again" : "Deep search";
  return (
    <button type="button" className={cn("btn btn-secondary btn-sm", styles.deepButton)} data-testid="deep-search-button" disabled={disabled || blocked}
      aria-busy={running || undefined} aria-describedby={describedBy} onClick={onStart}>
      <Search size={14} strokeWidth={1.8} aria-hidden />{label}
    </button>
  );
}

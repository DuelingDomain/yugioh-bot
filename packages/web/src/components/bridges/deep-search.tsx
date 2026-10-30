"use client";

import type { Ref } from "react";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { DEEP_STEPS, countdownText, stepIndex } from "./bridges-model";
import type { Deep } from "./use-bridges";
import styles from "./bridges.module.css";

/**
 * The progress of a running deep search: a bar, its step names and the current step marked. `title` names a search
 * for other engines that still runs.
 */
export function DeepProgress({ deep, title = "Searching all possible bridges...", testId = "deep-progress" }: { deep: Pick<Deep, "phase" | "step" | "progress">; title?: string; testId?: string }) {
  const current = stepIndex(deep.step);
  const failed = deep.phase === "failed";
  return (
    <div className={styles.progress} data-state={failed ? "failed" : undefined} data-testid={testId}>
      <p className={styles.progressText}>{title}</p>
      <div className={styles.bar} role="progressbar" aria-label={title.replace(/\.+$/, "")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={deep.progress}>
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
 * The Deep search button. It stays off while a search runs and when the server returns an hourly limit, which shows its countdown.
 * The hook sends one request per click, so a double click is safe even before this button is disabled.
 */
export function DeepSearchButton({ deep, cooldown, blocked, disabled, again, describedBy, onStart, ref }: {
  deep: Deep;
  cooldown: number;
  blocked: boolean;
  /** No archetype to search from. */
  disabled: boolean;
  /** These engines were searched before, for other cards. */
  again?: boolean;
  /** The id of the hint under the button. */
  describedBy: string;
  onStart: () => void;
  ref?: Ref<HTMLButtonElement>;
}) {
  const running = deep.phase === "starting" || deep.phase === "running";
  const label = running ? "Searching…" : cooldown > 0 ? `Deep search in ${countdownText(cooldown)}` : deep.phase === "failed" ? "Try again" : deep.phase === "done" || again ? "Search again" : "Deep search";
  return (
    <button ref={ref} type="button" className={cn("btn btn-secondary btn-sm", styles.deepButton)} data-testid="deep-search-button" disabled={disabled || blocked}
      aria-busy={running || undefined} aria-describedby={describedBy} onClick={onStart}>
      <Search size={14} strokeWidth={1.8} aria-hidden />{label}
    </button>
  );
}

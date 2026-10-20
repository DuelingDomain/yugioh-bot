"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ArchetypeGuide } from "@yugidraft/shared/cards/effects";
import styles from "./how-it-plays.module.css";

const SHOWN_HOOKS = 3;

/**
 * An archetype's game plan (three lines, "More" opens the rest) and what works with it ("label — why", the
 * top three, "Show all" for the rest). A hook that can be searched is a button; the rest are plain text.
 */
export function HowItPlays({
  guide,
  onHook,
  activeHook = null,
  testId = "how-it-plays",
}: {
  guide: ArchetypeGuide;
  /** Searches for the cards that fit one hook. Not given: every row is plain text. */
  onHook?: (index: number) => void;
  activeHook?: number | null;
  testId?: string;
}) {
  const [open, setOpen] = React.useState(true);
  const [planOpen, setPlanOpen] = React.useState(false);
  const [allHooks, setAllHooks] = React.useState(false);
  const [overflowing, setOverflowing] = React.useState(false);
  const planRef = React.useRef<HTMLParagraphElement>(null);
  const planId = React.useId();
  const bodyId = React.useId();

  // A new archetype starts folded back to the summary.
  React.useEffect(() => {
    setPlanOpen(false);
    setAllHooks(false);
  }, [guide.archetype]);

  React.useLayoutEffect(() => {
    const el = planRef.current;
    if (!el || !open) return;
    const measure = () => {
      if (planRef.current && !planOpen) setOverflowing(planRef.current.scrollHeight > planRef.current.clientHeight + 1);
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [guide.plan, open, planOpen]);

  const hooks = allHooks ? guide.hooks : guide.hooks.slice(0, SHOWN_HOOKS);
  return (
    <section className={styles.panel} aria-label={`How it plays: ${guide.archetype}`} data-testid={testId}>
      <div className={styles.head}>
        <h3 className={styles.title}>How it plays <span>{guide.archetype}</span></h3>
        <button type="button" className={styles.fold} aria-expanded={open} aria-controls={bodyId} aria-label={open ? "Hide how it plays" : "Show how it plays"} onClick={() => setOpen((now) => !now)}>
          {open ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
        </button>
      </div>
      {open ? (
        <div className={styles.body} id={bodyId}>
          <p ref={planRef} id={planId} className={styles.plan} data-clamped={planOpen ? undefined : ""} data-testid="how-it-plays-plan">{guide.plan}</p>
          {overflowing || planOpen ? (
            <button type="button" className={styles.more} aria-expanded={planOpen} aria-controls={planId} onClick={() => setPlanOpen((now) => !now)}>{planOpen ? "Less" : "More"}</button>
          ) : null}
          {hooks.length > 0 ? (
            <ul className={styles.hooks} aria-label="Works with it">
              {hooks.map((hook, index) => {
                const text = (
                  <span className={styles.hookText} data-clamped={allHooks ? undefined : ""}>
                    <span className={styles.label}>{hook.label}</span>
                    <span className={styles.cue}> — </span>
                    {hook.why}
                  </span>
                );
                return (
                  <li key={`${index}-${hook.label}`}>
                    {onHook && hook.searchable ? (
                      <button type="button" className={styles.hookBtn} aria-pressed={activeHook === index} aria-label={`Find cards for ${hook.label}`} title={hook.why} data-testid="how-it-plays-hook" onClick={() => onHook(index)}>{text}</button>
                    ) : (
                      <div className={styles.hookRow} data-testid="how-it-plays-hook-text">{text}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : null}
          {guide.hooks.length > SHOWN_HOOKS ? (
            <button type="button" className={styles.more} aria-expanded={allHooks} onClick={() => setAllHooks((now) => !now)}>{allHooks ? "Show fewer" : `Show all (${guide.hooks.length})`}</button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

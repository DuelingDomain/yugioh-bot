"use client";

import * as React from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { ArchetypeGuide, ArchetypeGuideHook } from "@yugidraft/shared/cards/effects";
import styles from "./how-it-plays.module.css";

const SHOWN_HOOKS = 3;

interface HookAsk {
  find: HookFind;
  /** The small lead-in ("Is a") and what follows it ("LIGHT Fiend monster"). */
  lead: string;
  what: string;
  /** The button's name for a screen reader. */
  name: string;
}

/** "a" or "an" for the word that follows: "an EARTH Warrior monster", "an Xyz monster", "a LIGHT Fiend monster". */
const article = (what: string) => (/^(?:[aeio]|u(?!ni)|xyz)/i.test(what) ? "an" : "a");

/** What a click on this hook can find, "is a" first. Empty only for a guide from before hooks said what they find. */
function hookAsks(hook: ArchetypeGuideHook, archetype: string): HookAsk[] {
  const finds = hook.finds ?? { is: null, support: hook.searchable };
  const asks: HookAsk[] = [];
  if (finds.is) asks.push({ find: "is", lead: `Is ${article(finds.is.one)}`, what: finds.is.one, name: `Find ${finds.is.many}` });
  if (finds.support) asks.push({ find: "support", lead: "Support for", what: archetype, name: `Find cards for ${hook.label}` });
  return asks;
}

function Ask({ ask }: { ask: HookAsk }) {
  return <span className={styles.ask}><span className={styles.askLead}>{ask.lead}</span> <span className={styles.askWhat}>{ask.what}</span></span>;
}

/** Which of a hook's two questions a click asks: cards that ARE this kind of card, or cards that help the deck. */
export type HookFind = "is" | "support";

/**
 * An archetype's game plan (three lines, "More" opens the rest) and what works with it ("label — why", the
 * top three, "Show all" for the rest). Every row says what a click finds. A row with one answer is a button;
 * a row with two ("is a" and "support for") has two small buttons. Without `onHook` the rows are plain text.
 */
export function HowItPlays({
  guide,
  onHook,
  testId = "how-it-plays",
}: {
  guide: ArchetypeGuide;
  /** Searches for the cards that fit one hook, in the way asked. Not given: every row is plain text. */
  onHook?: (index: number, find: HookFind) => void;
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
                const asks = hookAsks(hook, guide.archetype);
                return (
                  <li key={`${index}-${hook.label}`}>
                    {!onHook || asks.length === 0 ? (
                      <div className={styles.hookRow} data-plain="" data-testid="how-it-plays-hook-text">{text}</div>
                    ) : asks.length === 1 ? (
                      <button type="button" className={styles.hookBtn} aria-label={asks[0]!.name} title={hook.why} data-hook={`${index}:${asks[0]!.find}`} data-testid="how-it-plays-hook" onClick={() => onHook(index, asks[0]!.find)}>
                        {text}
                        <Ask ask={asks[0]!} />
                      </button>
                    ) : (
                      <div className={styles.hookRow} data-testid="how-it-plays-hook-multi">
                        {text}
                        <span className={styles.asks}>
                          {asks.map((ask) => (
                            <button key={ask.find} type="button" className={styles.askBtn} aria-label={ask.name} data-hook={`${index}:${ask.find}`} data-testid="how-it-plays-hook" onClick={() => onHook(index, ask.find)}>
                              <Ask ask={ask} />
                            </button>
                          ))}
                        </span>
                      </div>
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

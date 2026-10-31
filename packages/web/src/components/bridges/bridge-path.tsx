"use client";

import { ArrowDown, ArrowRight, Check } from "lucide-react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import type { CardAdder } from "@/components/decks/card-adder";
import { LimitBadge } from "@/components/decks/limit-badge";
import { cn } from "@/lib/utils";
import type { CardPropsFor } from "./bridge-card";
import { roleFor } from "./bridges-model";
import type { ShownBridge } from "./bridges-api";
import styles from "./bridges.module.css";

/** One card of the line. `card` is null until its details load (or when no card of the bridge has that name). */
export type PathStep = {
  name: string;
  card: DeckCardInfo | null;
  /** What the bridge data says this step does. Empty when it says nothing, or the same as the step before. */
  text: string;
};

/**
 * The line of a bridge as steps, in play order. The reviewed line holds card names; each name is matched to the
 * bridge card of that name. Prefer the code-written review step, including an explicit empty caption. Older rows
 * fall back to reason text, with a shared reason shown once under the first card.
 */
export function pathSteps(bridge: ShownBridge, cards: ReadonlyMap<number, DeckCardInfo>): PathStep[] {
  const byName = new Map<string, { code: number; card: DeckCardInfo }>();
  for (const code of bridge.cards) {
    const card = cards.get(code);
    if (card && !byName.has(card.name)) byName.set(card.name, { code, card });
  }
  const said = new Set<string>();
  return bridge.review.line.map((name, index) => {
    const found = byName.get(name);
    const reviewed = bridge.review.steps?.[index];
    const sentence = reviewed?.card === name ? reviewed.text : found ? roleFor(bridge, found.code) : "";
    const text = reviewed?.card === name ? sentence : sentence && !said.has(sentence) ? sentence : "";
    if (sentence) said.add(sentence);
    return { name, card: found?.card ?? null, text };
  });
}

/** The cards of the line that the deck does not hold yet, once each. */
export function missingSteps(steps: readonly PathStep[], deckCount: (card: DeckCardInfo) => number): DeckCardInfo[] {
  const seen = new Set<string>();
  const out: DeckCardInfo[] = [];
  for (const { card } of steps) {
    if (!card || seen.has(card.name) || deckCount(card) > 0) continue;
    seen.add(card.name);
    out.push(card);
  }
  return out;
}

/**
 * The line as small card images with an arrow between each, for a list. A card opens the card inspector on hover or
 * tap, like a tile elsewhere in Suggestions. An arrow stays with the card after it, so a wrapped line never starts
 * with a loose arrow.
 */
export function PathThumbs({ steps, cardProps, label = "Path of cards" }: { steps: readonly PathStep[]; cardProps: CardPropsFor; label?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={styles.path} aria-label={label} data-testid="bridge-path">
      {steps.map((step, index) => (
        <li key={`${index}-${step.name}`} className={styles.pathStep}>
          {index > 0 ? <ArrowRight size={14} strokeWidth={1.8} aria-hidden className={styles.pathArrow} /> : null}
          {step.card ? (
            <button type="button" className={styles.thumb} aria-label={step.name} title={step.name} {...cardProps(step.card)}>
              <CardArt code={step.card.code} name={step.name} />
            </button>
          ) : (
            <span className={cn(styles.thumb, styles.thumbName)} role="img" aria-label={step.name} title={step.name}><span aria-hidden>{step.name}</span></span>
          )}
        </li>
      ))}
    </ol>
  );
}

/**
 * The line at full size, in order: the card, its name, whether the deck holds it, and the sentence the bridge data
 * has for it. The steps stack with a down arrow between, so a narrow column and a phone read the same way.
 */
export function PathSteps({ steps, cardProps, deckCount, limit }: {
  steps: readonly PathStep[];
  cardProps: CardPropsFor;
  deckCount: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
}) {
  return (
    <div className={styles.pathBox}>
      <ol className={styles.pathFull} data-testid="bridge-line" aria-label="The line, in play order">
        {steps.map((step, index) => {
          const count = step.card ? deckCount(step.card) : 0;
          return (
            <li key={`${index}-${step.name}`} className={styles.fullStep} data-testid="bridge-step">
              {index > 0 ? (
                <span className={styles.fullArrow} aria-hidden><ArrowDown size={16} strokeWidth={1.8} /></span>
              ) : null}
              {step.card ? (
                <button type="button" className={styles.fullArt} aria-label={`${step.name}${count ? `, ${count} in deck` : ", not in deck"}`} {...cardProps(step.card)}>
                  <CardArt code={step.card.code} name={step.name} />
                  <LimitBadge limit={limit(step.card)} />
                </button>
              ) : (
                <span className={cn(styles.fullArt, styles.thumbName)} role="img" aria-label={step.name}><span aria-hidden>{step.name}</span></span>
              )}
              <div className={styles.fullText}>
                <strong className={styles.stepName} data-testid="bridge-step-name">{step.name}</strong>
                {step.card ? <span className={styles.stepDeck} data-have={count > 0 ? "" : undefined} data-testid="bridge-step-deck">{count > 0 ? `In deck ×${count}` : "Not in deck"}</span> : null}
                {step.text ? <p className={styles.stepSays} data-testid="bridge-step-text">{step.text}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/**
 * "Add 2 cards": puts the cards of the line that the deck lacks into the deck, in one undo step. It says which cards
 * go in (and where), and which cannot (banlist, Genesys, a full section). With nothing missing it says so.
 */
export function AddPathCards({ steps, deckCount, adder }: { steps: readonly PathStep[]; deckCount: (card: DeckCardInfo) => number; adder: CardAdder }) {
  // A card whose details have not loaded cannot be placed in Main or Extra yet.
  if (steps.length === 0 || !steps.some((step) => step.card)) return null;
  const loading = steps.some((step) => !step.card);
  const missing = missingSteps(steps, deckCount);
  if (missing.length === 0) {
    return (
      <div className={styles.addBox} data-testid="bridge-add-box">
        <button type="button" className="btn btn-secondary btn-sm" aria-disabled="true" data-testid="bridge-add" data-state="done" onClick={(event) => event.preventDefault()}>
          <Check size={14} strokeWidth={2} aria-hidden />Already in deck
        </button>
      </div>
    );
  }
  const plan = adder.plan(missing);
  const count = plan.add.length;
  const where = (section: "main" | "extra") => (section === "extra" ? "Extra Deck" : "Main Deck");
  return (
    <div className={styles.addBox} data-testid="bridge-add-box">
      {count > 0 ? (
        <button type="button" className="btn btn-primary btn-sm" data-testid="bridge-add" data-state="ready" aria-busy={loading || undefined}
          onClick={() => adder.add(missing)}>
          Add {count} {count === 1 ? "card" : "cards"}
        </button>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" aria-disabled="true" data-testid="bridge-add" data-state="blocked" onClick={(event) => event.preventDefault()}>
          Cannot add
        </button>
      )}
      {count > 0 ? (
        <p className={styles.addList} data-testid="bridge-add-list">
          Adds {plan.add.map((entry) => `${entry.card.name} (${where(entry.section)})`).join(", ")}.
        </p>
      ) : null}
      {plan.blocked.length > 0 ? (
        <ul className={styles.addBlocked} aria-label="Cards that cannot be added" data-testid="bridge-add-blocked">
          {plan.blocked.map((entry) => <li key={entry.card.code}><strong>{entry.card.name}:</strong> {entry.reason}</li>)}
        </ul>
      ) : null}
      {loading ? <p className={styles.addList}>Some cards of the line are still loading.</p> : null}
    </div>
  );
}

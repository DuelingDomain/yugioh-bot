"use client";

import { ArrowDown, ArrowRight, Check } from "lucide-react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import type { CardAdder } from "@/components/decks/card-adder";
import { LimitBadge } from "@/components/decks/limit-badge";
import { cn } from "@/lib/utils";
import type { CardPropsFor } from "./bridge-card";
import { roleFor } from "./bridges-model";
import type { CardsState } from "./use-bridges";
import type { BridgeAlternativePath, ShownBridge } from "@/lib/bridges-api";
import styles from "./bridges.module.css";

/** One card of the line. `card` is null while its details load ("loading") or when none was found for the name ("missing"). */
export type PathStep = {
  name: string;
  card: DeckCardInfo | null;
  status: "ready" | "loading" | "missing" | "failed";
  /** What the bridge data says this step does. Empty when it says nothing, or the same as the step before. */
  text: string;
};

/**
 * The line of a bridge as steps, in play order. The reviewed line holds card names; each name is matched to the
 * bridge card of that name. Prefer the code-written review step, including an explicit empty caption. Older rows
 * fall back to reason text, with a shared reason shown once under the first card.
 */
export function pathSteps(bridge: ShownBridge, cards: ReadonlyMap<number, DeckCardInfo>, state: CardsState = "settled"): PathStep[] {
  const byName = new Map<string, { code: number; card: DeckCardInfo }>();
  for (const code of bridge.cards) {
    const card = cards.get(code);
    if (card && !byName.has(card.name)) byName.set(card.name, { code, card });
  }
  const said = new Set<string>();
  return bridge.review.line.map((name, index) => {
    const found = byName.get(name);
    const status = found ? "ready" : state === "settled" ? "missing" : state === "failed" ? "failed" : "loading";
    const reviewed = bridge.review.steps?.[index];
    const sentence = reviewed?.card === name ? reviewed.text : found ? roleFor(bridge, found.code) : "";
    const text = reviewed?.card === name ? sentence : sentence && !said.has(sentence) ? sentence : "";
    if (sentence) said.add(sentence);
    return { name, card: found?.card ?? null, status, text };
  });
}

/**
 * One other way in as steps. Its names are matched to the loaded cards of `codes` (the bridge cards and the engine
 * core), like the main line. Each step keeps the sentence the host wrote for it.
 */
export function alternativeSteps(path: BridgeAlternativePath, codes: readonly number[], cards: ReadonlyMap<number, DeckCardInfo>, state: CardsState = "settled"): PathStep[] {
  const byName = new Map<string, DeckCardInfo>();
  for (const code of codes) {
    const card = cards.get(code);
    if (card && !byName.has(card.name)) byName.set(card.name, card);
  }
  return path.line.map((name, index) => {
    const card = byName.get(name) ?? null;
    return { name, card, status: card ? "ready" : state === "settled" ? "missing" : state === "failed" ? "failed" : "loading", text: path.steps[index]?.text ?? "" };
  });
}

/** The cards of the line that the deck (Main and Extra) does not hold yet, once each. */
export function missingSteps(steps: readonly PathStep[], held: (card: DeckCardInfo) => number): DeckCardInfo[] {
  const seen = new Set<string>();
  const out: DeckCardInfo[] = [];
  for (const { card } of steps) {
    if (!card || seen.has(card.name) || held(card) > 0) continue;
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
export function PathThumbs({ steps, cardProps, label = "Path of cards", testId = "bridge-path" }: { steps: readonly PathStep[]; cardProps: CardPropsFor; label?: string; testId?: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className={styles.path} aria-label={label} data-testid={testId}>
      {steps.map((step, index) => (
        <li key={`${index}-${step.name}`} className={styles.pathStep}>
          {index > 0 ? <ArrowRight size={14} strokeWidth={1.8} aria-hidden className={styles.pathArrow} /> : null}
          {step.card ? (
            <button type="button" className={styles.thumb} aria-label={step.name} title={step.name} {...cardProps(step.card)}>
              <CardArt code={step.card.code} name={step.name} />
            </button>
          ) : (
            <span className={cn(styles.thumb, styles.thumbName)} role="img" data-missing={step.status === "missing" || step.status === "failed" ? "" : undefined} aria-label={step.status === "missing" ? `${step.name}, card not found` : step.status === "failed" ? `${step.name}, could not load` : step.name} title={step.status === "missing" ? `${step.name}: card not found` : step.status === "failed" ? `${step.name}: could not load` : step.name}><span aria-hidden>{step.name}</span></span>
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
export function PathSteps({ steps, cardProps, deckCount, held, limit }: {
  steps: readonly PathStep[];
  cardProps: CardPropsFor;
  /** Copies in the deck in any section; `held` counts Main and Extra only, so a Side Deck copy reads "In Side Deck". */
  deckCount: (card: DeckCardInfo) => number;
  held: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
}) {
  return (
    <div className={styles.pathBox}>
      <p className={styles.pathNote} data-testid="bridge-line-note">Each step still needs its card&apos;s printed conditions and costs.</p>
      <ol className={styles.pathFull} data-testid="bridge-line" aria-label="The line, in play order">
        {steps.map((step, index) => {
          const count = step.card ? held(step.card) : 0;
          const side = step.card && count === 0 ? deckCount(step.card) : 0;
          return (
            <li key={`${index}-${step.name}`} className={styles.fullStep} data-testid="bridge-step">
              {index > 0 ? (
                <span className={styles.fullArrow} aria-hidden><ArrowDown size={16} strokeWidth={1.8} /></span>
              ) : null}
              {step.card ? (
                <button type="button" className={styles.fullArt} aria-label={`${step.name}${count ? `, ${count} in deck` : side ? ", in Side Deck" : ", not in deck"}`} {...cardProps(step.card)}>
                  <CardArt code={step.card.code} name={step.name} />
                  <LimitBadge limit={limit(step.card)} />
                </button>
              ) : (
                <span className={cn(styles.fullArt, styles.thumbName)} role="img" aria-label={step.name}><span aria-hidden>{step.name}</span></span>
              )}
              <div className={styles.fullText}>
                <strong className={styles.stepName} data-testid="bridge-step-name">{step.name}</strong>
                {step.card ? <span className={styles.stepDeck} data-have={count > 0 ? "" : undefined} data-testid="bridge-step-deck">{count > 0 ? `In deck ×${count}` : side > 0 ? `In Side Deck ×${side}` : "Not in deck"}</span> : step.status === "missing" || step.status === "failed" ? <span className={styles.stepDeck} data-testid="bridge-step-deck" data-missing="">{step.status === "missing" ? "Card not found" : "Could not load"}</span> : null}
                {step.text ? <p className={styles.stepSays} data-testid="bridge-step-text">{step.text}</p> : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** What an add button shows: the cards that go in (and where), the ones that cannot, and what is not known yet. */
export type AddView = {
  /** Sets the test ids: `bridge-add`, `core-add`. */
  prefix: "bridge" | "core";
  /** "Add bridge" or "Add engine". */
  verb: string;
  /** Copies the button adds. */
  count: number;
  /** The label of screen readers for the Add button, with the engine's name. */
  label?: string;
  adds: readonly { card: DeckCardInfo; section: "main" | "extra"; copies: number }[];
  blocked: readonly { card: DeckCardInfo; reason: string; copies?: number }[];
  unknownPoints: readonly DeckCardInfo[];
  /** Copies the deck lacks, before the rules decide. Zero: the deck holds it all. */
  lacking: number;
  loading: boolean;
  unfound: readonly string[];
  unloaded: readonly string[];
  /** The host says the deck holds the whole package: no Add, a quiet label. */
  owned?: boolean;
  /** One more line under the list, for example the Genesys points the copies cost. */
  note?: string;
  onAdd: () => void;
};

/**
 * "Add bridge (2)" or "Add engine (4)": puts the cards the deck lacks into the deck, in one undo step. It says which
 * cards go in (and where), and which cannot (banlist, a full section). It never says "Already in deck" while a card
 * is still loading or was not found: it says so and names that card.
 */
export function AddBox({ prefix, verb, count, label, adds, blocked, unknownPoints, lacking, loading, unfound, unloaded, owned = false, note, onAdd }: AddView) {
  const id = `${prefix}-add`;
  if (owned) {
    return (
      <div className={styles.addBox} data-testid={`${id}-box`}>
        <span className={styles.owned} data-testid={id} data-state="owned"><Check size={12} strokeWidth={2} aria-hidden />Already in deck</span>
      </div>
    );
  }
  const where = (section: "main" | "extra") => (section === "extra" ? "Extra Deck" : "Main Deck");
  const complete = !loading && unfound.length === 0 && unloaded.length === 0 && blocked.length === 0;
  return (
    <div className={styles.addBox} data-testid={`${id}-box`}>
      {count > 0 ? (
        <button type="button" className="btn btn-primary btn-sm" aria-label={label} data-testid={id} data-state="ready" onClick={onAdd}>
          {verb} ({count})
        </button>
      ) : complete && lacking === 0 ? (
        <button type="button" className="btn btn-secondary btn-sm" aria-disabled="true" data-testid={id} data-state="done" onClick={(event) => event.preventDefault()}>
          <Check size={14} strokeWidth={2} aria-hidden />Already in deck
        </button>
      ) : (
        <button type="button" className="btn btn-secondary btn-sm" aria-disabled="true" aria-busy={loading || undefined} data-testid={id} data-state={loading ? "loading" : "blocked"} onClick={(event) => event.preventDefault()}>
          {loading ? verb : "Cannot add"}
        </button>
      )}
      {count > 0 ? (
        <p className={styles.addList} data-testid={`${id}-list`}>
          Adds {adds.map((entry) => `${entry.card.name}${entry.copies > 1 ? ` ×${entry.copies}` : ""} (${where(entry.section)})`).join(", ")}.
          {unknownPoints.length > 0 ? ` Genesys points unknown: ${unknownPoints.map((card) => card.name).join(", ")}.` : ""}
          {note ? ` ${note}` : ""}
        </p>
      ) : null}
      {blocked.length > 0 ? (
        <ul className={styles.addBlocked} aria-label="Cards that cannot be added" data-testid={`${id}-blocked`}>
          {blocked.map((entry) => <li key={entry.card.code}><strong>{entry.card.name}{entry.copies && entry.copies > 1 ? ` ×${entry.copies}` : ""}:</strong> {entry.reason}</li>)}
        </ul>
      ) : null}
      {unfound.length > 0 ? <p className={styles.addList} data-testid={`${id}-unfound`}>{unfound.join(", ")} could not be found, so {unfound.length === 1 ? "it is" : "they are"} not added.</p> : null}
      {unloaded.length > 0 ? <p className={styles.addList} data-testid={`${id}-unloaded`}>{unloaded.join(", ")} could not be loaded, so {unloaded.length === 1 ? "it is" : "they are"} not added. Try again in a moment.</p> : null}
      {loading ? <p className={styles.addList} data-testid={`${id}-loading`}>Some cards are still loading.</p> : null}
    </div>
  );
}

/** "Add bridge (2)": the cards of the line that the deck lacks (one copy each). */
export function AddPathCards({ steps, name, held, adder, owned = false }: { steps: readonly PathStep[]; /** The engine the bridge leads to, for the label of screen readers. */ name: string; held: (card: DeckCardInfo) => number; adder: CardAdder; /** The host says the deck holds the whole package: no Add, a quiet label. */ owned?: boolean }) {
  if (steps.length === 0) return null;
  const missing = missingSteps(steps, held);
  const plan = adder.plan(missing);
  return (
    <AddBox prefix="bridge" verb="Add bridge" count={plan.add.length} label={`Add ${name} bridge, ${plan.add.length} ${plan.add.length === 1 ? "card" : "cards"}`} adds={plan.add.map((entry) => ({ ...entry, copies: 1 }))} blocked={plan.blocked} unknownPoints={plan.unknownPoints}
      lacking={missing.length} loading={steps.some((step) => step.status === "loading")}
      unfound={steps.filter((step) => step.status === "missing").map((step) => step.name)} unloaded={steps.filter((step) => step.status === "failed").map((step) => step.name)}
      owned={owned} onAdd={() => adder.add(missing)} />
  );
}

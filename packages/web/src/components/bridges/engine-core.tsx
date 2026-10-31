"use client";

import { useState } from "react";
import type { DeckCardInfo, DuelMode } from "@yugidraft/shared/duels";
import { CardArt } from "@/components/decks/card-art";
import type { CardAdder, CopyRequest } from "@/components/decks/card-adder";
import { LimitBadge } from "@/components/decks/limit-badge";
import type { BridgeAlternativePath, CoreCard, EngineCore } from "@/lib/bridges-api";
import type { CardPropsFor } from "./bridge-card";
import { AddBox, PathThumbs, alternativeSteps, type PathStep } from "./bridge-path";
import { cardsState, type CardsState } from "./use-bridges";
import styles from "./bridges.module.css";

/** The words for the part a core card plays. */
const ROLE_WORDS: Record<CoreCard["role"], string> = {
  starter: "Starter", searcher: "Searcher", extender: "Extender", payoff: "Payoff", support: "Support", material: "Material",
};

/** The passcodes of an engine's core, for the card loader. Older answers have no core. */
export function coreCodes(core: EngineCore | undefined): number[] {
  return core ? core.cards.map((entry) => entry.code) : [];
}

/** Genesys points of a core card: the host's number, else the catalog's. Undefined: unknown. */
function pointsOf(entry: CoreCard, card: DeckCardInfo | undefined): number | undefined {
  if (entry.points != null) return entry.points;
  return typeof card?.genesysPoints === "number" ? card.genesysPoints : undefined;
}

/**
 * The engine core of a suggestion: the cards that make the engine work, each as an image with its role, how many
 * copies it wants, what the deck holds and what it still needs. Counts follow the open deck, so they change as the
 * deck does; a card that has not loaded yet shows the counts the host sent. A core that is not ready says why and has
 * no Add button.
 */
export function EngineCoreGroup({ core, cards, cardProps, genesys, held, limit, heading: Heading = "h4" }: {
  core: EngineCore;
  cards: ReadonlyMap<number, DeckCardInfo>;
  cardProps: CardPropsFor;
  genesys: boolean;
  /** Copies of a card in Main and Extra. Not given: the counts the host sent. */
  held?: (card: DeckCardInfo) => number;
  limit?: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  heading?: "h4" | "h5";
}) {
  return (
    <section className={styles.coreBox} aria-label="Engine core" data-testid="engine-core" data-ready={core.ready ? "" : undefined}>
      <Heading className={styles.subTitle}>Engine core</Heading>
      {core.caption ? <p className={styles.coreCaption} data-testid="engine-core-caption">{core.caption}</p> : null}
      {!core.ready ? (
        <p className={styles.coreGaps} data-testid="engine-core-gaps">
          <span className={styles.gapsLabel}>Not ready:</span> {core.gaps.length > 0 ? core.gaps.join(" ") : "we know no core cards for this engine yet."}
        </p>
      ) : null}
      {core.cards.length > 0 ? (
        <ul className={styles.coreCards} aria-label="Engine core cards" data-testid="engine-core-cards">
          {core.cards.map((entry) => {
            const card = cards.get(entry.code);
            const have = card && held ? held(card) : entry.held;
            const need = Math.max(0, entry.copies - have);
            const points = genesys ? pointsOf(entry, card) : undefined;
            const art = <CardArt code={entry.code} name={entry.name} />;
            return (
              <li key={entry.code} className={styles.coreCard} data-testid="engine-core-card" data-role={entry.role} data-code={entry.code}>
                {card ? (
                  <button type="button" className={styles.coreArt} aria-label={`${entry.name}. ${ROLE_WORDS[entry.role]}, ${entry.copies} ${entry.copies === 1 ? "copy" : "copies"}, ${have > 0 ? `${have} in deck` : "not in deck"}`} title={entry.name} {...cardProps(card)}>
                    {art}
                    {limit ? <LimitBadge limit={limit(card)} /> : null}
                  </button>
                ) : <span className={styles.coreArt} role="img" aria-label={entry.name}>{art}</span>}
                <div className={styles.fullText}>
                  <span className={styles.stepName} data-testid="engine-core-name">{entry.name}</span>
                  <span className={styles.coreTags}>
                    <span className={styles.roleTag} data-role={entry.role} data-testid="engine-core-role">{ROLE_WORDS[entry.role]}</span>
                    <span className="num" data-testid="engine-core-copies">×{entry.copies}</span>
                    <span data-testid="engine-core-section">{entry.section === "extra" ? "Extra" : "Main"}</span>
                    {genesys && points == null ? <span data-testid="engine-core-points">Points unknown</span> : null}
                    {points != null && points > 0 ? <span className="num" data-testid="engine-core-points">{points} pts</span> : null}
                  </span>
                  <span className={styles.stepDeck} data-testid="engine-core-deck">
                    {have > 0 ? <span data-have="" data-testid="engine-core-held">In deck ×{have}</span> : null}
                    {have > 0 && need > 0 ? ", " : null}
                    {need > 0 ? <span data-testid="engine-core-need">Need ×{need}</span> : null}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      ) : null}
    </section>
  );
}

/** What "Add engine" asks for: per card, the copies the deck still lacks. The maximum of the line and the core, not their sum. */
export function engineRequests(core: EngineCore, line: readonly PathStep[], cards: ReadonlyMap<number, DeckCardInfo>, held: (card: DeckCardInfo) => number, state: CardsState) {
  const wanted = new Map<string, CopyRequest>();
  const want = (card: DeckCardInfo, copies: number) => {
    const known = wanted.get(card.name);
    if (!known) wanted.set(card.name, { card, copies });
    else if (copies > known.copies) known.copies = copies;
  };
  const unfound: string[] = [];
  const unloaded: string[] = [];
  let loading = false;
  for (const entry of core.cards) {
    const card = cards.get(entry.code);
    if (card) want(card, entry.copies);
    else if (state === "settled") unfound.push(entry.name);
    else if (state === "failed") unloaded.push(entry.name);
    else loading = true;
  }
  for (const step of line) {
    if (step.card) want(step.card, 1);
    else if (step.status === "missing") unfound.push(step.name);
    else if (step.status === "failed") unloaded.push(step.name);
    else loading = true;
  }
  const requests = [...wanted.values()]
    .map(({ card, copies }) => ({ card, copies: Math.max(0, copies - held(card)) }))
    .filter((request) => request.copies > 0);
  return { requests, unfound: [...new Set(unfound)], unloaded: [...new Set(unloaded)], loading };
}

/**
 * "Add engine (4)": every copy of the core and of the line that the deck lacks, in one undo step. It shows only for
 * a ready core: a core with gaps says "Not ready" and offers no button.
 */
export function AddEngineCards({ core, line, cards, mode, adder, owned = false, genesys }: {
  core: EngineCore | undefined;
  /** The bridge cards of the chosen path, which the engine needs too. */
  line: readonly PathStep[];
  cards: ReadonlyMap<number, DeckCardInfo>;
  mode: DuelMode;
  adder: CardAdder;
  owned?: boolean;
  genesys: boolean;
}) {
  if (!core || !core.ready) return null;
  const { requests, unfound, unloaded, loading } = engineRequests(core, line, cards, adder.held, cardsState(coreCodes(core), mode));
  const plan = adder.planCopies(requests);
  const copies = plan.add.reduce((sum, entry) => sum + entry.copies, 0);
  const costs = plan.add.map((entry) => entry.card.genesysPoints);
  const note = genesys && copies > 0 && costs.every((points) => typeof points === "number")
    ? `Needs about ${plan.add.reduce((sum, entry) => sum + (entry.card.genesysPoints ?? 0) * entry.copies, 0)} Genesys points for these copies.`
    : undefined;
  return (
    <AddBox prefix="core" verb="Add engine" count={copies} adds={plan.add} blocked={plan.blocked} unknownPoints={plan.unknownPoints}
      lacking={requests.reduce((sum, request) => sum + request.copies, 0)} loading={loading} unfound={unfound} unloaded={unloaded}
      owned={owned} note={note} onAdd={() => adder.addCopies(requests)} />
  );
}

/** Other ways in shown before "Show more". */
const OTHER_WAYS_SHOWN = 2;

/**
 * The other ways into the engine, one compact row each: card images with arrows, in play order. The first two show;
 * the rest sit behind a button.
 */
export function OtherWays({ paths, codes, cards, state, cardProps }: {
  paths: readonly BridgeAlternativePath[];
  codes: readonly number[];
  cards: ReadonlyMap<number, DeckCardInfo>;
  state: CardsState;
  cardProps: CardPropsFor;
}) {
  const [all, setAll] = useState(false);
  if (paths.length === 0) return null;
  const shown = all ? paths : paths.slice(0, OTHER_WAYS_SHOWN);
  return (
    <section className={styles.otherWays} aria-label="Other ways in" data-testid="bridge-other-ways">
      <h5 className={styles.subTitle}>Other ways in</h5>
      <ul className={styles.otherRows} data-testid="bridge-other-rows">
        {shown.map((path, index) => {
          const steps = alternativeSteps(path, codes, cards, state);
          return (
            <li key={`${index}-${path.line.join(">")}`} className={styles.otherRow} data-testid="bridge-other-row" title={path.steps.map((step) => `${step.card}: ${step.text}`).join("\n")}>
              <PathThumbs steps={steps} cardProps={cardProps} label={`Other way in: ${path.line.join(", then ")}`} testId="bridge-other-path" />
            </li>
          );
        })}
      </ul>
      {paths.length > OTHER_WAYS_SHOWN ? (
        <button type="button" className={styles.link} aria-expanded={all} data-testid="bridge-other-more" onClick={() => setAll((now) => !now)}>
          {all ? "Show fewer" : `Show ${paths.length - OTHER_WAYS_SHOWN} more`}
        </button>
      ) : null}
    </section>
  );
}

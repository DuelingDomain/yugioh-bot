"use client";

import { AlertTriangle, Crown, Link2, Loader2, Plus, RotateCw, Sparkles } from "lucide-react";
import type { DeckCardInfo } from "@yugidraft/shared/duels";
import { EFFECT_SEARCH_ATTRIBUTION } from "@yugidraft/shared/cards/effects/capability";
import { cn } from "@/lib/utils";
import { CardArt } from "./card-art";
import { genesysMark } from "./genesys";
import { GenesysBadge } from "./genesys-ui";
import type { InsightCard } from "./insights-api";
import type { SuggestionsState } from "./use-deck-suggestions";
import styles from "./suggestions-panel.module.css";

/**
 * The Suggestions list of a deck: up to 20 cards, each with one reason line and a one-click add.
 * Genesys decks show the points of each card and the points left; Domain decks mark the cards that fit the Deck Master.
 */
export function SuggestionsPanel({
  state,
  genesys = null,
  domain = false,
  hasMaster = false,
  inDeck,
  addBlock,
  onAdd,
  onInspect,
  onWorksWith,
  onRetry,
}: {
  state: SuggestionsState;
  /** Genesys on: the points left under the cap (never below 0). */
  genesys?: { remaining: number; cap: number } | null;
  domain?: boolean;
  hasMaster?: boolean;
  /** Copies of the card already in the deck. */
  inDeck: (card: DeckCardInfo) => number;
  /** Why a card cannot be added right now, or null when it can. */
  addBlock: (card: DeckCardInfo) => string | null;
  onAdd: (card: DeckCardInfo) => void;
  onInspect?: (card: DeckCardInfo) => void;
  onWorksWith?: (card: DeckCardInfo) => void;
  onRetry?: () => void;
}) {
  const working = state.status === "loading";
  return (
    <section className={styles.panel} aria-label="Suggestions" aria-busy={working || undefined} data-keep>
      <header className={styles.head}>
        <h2 className={styles.title}><Sparkles size={16} strokeWidth={1.6} aria-hidden />Suggestions</h2>
        <p className={styles.sub}>
          Cards that link to the most cards in your deck.
          {genesys ? <> <b className="num">{genesys.remaining}</b> of {genesys.cap} points left.</> : null}
        </p>
        {working && state.cards.length > 0 ? <span className={styles.working}><Loader2 size={13} className={styles.spin} aria-hidden />Updating…</span> : null}
      </header>

      {state.status === "error" ? (
        <div className={styles.note} role="alert">
          <AlertTriangle size={15} aria-hidden />
          <span>{state.error ?? "Suggestions are not available."} The editor still works.</span>
          {onRetry ? <button type="button" className={styles.retry} onClick={onRetry}><RotateCw size={13} aria-hidden />Try again</button> : null}
        </div>
      ) : null}

      {state.status === "idle" ? <p className={styles.empty}>Add some cards to your deck to see suggestions.</p> : null}
      {working && state.cards.length === 0 ? <p className={styles.empty}><Loader2 size={14} className={styles.spin} aria-hidden />Finding cards that work with your deck…</p> : null}
      {state.status === "ready" && state.cards.length === 0 ? <p className={styles.empty}>No card fits right now{genesys ? " in the points left" : ""}.</p> : null}

      {state.cards.length > 0 ? (
        <ol className={styles.list} data-stale={working ? "true" : undefined}>
          {state.cards.map((card) => (
            <Row key={card.code} card={card} genesys={genesys != null} master={domain && hasMaster} copies={inDeck(card)} block={addBlock(card)} onAdd={onAdd} onInspect={onInspect} onWorksWith={onWorksWith} />
          ))}
        </ol>
      ) : null}

      <p className={styles.credit}>{EFFECT_SEARCH_ATTRIBUTION}</p>
    </section>
  );
}

function Row({
  card,
  genesys,
  master,
  copies,
  block,
  onAdd,
  onInspect,
  onWorksWith,
}: {
  card: InsightCard;
  genesys: boolean;
  master: boolean;
  copies: number;
  block: string | null;
  onAdd: (card: DeckCardInfo) => void;
  onInspect?: (card: DeckCardInfo) => void;
  onWorksWith?: (card: DeckCardInfo) => void;
}) {
  const points = genesys ? genesysMark(card) : null;
  return (
    <li className={styles.row}>
      <button type="button" className={styles.main} aria-label={`${card.name}. ${card.reason}`} onClick={() => onInspect?.(card)} onDoubleClick={() => { if (!block) onAdd(card); }}>
        <span className={styles.art}><CardArt code={card.code} name={card.name} /></span>
        <span className={styles.text}>
          <strong>{card.name}</strong>
          <span className={styles.reason}>{card.reason}</span>
          <span className={styles.meta}>
            <span className={styles.links}><Link2 size={12} aria-hidden />Links to <b className="num">{card.linkedCards}</b> {card.linkedCards === 1 ? "card" : "cards"}</span>
            {master && card.deckMasterFit ? <span className={cn("chip", "chip-gold", styles.fit)} title="This card links to your Deck Master"><Crown size={12} aria-hidden />Deck Master fits</span> : null}
            {copies > 0 ? <span className={cn("num", styles.have)}>×{copies} in deck</span> : null}
          </span>
        </span>
        {points ? <GenesysBadge card={card} variant="inline" /> : null}
      </button>
      {onWorksWith ? (
        <button type="button" className={styles.side} aria-label={`Find cards that work with ${card.name}`} title="Find cards that work with this" onClick={() => onWorksWith(card)}>
          <Link2 size={15} strokeWidth={1.7} aria-hidden />
        </button>
      ) : null}
      <button type="button" className={styles.add} aria-label={block ? `Add ${card.name} to the deck. Not allowed: ${block}` : `Add ${card.name} to the deck`} title={block ?? "Add to deck"} aria-disabled={block != null || undefined} onClick={() => { if (!block) onAdd(card); }}>
        <Plus size={16} strokeWidth={1.9} aria-hidden />
      </button>
    </li>
  );
}

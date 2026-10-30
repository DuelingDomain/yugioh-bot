"use client";

import { useEffect, useMemo, useRef, useState, type ButtonHTMLAttributes, type ReactNode } from "react";
import type { DeckCardInfo, DuelDeck, DuelMode } from "@yugidraft/shared/duels";
import type { DeckSuggestionRow } from "@yugidraft/shared/services";
import { cn } from "@/lib/utils";
import { CardArt } from "./card-art";
import { InsightsDisabledError, fetchSuggestRows, resolveInsightCards, type InsightCard } from "./insights-api";
import { LimitBadge } from "./limit-badge";
import styles from "./suggestions-panel.module.css";

/** Wait this long after the last deck change before asking again. */
export const SUGGESTIONS_DEBOUNCE_MS = 600;

/** A row shows this many cards. The rest wait behind "Show more". */
export const SUGGESTIONS_ROW_PREVIEW = 4;

const ROW_IDS: DeckSuggestionRow["id"][] = ["archetype", "outside", "extra", "staples"];
const EMPTY_HINTS: Record<DeckSuggestionRow["id"], string> = {
  archetype: "No archetype support fits your deck yet.",
  outside: "No outside support fits your deck yet.",
  extra: "No Extra Deck card fits your Main Deck yet.",
  staples: "No staples fit this format and pool yet.",
};

const ROW_TITLES: Record<DeckSuggestionRow["id"], string> = {
  archetype: "Archetype support",
  outside: "Outside the archetype",
  extra: "Extra Deck you can make",
  staples: "Staples for this format",
};

/** What the editor tells the list about the deck, so the list can ask for suggestions. */
export type BrowserSuggest = {
  deck: DuelDeck;
  /** A banlist id of the editor. Not given: the server uses the default of the format. */
  banlist?: string;
  deckMaster?: number | null;
  genesysRemaining?: number;
  /** The archetype of the deck, for the Bridges tab. Null: the deck has none yet. */
  archetype?: string | null;
};

type Row = { id: DeckSuggestionRow["id"]; state: DeckSuggestionRow["state"]; hint?: string; minimumMainCards?: number; mainCards?: number; cards: InsightCard[] };
type Loaded = { key: string; rows: Row[] };

type Props = {
  /** The Suggest tab is on screen. A hidden panel stays mounted but asks for nothing; it asks again when it is shown. */
  active: boolean;
  /** The "Engines that fit" row, above the four rows. Not given yet: no space is used. */
  engines?: ReactNode;
  suggest: BrowserSuggest;
  mode: DuelMode;
  genesys: boolean;
  /** Draft deck mode: only these canonical passcodes can be suggested. */
  pool?: readonly number[];
  /** The same click, drag and hover handlers as a card in the normal results. */
  cardProps: (card: DeckCardInfo) => ButtonHTMLAttributes<HTMLButtonElement>;
  deckCount: (card: DeckCardInfo) => number;
  limit: (card: DeckCardInfo) => 0 | 1 | 2 | 3;
  onCatalog: (cards: DeckCardInfo[]) => void;
  /** The server says Suggestions are off. */
  onDisabled?: () => void;
};

/** One request key for the deck and its scope. The order of the cards does not matter. */
function requestKey(props: Pick<Props, "mode" | "genesys" | "pool"> & BrowserSuggest): string {
  const sorted = (codes: readonly number[]) => [...codes].sort((a, b) => a - b).join(",");
  return JSON.stringify([props.mode, props.genesys, props.banlist ?? "", props.deckMaster ?? 0, props.genesysRemaining ?? -1, props.pool === undefined ? null : sorted(props.pool), sorted(props.deck.main), sorted(props.deck.extra), sorted(props.deck.side)]);
}

/**
 * The Suggest tab of the deck editor. The rows stay while a new answer loads,
 * so the list does not flicker, and every tile has a fixed size, so nothing moves.
 */
export function SuggestionsPanel({ active, engines, suggest, mode, genesys, pool, cardProps, deckCount, limit, onCatalog, onDisabled }: Props) {
  const { deck, banlist, deckMaster, genesysRemaining } = suggest;
  const needsMaster = mode === "domain" && deckMaster == null;
  const empty = deck.main.length === 0;
  const key = useMemo(
    () => requestKey({ mode, genesys, pool, deck, banlist, deckMaster, genesysRemaining }),
    [mode, genesys, pool, deck, banlist, deckMaster, genesysRemaining],
  );
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set());
  const latest = useRef({ deck, banlist, deckMaster, genesysRemaining, pool, mode, genesys });
  latest.current = { deck, banlist, deckMaster, genesysRemaining, pool, mode, genesys };
  const loadedRef = useRef(loaded);
  loadedRef.current = loaded;
  const onCatalogRef = useRef(onCatalog);
  onCatalogRef.current = onCatalog;
  const onDisabledRef = useRef(onDisabled);
  onDisabledRef.current = onDisabled;

  useEffect(() => {
    if (!active || empty || needsMaster) return;
    if (loaded?.key === key && retry === 0) return;
    const controller = new AbortController();
    // A deck change waits for the last change to settle. The first answer has nothing to wait for.
    const timer = window.setTimeout(() => {
      void (async () => {
        const now = latest.current;
        try {
          const scope = { mode: now.mode, genesys: now.genesys, deckMaster: now.deckMaster, ...(now.banlist ? { banlist: now.banlist } : {}), ...(now.pool ? { pool: now.pool } : {}), ...(now.genesysRemaining != null ? { genesysRemaining: now.genesysRemaining } : {}) };
          const answer = await fetchSuggestRows({ main: now.deck.main, extra: now.deck.extra, side: now.deck.side, ...(now.mode === "domain" && now.deckMaster != null ? { deckMaster: now.deckMaster } : {}) }, scope, controller.signal);
          const ranked = answer.rows.flatMap((row) => row.cards);
          const cards = await resolveInsightCards(ranked, { mode: now.mode }, controller.signal);
          if (controller.signal.aborted) return;
          const byCode = new Map(cards.map((card) => [card.code, card]));
          const rows = answer.rows.map((row): Row => ({
            id: row.id, state: row.state, hint: row.hint, minimumMainCards: row.minimumMainCards, mainCards: row.mainCards,
            cards: row.cards.flatMap((item) => { const card = byCode.get(item.passcode); return card ? [card] : []; }),
          }));
          onCatalogRef.current(cards);
          setFailed(null);
          setRetry(0);
          setLoaded({ key, rows });
        } catch (reason) {
          if (controller.signal.aborted) return;
          if (reason instanceof InsightsDisabledError) { onDisabledRef.current?.(); return; }
          setFailed(key);
        }
      })();
    }, loadedRef.current ? SUGGESTIONS_DEBOUNCE_MS : 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
    // `loaded` is read only to skip a repeat of an answer that is already shown.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, empty, needsMaster, retry]);

  const updating = !empty && !needsMaster && loaded?.key !== key && failed !== key;
  // Keep the same responsive four-tile footprint before and after the first answer,
  // and when a row becomes empty. Expanding a row is an explicit user action.
  const body = ROW_IDS.map((id) => {
    const row = loaded?.rows.find((row) => row.id === id);
    const open = expanded.has(id);
    const cards = empty || needsMaster ? [] : row?.cards ?? [];
    const shown = open ? cards : cards.slice(0, SUGGESTIONS_ROW_PREVIEW);
    const skeleton = !empty && !needsMaster && loaded == null && failed == null;
    const hint = needsMaster ? "Choose a Deck Master to see suggestions for this deck."
      : empty ? "Add a few Main Deck cards. Suggestions for your deck show here."
      : row?.state === "hint" ? `Add ${row.minimumMainCards ?? 40} Main Deck cards to see what your deck can make (${row.mainCards ?? deck.main.length}/${row.minimumMainCards ?? 40})`
      : EMPTY_HINTS[id];
    return (
      <section key={id} className={styles.row} aria-labelledby={`suggest-${id}`}>
        <h3 id={`suggest-${id}`} className={styles.rowTitle}>{ROW_TITLES[id]}</h3>
        <div className={styles.slots}>
          <ul className={styles.grid} aria-hidden={skeleton || !cards.length || undefined}>
            {Array.from({ length: Math.max(SUGGESTIONS_ROW_PREVIEW, shown.length) }, (_, index) => {
              const card = shown[index];
              if (!card) return <li key={`slot-${index}`} className={cn(styles.cell, skeleton && styles.skeleton)} aria-hidden />;
              const count = deckCount(card);
              return (
                <li key={card.code} className={styles.cell}>
                  <button type="button" className={styles.card}
                    aria-label={`${card.name}${count ? `, ${count} in deck` : ""}. ${card.reason}`}
                    data-un={card.unavailableReason ? "" : undefined} {...cardProps(card)}
                    title={`${card.name}: ${card.reason}`}>
                    <span className={styles.art}>
                      <CardArt code={card.code} name={card.name} />
                      <LimitBadge limit={limit(card)} />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.nameLine}>
                        <strong className={styles.name}>{card.name}</strong>
                        {count > 0 ? <span className={cn("num", styles.have)}>×{count}</span> : null}
                      </span>
                      <span className={styles.why}>{card.reason}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          {!cards.length && !skeleton ? (
            <p className={styles.hint}>
              {failed === key && id === "archetype" ? <>Suggestions are not available right now. <button type="button" className={styles.retry} onClick={() => setRetry((value) => value + 1)}>Try again</button></> : hint}
            </p>
          ) : null}
        </div>
        <div className={styles.rowFooter}>
          {cards.length > SUGGESTIONS_ROW_PREVIEW ? (
            <button type="button" className={styles.more} aria-expanded={open}
              onClick={() => setExpanded((now) => { const next = new Set(now); if (next.has(id)) next.delete(id); else next.add(id); return next; })}>
              {open ? "Show less" : `Show more (${cards.length - SUGGESTIONS_ROW_PREVIEW})`}
            </button>
          ) : null}
        </div>
      </section>
    );
  });

  return (
    <section className={styles.panel} aria-label="Suggestions" aria-busy={updating || undefined} data-testid="deck-suggestions">
      <header className={styles.head}>
        <h2 className={styles.title}>Suggestions</h2>
        <span className={styles.status} aria-live="polite">{updating ? "Updating…" : ""}</span>
      </header>
      {engines}
      {body}
    </section>
  );
}

"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { AlertTriangle, ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Plus, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { cardLimit, type CardArchetype, type CardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import { TYPE_LINK, cardDetailsText, cardStatsText } from "@/components/duel/constants";
import { cn } from "@/lib/utils";
import { artCountLabel } from "@/components/artwork/artwork-picker";
import { ArtChip } from "./art-chip";
import { DeckButton, DeckSelect, DeckSegmented } from "./controls";
import { queryDeckCards } from "./api";
import { CardArt } from "./card-art";
import { CardFilters } from "./card-filters";
import { hasCardDrag, readCardDrag, writeCardDrag, type CardDrag } from "./drag";
import { SORT_CHOICES, clearFilters, filterChips, queryKey, type BrowserView } from "./filter-model";
import { LimitBadge, limitName } from "./limit-badge";
import type { BanlistLimits } from "./model";
import { queryPoolCards } from "./pool-search";
import styles from "./card-browser.module.css";

const PAGE = 60;
const DEBOUNCE_MS = 160;

const SCOPE_CHOICES = [
  { value: "all" as const, label: "Name + text" },
  { value: "name" as const, label: "Name only" },
];

/** A search result. Server searches say how many other arts the card has; the pool list does not. */
export type BrowserCard = DeckCardInfo & { altArtCount?: number };

type Results = {
  key: string;
  cards: BrowserCard[];
  total: number;
  error: string | null;
};

/** Draft deck mode: the list holds only the player's pool, searched in the browser. */
export type BrowserPool = {
  /** Pool cards; null while they load. */
  cards: DeckCardInfo[] | null;
  /** Copies of the card the pool still has after the deck. */
  remaining: (card: DeckCardInfo) => number;
  totalCopies?: number;
  notInDeck?: number;
};

export function CardBrowser({
  id,
  pool,
  query,
  onQueryChange,
  archetypes,
  limits,
  view,
  onViewChange,
  deckCount,
  inspectCode,
  onInspect,
  onHover,
  onAdd,
  onCatalog,
  onRemoveDrop,
  searchRef,
}: {
  id?: string;
  pool?: BrowserPool;
  query: CardQuery;
  onQueryChange: (query: CardQuery) => void;
  archetypes: readonly CardArchetype[];
  limits: BanlistLimits | null;
  view: BrowserView;
  onViewChange: (view: BrowserView) => void;
  /** Copies of this card (by name) already in the deck. */
  deckCount: (card: DeckCardInfo) => number;
  inspectCode: number | null;
  onInspect: (card: DeckCardInfo, openSheet?: boolean) => void;
  /** The card under the pointer, or null when the pointer leaves it. */
  onHover: (card: DeckCardInfo | null) => void;
  onAdd: (card: DeckCardInfo) => void;
  onCatalog: (cards: DeckCardInfo[]) => void;
  onRemoveDrop: (drag: CardDrag) => void;
  searchRef: RefObject<HTMLInputElement | null>;
}) {
  const key = queryKey(query);
  const [results, setResults] = useState<Results | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [retry, setRetry] = useState(0);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [dropping, setDropping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const moreController = useRef<AbortController | null>(null);
  const latest = useRef(query);
  latest.current = query;
  const poolCards = pool?.cards;
  const archetypesRef = useRef(archetypes);
  archetypesRef.current = archetypes;
  const onCatalogRef = useRef(onCatalog);
  onCatalogRef.current = onCatalog;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const listHover = useRef(false);

  function pointAt(card: DeckCardInfo | null) {
    listHover.current = card != null;
    onHoverRef.current(card);
  }
  // New results or a new view replace the tiles, and a removed tile never sends pointerleave.
  function dropHover() {
    if (listHover.current) pointAt(null);
  }

  useEffect(() => {
    const controller = new AbortController();
    moreController.current?.abort();
    setLoadingMore(false);
    if (pool) {
      if (poolCards) {
        const found = queryPoolCards(poolCards, latest.current, (code) => archetypesRef.current.find((item) => item.codes.includes(code))?.name);
        setResults({ key, cards: found, total: found.length, error: null });
        setLoading(false);
        dropHover();
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
      }
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void queryDeckCards({ ...latest.current, offset: 0, limit: PAGE }, controller.signal).then(
        (result) => {
          setResults({ key, cards: result.cards, total: result.total, error: null });
          setLoading(false);
          dropHover();
          onCatalogRef.current(result.cards);
          if (scrollRef.current) scrollRef.current.scrollTop = 0;
        },
        (reason: unknown) => {
          if (controller.signal.aborted) return;
          setResults({ key, cards: [], total: 0, error: reason instanceof Error ? reason.message : "Could not search cards." });
          setLoading(false);
          dropHover();
        },
      );
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [key, retry, poolCards]);

  const cards = results?.cards ?? [];
  const total = results?.total ?? 0;
  const hasMore = results != null && results.key === key && !results.error && cards.length < total;

  function loadMore() {
    if (!results || loading || loadingMore || !hasMore) return;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    const pageKey = results.key;
    void queryDeckCards({ ...latest.current, offset: results.cards.length, limit: PAGE }, controller.signal).then(
      (result) => {
        setResults((prev) => (prev && prev.key === pageKey
          ? { ...prev, cards: [...prev.cards, ...result.cards], total: result.total }
          : prev));
        setLoadingMore(false);
        onCatalogRef.current(result.cards);
      },
      () => {
        if (!controller.signal.aborted) setLoadingMore(false);
      },
    );
  }
  const loadMoreRef = useRef(loadMore);
  loadMoreRef.current = loadMore;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(
      (entries) => { if (entries.some((entry) => entry.isIntersecting)) loadMoreRef.current(); },
      { root: scrollRef.current, rootMargin: "320px 0px" },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, view]);

  const chips = useMemo(() => filterChips(query, archetypes), [query, archetypes]);
  const stale = loading || (results != null && results.key !== key);

  function onTileKey(event: KeyboardEvent, card: DeckCardInfo) {
    if (card.unavailableReason) return;
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    if (event.key === "+" || event.key === "=" || (event.key === "Enter" && event.shiftKey)) {
      event.preventDefault();
      onAdd(card);
    }
  }

  function onDragOver(event: DragEvent) {
    if (!hasCardDrag(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropping(true);
  }

  function onDrop(event: DragEvent) {
    setDropping(false);
    const drag = readCardDrag(event);
    if (!drag || drag.from === "list") return;
    event.preventDefault();
    onRemoveDrop(drag);
  }

  const countText = results?.error
    ? "Search failed"
    : results == null
      ? pool ? "Loading your pool…" : "Searching…"
      : `${(pool ? pool.totalCopies ?? total : total).toLocaleString("en-US")} ${(pool ? pool.totalCopies ?? total : total) === 1 ? "card" : "cards"}${pool ? " in your pool" : ""}`;

  return (
    <aside
      id={id}
      className={styles["de-list"]}
      aria-label="Card list"
      data-dropping={dropping ? "true" : undefined}
      onDragOver={onDragOver}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={onDrop}
    >
      <div className={styles.head}>
        {pool ? <div className={styles["de-lh"]}><h2 className={styles["de-sec"]}>Your pool</h2><span className="small">{pool.totalCopies ?? pool.cards?.length ?? 0} cards, {pool.notInDeck ?? 0} not in the deck</span></div> : null}
        <div className={styles["de-lt"]}>
          <label className={styles["de-q"]}>
            <Search size={16} strokeWidth={1.6} aria-hidden />
            <span className={"sr"}>Search cards</span>
            <input
              ref={searchRef}
              type="search"
              className={cn("input", styles.searchInput)}
              placeholder={pool ? "Search pool" : "Search cards"}
              value={query.text}
              maxLength={200}
              spellCheck={false}
              autoComplete="off"
              onChange={(event) => onQueryChange({ ...query, text: event.target.value })}
            />
            {query.text ? (
              <button type="button" className={styles.clearText} aria-label="Clear search" onClick={() => onQueryChange({ ...query, text: "" })}>
                <X size={14} aria-hidden />
              </button>
            ) : <kbd>/</kbd>}
          </label>
          <button
            type="button"
            className={cn("btn btn-secondary btn-sm", styles["de-fbtn"])}
            aria-expanded={filtersOpen}
            aria-controls="deck-card-filters"
            data-active={chips.length > 0 ? "true" : undefined}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} strokeWidth={1.6} aria-hidden />
            Filters{" "}
            {chips.length > 0 ? <span className={cn("num", styles.filterCount)}>{chips.length}</span> : null}
          </button>
            <div className={cn("seg", styles["de-view"])} role="group" aria-label="Display">
              <button type="button" className={styles.viewButton} aria-pressed={view === "grid"} aria-label="Card grid" onClick={() => { dropHover(); onViewChange("grid"); }}>
                <LayoutGrid size={16} strokeWidth={1.6} aria-hidden />
              </button>
              <button type="button" className={styles.viewButton} aria-pressed={view === "list"} aria-label="Card list with details" onClick={() => { dropHover(); onViewChange("list"); }}>
                <List size={16} strokeWidth={1.6} aria-hidden />
              </button>
            </div>
        </div>

        <div className={styles["de-lt2"]}>
          <DeckSegmented
            label="Search in"
            hideLabel
            value={query.scope}
            choices={SCOPE_CHOICES}
            onChange={(scope) => onQueryChange({ ...query, scope })}
          />
          <div className={styles["de-sort"]}>
            <DeckSelect
              label="Sort by"
              hideLabel
              compact
              className={styles["de-sort-select"]}
              value={query.sort}
              choices={SORT_CHOICES}
              onChange={(sort) => onQueryChange({ ...query, sort })}
            />
            <button
              type="button"
              className={styles.iconButton}
              aria-label={query.order === "asc" ? "Ascending order. Change to descending" : "Descending order. Change to ascending"}
              title={query.order === "asc" ? "Ascending" : "Descending"}
              onClick={() => onQueryChange({ ...query, order: query.order === "asc" ? "desc" : "asc" })}
            >
              {query.order === "asc"
                ? <ArrowUpNarrowWide size={16} strokeWidth={1.6} aria-hidden />
                : <ArrowDownWideNarrow size={16} strokeWidth={1.6} aria-hidden />}
            </button>

          </div>
        </div>

        {chips.length > 0 ? (
          <ul className={styles["de-chips"]} aria-label="Active filters">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  className={cn("chip", "chip-pen", styles.chipButton)}
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={() => onQueryChange(chip.clear(query))}
                >
                  {chip.label}
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
            <li>
              <button type="button" className={cn("btn btn-quiet btn-sm", styles.clearAll)} onClick={() => onQueryChange(clearFilters(query))}>Clear filters</button>
            </li>
          </ul>
        ) : null}
      </div>

      <div className={styles.body}>
        <div ref={scrollRef} className={styles.results} aria-busy={stale || undefined}>
          <p className={styles["de-count"]} aria-live="polite">
            <span className={"num"}>{countText}</span>{" "}
            {stale ? <span className={styles.working}>Updating…</span> : null}
          </p>

          {results?.error ? (
            <div className="banner banner-bad" role="alert">
              <AlertTriangle className="ic" aria-hidden />
              <div>
                <p>{/duel engine is not set up|duel engine.*not configured/i.test(results.error) ? <><strong>Card search isn't available.</strong>{" "}The duel engine is not set up on this server. Your deck is safe and still saves.</> : "Card search failed. Try again."}</p>
                <DeckButton className={styles.retry} onClick={() => setRetry((value) => value + 1)}><RotateCw className="ic sm" aria-hidden />Try again</DeckButton>
              </div>
            </div>
          ) : results != null && total === 0 && !stale ? (
            <div className={styles.none}>
              <p>No cards match.</p>
              {chips.length > 0 ? (
                <DeckButton size="sm" kind="quiet" onClick={() => onQueryChange(clearFilters(query))}>Clear filters</DeckButton>
              ) : null}
            </div>
          ) : (
            <ul className={view === "grid" ? styles["de-res"] : styles.rows} data-stale={stale ? "true" : undefined}>
              {cards.map((card) => {
                const count = deckCount(card);
                const left = pool?.remaining(card) ?? 0;
                // A pool card is full when no copy is left; a pool has no banlist marks.
                const limit = pool || !limits ? 3 : cardLimit(limits, card);
                const full = pool ? left <= 0 : count >= limit;
                const status = pool ? null : limitName(limit);
                const arts = card.altArtCount ? `, ${artCountLabel(card.altArtCount)}` : "";
                const availability = card.unavailableReason ? `, Unavailable: ${card.unavailableReason}` : "";
                const label = (pool
                  ? `${card.name}, ${left} ${left === 1 ? "copy" : "copies"} left in your pool${arts}`
                  : `${card.name}${count ? `, ${count} in deck` : ""}${status ? `, ${status}` : ""}${arts}`) + availability;
                const handlers = {
                  draggable: !card.unavailableReason,
                  title: card.unavailableReason ? `${card.name}: Unavailable: ${card.unavailableReason}` : card.name,
                  "aria-pressed": inspectCode === card.code,
                  onClick: (event: MouseEvent<HTMLButtonElement>) => { event.currentTarget.focus(); onInspect(card); },
                  onPointerEnter: (event: PointerEvent) => { if (event.pointerType !== "touch") pointAt(card); },
                  onPointerLeave: () => pointAt(null),
                  onDoubleClick: () => { if (!card.unavailableReason) onAdd(card); },
                  onContextMenu: (event: MouseEvent) => { event.preventDefault(); if (!card.unavailableReason) onAdd(card); },
                  onKeyDown: (event: KeyboardEvent) => onTileKey(event, card),
                  onDragStart: (event: DragEvent) => { if (card.unavailableReason) { event.preventDefault(); return; } onInspect(card, false); writeCardDrag(event, { code: card.code, from: "list" }); },
                };
                if (view === "grid") {
                  return (
                    <li key={card.code}>
                      <button type="button" className={styles["de-t"]} aria-label={label} data-full={card.unavailableReason || (pool && full) ? "true" : undefined} {...handlers}>
                        <CardArt code={card.code} name={card.name} />
                        <LimitBadge limit={limit} />
                        <ArtChip otherArts={card.altArtCount ?? 0} corner />
                        {card.unavailableReason ? <span className={styles.unavailable}>Unavailable</span> : null}
                        {pool ? (
                          <span className={cn("num", styles["de-left"])} data-zero={left <= 0 ? "true" : undefined} title="Copies left in your pool">{left} left</span>
                        ) : count > 0 ? <span className={cn("num", styles["de-have"])}>×{count}</span> : null}
                      </button>
                    </li>
                  );
                }
                const stats = cardStatsText(card);
                return (
                  <li key={card.code} className={styles.row}>
                    <button type="button" className={styles.rowMain} aria-label={label} data-full={card.unavailableReason || (pool && full) ? "true" : undefined} {...handlers}>
                      <span className={styles.rowArt}>
                        <CardArt code={card.code} name={card.name} />
                        <LimitBadge limit={limit} />
                      </span>
                      <span className={styles.rowText}>
                        <strong>{card.name}</strong>{" "}
                        {card.unavailableReason ? <span>Unavailable: {card.unavailableReason}</span> : null}
                        <span>{cardDetailsText(card)}</span>{" "}
                        <ArtChip otherArts={card.altArtCount ?? 0} />{" "}
                        {stats ? <span className={cn("num", styles.rowStats)}>{(card.type & TYPE_LINK) ? `ATK ${stats}` : stats}</span> : null}
                      </span>{" "}
                      {pool ? (
                        <span className={cn("num", styles.rowHave)} data-zero={left <= 0 ? "true" : undefined} title="Copies left in your pool">{left} left</span>
                      ) : count > 0 ? <span className={cn("num", styles.rowHave)}>×{count}</span> : null}
                    </button>
                    <button type="button" className={styles.rowAdd} aria-label={`Add ${card.name} to the deck`} title={card.unavailableReason ? `Unavailable: ${card.unavailableReason}` : "Add to deck"} disabled={!!card.unavailableReason || (pool != null && full)} onClick={() => onAdd(card)}>
                      <Plus size={16} strokeWidth={1.8} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore ? (
            <div ref={sentinelRef} className={styles.more}>
              <DeckButton size="sm" kind="quiet" loading={loadingMore} onClick={loadMore}>
                Show more ({(total - cards.length).toLocaleString("en-US")} left)
              </DeckButton>
            </div>
          ) : null}
        </div>

        {filtersOpen ? (
          <div
            id="deck-card-filters"
            className={styles.filters}
            role="region"
            aria-label="Filters"
            onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setFiltersOpen(false); } }}
          >
            <div className={styles.filtersHead}>
              <h2 className={styles.filtersTitle}>Filters</h2>
              <button type="button" className={styles.iconButton} aria-label="Close filters" onClick={() => setFiltersOpen(false)}>
                <X size={16} aria-hidden />
              </button>
            </div>
            <div className={styles.filtersScroll}>
              <CardFilters query={query} archetypes={archetypes} onChange={onQueryChange} hideLimits={pool != null} />
            </div>
            <div className={styles.filtersFoot}>
              <DeckButton kind="quiet" size="sm" disabled={chips.length === 0} onClick={() => onQueryChange(clearFilters(query))}>
                Reset
              </DeckButton>
              <DeckButton kind="primary" size="sm" onClick={() => setFiltersOpen(false)}>
                {stale ? "Show cards" : `Show ${total.toLocaleString("en-US")} ${total === 1 ? "card" : "cards"}`}
              </DeckButton>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

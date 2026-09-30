"use client";

import { useEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { ArrowDownWideNarrow, ArrowUpNarrowWide, LayoutGrid, List, Plus, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { cardLimit, type CardArchetype, type CardQuery, type DeckCardInfo } from "@yugidraft/shared/duels";
import { TYPE_LINK, cardDetailsText, cardStatsText } from "@/components/duel/constants";
import { cx, SheetButton, SheetSelect, SheetSegmented } from "@/components/duel/sheet-ui";
import ui from "@/components/duel/sheet-ui.module.css";
import { queryDeckCards } from "./api";
import { CardArt } from "./card-art";
import { CardFilters } from "./card-filters";
import { hasCardDrag, readCardDrag, writeCardDrag, type CardDrag } from "./drag";
import { SORT_CHOICES, clearFilters, filterChips, queryKey, type BrowserView } from "./filter-model";
import { LimitBadge, limitName } from "./limit-badge";
import type { BanlistLimits } from "./model";
import styles from "./card-browser.module.css";

const PAGE = 60;
const DEBOUNCE_MS = 160;

const SCOPE_CHOICES = [
  { value: "all" as const, label: "Name + text" },
  { value: "name" as const, label: "Name only" },
];

type Results = {
  key: string;
  cards: DeckCardInfo[];
  total: number;
  error: string | null;
};

export function CardBrowser({
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
  query: CardQuery;
  onQueryChange: (query: CardQuery) => void;
  archetypes: readonly CardArchetype[];
  limits: BanlistLimits | null;
  view: BrowserView;
  onViewChange: (view: BrowserView) => void;
  /** Copies of this card (by name) already in the deck. */
  deckCount: (card: DeckCardInfo) => number;
  inspectCode: number | null;
  onInspect: (card: DeckCardInfo) => void;
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
  }, [key, retry]);

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
      ? "Searching…"
      : `${total.toLocaleString("en-US")} ${total === 1 ? "card" : "cards"}`;

  return (
    <aside
      className={styles.browser}
      aria-label="Card list"
      data-dropping={dropping ? "true" : undefined}
      onDragOver={onDragOver}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={onDrop}
    >
      <div className={styles.head}>
        <div className={styles.searchRow}>
          <label className={styles.searchBox}>
            <Search size={16} strokeWidth={1.6} aria-hidden />
            <span className={ui.srOnly}>Search cards</span>
            <input
              ref={searchRef}
              type="search"
              className={styles.searchInput}
              placeholder="Search cards  ( / )"
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
            ) : null}
          </label>
          <button
            type="button"
            className={styles.filterButton}
            aria-expanded={filtersOpen}
            aria-controls="deck-card-filters"
            data-active={chips.length > 0 ? "true" : undefined}
            onClick={() => setFiltersOpen((open) => !open)}
          >
            <SlidersHorizontal size={16} strokeWidth={1.6} aria-hidden />
            Filters
            {chips.length > 0 ? <span className={cx(ui.num, styles.filterCount)}>{chips.length}</span> : null}
          </button>
        </div>

        <div className={styles.toolRow}>
          <SheetSegmented
            label="Search in"
            hideLabel
            value={query.scope}
            choices={SCOPE_CHOICES}
            onChange={(scope) => onQueryChange({ ...query, scope })}
          />
          <div className={styles.toolEnd}>
            <SheetSelect
              label="Sort by"
              hideLabel
              compact
              className={styles.sortSelect}
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
            <div className={styles.viewSwitch} role="group" aria-label="Display">
              <button type="button" className={styles.iconButton} aria-pressed={view === "grid"} aria-label="Card grid" onClick={() => { dropHover(); onViewChange("grid"); }}>
                <LayoutGrid size={16} strokeWidth={1.6} aria-hidden />
              </button>
              <button type="button" className={styles.iconButton} aria-pressed={view === "list"} aria-label="Card list with details" onClick={() => { dropHover(); onViewChange("list"); }}>
                <List size={16} strokeWidth={1.6} aria-hidden />
              </button>
            </div>
          </div>
        </div>

        {chips.length > 0 ? (
          <ul className={styles.chips} aria-label="Active filters">
            {chips.map((chip) => (
              <li key={chip.key}>
                <button
                  type="button"
                  className={cx(ui.chip, ui.chipAccent, styles.chipButton)}
                  aria-label={`Remove filter ${chip.label}`}
                  onClick={() => onQueryChange(chip.clear(query))}
                >
                  {chip.label}
                  <X size={12} aria-hidden />
                </button>
              </li>
            ))}
            <li>
              <button type="button" className={styles.clearAll} onClick={() => onQueryChange(clearFilters(query))}>Clear all</button>
            </li>
          </ul>
        ) : null}
      </div>

      <div className={styles.body}>
        <div ref={scrollRef} className={styles.results} aria-busy={stale || undefined}>
          <p className={styles.countLine} aria-live="polite">
            <span className={ui.num}>{countText}</span>
            {stale ? <span className={styles.working}>Updating…</span> : null}
          </p>

          {results?.error ? (
            <div className={styles.error}>
              <p role="alert" className={ui.alert}>{results.error}</p>
              <SheetButton size="sm" onClick={() => setRetry((value) => value + 1)}>
                <RotateCw size={14} aria-hidden />
                Try again
              </SheetButton>
            </div>
          ) : results != null && total === 0 && !stale ? (
            <div className={styles.none}>
              <p>No cards match.</p>
              {chips.length > 0 ? (
                <SheetButton size="sm" kind="quiet" onClick={() => onQueryChange(clearFilters(query))}>Clear filters</SheetButton>
              ) : null}
            </div>
          ) : (
            <ul className={view === "grid" ? styles.grid : styles.rows} data-stale={stale ? "true" : undefined}>
              {cards.map((card) => {
                const count = deckCount(card);
                const limit = limits ? cardLimit(limits, card) : 3;
                const full = count >= limit;
                const status = limitName(limit);
                const label = `${card.name}${count ? `, ${count} in deck` : ""}${status ? `, ${status}` : ""}`;
                const handlers = {
                  draggable: true,
                  "aria-pressed": inspectCode === card.code,
                  onClick: () => onInspect(card),
                  onPointerEnter: (event: PointerEvent) => { if (event.pointerType !== "touch") pointAt(card); },
                  onPointerLeave: () => pointAt(null),
                  onDoubleClick: () => onAdd(card),
                  onContextMenu: (event: MouseEvent) => { event.preventDefault(); onAdd(card); },
                  onKeyDown: (event: KeyboardEvent) => onTileKey(event, card),
                  onDragStart: (event: DragEvent) => { onInspect(card); writeCardDrag(event, { code: card.code, from: "list" }); },
                };
                if (view === "grid") {
                  return (
                    <li key={card.code}>
                      <button type="button" className={styles.tile} aria-label={label} data-full={full ? "true" : undefined} title={card.name} {...handlers}>
                        <CardArt code={card.code} name={card.name} />
                        <LimitBadge limit={limit} />
                        {count > 0 ? <span className={cx(ui.num, styles.have)}>{count}</span> : null}
                      </button>
                    </li>
                  );
                }
                const stats = cardStatsText(card);
                return (
                  <li key={card.code} className={styles.row}>
                    <button type="button" className={styles.rowMain} aria-label={label} data-full={full ? "true" : undefined} {...handlers}>
                      <span className={styles.rowArt}>
                        <CardArt code={card.code} name={card.name} />
                        <LimitBadge limit={limit} />
                      </span>
                      <span className={styles.rowText}>
                        <strong>{card.name}</strong>
                        <span>{cardDetailsText(card)}</span>
                        {stats ? <span className={cx(ui.num, styles.rowStats)}>{(card.type & TYPE_LINK) ? `ATK ${stats}` : stats}</span> : null}
                      </span>
                      {count > 0 ? <span className={cx(ui.num, styles.rowHave)}>×{count}</span> : null}
                    </button>
                    <button type="button" className={styles.rowAdd} aria-label={`Add ${card.name} to the deck`} title="Add to deck" onClick={() => onAdd(card)}>
                      <Plus size={16} strokeWidth={1.8} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {hasMore ? (
            <div ref={sentinelRef} className={styles.more}>
              <SheetButton size="sm" kind="quiet" loading={loadingMore} onClick={loadMore}>
                Show more ({(total - cards.length).toLocaleString("en-US")} left)
              </SheetButton>
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
              <CardFilters query={query} archetypes={archetypes} onChange={onQueryChange} />
            </div>
            <div className={styles.filtersFoot}>
              <SheetButton kind="quiet" size="sm" disabled={chips.length === 0} onClick={() => onQueryChange(clearFilters(query))}>
                Reset
              </SheetButton>
              <SheetButton kind="primary" size="sm" onClick={() => setFiltersOpen(false)}>
                {stale ? "Show cards" : `Show ${total.toLocaleString("en-US")} ${total === 1 ? "card" : "cards"}`}
              </SheetButton>
            </div>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

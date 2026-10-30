"use client";

import { PrereleaseLabel } from "@/components/prerelease-label";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from "react";
import { AlertTriangle, ArrowDownWideNarrow, ArrowUpNarrowWide, Minus, LayoutGrid, Link2, List, Plus, RotateCw, Search, SlidersHorizontal, X } from "lucide-react";
import { cardLimit, type CardArchetype, type CardQuery, type CardQueryResult, type DeckCardInfo, type DuelMode } from "@yugidraft/shared/duels";
import { mayReadEffect } from "@yugidraft/shared/cards/effects/capability";
import type { ArchetypeGuide } from "@yugidraft/shared/cards/effects";
import { HowItPlays, type HookFind } from "@/components/effect-search/how-it-plays";
import { HookDrill } from "@/components/effect-search/hook-drill";
import { BridgesRow, type FocusEngine } from "@/components/bridges/bridges-row";
import { EngineFit } from "@/components/bridges/engine-fit";
import { IntentHeading, RelaxHints } from "@/components/effect-search/search-intent";
import { TYPE_LINK, cardDetailsText, cardStatsText } from "@/components/duel/constants";
import { cn } from "@/lib/utils";
import { artCountLabel } from "@/components/artwork/artwork-picker";
import { ArtChip } from "./art-chip";
import { DeckButton, DeckSelect, DeckSegmented } from "./controls";
import { queryDeckCards } from "./api";
import { InsightsDisabledError, fetchHookCards, fetchWorksWith, resolveInsightCards, type InsightCard } from "./insights-api";
import { useTileLongPress } from "./tile-long-press";
import { CardArt } from "./card-art";
import { CardFilters } from "./card-filters";
import { hasCardDrag, readCardDrag, writeCardDrag, type CardDrag } from "./drag";
import { SORT_CHOICES, clearFilters, filterChips, queryKey, type BrowserView } from "./filter-model";
import { genesysMark, genesysMarkText } from "./genesys";
import { GenesysBadge } from "./genesys-ui";
import { ReleaseMarks } from "./release-marks";
import { LimitBadge, limitName } from "./limit-badge";
import { cardKind, type BanlistLimits } from "./model";
import { queryPoolCards } from "./pool-search";
import { EditorTabList } from "./editor-tab-list";
import type { ColumnTab } from "./editor-tabs";
import { SuggestionsPanel, type BrowserSuggest } from "./suggestions-panel";
import styles from "./card-browser.module.css";

const PAGE = 60;
const DEBOUNCE_MS = 160;
/** How many cards "works with" lists. The active filters then cut this list. */
const WORKS_WITH_LIMIT = 100;

const SCOPE_CHOICES = [
  { value: "all" as const, label: "Name + text" },
  { value: "name" as const, label: "Name only" },
];

/** A search result. Server searches say how many other arts the card has; the pool list does not. */
export type BrowserCard = DeckCardInfo & { altArtCount?: number; reason?: string };

type Results = Pick<CardQueryResult, "effectSearchEnabled" | "reading" | "effectHits" | "effectTotal" | "profile" | "relax"> & {
  key: string;
  /** A hook's list is cut at the best few; more cards fit than are shown. */
  capped?: boolean;
  cards: BrowserCard[];
  total: number;
  error: string | null;
};

/** The card the list is showing partners for ("Works with: <card>"). */
export type BrowserPartner = {
  code: number;
  name: string;
  /**
   * The list shows the cards that fit one hook of an archetype's "How it plays" panel, not the partners of a card.
   * `name` is then what the hook finds, for the breadcrumb: the kind of card, or the hook's label.
   */
  hook?: { archetype: string; index: number; find: HookFind; /** The archetype's own cards are in the list. */ members: boolean };
};

/** The drill-down for one hook of a guide, asked one way. */
export function hookPartner(guide: ArchetypeGuide, index: number, find: HookFind): BrowserPartner {
  const hook = guide.hooks[index];
  return { code: -(index + 1), name: (find === "is" ? hook?.finds?.is?.many : undefined) ?? hook?.label ?? guide.archetype, hook: { archetype: guide.archetype, index, find, members: false } };
}

const partnerKey = (partner: BrowserPartner | null) => partner ? `w${partner.code}${partner.hook ? `:${partner.hook.archetype}:${partner.hook.find}:${partner.hook.members ? "all" : "out"}` : ""}:` : "";

/** Draft deck mode: the list holds only the player's pool, searched in the browser. */
export type BrowserPool = {
  /** Pool cards; null while they load. */
  cards: DeckCardInfo[] | null;
  /** Copies of the card the pool still has after the deck. */
  remaining: (card: DeckCardInfo) => number;
  totalCopies?: number;
  notInDeck?: number;
};

/**
 * The tabs of the right column: Cards (search and the list), Suggest and Bridges. All panes stay mounted and the
 * hidden ones carry `hidden`, so the search text, the filters and the scroll stay. Suggest and Bridges mount the
 * first time they are shown. Not given: the column is the card list alone.
 */
export type BrowserColumns = {
  /** The tabs that exist, Cards first. */
  tabs: readonly ColumnTab[];
  /** The tab on screen. */
  tab: ColumnTab;
  onTab: (tab: ColumnTab) => void;
  /** The tab bar sits on top of the column (desktop). On a phone the editor shows the tabs instead. */
  bar: boolean;
  /** The ids of the tabs that label the panes. */
  tabIdPrefix: string;
  /** A deep search finished while the Bridges tab was hidden. */
  bridgesDot: boolean;
  onDeepFinished: () => void;
  /** The server says Suggestions or Bridges are off. */
  onSuggestDisabled: () => void;
  onBridgesDisabled: () => void;
};

const SOLO_COLUMNS: BrowserColumns = {
  tabs: ["cards"], tab: "cards", onTab: () => undefined, bar: false, tabIdPrefix: "deck-editor", bridgesDot: false,
  onDeepFinished: () => undefined, onSuggestDisabled: () => undefined, onBridgesDisabled: () => undefined,
};

export function CardBrowser({
  id,
  mode = "normal",
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
  fullReason,
  onCatalog,
  onRemoveDrop,
  searchRef,
  genesys = false,
  onEffectCapability,
  partner = null,
  onPartnerChange,
  onWorksWith,
  suggest,
  columns = SOLO_COLUMNS,
}: {
  id?: string;
  mode?: DuelMode;
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
  /** Why this card cannot be added because its section is full ("Main Deck is full (60/60)."), or null. */
  fullReason?: (card: DeckCardInfo) => string | null;
  onCatalog: (cards: DeckCardInfo[]) => void;
  onRemoveDrop: (drag: CardDrag) => void;
  searchRef: RefObject<HTMLInputElement | null>;
  /** Genesys on: tiles show points instead of banlist marks, and Link and Pendulum tiles are marked. */
  genesys?: boolean;
  onEffectCapability?: (enabled: boolean) => void;
  /** "Works with" is on: the list shows the cards that work with this card, under the active filters. */
  partner?: BrowserPartner | null;
  onPartnerChange?: (partner: BrowserPartner | null) => void;
  /** A card asked for its partners (hover button, W key, long press). Not given: the entry points stay off. */
  onWorksWith?: (card: DeckCardInfo) => void;
  /** The deck, for the Suggestions rows that show while the search box is empty. Not given: no rows. */
  suggest?: BrowserSuggest;
  columns?: BrowserColumns;
}) {
  const key = `${mode}:${genesys}:${suggest?.deckMaster??""}:${partnerKey(partner)}${queryKey(query)}`;
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
  const capabilityRef = useRef(onEffectCapability);
  capabilityRef.current = onEffectCapability;
  const partnerRef = useRef(onPartnerChange);
  partnerRef.current = onPartnerChange;
  // The ranked partners of the last card, so a filter or a typed letter narrows the same list without asking again.
  const partnersCache = useRef<{ code: number; scope: string; cards: InsightCard[] } | null>(null);
  // The view a hook drill-down came from: query, filters, results and scroll, so Back returns to exactly that.
  const cameFrom = useRef<{ query: CardQuery; results: Results | null; key: string } | null>(null);
  const cameScroll = useRef(0);
  const drilling = useRef(false);
  drilling.current = partner?.hook != null;
  const restoredKey = useRef<string | null>(null);
  const restoreScroll = useRef<number | null>(null);
  // The row a drill-down was opened from ("2:is"), so Back can put the keyboard focus on it again.
  const cameButton = useRef<string | null>(null);
  const press = useTileLongPress<DeckCardInfo>((card) => onWorksWith?.(card));
  // Suggest and Bridges load the first time they are shown, and stay mounted after that.
  const hasSuggest = suggest != null && columns.tabs.includes("suggest");
  const hasBridges = suggest != null && columns.tabs.includes("bridges");
  const [seen, setSeen] = useState({ suggest: false, bridges: false });
  if ((columns.tab === "suggest" && !seen.suggest) || (columns.tab === "bridges" && !seen.bridges)) {
    setSeen({ suggest: seen.suggest || columns.tab === "suggest", bridges: seen.bridges || columns.tab === "bridges" });
  }
  // A tap on an engine in Suggest opens the Bridges tab on that engine. The count makes a second tap on the same engine count.
  const [focusEngine, setFocusEngine] = useState<FocusEngine | null>(null);
  const openEngine = (name: string) => { setFocusEngine((now) => ({ name, count: (now?.count ?? 0) + 1 })); columns.onTab("bridges"); };
  const paneProps = (tab: ColumnTab) => ({
    id: `deck-editor-${tab}`,
    className: styles.pane,
    "data-pane": tab,
    hidden: columns.tab !== tab,
    ...(columns.tabs.length > 1 ? { role: "tabpanel", "aria-labelledby": `${columns.tabIdPrefix}-${tab}-tab` } : {}),
  });

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
    // Back put the saved results in place for this very key; asking again would only make them flicker.
    const restored = restoredKey.current;
    restoredKey.current = null;
    if (restored === key) {
      setLoading(false);
      return;
    }
    if (partner) {
      setLoading(true);
      const timer = window.setTimeout(() => {
        void (async () => {
          try {
            const scope = `${mode}|${genesys}|${poolCards ? poolCards.length : ""}${partner.hook ? `|${partner.hook.archetype}#${partner.hook.index}:${partner.hook.find}:${partner.hook.members}` : ""}`;
            let ranked: InsightCard[];
            const cached = partnersCache.current;
            if (cached && cached.code === partner.code && cached.scope === scope) ranked = cached.cards;
            else {
              const scopeOptions = { mode, genesys, ...(poolCards ? { pool: poolCards.map((card) => card.canonicalPasscode ?? card.code) } : {}), limit: WORKS_WITH_LIMIT };
              const hits = partner.hook ? await fetchHookCards(partner.hook.archetype, partner.hook.index, partner.hook.find, partner.hook.members, scopeOptions, controller.signal) : await fetchWorksWith(partner.code, scopeOptions, controller.signal);
              ranked = (await resolveInsightCards(hits, { mode }, controller.signal)).filter((card) => card.code !== partner.code);
              if (controller.signal.aborted) return;
              partnersCache.current = { code: partner.code, scope, cards: ranked };
            }
            // The filters decide which partners stay; the rank decides the order.
            const kept = new Set(queryPoolCards(ranked, latest.current, (code) => archetypesRef.current.find((item) => item.codes.includes(code))?.name).map((card) => card.code));
            const found = ranked.filter((card) => kept.has(card.code));
            capabilityRef.current?.(true);
            setResults({ key, cards: found, total: found.length, error: null, effectSearchEnabled: true, capped: partner.hook != null && ranked.length >= WORKS_WITH_LIMIT });
            setLoading(false);
            dropHover();
            onCatalogRef.current(ranked);
            if (scrollRef.current) scrollRef.current.scrollTop = 0;
          } catch (reason) {
            if (controller.signal.aborted) return;
            if (reason instanceof InsightsDisabledError) {
              capabilityRef.current?.(false);
              partnerRef.current?.(null);
              return;
            }
            setResults({ key, cards: [], total: 0, error: partner.hook ? "Could not find these cards." : `Could not find cards that work with ${partner.name}.` });
            setLoading(false);
            dropHover();
          }
        })();
      }, DEBOUNCE_MS);
      return () => { window.clearTimeout(timer); controller.abort(); };
    }
    if (pool) {
      if (poolCards) {
        const found = queryPoolCards(poolCards, latest.current, (code) => archetypesRef.current.find((item) => item.codes.includes(code))?.name);
        setResults({ key, cards: found, total: found.length, error: null });
        setLoading(false);
        dropHover();
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
        const timer = window.setTimeout(() => {
          const current = latest.current;
          // Immediate local name results keep drafting responsive. Only the additional effect group is remote.
          const wantsEffects = !current.exact && current.scope !== "name" && mayReadEffect(current.text);
          void queryDeckCards({ ...current, format: genesys ? mode === "domain" ? "genesys-domain" : "genesys" : mode, deckMaster: suggest?.deckMaster ?? undefined, ...(wantsEffects ? {} : { exact: true }), passcodes: poolCards.map(card => card.canonicalPasscode ?? card.code), offset: 0, effectOffset: 0, limit: PAGE }, controller.signal, { mode }).then(result => {
            if (controller.signal.aborted) return;
            capabilityRef.current?.(result.effectSearchEnabled === true);
            const names = (result.reading?.query.intent || result.reading?.query.formatFilter || result.reading?.query.recruiter || result.reading?.query.released || result.reading?.query.sort) ? result.cards : result.reading ? queryPoolCards(poolCards, { ...current, scope: "name" }, (code) => archetypesRef.current.find((item) => item.codes.includes(code))?.name) : found;
            setResults({ ...result, key, cards: names, total: names.length, error: null });
            onCatalogRef.current(result.effectHits ?? []);
          }).catch(() => { /* Pool names remain available during host outages. */ });
        }, DEBOUNCE_MS);
        return () => { window.clearTimeout(timer); controller.abort(); };
      }
      return;
    }
    setLoading(true);
    const timer = window.setTimeout(() => {
      void queryDeckCards({ ...latest.current, format: genesys ? mode === "domain" ? "genesys-domain" : "genesys" : mode, deckMaster: suggest?.deckMaster ?? undefined, offset: 0, effectOffset: 0, limit: PAGE }, controller.signal, { mode }).then(
        (result) => {
          if (controller.signal.aborted) return;
          capabilityRef.current?.(result.effectSearchEnabled === true);
          setResults({ ...result, key, cards: result.cards, total: result.total, error: null });
          setLoading(false);
          dropHover();
          onCatalogRef.current([...result.cards, ...(result.effectHits ?? [])]);
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

  // Until a hook drill-down opens, remember the view it would come back to. It reads the last render without a partner.
  useEffect(() => {
    if (!partner) cameFrom.current = { query, results, key };
  }, [partner, query, results, key]);
  useLayoutEffect(() => {
    const box = scrollRef.current;
    const top = restoreScroll.current;
    // Back saved a view for one key. Another key means the saved view is not coming back, so it is dropped.
    if (restoredKey.current !== null && restoredKey.current !== key) { restoredKey.current = null; restoreScroll.current = null; return; }
    if (top == null || !box) return;
    restoreScroll.current = null;
    // The list may still be growing (tiles, images), so ask again for a few frames until the position holds.
    let frames = 0;
    const put = () => {
      box.scrollTop = top;
      if (Math.abs(box.scrollTop - top) > 1 && frames++ < 6) requestAnimationFrame(put);
    };
    put();
  }, [key]);

  const cards = results?.key === key ? results.cards : [];
  const total = results?.key === key ? results.total : 0;
  const effectCards = results?.key === key ? results.effectHits ?? [] : [];
  const effectTotal = results?.key === key ? results.effectTotal ?? 0 : 0;
  const hasMore = results != null && results.key === key && !results.error && (cards.length < total || effectCards.length < effectTotal);

  function loadMore() {
    if (!results || loading || loadingMore || !hasMore) return;
    const controller = new AbortController();
    moreController.current = controller;
    setLoadingMore(true);
    const pageKey = results.key;
    void queryDeckCards({ ...latest.current, format: genesys ? mode === "domain" ? "genesys-domain" : "genesys" : mode, deckMaster: suggest?.deckMaster ?? undefined, ...(poolCards ? { passcodes: poolCards.map(card => card.canonicalPasscode ?? card.code) } : {}), offset: results.cards.length, effectOffset: results.effectHits?.length ?? 0, limit: PAGE }, controller.signal, { mode }).then(
      (result) => {
        if (controller.signal.aborted) return;
        setResults((prev) => (prev && prev.key === pageKey
          ? { ...prev, cards: poolCards ? prev.cards : [...prev.cards, ...result.cards], total: poolCards ? prev.total : result.total, effectHits: [...(prev.effectHits ?? []), ...(result.effectHits ?? [])], effectTotal: result.effectTotal }
          : prev));
        setLoadingMore(false);
        onCatalogRef.current([...result.cards, ...(result.effectHits ?? [])]);
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

  // In Genesys the Link and Pendulum filter is always on, so it is a rule of the format and not a chip to clear.
  const chips = useMemo(() => filterChips(genesys ? { ...query, excludeGenesysForbidden: false } : query, archetypes), [query, archetypes, genesys]);
  const stale = loading || (results != null && results.key !== key);

  // "How it plays": from the first page of an archetype search. It stays mounted, hidden, while a hook drill-down is open,
  // so Back finds its plan and its rows as they were left.
  const intent = !partner && results?.key === key ? results.reading?.query?.intent : undefined;
  const searchGuide = !partner && results?.key === key ? results.profile ?? null : null;
  const [heldGuide, setHeldGuide] = useState<ArchetypeGuide | null>(null);
  useEffect(() => { if (searchGuide) setHeldGuide(searchGuide); }, [searchGuide]);
  const hookOpen = partner?.hook != null;
  const shownGuide = hookOpen ? heldGuide : searchGuide;
  function openHook(index: number, find: HookFind) {
    if (!shownGuide) return;
    // The search text named the archetype; the cards that fit its hook would not match it. Other filters stay.
    onQueryChange({ ...query, text: "", effectOmit: [] });
    cameButton.current = `${index}:${find}`;
    onPartnerChange?.(hookPartner(shownGuide, index, find));
  }
  /** Back from a hook drill-down: the same query, filters, results and scroll as before it. */
  function closeHook() {
    const from = cameFrom.current;
    if (from?.results && from.results.key === from.key) {
      restoredKey.current = from.key;
      restoreScroll.current = cameScroll.current;
      setResults(from.results);
      setLoading(false);
    }
    if (from) onQueryChange(from.query);
    onPartnerChange?.(null);
  }

  // The rows are shown again once the drill-down closes, so the row that opened it can take the focus back.
  useLayoutEffect(() => {
    if (hookOpen || !cameButton.current) return;
    const row = scrollRef.current?.querySelector<HTMLElement>(`[data-hook="${cameButton.current}"]`);
    cameButton.current = null;
    row?.focus({ preventScroll: true });
  }, [hookOpen]);

  const worksEnabled = onWorksWith != null && results?.effectSearchEnabled === true;

  function onTileKey(event: KeyboardEvent, card: DeckCardInfo) {
    if (event.ctrlKey || event.metaKey || event.altKey) return;
    // W, the ContextMenu key and Shift+F10 list the cards that work with this one.
    if (worksEnabled && (event.key === "w" || event.key === "W" || event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))) {
      event.preventDefault();
      onWorksWith(card);
      return;
    }
    if (card.unavailableReason) return;
    if (event.key === "+" || event.key === "=" || (event.key === "Enter" && event.shiftKey)) {
      event.preventDefault();
      onAdd(card);
    }
  }

  /** The title above the first card of a group: partners of a card, or the effect hits under the name results. */
  function heading(position: number) {
    if (partner?.hook) return null;
    if (partner) return position === 0 ? <li className={styles.effectHeading}><h3>Works with {partner.name}</h3><span>{total.toLocaleString("en-US")} {total === 1 ? "card" : "cards"}</span></li> : null;
    if (position !== cards.length || effectCards.length === 0) return null;
    // "Cards like X" heads its own group; "How to beat X" already heads the page, so its cards are "Answers".
    if (intent?.kind === "similar") return <li className={styles.effectHeading}><IntentHeading intent={intent} testId="intent-group-heading" /><span>{effectTotal.toLocaleString("en-US")} matches</span></li>;
    return <li className={styles.effectHeading}><h3>{intent?.kind === "counters" ? "Cards that stop it" : "Cards that do this"}</h3><span>{effectTotal.toLocaleString("en-US")} matches</span></li>;
  }

  /** A Suggestions tile takes the same clicks, drags and hover as a result tile. */
  function suggestionProps(card: DeckCardInfo) {
    return {
      draggable: !card.unavailableReason,
      "aria-pressed": inspectCode === card.code,
      onClick: (event: MouseEvent<HTMLButtonElement>) => { event.currentTarget.focus(); onInspect(card); },
      onPointerEnter: (event: PointerEvent) => { if (event.pointerType !== "touch") pointAt(card); },
      onPointerLeave: () => pointAt(null),
      onDoubleClick: () => { if (!card.unavailableReason) onAdd(card); },
      onContextMenu: (event: MouseEvent) => { event.preventDefault(); if (!card.unavailableReason) onAdd(card); },
      onKeyDown: (event: KeyboardEvent) => onTileKey(event, card),
      onDragStart: (event: DragEvent) => { if (card.unavailableReason) { event.preventDefault(); return; } onInspect(card, false); writeCardDrag(event, { code: card.code, from: "list" }, cardKind(card)); },
    };
  }

  function worksButton(card: DeckCardInfo, className: string) {
    return (
      <button type="button" className={className} tabIndex={-1} aria-label={`Find cards that work with ${card.name}`} title="Find cards that work with this (W)" onClick={() => onWorksWith?.(card)}>
        <Link2 size={14} strokeWidth={1.8} aria-hidden />
      </button>
    );
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

  const displayedTotal = pool ? pool.totalCopies ?? total : total + effectTotal;
  const countText = results?.error
    ? "Search failed"
    : results == null
      ? partner ? partner.hook ? "Finding cards…" : `Finding cards that work with ${partner.name}…` : pool ? "Loading your pool…" : "Searching…"
      : partner?.hook ? `${total.toLocaleString("en-US")} ${total === 1 ? "card" : "cards"}${results.capped ? ", best matches first" : ""}`
      : partner ? `${total.toLocaleString("en-US")} ${total === 1 ? "card works" : "cards work"} with ${partner.name}`
      : `${displayedTotal.toLocaleString("en-US")} ${displayedTotal === 1 ? "card" : "cards"}${pool ? " in your pool" : ""}`;

  return (
    <aside
      id={id}
      className={styles["de-list"]}
      aria-label="Card list"
      data-dropping={dropping ? "true" : undefined}
      data-tabs={columns.bar && columns.tabs.length > 1 ? "" : undefined}
      onDragOver={onDragOver}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropping(false); }}
      onDrop={onDrop}
    >
      {columns.bar && columns.tabs.length > 1 ? (
        <EditorTabList variant="bar" idPrefix={columns.tabIdPrefix} label="Card list" tabs={columns.tabs} tab={columns.tab} onChange={(tab) => columns.onTab(tab as ColumnTab)} bridgesDot={columns.bridgesDot} className={styles.tabs} />
      ) : null}
      <div {...paneProps("cards")}>
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
                onChange={(event) => onQueryChange({ ...query, text: event.target.value, effectOmit: [] })}
              />
              {query.text ? (
                <button type="button" className={styles.clearText} aria-label="Clear search" onClick={() => onQueryChange({ ...query, text: "", effectOmit: [] })}>
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
            {results?.effectSearchEnabled && !partner ? <button type="button" className={styles.exactToggle} aria-pressed={query.exact === true} onClick={() => onQueryChange({ ...query, exact: !query.exact })}>Exact text</button> : null}
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
                disabled={query.sort === "newest"}
                aria-label={query.sort === "newest" ? "Newest first. The order does not change" : query.order === "asc" ? "Ascending order. Change to descending" : "Descending order. Change to ascending"}
                title={query.sort === "newest" ? "Newest first" : query.order === "asc" ? "Ascending" : "Descending"}
                onClick={() => onQueryChange({ ...query, order: query.order === "asc" ? "desc" : "asc" })}
              >
                {query.sort === "newest" ? <Minus size={16} strokeWidth={1.6} aria-hidden /> : query.order === "asc"
                  ? <ArrowUpNarrowWide size={16} strokeWidth={1.6} aria-hidden />
                  : <ArrowDownWideNarrow size={16} strokeWidth={1.6} aria-hidden />}
              </button>

            </div>
          </div>

          {partner?.hook ? (
            <HookDrill archetype={partner.hook.archetype} title={partner.name} members={partner.hook.members} onBack={closeHook}
              onMembers={(members) => onPartnerChange?.({ ...partner, hook: { ...partner.hook!, members } })} />
          ) : partner ? (
            <ul className={styles["de-chips"]} aria-label="Works with">
              <li>
                <button type="button" className={cn("chip", "chip-gold", styles.chipButton)} aria-label={`Remove Works with ${partner.name}`} onClick={() => onPartnerChange?.(null)}>
                  <Link2 size={12} aria-hidden />Works with: {partner.name}<X size={12} aria-hidden />
                </button>
              </li>
            </ul>
          ) : null}
          {results?.key === key && results.reading && !partner ? <ul className={styles["de-chips"]} aria-label="Effect reading">
            {results.reading.chips.map(label => <li key={label}><button type="button" className={cn("chip", styles.chipButton)} aria-label={`Remove reading ${label}`} onClick={() => onQueryChange({ ...query, effectOmit: [...(query.effectOmit ?? []), label] })}>{label}<X size={12} aria-hidden /></button></li>)}
          </ul> : null}
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
          <div ref={scrollRef} className={styles.results} aria-busy={stale || undefined} onScroll={(event) => { if (!drilling.current) cameScroll.current = event.currentTarget.scrollTop; }}>
            <p className={styles["de-count"]} aria-live="polite">
              <span className={partner ? undefined : "num"}>{countText}</span>{" "}
              {stale ? <span className={styles.working}>Updating…</span> : null}
            </p>

            {!partner && results?.key === key && !stale && !results.error && total > 0 && effectTotal === 0 && results.relax?.length ? <div className={styles.guide}><RelaxHints relax={results.relax} onRemove={(chip) => onQueryChange({ ...query, effectOmit: [...new Set([...(query.effectOmit ?? []), chip])] })} /></div> : null}
            {intent?.kind === "counters" && !results?.error && !stale ? <div className={styles.guide}><IntentHeading intent={intent} count={effectTotal} /></div> : null}
            {shownGuide && !results?.error ? <div className={styles.guide} hidden={hookOpen}><HowItPlays guide={shownGuide} onHook={onPartnerChange ? openHook : undefined} /></div> : null}

            {results?.error ? (
              <div className="banner banner-bad" role="alert">
                <AlertTriangle className="ic" aria-hidden />
                <div>
                  <p>{/duel engine is not set up|duel engine.*not configured/i.test(results.error) ? <><strong>Card search isn't available.</strong>{" "}The duel engine is not set up on this server. Your deck is safe and still saves.</> : "Card search failed. Try again."}</p>
                  <DeckButton className={styles.retry} onClick={() => setRetry((value) => value + 1)}><RotateCw className="ic sm" aria-hidden />Try again</DeckButton>
                </div>
              </div>
            ) : results != null && total === 0 && effectTotal === 0 && !stale ? (
              <div className={styles.none}>
                {results.relax?.length && !partner ? <RelaxHints relax={results.relax} onRemove={(chip) => onQueryChange({ ...query, effectOmit: [...new Set([...(query.effectOmit ?? []), chip])] })} /> : <p>{partner ? partner.hook ? chips.length > 0 ? "No card here fits these filters." : partner.hook.members ? "No card fits this." : `No card outside ${partner.hook.archetype} fits this.` : `No card that works with ${partner.name} fits these filters.` : "No cards match."}</p>}
                {chips.length > 0 ? (
                  <DeckButton size="sm" kind="quiet" onClick={() => onQueryChange(clearFilters(query))}>Clear filters</DeckButton>
                ) : null}
                {partner?.hook && !partner.hook.members ? (
                  <DeckButton size="sm" kind="quiet" onClick={() => onPartnerChange?.({ ...partner, hook: { ...partner.hook!, members: true } })}>Show all cards</DeckButton>
                ) : null}
              </div>
            ) : (
              <ul className={view === "grid" ? styles["de-res"] : styles.rows} data-stale={stale ? "true" : undefined}>
                {([...cards, ...effectCards] as BrowserCard[]).map((card, position) => {
                  const count = deckCount(card);
                  const left = pool?.remaining(card) ?? 0;
                  // A pool card is full when no copy is left; a pool has no banlist marks.
                  const limit = pool || !limits ? 3 : cardLimit(limits, card);
                  const full = pool ? left <= 0 : count >= limit;
                  const status = pool ? null : limitName(limit);
                  const arts = card.altArtCount ? `, ${artCountLabel(card.altArtCount)}` : "";
                  const gMark = genesys && !pool ? genesysMark(card) : null;
                  const gText = gMark ? `, ${genesysMarkText(gMark)}` : "";
                  const availability = card.unavailableReason ? `, Unavailable: ${card.unavailableReason}` : "";
                  const label = (pool
                    ? `${card.name}, ${left} ${left === 1 ? "copy" : "copies"} left in your pool${arts}`
                    : `${card.name}${count ? `, ${count} in deck` : ""}${status ? `, ${status}` : ""}${gText}${arts}`) + availability;
                  const handlers = {
                    draggable: !card.unavailableReason,
                    title: card.unavailableReason ? `${card.name}: Unavailable: ${card.unavailableReason}` : card.name,
                    "aria-pressed": inspectCode === card.code,
                    "data-gx": gMark?.kind === "forbidden" ? "forbidden" : undefined,
                    ...(worksEnabled ? press.bind(card) : {}),
                    onClick: (event: MouseEvent<HTMLButtonElement>) => { event.currentTarget.focus(); if (press.fired()) return; onInspect(card); },
                    onPointerEnter: (event: PointerEvent) => { if (event.pointerType !== "touch") pointAt(card); },
                    onPointerLeave: () => pointAt(null),
                    onDoubleClick: () => { if (!card.unavailableReason) onAdd(card); },
                    onContextMenu: (event: MouseEvent) => { event.preventDefault(); if (press.fired()) return; if (!card.unavailableReason) onAdd(card); },
                    onKeyDown: (event: KeyboardEvent) => onTileKey(event, card),
                    onDragStart: (event: DragEvent) => { if (card.unavailableReason) { event.preventDefault(); return; } onInspect(card, false); writeCardDrag(event, { code: card.code, from: "list" }, cardKind(card)); },
                  };
                  if (view === "grid") {
                    return (
                      <Fragment key={card.code}>
                      {heading(position)}
                      <li className={styles.tileCell}>
                        <button type="button" className={styles["de-t"]} aria-label={label} data-full={card.unavailableReason || (pool && full) ? "true" : undefined} data-un={card.unavailableReason ? "" : undefined} {...handlers}>
                          <CardArt code={card.code} name={card.name} />
                          {genesys && !pool ? <GenesysBadge card={card} variant="browse" lift={Boolean(card.unavailableReason)} /> : <LimitBadge limit={limit} />}
                          <ArtChip otherArts={card.altArtCount ?? 0} corner />
                          <span className={styles.tileMarks}>
                            {card.prerelease && !card.release?.upcoming ? <PrereleaseLabel /> : null}
                            <ReleaseMarks release={card.release} />
                          </span>
                          {card.unavailableReason ? <span className={styles.unavailable}>Unavailable</span> : null}
                          {pool ? (
                            <span className={cn("num", styles["de-left"])} data-zero={left <= 0 ? "true" : undefined} title="Copies left in your pool">{left} left</span>
                          ) : count > 0 ? <span className={cn("num", styles["de-have"])} data-gx={genesys ? "" : undefined}>×{count}</span> : null}
                        </button>
                        {worksEnabled ? worksButton(card, styles.worksTile!) : null}
                        {card.reason ? <p className={styles.tileReason} title={card.reason}>{card.reason}</p> : null}
                      </li>
                      </Fragment>
                    );
                  }
                  const stats = cardStatsText(card);
                  return (
                    <Fragment key={card.code}>
                    {heading(position)}
                    <li className={styles.row}>
                      <button type="button" className={styles.rowMain} aria-label={label} data-full={card.unavailableReason || (pool && full) ? "true" : undefined} {...handlers}>
                        <span className={styles.rowArt}>
                          <CardArt code={card.code} name={card.name} />
                          {genesys && !pool ? <GenesysBadge card={card} variant="row" /> : <LimitBadge limit={limit} />}
                        </span>
                        <span className={styles.rowText}>
                          <strong>{card.name}</strong>{" "}
                          {card.prerelease && !card.release?.upcoming ? <PrereleaseLabel /> : null}
                          <ReleaseMarks release={card.release} />
                          {card.unavailableReason ? <span>Unavailable: {card.unavailableReason}</span> : null}
                          <span>{cardDetailsText(card)}</span>
                          {card.reason ? <span className={styles.effectReason} title={card.reason}>{card.reason}</span> : null}{" "}
                          <ArtChip otherArts={card.altArtCount ?? 0} />{" "}
                          {stats ? <span className={cn("num", styles.rowStats)}>{(card.type & TYPE_LINK) ? `ATK ${stats}` : stats}</span> : null}
                        </span>{" "}
                        {pool ? (
                          <span className={cn("num", styles.rowHave)} data-zero={left <= 0 ? "true" : undefined} title="Copies left in your pool">{left} left</span>
                        ) : count > 0 ? <span className={cn("num", styles.rowHave)}>×{count}</span> : null}
                      </button>
                      {worksEnabled ? worksButton(card, styles.rowWorks!) : null}
                      <button type="button" className={styles.rowAdd} aria-label={`Add ${card.name} to the deck`} title={card.unavailableReason ? `Unavailable: ${card.unavailableReason}` : fullReason?.(card) ?? "Add to deck"} disabled={!!card.unavailableReason || (pool != null && full) || !!fullReason?.(card)} onClick={() => onAdd(card)}>
                        <Plus size={16} strokeWidth={1.8} aria-hidden />
                      </button>
                    </li>
                    </Fragment>
                  );
                })}
              </ul>
            )}

            {hasMore ? (
              <div ref={sentinelRef} className={styles.more}>
                <DeckButton size="sm" kind="quiet" loading={loadingMore} onClick={loadMore}>
                  Show more ({(total - cards.length + effectTotal - effectCards.length).toLocaleString("en-US")} left)
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
                <CardFilters query={query} archetypes={archetypes} onChange={onQueryChange} hideLimits={pool != null || genesys} genesys={genesys} />
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
      </div>
      {/* A tab that was never opened has an empty panel, so the tab's aria-controls still points at something. */}
      {hasSuggest && !seen.suggest ? <div {...paneProps("suggest")} /> : null}
      {hasBridges && !pool && !seen.bridges ? <div {...paneProps("bridges")} /> : null}
      {suggest && hasSuggest && seen.suggest ? (
        <div {...paneProps("suggest")}>
          <div className={styles.paneScroll}>
            <SuggestionsPanel
              active={columns.tab === "suggest" && (!pool || poolCards != null)}
              suggest={suggest}
              mode={mode}
              genesys={genesys}
              pool={poolCards ? poolCards.map((card) => card.canonicalPasscode ?? card.code) : undefined}
              cardProps={suggestionProps}
              deckCount={deckCount}
              limit={(card) => (pool || genesys || !limits ? 3 : cardLimit(limits, card))}
              onCatalog={(found) => onCatalogRef.current(found)}
              onDisabled={columns.onSuggestDisabled}
              engines={hasBridges && !pool ? (
                <EngineFit
                  deck={suggest.deck}
                  deckMaster={suggest.deckMaster}
                  mode={mode}
                  genesys={genesys}
                  active={columns.tab === "suggest"}
                  cardProps={suggestionProps}
                  onCatalog={(found) => onCatalogRef.current(found)}
                  onOpenEngine={openEngine}
                  onOpenBridges={() => columns.onTab("bridges")}
                  onDisabled={columns.onBridgesDisabled}
                />
              ) : undefined}
            />
          </div>
        </div>
      ) : null}
      {/* Bridges look at the deck's archetype only, so a draft pool (no free choice of cards) has no tab. */}
      {suggest && hasBridges && seen.bridges && !pool ? (
        <div {...paneProps("bridges")}>
          <div className={styles.paneScroll}>
            <BridgesRow
              active={columns.tab === "bridges"}
              archetype={suggest.archetype ?? null}
              deckId={suggest.deckId ?? null}
              deck={suggest.deck}
              deckMaster={suggest.deckMaster}
              mode={mode}
              genesys={genesys}
              genesysRemaining={suggest.genesysRemaining}
              cardProps={suggestionProps}
              deckCount={deckCount}
              limit={(card) => (genesys || !limits ? 3 : cardLimit(limits, card))}
              onCatalog={(found) => onCatalogRef.current(found)}
              onDisabled={columns.onBridgesDisabled}
              onDeepFinished={columns.onDeepFinished}
              focus={focusEngine}
            />
          </div>
        </div>
      ) : null}
    </aside>
  );
}

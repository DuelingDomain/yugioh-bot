"use client";

/**
 * The pool browser: a dense, windowed card grid or list of a draft pool, with Main / Extra / Split lanes, search,
 * type chips, a copy-weighted ratio bar and level curve, filters, grouping and sorting. It draws only the rows in view,
 * so a 500-card pool stays light. It holds no pool of its own: you pass the pools in and react to callbacks.
 *
 * Props:
 *   main, extra     Map of passcode to copies for each lane. Leave `extra` out for a Main-only pool. A passcode is in one lane.
 *   getCard         card details by passcode (undefined while they load). Pass a NEW function when details arrive so rows update.
 *   actions         { onStep, onSetCopies, onRemove }. Leave `onStep` out for READ-ONLY: no steppers, no +/- keys.
 *   inspector       controller from `useCardInspector`. Hover and focus preview a card, click pins it; show it with <CardInspector>.
 *   title           heading text next to the counts (for example "Draft pool"). Optional.
 *   defaultLane     "main" (default) | "extra" | "split". Split needs about 880px of width and falls back to Main below that.
 *   onLaneChange    called with the lane view when the user switches it.
 *   defaultLayout   "grid" (default) | "list".
 *   compact         hides the filter selects and the level curve, for a narrow drawer. Search, lanes and type chips stay.
 *   emptyState      shown instead of the browser when both lanes are empty (for example an import prompt).
 *   height          CSS height of the whole browser. Default "100%": give its parent a height.
 *   className       for the root.
 *   ref             { focusSearch() }.
 *
 * Keys (focus inside the browser, not in a field): arrows, Home, End move between cards and keep the focus ring on the
 * card; + and - change copies and Delete removes the card (edit mode); F search; G grid or list; M and E switch lane.
 * Enter or Space on a card pins it. Esc unpins (handled by the inspector hook).
 */

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, LayoutGrid, List, Search } from "lucide-react";
import { CopiesStepper } from "./card-inspector";
import type { CardInspectorController } from "./use-card-inspector";
import {
  CURVE_LEVELS,
  GRID_GAP,
  GROUP_CHIP,
  GROUP_COLOR,
  HEADER_HEIGHT,
  NO_FILTERS,
  chipGroups,
  copiesLabel,
  countsLine,
  entriesOf,
  filterEntries,
  filtersActive,
  findInRows,
  gridMetrics,
  groupEntries,
  idsInRows,
  layoutRows,
  levelCurve,
  nameOf,
  navigate,
  neighborAfterRemoval,
  sortEntries,
  summarize,
  tallyGroups,
  tileImage,
  type CardGroup,
  type CopiesFilter,
  type NavKey,
  type PoolCard,
  type PoolCopies,
  type PoolEditActions,
  type PoolEntry,
  type PoolFilters,
  type PoolGroupBy,
  type PoolLane,
  type PoolLaneView,
  type PoolLayout,
  type PoolRow,
  type PoolSortBy,
  type TributeFilter,
} from "./pool-browser-model";
import styles from "./setup.module.css";

export interface PoolBrowserHandle {
  focusSearch: () => void;
}

export interface PoolBrowserProps {
  main: PoolCopies;
  extra?: PoolCopies;
  getCard: (id: number) => PoolCard | undefined;
  actions?: PoolEditActions;
  inspector?: CardInspectorController;
  title?: React.ReactNode;
  defaultLane?: PoolLaneView;
  onLaneChange?: (lane: PoolLaneView) => void;
  defaultLayout?: PoolLayout;
  compact?: boolean;
  emptyState?: React.ReactNode;
  height?: number | string;
  className?: string;
  ref?: React.Ref<PoolBrowserHandle>;
}

const PAD_X = 12;
const SPLIT_MIN_WIDTH = 880;
const FALLBACK_WIDTH = 960;

/** Width of an element, kept up to date. 0 until it is measured (and in environments that cannot measure). */
function useWidth(ref: React.RefObject<HTMLElement | null>): number {
  const [width, setWidth] = React.useState(0);
  React.useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => setWidth((w) => (w === el.clientWidth ? w : el.clientWidth));
    read();
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener("resize", read);
    return () => window.removeEventListener("resize", read);
  }, [ref]);
  return width;
}

const isTyping = (t: EventTarget | null) => {
  const el = t as HTMLElement | null;
  return !!el && typeof el.matches === "function" && el.matches("input, textarea, select, [contenteditable='true']");
};

const NAV_KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"]);

/* ---------- one card ---------- */

interface CardHandlers {
  onPick: (id: number) => void;
  onFocusCard: (id: number) => void;
  onBlurCard: (e: React.FocusEvent) => void;
  onEnterCard: (id: number, e: React.PointerEvent) => void;
  onLeaveCard: () => void;
  onKeyCard: (e: React.KeyboardEvent, entry: PoolEntry) => void;
  onStep: ((id: number, delta: number, lane: PoolLane) => void) | undefined;
  onSet: ((id: number, copies: number, lane: PoolLane) => void) | undefined;
}

interface CardProps extends CardHandlers {
  entry: PoolEntry;
  pinned: boolean;
  tab: boolean;
  readOnly: boolean;
}

const Tile = React.memo(function Tile({ entry, pinned, tab, readOnly, onPick, onFocusCard, onBlurCard, onEnterCard, onLeaveCard, onKeyCard, onStep }: CardProps) {
  const { id, copies, lane } = entry;
  const name = nameOf(entry);
  return (
    <div
      className={styles.tile}
      role="listitem"
      data-card-id={id}
      data-lane={lane}
      data-pinned={pinned ? "1" : undefined}
      style={{ "--k": GROUP_COLOR[entry.group] } as React.CSSProperties}
      onPointerEnter={(e) => onEnterCard(id, e)}
      onPointerLeave={onLeaveCard}
    >
      <button
        type="button"
        data-tile
        className={styles.tileBtn}
        tabIndex={tab ? 0 : -1}
        aria-pressed={pinned}
        aria-label={`${name}, ${copiesLabel(copies)}`}
        onClick={() => onPick(id)}
        onFocus={() => onFocusCard(id)}
        onBlur={onBlurCard}
        onKeyDown={(e) => onKeyCard(e, entry)}
      >
        <span className={styles.tileName} aria-hidden="true">
          {name}
        </span>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.card?.imageUrlSmall || tileImage(id)} alt="" loading="lazy" decoding="async" draggable={false} />
        <i className={styles.tileKind} aria-hidden="true" />
        {copies > 1 && (
          <span className={styles.tileCopies} aria-hidden="true">
            ×{copies}
          </span>
        )}
      </button>
      {!readOnly && onStep && (
        <span className={styles.tileStep}>
          <CopiesStepper name={name} copies={copies} tabbable={tab} onStep={(d) => onStep(id, d, lane)} />
        </span>
      )}
    </div>
  );
});

const ListRow = React.memo(function ListRow({ entry, pinned, tab, readOnly, onPick, onFocusCard, onBlurCard, onEnterCard, onLeaveCard, onKeyCard, onStep }: CardProps) {
  const { id, copies, lane, card } = entry;
  const name = nameOf(entry);
  const meta = [card?.type, card?.level ? `${card.frameType.toLowerCase() === "xyz" ? "Rank" : "Lv"} ${card.level}` : null, card?.attribute, card && card.atk !== undefined ? `${card.atk}/${card.def ?? "?"}` : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div
      className={styles.listRow}
      role="listitem"
      data-card-id={id}
      data-lane={lane}
      data-pinned={pinned ? "1" : undefined}
      style={{ "--k": GROUP_COLOR[entry.group] } as React.CSSProperties}
      onPointerEnter={(e) => onEnterCard(id, e)}
      onPointerLeave={onLeaveCard}
    >
      <button
        type="button"
        data-tile
        className={styles.listBtn}
        tabIndex={tab ? 0 : -1}
        aria-pressed={pinned}
        aria-label={`${name}, ${copiesLabel(copies)}`}
        onClick={() => onPick(id)}
        onFocus={() => onFocusCard(id)}
        onBlur={onBlurCard}
        onKeyDown={(e) => onKeyCard(e, entry)}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={entry.card?.imageUrlSmall || tileImage(id)} alt="" loading="lazy" decoding="async" draggable={false} />
        <span className={styles.listName} aria-hidden="true">
          <b>{name}</b>
          <span>
            <i />
            {meta}
          </span>
        </span>
      </button>
      {readOnly || !onStep ? (
        <span className={styles.listCount} aria-hidden="true">
          ×{copies}
        </span>
      ) : (
        <CopiesStepper name={name} copies={copies} tabbable={tab} onStep={(d) => onStep(id, d, lane)} />
      )}
    </div>
  );
});

/* ---------- one lane, windowed ---------- */

interface LaneBodyProps extends CardHandlers {
  lane: PoolLane;
  /** Heading shown over the lane in split view. */
  heading?: string;
  entries: PoolEntry[];
  filters: PoolFilters;
  sortBy: PoolSortBy;
  groupBy: PoolGroupBy;
  layout: PoolLayout;
  tileMin: number;
  collapsed: ReadonlySet<string>;
  onToggleSection: (key: string) => void;
  readOnly: boolean;
  pinnedId: number | null;
  onClearFilters: () => void;
}

function LaneBody(props: LaneBodyProps) {
  const { lane, heading, entries, filters, sortBy, groupBy, layout, tileMin, collapsed, onToggleSection, readOnly, pinnedId, onClearFilters } = props;
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const width = useWidth(scrollRef);
  const inner = Math.max(0, (width || FALLBACK_WIDTH) - PAD_X * 2);
  const metrics = gridMetrics(layout, inner, tileMin);
  const [active, setActive] = React.useState<number | null>(null);
  const pendingFocus = React.useRef<number | null>(null);
  const focusedId = React.useRef<number | null>(null);
  const previousIds = React.useRef<number[]>([]);

  const visible = React.useMemo(() => sortEntries(filterEntries(entries, filters), sortBy), [entries, filters, sortBy]);
  const sections = React.useMemo(() => groupEntries(visible, groupBy, lane), [visible, groupBy, lane]);
  const rows = React.useMemo<PoolRow[]>(
    () => layoutRows(sections, metrics.perRow, (key) => collapsed.has(`${lane}:${key}`)),
    [sections, metrics.perRow, collapsed, lane],
  );

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (rows[i].kind === "header" ? HEADER_HEIGHT : metrics.rowHeight),
    getItemKey: (i) => rows[i].key,
    overscan: 4,
  });
  React.useEffect(() => {
    virtualizer.measure();
    // The virtualizer object is stable; only a change of sizes or rows needs a fresh measure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, metrics.rowHeight]);

  const goTo = React.useCallback(
    (id: number) => {
      const spot = findInRows(rows, id);
      if (!spot) return;
      setActive(id);
      pendingFocus.current = id;
      virtualizer.scrollToIndex(spot.row, { align: "auto" });
    },
    [rows, virtualizer],
  );

  // Focus a card the keys moved to, once its row is drawn. It is kept until then.
  React.useEffect(() => {
    const id = pendingFocus.current;
    if (id === null) return;
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-card-id="${id}"] [data-tile]`);
    if (el) {
      pendingFocus.current = null;
      el.focus();
    } else if (!idsInRows(rows).includes(id)) {
      pendingFocus.current = null;
    }
  });

  // A card that held focus and is gone (removed, filtered out): focus moves to its neighbor instead of the page.
  React.useEffect(() => {
    const ids = idsInRows(rows);
    const before = previousIds.current;
    previousIds.current = ids;
    const held = focusedId.current;
    if (held === null || ids.includes(held) || !before.includes(held)) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    focusedId.current = null;
    const next = neighborAfterRemoval(before, ids, held);
    if (next !== null) goTo(next);
  }, [rows, goTo]);

  const onKeyCard = props.onKeyCard;
  const handleKey = React.useCallback(
    (e: React.KeyboardEvent, entry: PoolEntry) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (NAV_KEYS.has(e.key)) {
        e.preventDefault();
        const to = navigate(rows, entry.id, e.key as NavKey);
        if (to && to.id !== entry.id) goTo(to.id);
        return;
      }
      onKeyCard(e, entry);
    },
    [rows, goTo, onKeyCard],
  );

  const onFocusCard = props.onFocusCard;
  const handleFocus = React.useCallback(
    (id: number) => {
      focusedId.current = id;
      setActive(id);
      onFocusCard(id);
    },
    [onFocusCard],
  );
  const onBlurCard = props.onBlurCard;
  const handleBlur = React.useCallback(
    (e: React.FocusEvent) => {
      onBlurCard(e);
      const el = e.currentTarget;
      const to = e.relatedTarget as HTMLElement | null;
      if (to && to.closest?.("[data-card-id]")) return;
      // A tile that was removed from the page keeps the held id so focus can move on. A real blur forgets it.
      queueMicrotask(() => {
        if (el.isConnected) focusedId.current = null;
      });
    },
    [onBlurCard],
  );

  const items = virtualizer.getVirtualItems();
  const shownIds: number[] = [];
  for (const item of items) {
    const row = rows[item.index];
    if (row?.kind === "cards") for (const e of row.entries) shownIds.push(e.id);
  }
  const tabId = active !== null && shownIds.includes(active) ? active : (shownIds[0] ?? null);

  if (entries.length === 0) {
    return (
      <div className={styles.lane} data-lane={lane}>
        {heading && <h3 className={styles.laneHead}>{heading}</h3>}
        <p className={styles.empty}>{lane === "extra" ? "No Extra Deck cards in the pool." : "No Main Deck cards in the pool."}</p>
      </div>
    );
  }
  if (visible.length === 0) {
    return (
      <div className={styles.lane} data-lane={lane}>
        {heading && <h3 className={styles.laneHead}>{heading}</h3>}
        <div className={styles.empty}>
          <p>No cards match.{filtersActive(filters) ? ` ${entries.length} ${entries.length === 1 ? "card is" : "cards are"} hidden by the filters.` : ""}</p>
          <button type="button" className={styles.textBtn} onClick={onClearFilters}>
            Clear filters
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.lane} data-lane={lane}>
      {heading && (
        <h3 className={styles.laneHead}>
          {heading}
          <span>{summarize(entries).copies}</span>
        </h3>
      )}
      <div
        ref={scrollRef}
        className={styles.scroll}
        role="region"
        aria-label={lane === "extra" ? "Extra pool cards" : "Main pool cards"}
        style={{ paddingInline: PAD_X }}
      >
        <div className={styles.windowBox} style={{ height: virtualizer.getTotalSize() }}>
          {items.map((item) => {
            const row = rows[item.index];
            if (!row) return null;
            if (row.kind === "header") {
              const s = row.section;
              return (
                <div key={row.key} className={styles.vrow} style={{ height: item.size, transform: `translateY(${item.start}px)` }} data-index={item.index}>
                  <button
                    type="button"
                    className={styles.groupHead}
                    aria-expanded={!row.collapsed}
                    style={{ "--k": GROUP_COLOR[s.group] } as React.CSSProperties}
                    onClick={() => onToggleSection(`${lane}:${s.key}`)}
                  >
                    <i className={styles.groupBar} aria-hidden="true" />
                    <b>{s.label}</b>
                    <span>
                      <em>{s.copies}</em> {s.copies === 1 ? "card" : "cards"} · {s.entries.length} unique
                    </span>
                    <ChevronDown size={16} aria-hidden="true" />
                  </button>
                </div>
              );
            }
            return (
              <div
                key={row.key}
                className={styles.vrow}
                role="list"
                aria-label="Cards"
                data-index={item.index}
                style={{
                  height: item.size - (layout === "grid" ? GRID_GAP : 2),
                  transform: `translateY(${item.start}px)`,
                  display: "grid",
                  gridTemplateColumns: `repeat(${metrics.perRow}, minmax(0, 1fr))`,
                  columnGap: layout === "grid" ? GRID_GAP : 14,
                }}
              >
                {row.entries.map((entry) => {
                  const Card = layout === "grid" ? Tile : ListRow;
                  return (
                    <Card
                      key={entry.id}
                      entry={entry}
                      pinned={pinnedId === entry.id}
                      tab={tabId === entry.id}
                      readOnly={readOnly}
                      onPick={props.onPick}
                      onFocusCard={handleFocus}
                      onBlurCard={handleBlur}
                      onEnterCard={props.onEnterCard}
                      onLeaveCard={props.onLeaveCard}
                      onKeyCard={handleKey}
                      onStep={props.onStep}
                      onSet={props.onSet}
                    />
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ---------- the browser ---------- */

const SHOW_OPTIONS: Array<[CopiesFilter, string]> = [
  ["all", "All cards"],
  ["single", "One copy"],
  ["multi", "2+ copies"],
  ["three", "3+ copies"],
];
const TRIBUTE_OPTIONS: Array<[TributeFilter, string]> = [
  ["any", "Any tributes"],
  ["none", "No tribute (Lv 1-4)"],
  ["one", "One tribute (Lv 5-6)"],
  ["two", "Two tributes (Lv 7+)"],
];
const GROUP_OPTIONS: Array<[PoolGroupBy, string]> = [
  ["type", "Group: Type"],
  ["subtype", "Group: Card type"],
  ["level", "Group: Level"],
  ["none", "No groups"],
];
const SORT_OPTIONS: Array<[PoolSortBy, string]> = [
  ["added", "Newest first"],
  ["name", "Name"],
  ["level", "Level"],
  ["copies", "Most copies"],
];

export function PoolBrowser(props: PoolBrowserProps) {
  const { main, extra, getCard, inspector, title, compact = false, emptyState, height = "100%", className } = props;
  const actions = props.actions ?? inspector?.actions;
  const readOnly = !actions?.onStep;
  const hasExtra = extra !== undefined;

  const rootRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const rootWidth = useWidth(rootRef);
  const canSplit = hasExtra && (rootWidth || FALLBACK_WIDTH) >= SPLIT_MIN_WIDTH;

  const [lane, setLaneState] = React.useState<PoolLaneView>(props.defaultLane ?? "main");
  const [layout, setLayout] = React.useState<PoolLayout>(props.defaultLayout ?? "grid");
  const [filters, setFilters] = React.useState<PoolFilters>(NO_FILTERS);
  const [groupBy, setGroupBy] = React.useState<PoolGroupBy>("type");
  const [sortBy, setSortBy] = React.useState<PoolSortBy>("added");
  const [tileMin, setTileMin] = React.useState(104);
  const [collapsed, setCollapsed] = React.useState<ReadonlySet<string>>(() => new Set());

  const view: PoolLaneView = !hasExtra ? "main" : lane === "split" && !canSplit ? "main" : lane;

  React.useImperativeHandle(props.ref, () => ({ focusSearch: () => searchRef.current?.focus() }), []);

  const mainEntries = React.useMemo(() => entriesOf(main, "main", getCard), [main, getCard]);
  const extraEntries = React.useMemo(() => entriesOf(extra, "extra", getCard), [extra, getCard]);
  const mainSummary = React.useMemo(() => summarize(mainEntries), [mainEntries]);
  const extraSummary = React.useMemo(() => summarize(extraEntries), [extraEntries]);

  const setLane = React.useCallback(
    (next: PoolLaneView) => {
      setLaneState(next);
      setFilters((f) => (f.chip !== "all" && !chipGroups(next).includes(f.chip) ? { ...f, chip: "all" } : f));
      props.onLaneChange?.(next);
    },
    [props],
  );

  const chipEntries = view === "main" ? mainEntries : view === "extra" ? extraEntries : [...mainEntries, ...extraEntries];
  const tally = React.useMemo(() => tallyGroups(chipEntries), [chipEntries]);
  const chips = chipGroups(view);
  const chipTotal = chips.reduce((n, g) => n + tally[g], 0);
  const curve = React.useMemo(
    () => (view === "split" ? null : levelCurve(view === "main" ? mainEntries : extraEntries, view)),
    [view, mainEntries, extraEntries],
  );

  /* callbacks the cards share. Everything here is stable between renders unless the inspector or actions change. */
  const preview = inspector?.preview;
  const endPreview = inspector?.endPreview;
  const togglePin = inspector?.togglePin;
  const onStep = actions?.onStep;
  const onSetCopies = actions?.onSetCopies;
  const onRemove = actions?.onRemove;
  const onPick = React.useCallback((id: number) => togglePin?.(id), [togglePin]);
  const onFocusCard = React.useCallback((id: number) => preview?.(id), [preview]);
  const onBlurCard = React.useCallback(
    (e: React.FocusEvent) => {
      const to = e.relatedTarget as HTMLElement | null;
      if (!to || !to.closest?.("[data-card-id]")) endPreview?.(120);
    },
    [endPreview],
  );
  const onEnterCard = React.useCallback(
    (id: number, e: React.PointerEvent) => {
      if (e.pointerType !== "touch") preview?.(id);
    },
    [preview],
  );
  const onLeaveCard = React.useCallback(() => endPreview?.(), [endPreview]);
  const onKeyCard = React.useCallback(
    (e: React.KeyboardEvent, entry: PoolEntry) => {
      if (!onStep) return;
      if (e.key === "+" || e.key === "=") {
        e.preventDefault();
        onStep(entry.id, 1, entry.lane);
      } else if (e.key === "-" || e.key === "_") {
        e.preventDefault();
        onStep(entry.id, -1, entry.lane);
      } else if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        if (onRemove) onRemove(entry.id, entry.lane);
        else onStep(entry.id, -entry.copies, entry.lane);
      }
    },
    [onStep, onRemove],
  );
  const toggleSection = React.useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);
  const clearFilters = React.useCallback(() => setFilters(NO_FILTERS), []);
  const setSet = onSetCopies;

  const onRootKey = (e: React.KeyboardEvent) => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || isTyping(e.target)) return;
    const k = e.key.toLowerCase();
    if (k === "f") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if (k === "g") {
      setLayout((l) => (l === "grid" ? "list" : "grid"));
    } else if (k === "m") {
      setLane("main");
    } else if (k === "e" && hasExtra) {
      setLane("extra");
    }
  };

  const total = mainSummary.copies + extraSummary.copies;
  const distinct = mainSummary.distinct + extraSummary.distinct;

  if (total === 0 && distinct === 0 && emptyState) {
    return (
      <div ref={rootRef} className={`${styles.browser} ${className ?? ""}`} style={{ height }}>
        {emptyState}
      </div>
    );
  }

  const shared: Omit<LaneBodyProps, "lane" | "entries" | "heading"> = {
    filters,
    sortBy,
    groupBy,
    layout,
    tileMin,
    collapsed,
    onToggleSection: toggleSection,
    readOnly,
    pinnedId: inspector?.pinnedId ?? null,
    onClearFilters: clearFilters,
    onPick,
    onFocusCard,
    onBlurCard,
    onEnterCard,
    onLeaveCard,
    onKeyCard,
    onStep,
    onSet: setSet,
  };

  return (
    <div ref={rootRef} className={`${styles.browser} ${className ?? ""}`} style={{ height }} onKeyDown={onRootKey} data-readonly={readOnly ? "1" : undefined}>
      <div className={styles.bHead}>
        <div className={styles.bTitle}>
          {title && <h2>{title}</h2>}
          <span className={styles.bCounts}>{countsLine(total, distinct)}</span>
        </div>
        <div className={styles.bTools}>
          {hasExtra && (
            <div className={styles.seg} role="group" aria-label="Pool lane">
              <button type="button" aria-pressed={view === "main"} onClick={() => setLane("main")}>
                Main <small>{mainSummary.copies}</small>
              </button>
              <button type="button" aria-pressed={view === "extra"} onClick={() => setLane("extra")}>
                Extra <small>{extraSummary.copies}</small>
              </button>
              {canSplit && (
                <button type="button" aria-pressed={view === "split"} onClick={() => setLane("split")}>
                  Split
                </button>
              )}
            </div>
          )}
          <div className={styles.seg} role="group" aria-label="Layout">
            <button type="button" aria-pressed={layout === "grid"} aria-label="Grid view" title="Grid (G)" onClick={() => setLayout("grid")}>
              <LayoutGrid size={16} aria-hidden="true" />
            </button>
            <button type="button" aria-pressed={layout === "list"} aria-label="List view" title="List (G)" onClick={() => setLayout("list")}>
              <List size={16} aria-hidden="true" />
            </button>
          </div>
          {layout === "grid" && (
            <input
              className={styles.size}
              type="range"
              min={80}
              max={180}
              step={4}
              value={tileMin}
              aria-label="Card size"
              onChange={(e) => setTileMin(Number(e.target.value))}
            />
          )}
        </div>
      </div>

      <div className={styles.bFilters}>
        <label className={styles.search}>
          <Search size={15} aria-hidden="true" />
          <input
            ref={searchRef}
            type="search"
            placeholder="Filter this pool"
            aria-label="Filter this pool"
            autoComplete="off"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          />
        </label>
        {!compact && (
          <>
            <select aria-label="Show" value={filters.copies} onChange={(e) => setFilters((f) => ({ ...f, copies: e.target.value as CopiesFilter }))}>
              {SHOW_OPTIONS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            {view !== "extra" && (
              <select aria-label="Tributes" value={filters.tribute} onChange={(e) => setFilters((f) => ({ ...f, tribute: e.target.value as TributeFilter }))}>
                {TRIBUTE_OPTIONS.map(([v, t]) => (
                  <option key={v} value={v}>
                    {t}
                  </option>
                ))}
              </select>
            )}
            <select aria-label="Group by" value={groupBy} onChange={(e) => setGroupBy(e.target.value as PoolGroupBy)}>
              {GROUP_OPTIONS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
            <select aria-label="Sort by" value={sortBy} onChange={(e) => setSortBy(e.target.value as PoolSortBy)}>
              {SORT_OPTIONS.map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </select>
          </>
        )}
      </div>

      <div className={styles.strip}>
        <div className={styles.stripMain}>
          <div className={styles.chips} role="group" aria-label="Filter by type">
            <button type="button" className={styles.chip} aria-pressed={filters.chip === "all"} onClick={() => setFilters((f) => ({ ...f, chip: "all" }))}>
              All <b>{chipTotal}</b>
            </button>
            {chips.map((g: CardGroup) => (
              <button
                key={g}
                type="button"
                className={styles.chip}
                aria-pressed={filters.chip === g}
                style={{ "--k": GROUP_COLOR[g] } as React.CSSProperties}
                onClick={() => setFilters((f) => ({ ...f, chip: f.chip === g ? "all" : g }))}
              >
                <i aria-hidden="true" />
                {GROUP_CHIP[g]} <b>{tally[g]}</b>
              </button>
            ))}
          </div>
          <div className={styles.ratio} aria-hidden="true">
            {chips.map((g) => (
              <i key={g} title={`${GROUP_CHIP[g]}: ${tally[g]}`} style={{ flex: `${tally[g]} 1 0`, background: GROUP_COLOR[g] }} />
            ))}
          </div>
        </div>
        {!compact && curve && curve.max > 0 && (
          <div
            className={styles.curve}
            data-lane={view}
            role="img"
            aria-label={`Level curve: ${curve.counts.map((n, i) => (n ? `level ${i + 1} ${n}` : "")).filter(Boolean).join(", ")}`}
          >
            <span className={styles.curveLabel}>{view === "extra" ? "Lv / Rk" : "Level"}</span>
            {curve.counts.map((n, i) => (
              <span key={i} className={styles.curveCol} data-zero={n === 0 ? "1" : undefined} title={`Level ${i + 1}${i + 1 === CURVE_LEVELS ? "+" : ""}: ${copiesLabel(n)}`}>
                <u>{n > 0 && n === curve.max ? n : ""}</u>
                <i style={{ height: n ? Math.max(3, Math.round((n / curve.max) * 28)) : 2 }} />
                <em>{i + 1}</em>
              </span>
            ))}
          </div>
        )}
      </div>

      <div className={styles.bBody} data-split={view === "split" ? "1" : undefined}>
        {view === "split" ? (
          <>
            <LaneBody {...shared} lane="main" heading="Main Deck" entries={mainEntries} />
            <LaneBody {...shared} lane="extra" heading="Extra Deck" entries={extraEntries} />
          </>
        ) : (
          <LaneBody key={view} {...shared} lane={view} entries={view === "main" ? mainEntries : extraEntries} />
        )}
      </div>
    </div>
  );
}

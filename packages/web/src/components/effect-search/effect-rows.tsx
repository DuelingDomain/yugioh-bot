"use client";

import * as React from "react";
import { Check, Info, Minus } from "lucide-react";
import { cardImageUrl } from "@/lib/card-image-url";
import type { CardSummary } from "@/lib/card-types";
import { ReleaseMarks } from "../decks/release-marks";
import { CardNotePopover } from "./card-note-popover";
import { allShownSelected, type Batch, type Selectable } from "./selection";
import styles from "./effect-search.module.css";

export interface RowCard extends CardSummary {
  synergyCategory?: import("@yugidraft/shared/cards/effects").SynergyCategory;
  /** One line on why the card is in the list. */
  reason?: string;
}

/** What `useResultNav` hands out; the list takes it so the keyboard works from the input above it. */
export interface RowNav {
  listProps: { id: string; role: "listbox" };
  optionProps: (index: number) => React.HTMLAttributes<HTMLLIElement> & { "data-active"?: string };
}

const HOVER_MS = 350;
const KEY_MS = 600;

/**
 * Result rows with a checkbox each. A click on the row toggles the card (or, with `onRowClick`, does that and
 * the box toggles); shift-click takes a range. Rows never change size on hover or focus: the summary is a
 * fixed overlay.
 */
export function EffectRows({
  cards,
  batch,
  selectable,
  held,
  kindLine,
  nav,
  label,
  stale,
  busy,
  onToggle,
  onRowClick,
  trailing,
  keyboardActive,
  testId = "effect-result",
  heading,
}: {
  cards: readonly RowCard[];
  batch: Batch;
  selectable: Selectable;
  /** Copies of the card the target already holds. Such a row cannot be picked. */
  held: (card: CardSummary) => number;
  kindLine: (card: CardSummary) => string;
  nav: RowNav;
  label: string;
  stale?: boolean;
  busy?: boolean;
  onToggle: (card: CardSummary, range: boolean) => void;
  /** Name mode: the row adds the card at once and only its box joins the batch. */
  onRowClick?: (card: CardSummary) => void;
  /** Right edge content in place of the held note, for a row that is not held. */
  trailing?: (card: CardSummary) => React.ReactNode;
  /** True while the keyboard drives the list, so the summary follows the highlighted row. */
  keyboardActive?: boolean;
  testId?: string;
  /** Separate synergy lists share keyboard navigation while retaining their own headings. */
  heading?: (index: number) => string | undefined;
}) {
  const popId = React.useId();
  const [hover, setHover] = React.useState<{ id: number; el: HTMLElement } | null>(null);
  const [pinned, setPinned] = React.useState<{ id: number; el: HTMLElement } | null>(null);
  const [keyed, setKeyed] = React.useState<{ id: number; el: HTMLElement } | null>(null);
  const hoverTimer = React.useRef<ReturnType<typeof setTimeout>>(undefined);
  // Keyed by the row key: one card can sit in two groups, and each group has its own row.
  const rows = React.useRef(new Map<string, HTMLLIElement>());

  // A new list closes every summary.
  React.useEffect(() => {
    setHover(null);
    setPinned(null);
    setKeyed(null);
  }, [cards]);

  React.useEffect(() => {
    if (!pinned) return;
    const away = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest("[role=tooltip], [data-info]")) return;
      setPinned(null);
    };
    const esc = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPinned(null);
    };
    document.addEventListener("pointerdown", away, true);
    document.addEventListener("keydown", esc, true);
    return () => {
      document.removeEventListener("pointerdown", away, true);
      document.removeEventListener("keydown", esc, true);
    };
  }, [pinned]);

  const activeIndex = cards.findIndex((_, i) => nav.optionProps(i)["data-active"] !== undefined);
  const activeId = activeIndex >= 0 ? cards[activeIndex]!.id : null;
  React.useEffect(() => {
    setKeyed(null);
    if (!keyboardActive || activeId == null) return;
    const timer = setTimeout(() => {
      const el = rows.current.get(`${activeIndex}:${activeId}`);
      if (el) setKeyed({ id: activeId, el });
    }, KEY_MS);
    return () => clearTimeout(timer);
  }, [keyboardActive, activeId, activeIndex]);

  React.useEffect(() => () => clearTimeout(hoverTimer.current), []);

  const shown = pinned ?? hover ?? keyed;
  const shownCard = shown ? cards.find((c) => c.id === shown.id) : undefined;

  return (
    <>
      <ul
        className={styles.list}
        aria-label={label}
        aria-multiselectable="true"
        aria-busy={stale || busy || undefined}
        data-stale={stale ? "" : undefined}
        {...nav.listProps}
      >
        {cards.map((card, index) => {
          const rowKey = `${index}:${card.id}`;
          const opt = nav.optionProps(index);
          const inCube = held(card);
          const checked = batch.cards.has(card.id);
          const can = inCube === 0 && selectable(card);
          const describedBy = shown?.id === card.id ? popId : undefined;
          return (
            <React.Fragment key={rowKey}>
            {heading?.(index) ? <li role="presentation"><h3>{heading(index)}</h3></li> : null}
            <li
              {...opt}
              ref={(el) => {
                if (el) rows.current.set(rowKey, el);
                else rows.current.delete(rowKey);
              }}
              className={styles.row}
              aria-selected={checked}
              aria-describedby={describedBy}
              data-testid={testId}
              data-card-id={card.id}
              data-checked={checked ? "" : undefined}
              onClick={(event) => {
                if (inCube > 0) return;
                if (onRowClick) onRowClick(card);
                else if (can || checked) onToggle(card, event.shiftKey);
              }}
              onPointerEnter={(event) => {
                if (event.pointerType !== "mouse") return;
                const el = event.currentTarget;
                clearTimeout(hoverTimer.current);
                hoverTimer.current = setTimeout(() => setHover({ id: card.id, el }), HOVER_MS);
              }}
              onPointerLeave={() => {
                clearTimeout(hoverTimer.current);
                setHover(null);
              }}
            >
              {onRowClick ? (
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={checked}
                  aria-label={`Add ${card.name} to the batch`}
                  className={styles.box}
                  data-checked={checked ? "" : undefined}
                  data-disabled={!can && !checked ? "" : undefined}
                  disabled={!can && !checked}
                  data-testid="effect-box"
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    onToggle(card, event.shiftKey);
                  }}
                >
                  <Check aria-hidden="true" />
                </button>
              ) : (
                <span className={styles.box} aria-hidden="true" data-checked={checked ? "" : undefined} data-disabled={!can && !checked ? "" : undefined}>
                  <Check />
                </span>
              )}
              <span className={styles.thumb}>
                <img src={cardImageUrl(card.id, "small")} alt="" loading="lazy" />
              </span>
              <div className={styles.text}>
                <p className={styles.n}>{card.name} <ReleaseMarks release={card.release} /></p>
                <p className={styles.k}>{kindLine(card)}</p>
                {card.reason ? (
                  <p className={styles.why} data-testid="effect-reason">
                    {card.reason}
                  </p>
                ) : null}
              </div>
              <span className={styles.side}>
                {inCube > 0 ? (
                  <span className={styles.in}>
                    <Check aria-hidden="true" />×{inCube} in cube
                  </span>
                ) : (
                  trailing?.(card)
                )}
                <button
                  type="button"
                  className={styles.info}
                  data-info=""
                  tabIndex={-1}
                  aria-label={`About ${card.name}`}
                  aria-expanded={pinned?.id === card.id}
                  aria-controls={pinned?.id === card.id ? popId : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={(event) => {
                    event.stopPropagation();
                    const el = event.currentTarget.closest("li") as HTMLElement;
                    setPinned((now) => (now?.id === card.id ? null : { id: card.id, el }));
                  }}
                >
                  <Info aria-hidden="true" />
                </button>
              </span>
            </li>
            </React.Fragment>
          );
        })}
      </ul>
      {shown && shownCard && <CardNotePopover key={shown.id} card={shownCard} anchor={shown.el} id={popId} pinned={pinned?.id === shown.id} />}
    </>
  );
}

/** "Select all shown" with a mixed state when some of the list is in the batch. */
export function SelectAllShown({
  cards,
  batch,
  selectable,
  onSelectAll,
  onClear,
  total,
}: {
  cards: readonly CardSummary[];
  batch: Batch;
  selectable: Selectable;
  onSelectAll: () => void;
  onClear: () => void;
  /** Matches in all, when more than the list shows. */
  total?: number;
}) {
  // A card listed in two groups is one pick.
  const unique = cards.filter((c, i) => cards.findIndex((o) => o.id === c.id) === i);
  const pickable = unique.filter(selectable).length;
  const all = allShownSelected(batch, cards, selectable);
  const some = cards.some((c) => batch.cards.has(c.id));
  return (
    <div className={styles.listHead}>
      <button
        type="button"
        className={styles.selectAll}
        disabled={pickable === 0 && !some}
        aria-pressed={all}
        data-testid="effect-select-all"
        onMouseDown={(event) => event.preventDefault()}
        onClick={all ? onClear : onSelectAll}
      >
        <span className={styles.box} aria-hidden="true" data-checked={all ? "" : undefined} data-mixed={!all && some ? "" : undefined} style={{ marginTop: 0 }}>
          {!all && some ? <Minus /> : <Check />}
        </span>
        {all ? "Clear shown" : `Select all shown (${pickable})`}
      </button>
      {total !== undefined && total > unique.length ? <span>Top {unique.length} of {total}</span> : <span>{unique.length} shown</span>}
    </div>
  );
}

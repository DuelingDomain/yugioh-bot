"use client";

import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ChevronDown, Minus, Plus, Search, Undo2, X } from "lucide-react";
import { CardThumb } from "./pool-bits";
import {
  MAX_COPIES,
  kindOf,
  kindText,
  listRows,
  tallyCopies,
  tallyDistinct,
  type CardInfo,
  type Kind,
  type KindFilter,
} from "./pool-model";
import type { PoolEditor } from "./use-pool-editor";
import styles from "./pool.module.css";

const ROW_HEIGHT = 52;
const KIND_VAR: Record<Kind, string> = { monster: "var(--k-mon)", spell: "var(--k-spell)", trap: "var(--k-trap)" };
const FILTERS: Array<{ value: KindFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "monster", label: "Monsters" },
  { value: "spell", label: "Spells" },
  { value: "trap", label: "Traps" },
];

interface RowProps {
  id: number;
  copies: number;
  /** Copies in the starting point, or null when there is none to compare with. */
  baseCopies: number | null;
  card: CardInfo | undefined;
  start: number;
  onStep: (id: number, delta: number) => void;
}

/** One card: thumbnail, name, kind and a copies stepper. Minus at 1 removes the card. */
const PoolRow = React.memo(function PoolRow({ id, copies, baseCopies, card, start, onStep }: RowProps) {
  const name = card?.name ?? `Card ${id}`;
  const kind = card ? kindOf(card) : null;
  const marked = baseCopies !== null && copies !== baseCopies;
  return (
    <div
      className={styles.plRow}
      role="listitem"
      data-mark={marked ? "1" : undefined}
      style={{ transform: `translateY(${start}px)` }}
    >
      <CardThumb id={id} src={card?.imageUrlSmall} className={styles.thumb} />
      <span className={styles.plNm} style={kind ? ({ "--k": KIND_VAR[kind] } as React.CSSProperties) : undefined}>
        <i className={styles.dot} aria-hidden="true" />
        <b title={name}>{name}</b>
        {marked && <span className={styles.sr}>{baseCopies === 0 ? "Added" : "Changed"}</span>}
      </span>
      <span className={styles.plKind}>{card ? kindText(card) : ""}</span>
      <span className={styles.step}>
        {copies === 1 ? (
          <button type="button" className={styles.ib} aria-label={`Remove ${name} from the pool`} title="Remove" onClick={() => onStep(id, -1)}>
            <X size={15} aria-hidden="true" />
          </button>
        ) : (
          <button type="button" className={styles.ib} aria-label={`One fewer ${name}`} onClick={() => onStep(id, -1)}>
            <Minus size={15} aria-hidden="true" />
          </button>
        )}
        <span className={styles.c} aria-label={`${copies} ${copies === 1 ? "copy" : "copies"}`}>
          {copies}
        </span>
        <button type="button" className={styles.ib} aria-label={`One more ${name}`} disabled={copies >= MAX_COPIES} onClick={() => onStep(id, 1)}>
          <Plus size={15} aria-hidden="true" />
        </button>
      </span>
    </div>
  );
});

/**
 * The cards in the pool as dense rows in a virtual list, with a search box and kind chips above it. Cards added or
 * changed this session get a violet marker and sit first. Cards taken out of the starting point wait under "Removed".
 */
export function PoolList({ ctl }: { ctl: PoolEditor }) {
  const [query, setQuery] = React.useState("");
  const [filter, setFilter] = React.useState<KindFilter>("all");
  const [removedOpen, setRemovedOpen] = React.useState(false);
  const scrollRef = React.useRef<HTMLDivElement>(null);
  const removedId = React.useId();
  const { pool, base, info, pinned, meta, diff } = ctl;
  const hasBase = meta !== null;

  // The order changes when cards come or go, not when a count steps, so a click does not re-sort the list.
  const structure = React.useMemo(() => Array.from(pool.keys()).join(","), [pool]);
  const rows = React.useMemo(
    () => listRows(pool, info, { query, filter, pinned }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [structure, info, query, filter, pinned],
  );
  const counts = React.useMemo(() => tallyDistinct(pool, info), [structure, info]); // eslint-disable-line react-hooks/exhaustive-deps
  const copies = React.useMemo(() => tallyCopies(pool, info), [pool, info]);

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
  });

  return (
    <>
      <div className={styles.plHead}>
        <div className={styles.edH}>
          <h3>Pool</h3>
          <span className={styles.nums}>
            <b>{copies.total}</b> cards, <b>{pool.size}</b> different
          </span>
        </div>
        <div className={styles.in}>
          <Search size={16} aria-hidden="true" />
          <input
            className="input"
            type="search"
            placeholder="Search the pool"
            aria-label="Search the pool"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
        </div>
        <div className={styles.plChips} role="group" aria-label="Filter by kind">
          {FILTERS.map((f) => (
            <button key={f.value} type="button" className={styles.fchip} aria-pressed={filter === f.value} onClick={() => setFilter(f.value)}>
              {f.label} <small>{counts[f.value]}</small>
            </button>
          ))}
        </div>
      </div>
      {rows.length === 0 ? (
        <p className={styles.plNone}>{pool.size > 0 ? "No card matches that." : "No cards in the pool."}</p>
      ) : (
        <div ref={scrollRef} className={styles.plScroll} role="region" tabIndex={0} aria-label="Cards in the pool">
          <div className={styles.plIn} role="list" aria-label="Pool cards" style={{ height: virtualizer.getTotalSize() }}>
            {virtualizer.getVirtualItems().map((item) => {
              const id = rows[item.index];
              return (
                <PoolRow
                  key={id}
                  id={id}
                  copies={pool.get(id) ?? 0}
                  baseCopies={hasBase ? (base.get(id) ?? 0) : null}
                  card={info(id)}
                  start={item.start}
                  onStep={ctl.step}
                />
              );
            })}
          </div>
        </div>
      )}
      {hasBase && diff.goneIds.length > 0 && (
        <div className={styles.plFoot}>
          <button type="button" className={styles.rmT} aria-expanded={removedOpen} aria-controls={removedId} onClick={() => setRemovedOpen((o) => !o)}>
            Removed ({diff.goneIds.length})
            <ChevronDown size={16} aria-hidden="true" />
          </button>
          {removedOpen && (
            <ul className={styles.rmList} id={removedId}>
              {diff.goneIds.map((id) => {
                const card = info(id);
                const name = card?.name ?? `Card ${id}`;
                return (
                  <li key={id} className={styles.rmRow}>
                    <CardThumb id={id} src={card?.imageUrlSmall} className={styles.thumb} />
                    <b title={name}>{name}</b>
                    <button type="button" className={styles.textBtn} aria-label={`Undo removing ${name}`} onClick={() => ctl.undo(id)}>
                      <Undo2 size={15} aria-hidden="true" />
                      Undo
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </>
  );
}

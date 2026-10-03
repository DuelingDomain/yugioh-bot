"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { LevelsChart } from "./levels-chart";
import {
  KINDS,
  KIND_LABEL,
  attributeChips,
  attributeTint,
  countKinds,
  facetCount,
  groupCopies,
  isFiltering,
  kindOf,
  matchesFilter,
  orderEntries,
  pickInfo,
  poolEntries,
  statParts,
  titleCase,
  toggled,
  typeParts,
  cardText,
  type GoneCard,
  type Kind,
  type MonsterSubtype,
  type Order,
  type PickConfig,
  type PoolEntry,
  type RoomCard,
  type RoomFilter,
  type TierKey,
} from "./room-model";

export type Tab = "mine" | "gone";
export type { Order } from "./room-model";

const MONSTER_SUBTYPES: Array<[MonsterSubtype, string]> = [
  ["all", "All monsters"],
  ["effect", "Effect"],
  ["normal", "Normal"],
];

export interface BinderHandle {
  focusSearch: () => void;
  clearSearch: () => void;
}

export interface BinderProps {
  tab: Tab;
  onTab: (tab: Tab) => void;
  showGone: boolean;
  theme: boolean;
  pool: RoomCard[];
  gone: GoneCard[];
  /** The pack on the table, so its attributes get a chip even before you hold one. */
  packCards: RoomCard[];
  filter: RoomFilter;
  onFilter: (next: RoomFilter) => void;
  pickConfig: PickConfig;
  /** Total cards you will draft (main + extra in a theme draft). */
  target: number;
  newId: number | null;
  phone: boolean;
  onClose: () => void;
  onPeek: (peek: { card: RoomCard; tag: string } | null) => void;
}

interface Row {
  key: string;
  group: Array<{ card: RoomCard; kind: Kind; info?: ReturnType<typeof pickInfo>; gone?: GoneCard }>;
}

const canHover = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;

function statText(card: RoomCard): string {
  const sp = statParts(card);
  return sp ? sp.map((x) => x[1]).join(" / ") : "";
}

export const Binder = memo(
  forwardRef<BinderHandle, BinderProps>(function Binder(p, ref) {
    const { filter, onFilter, theme, pickConfig } = p;
    const [order, setOrder] = useState<Order>("type");
    const [open, setOpen] = useState<Set<string>>(new Set());
    const [facetsOpen, setFacetsOpen] = useState(!p.phone);
    const [text, setText] = useState(filter.q);
    const input = useRef<HTMLInputElement>(null);
    const scroller = useRef<HTMLDivElement>(null);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const filterRef = useRef(filter);
    filterRef.current = filter;
    const monsterOnly = filter.kinds.size === 1 && filter.kinds.has("monster");
    const monsterSubtype = monsterOnly ? (filter.monsterSubtype ?? "all") : "all";

    useImperativeHandle(ref, () => ({
      focusSearch: () => input.current?.focus({ preventScroll: true }),
      clearSearch: () => setText(""),
    }));
    // a filter cleared elsewhere clears the box too
    useEffect(() => {
      if (filter.q === "") setText("");
    }, [filter.q]);
    useEffect(() => () => clearTimeout(timer.current), []);
    // Kind changes from the table also clear a subtype that no longer applies.
    useEffect(() => {
      if (!monsterOnly && filter.monsterSubtype && filter.monsterSubtype !== "all") {
        onFilter({ ...filter, monsterSubtype: "all" });
      }
    }, [monsterOnly, filter, onFilter]);

    const onType = (value: string) => {
      setText(value);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => onFilter({ ...filterRef.current, q: value.trim().toLowerCase() }), 90);
    };
    const clearQuery = () => {
      clearTimeout(timer.current);
      setText("");
      onFilter({ ...filterRef.current, q: "" });
    };

    const mineEntries = useMemo(() => poolEntries(p.pool), [p.pool]);
    const list: Array<{ card: RoomCard; kind: Kind; entry?: PoolEntry; gone?: GoneCard }> = useMemo(
      () =>
        p.tab === "gone"
          ? p.gone.map((g) => ({ card: g.card, kind: kindOf(g.card), gone: g }))
          : mineEntries.map((e) => ({ card: e.card, kind: e.kind, entry: e })),
      [p.tab, p.gone, mineEntries],
    );
    const cards = useMemo(() => list.map((e) => e.card), [list]);
    const counts = useMemo(() => countKinds(cards), [cards]);
    const shown = useMemo(() => list.filter((e) => matchesFilter(e.card, filter)), [list, filter]);
    const filtering = isFiltering(filter);
    const active = facetCount(filter);
    const chips = useMemo(() => attributeChips(cards, p.packCards, filter.attr), [cards, p.packCards, filter.attr]);

    const rows = useMemo(() => {
      const out: Array<{ key: string; heading?: React.ReactNode; kind?: Kind; count: number; rows: Row[] }> = [];
      const sorted = orderEntries(shown, order);
      const rowFor = (e: (typeof shown)[number], i: number): Row => ({
        key: `${p.tab}:${e.card.id}:${e.entry?.index ?? i}`,
        group: [{ card: e.card, kind: e.kind, gone: e.gone, info: e.entry ? pickInfo(e.entry.index, pickConfig) : undefined }],
      });
      if ((order === "oldest" || order === "newest") && p.tab === "mine") {
        const groups = new Map<string, typeof shown>();
        sorted.forEach((e) => {
          const info = pickInfo(e.entry!.index, pickConfig);
          const k = theme ? (info.phase === "extra" ? "Extra deck" : "Main deck") : `Pack ${info.round}`;
          if (!groups.has(k)) groups.set(k, []);
          groups.get(k)!.push(e);
        });
        groups.forEach((g, k) =>
          out.push({
            key: k,
            heading: k,
            count: g.length,
            rows: g.map(rowFor),
          }),
        );
        return out;
      }
      if (order !== "type") return [{ key: order, count: sorted.length, rows: sorted.map(rowFor) }];
      KINDS.forEach((k) => {
        const g = sorted.filter((e) => e.kind === k);
        if (!g.length) return;
        const grouped = p.tab === "gone" ? g.map((e) => [e]) : groupCopies(g);
        out.push({
          key: k,
          heading: KIND_LABEL[k],
          kind: k,
          count: g.length,
          rows: grouped.map((grp, i) => ({
            key: `${p.tab}:${grp[0].card.id}:${i}`,
            group: grp.map((e) => ({
              card: e.card,
              kind: e.kind,
              gone: e.gone,
              info: e.entry ? pickInfo(e.entry.index, pickConfig) : undefined,
            })),
          })),
        });
      });
      return out;
    }, [shown, order, p.tab, theme, pickConfig]);

    const toggleRow = (key: string) =>
      setOpen((cur) => {
        const next = new Set(cur);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        return next;
      });

    const readerTag = (info: ReturnType<typeof pickInfo>) =>
      theme
        ? `In your picks, ${info.phase === "extra" ? "Extra deck" : "main deck"} round ${info.step}`
        : `In your picks, pack ${info.round} pick ${info.step}`;

    const peek = (row: Row["group"][number] | null) => {
      if (!canHover()) return;
      if (!row) return p.onPeek(null);
      if (row.gone) return p.onPeek({ card: row.card, tag: `Gone from pack ${row.gone.round} by pick ${row.gone.goneBy}` });
      if (row.info) p.onPeek({ card: row.card, tag: readerTag(row.info) });
    };

    const clearAll = useCallback(() => {
      clearTimeout(timer.current);
      setText("");
      onFilter({ kinds: new Set(), q: "", lvl: new Set(), attr: new Set() });
    }, [onFilter]);

    // a new pick flashes in the list
    const flashRow = useRef<HTMLButtonElement>(null);
    useEffect(() => {
      if (p.newId != null && flashRow.current && !p.phone) flashRow.current.scrollIntoView?.({ block: "nearest" });
    }, [p.newId, p.phone, shown.length]);

    const showingText = filtering ? (
      <>
        Showing {shown.length} of {list.length}{" "}
        <button type="button" onClick={clearAll}>
          Clear
        </button>
      </>
    ) : p.tab === "gone" ? (
      `${list.length} cards gone`
    ) : (
      `${list.length} of ${p.target} picked`
    );

    const bar = list.length ? (
      KINDS.map((k) => <i key={k} data-kind={k} style={{ "--n": counts[k] } as React.CSSProperties} />)
    ) : (
      <i className="rest" style={{ "--n": 1 } as React.CSSProperties} />
    );

    return (
      <aside className="binder" id="binder" aria-label="Your picks">
        <div className="bd-head">
          <div className="tabs" role="tablist" aria-label="Lists">
            <button type="button" role="tab" id="tabMine" aria-selected={p.tab === "mine"} aria-controls="list" onClick={() => { setOpen(new Set()); p.onTab("mine"); }}>
              Your picks <b>{p.pool.length}</b>
            </button>
            {p.showGone ? (
              <button type="button" role="tab" id="tabGone" aria-selected={p.tab === "gone"} aria-controls="list" onClick={() => { setOpen(new Set()); p.onTab("gone"); }}>
                Taken by others <b>{p.gone.length}</b>
              </button>
            ) : null}
          </div>
          <button type="button" className="bd-x" onClick={p.onClose}>
            Close
          </button>
        </div>
        <label className="search" data-has={text ? "" : undefined}>
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="8.5" cy="8.5" r="5.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="m13 13 4.5 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            type="search"
            placeholder="Search names, types and card text"
            autoComplete="off"
            spellCheck={false}
            aria-label="Search your picks and this pack"
            value={text}
            onChange={(e) => onType(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                if (text) {
                  clearQuery();
                  e.stopPropagation();
                } else input.current?.blur();
              }
            }}
          />
          <kbd>/</kbd>
          <button
            type="button"
            className="clr"
            aria-label="Clear search"
            onClick={(e) => {
              e.preventDefault();
              clearQuery();
              input.current?.focus();
            }}
          >
            ×
          </button>
        </label>
        <div className="bd-scroll" ref={scroller}>
          <div className="mix">
            <div className="mix-bar" aria-hidden="true">
              {bar}
            </div>
            <div className="kinds">
              {KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  data-kind={k}
                  data-g="kinds"
                  data-k={k}
                  aria-pressed={filter.kinds.has(k)}
                  onClick={() => onFilter({ ...filter, kinds: toggled(filter.kinds, k), monsterSubtype: "all" })}
                >
                  <b>{counts[k]}</b>
                  <small>
                    <i />
                    {KIND_LABEL[k]}
                  </small>
                </button>
              ))}
            </div>
            {monsterOnly ? (
              <div className="monster-subtypes chips" role="group" aria-label="Monster subtype">
                {MONSTER_SUBTYPES.map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className="chip"
                    aria-pressed={monsterSubtype === value}
                    onClick={() => onFilter({ ...filter, monsterSubtype: value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
            ) : null}
            <div className="levels">
              <LevelsChart
                cards={cards}
                selected={filter.lvl}
                onToggle={(key: TierKey) => onFilter({ ...filter, lvl: toggled(filter.lvl, key) })}
              />
            </div>
            <button type="button" className="more" aria-expanded={facetsOpen} aria-controls="facets" onClick={() => setFacetsOpen((v) => !v)}>
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="m4 2 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              Breakdown <span>{!facetsOpen && active ? `${active} on` : ""}</span>
            </button>
            <div className="facets" id="facets" hidden={!facetsOpen}>
              {chips.length ? (
                <div className="fg">
                  <span>Attribute</span>
                  <div className="chips">
                    {chips.map((c) => (
                      <button
                        key={c.key}
                        type="button"
                        className="chip"
                        data-g="attr"
                        data-k={c.key}
                        aria-pressed={filter.attr.has(c.key)}
                        data-zero={c.n ? undefined : ""}
                        onClick={() => onFilter({ ...filter, attr: toggled(filter.attr, c.key) })}
                      >
                        <i style={{ "--dot": attributeTint(c.key) } as React.CSSProperties} />
                        {titleCase(c.key)} <b>{c.n}</b>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </div>
          </div>
          <div className="bd-bar">
            <span className="showing">{showingText}</span>
            <label className="bd-sort">
              <span>Sort</span>
              <select value={order} onChange={(e) => { setOrder(e.target.value as Order); setOpen(new Set()); }}>
                <option value="type">Type</option>
                <option value="newest">Newest</option>
                <option value="oldest">Oldest</option>
                <option value="name">Name</option>
              </select>
            </label>
          </div>
          <div
            className="list"
            id="list"
            role="tabpanel"
            aria-labelledby={p.tab === "mine" ? "tabMine" : "tabGone"}
            data-tab={p.tab}
            onPointerLeave={() => peek(null)}
          >
            {!shown.length && filtering ? (
              <p className="empty">
                No cards match these filters.{" "}
                <button type="button" onClick={clearAll}>
                  Clear filters
                </button>
              </p>
            ) : !list.length ? (
              <p className="empty">
                {p.tab === "gone"
                  ? "Nothing yet. When a pack you've already seen comes back around, the cards your friends took from it show up here."
                  : "Your picks land here as you draft."}
              </p>
            ) : (
              rows.map((section) => (
                <div key={section.key} style={{ display: "contents" }}>
                  {section.heading ? (
                    <h4 data-kind={section.kind}>
                      {section.kind ? <i /> : null}
                      {section.heading}
                      <span>{section.count}</span>
                    </h4>
                  ) : null}
                  <ul>
                    {section.rows.map((row) => {
                      const e = row.group[0];
                      const c = e.card;
                      const isOpen = open.has(row.key);
                      const sp = statParts(c);
                      const kindLine = typeParts(c)
                        .filter((_, j) => j !== 0 || e.kind === "spell" || e.kind === "trap")
                        .join(", ");
                      let right: React.ReactNode;
                      if ((order === "oldest" || order === "newest") && p.tab === "mine" && e.info) {
                        right = (
                          <span className="rs">
                            <span className="no">{theme ? `Round ${e.info.step}` : `Pick ${e.info.step}`}</span>
                          </span>
                        );
                      } else if (p.tab === "gone" && e.gone) {
                        right = (
                          <span className="rs">
                            <span className="no">Pack {e.gone.round}</span>
                            <em>by pick {e.gone.goneBy}</em>
                          </span>
                        );
                      } else {
                        right = (
                          <span className="rs">
                            {row.group.length > 1 ? <span className="x2">×{row.group.length}</span> : statText(c)}
                            {row.group.length > 1 && sp ? <em>{statText(c)}</em> : null}
                          </span>
                        );
                      }
                      const isNew = p.tab === "mine" && p.newId != null && row.group.some((g) => g.card.id === p.newId);
                      return (
                        <li key={row.key} data-new={isNew ? "" : undefined}>
                          <button
                            ref={isNew ? flashRow : undefined}
                            type="button"
                            className={`row-btn${isNew ? " flash" : ""}`}
                            aria-expanded={isOpen}
                            onClick={() => toggleRow(row.key)}
                            onPointerOver={() => peek(e)}
                            onFocus={() => peek(e)}
                            onBlur={() => peek(null)}
                          >
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img src={c.imageUrlSmall || c.imageUrl} alt="" loading="lazy" />
                            <span className="rn">{c.name}</span>
                            <span className="rt">{kindLine}</span>
                            {right}
                          </button>
                          {isOpen ? <div className="rd">{cardText(c)}</div> : null}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))
            )}
          </div>
        </div>
      </aside>
    );
  }),
);

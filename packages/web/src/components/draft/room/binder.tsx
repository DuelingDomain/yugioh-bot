"use client";

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { downloadYdk } from "@/lib/ydk";
import { LevelsChart } from "./levels-chart";
import {
  EMPTY_FILTER,
  KINDS,
  KIND_LABEL,
  archetypeChips,
  attributeChips,
  attributeTint,
  countKinds,
  facetCount,
  groupCopies,
  isFiltering,
  matchesFilter,
  orderEntries,
  pickInfo,
  poolEntries,
  statParts,
  titleCase,
  toggled,
  typeChips,
  typeKeyName,
  typeParts,
  cardText,
  type FacetChip,
  type Kind,
  type MonsterSubtype,
  type Order,
  type PickConfig,
  type RoomCard,
  type RoomFilter,
  type TierKey,
} from "./room-model";

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
  draftName: string;
  theme: boolean;
  pool: RoomCard[];
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
  group: Array<{ card: RoomCard; kind: Kind; info: ReturnType<typeof pickInfo> }>;
}

const canHover = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(hover: hover)").matches;

/** One labelled row of filter chips. A row with no chips (no data for it yet) is not drawn. */
function ChipRow({
  label,
  group,
  chips,
  selected,
  nameOf = (k) => k,
  dotOf,
  onToggle,
}: {
  label: string;
  group: "type" | "attr" | "arch";
  chips: FacetChip[];
  selected: ReadonlySet<string>;
  nameOf?: (key: string) => string;
  dotOf?: (key: string) => string;
  onToggle: (key: string) => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="fg">
      <span>{label}</span>
      <div className="chips">
        {chips.map((c) => (
          <button
            key={c.key}
            type="button"
            className="chip"
            data-g={group}
            data-k={c.key}
            aria-pressed={selected.has(c.key)}
            data-zero={c.n ? undefined : ""}
            onClick={() => onToggle(c.key)}
          >
            {dotOf ? <i style={{ "--dot": dotOf(c.key) } as React.CSSProperties} /> : null}
            {nameOf(c.key)} <b>{c.n}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

function statText(card: RoomCard): string {
  const sp = statParts(card);
  return sp ? sp.map((x) => x[1]).join(" / ") : "";
}

export const Binder = memo(
  forwardRef<BinderHandle, BinderProps>(function Binder(p, ref) {
    const { filter, onFilter, theme, pickConfig } = p;
    const [order, setOrder] = useState<Order>("type");
    const [open, setOpen] = useState<Set<string>>(new Set());
    const pickOrder = (next: Order) => {
      setOrder(next);
      setOpen(new Set());
    };
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

    const list = useMemo(() => poolEntries(p.pool), [p.pool]);
    const cards = useMemo(() => list.map((e) => e.card), [list]);
    const counts = useMemo(() => countKinds(cards), [cards]);
    const shown = useMemo(() => list.filter((e) => matchesFilter(e.card, filter)), [list, filter]);
    const filtering = isFiltering(filter);
    const active = facetCount(filter);
    const chips = useMemo(() => attributeChips(cards, p.packCards, filter.attr), [cards, p.packCards, filter.attr]);
    const monsterTypeChips = useMemo(() => typeChips("monster", cards, p.packCards, filter.type), [cards, p.packCards, filter.type]);
    const spellTypeChips = useMemo(() => typeChips("spell", cards, p.packCards, filter.type), [cards, p.packCards, filter.type]);
    const trapTypeChips = useMemo(() => typeChips("trap", cards, p.packCards, filter.type), [cards, p.packCards, filter.type]);
    const toggleType = (k: string) => onFilter({ ...filter, type: toggled(filter.type, k) });
    const archChips = useMemo(() => archetypeChips(cards, p.packCards, filter.arch), [cards, p.packCards, filter.arch]);

    const rows = useMemo(() => {
      const out: Array<{ key: string; heading?: React.ReactNode; kind?: Kind; count: number; rows: Row[] }> = [];
      const sorted = orderEntries(shown, order);
      const rowFor = (e: (typeof shown)[number]): Row => ({
        key: `mine:${e.card.id}:${e.index}`,
        group: [{ card: e.card, kind: e.kind, info: pickInfo(e.index, pickConfig) }],
      });
      if (order === "oldest" || order === "newest") {
        const groups = new Map<string, typeof shown>();
        sorted.forEach((e) => {
          const info = pickInfo(e.index, pickConfig);
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
        const grouped = groupCopies(g);
        out.push({
          key: k,
          heading: KIND_LABEL[k],
          kind: k,
          count: g.length,
          rows: grouped.map((grp, i) => ({
            key: `mine:${grp[0].card.id}:${i}`,
            group: grp.map((e) => ({
              card: e.card,
              kind: e.kind,
              info: pickInfo(e.index, pickConfig),
            })),
          })),
        });
      });
      return out;
    }, [shown, order, theme, pickConfig]);

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
      p.onPeek({ card: row.card, tag: readerTag(row.info) });
    };

    const clearAll = useCallback(() => {
      clearTimeout(timer.current);
      setText("");
      onFilter(EMPTY_FILTER);
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
    ) : (
      `${list.length} of ${p.target} picked`
    );

    const bar = list.length ? (
      KINDS.map((k) => <i key={k} data-kind={k} style={{ "--n": counts[k] } as React.CSSProperties} />)
    ) : (
      <i className="rest" style={{ "--n": 1 } as React.CSSProperties} />
    );

    return (
      <aside className="binder" id="binder" aria-labelledby="binderTitle">
        <div className="bd-head">
          <h3 className="bd-title" id="binderTitle">
            Your picks <b aria-hidden="true">{p.pool.length}</b>
          </h3>
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
              <ChipRow label="Monster type" group="type" chips={monsterTypeChips} selected={filter.type} nameOf={typeKeyName} onToggle={toggleType} />
              <ChipRow
                label="Attribute"
                group="attr"
                chips={chips}
                selected={filter.attr}
                nameOf={titleCase}
                dotOf={attributeTint}
                onToggle={(k) => onFilter({ ...filter, attr: toggled(filter.attr, k) })}
              />
              <ChipRow label="Spells" group="type" chips={spellTypeChips} selected={filter.type} nameOf={typeKeyName} onToggle={toggleType} />
              <ChipRow label="Traps" group="type" chips={trapTypeChips} selected={filter.type} nameOf={typeKeyName} onToggle={toggleType} />
              <ChipRow
                label="Archetype"
                group="arch"
                chips={archChips}
                selected={filter.arch}
                onToggle={(k) => onFilter({ ...filter, arch: toggled(filter.arch, k) })}
              />
            </div>
          </div>
          <div className="bd-bar">
            <span className="showing">{showingText}</span>
            <div className="seg" role="group" aria-label="Sort">
              <button type="button" aria-pressed={order === "type"} onClick={() => pickOrder("type")}>
                By type
              </button>
              <button type="button" aria-pressed={order === "oldest"} onClick={() => pickOrder("oldest")}>
                In order
              </button>
            </div>
          </div>
          <div
            className="list"
            id="list"
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
              <p className="empty">Your picks land here as you draft.</p>
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
                      if (order === "oldest" || order === "newest") {
                        right = (
                          <span className="rs">
                            <span className="no">{theme ? `Round ${e.info.step}` : `Pick ${e.info.step}`}</span>
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
                      const isNew = p.newId != null && row.group.some((g) => g.card.id === p.newId);
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
          <div className="bd-foot">
            <button
              type="button"
              className="bd-export"
              disabled={p.pool.length === 0}
              onClick={() => {
                const name = p.draftName.replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, "").trim() || "Draft";
                downloadYdk(p.pool.map((card) => ({ id: card.passcode, frameType: card.frameType })), `${name} picks.ydk`);
              }}
            >
              Export YDK
            </button>
          </div>
        </div>
      </aside>
    );
  }),
);

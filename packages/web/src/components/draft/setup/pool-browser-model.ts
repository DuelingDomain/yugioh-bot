/**
 * The pool browser's rules, kept free of React so they can be tested on their own.
 *
 * A pool is a Map of passcode to copies, one for the Main lane and one for the Extra lane. Everything here takes those
 * maps (plus a way to look a card up) and returns plain data: entries, filtered and sorted entries, groups, tallies,
 * the flat list of virtual rows, and keyboard moves between cards. All counts are copy-weighted: a card with 3 copies
 * counts three times in a type chip or a level bar, and once in a "different cards" count.
 */

import { cardImageUrl } from "@/lib/card-image-url";
import {
  isExtraDeckMonster,
  isMonster,
  isSpell,
  isTrap,
  tributeTierForLevel,
  type CardSummary,
  type TributeTier,
} from "@/lib/card-types";

/** What the browser and the inspector need to know about a card. A `CardSummary` fits. Only id, name, type and frame are required. */
export type PoolCard = Pick<CardSummary, "id" | "name" | "type" | "frameType"> &
  Partial<Pick<CardSummary, "attribute" | "level" | "atk" | "def" | "effectText" | "imageUrl" | "imageUrlSmall">>;

export type PoolLane = "main" | "extra";
/** "split" shows both lanes side by side. */
export type PoolLaneView = PoolLane | "split";
export type PoolCopies = ReadonlyMap<number, number>;
export type PoolLayout = "grid" | "list";

/** Callbacks that change a pool. Leave `onStep` out and the browser and inspector are read-only. */
export interface PoolEditActions {
  /** One more (+1) or one fewer (-1) copy. A step to 0 removes the card. */
  onStep?: (id: number, delta: number, lane: PoolLane) => void;
  /** Set the copies directly, from the inspector's number field. */
  onSetCopies?: (id: number, copies: number, lane: PoolLane) => void;
  /** Take the card out of the pool. When missing, a step down by the copies is used. */
  onRemove?: (id: number, lane: PoolLane) => void;
}

export const MAX_POOL_COPIES = 99;

/* ---------- card groups ---------- */

export type CardGroup = "monster" | "spell" | "trap" | "fusion" | "synchro" | "xyz" | "link" | "other" | "unknown";

export const MAIN_GROUPS: readonly CardGroup[] = ["monster", "spell", "trap"];
export const EXTRA_GROUPS: readonly CardGroup[] = ["fusion", "synchro", "xyz", "link"];
const GROUP_ORDER: readonly CardGroup[] = [...MAIN_GROUPS, ...EXTRA_GROUPS, "other", "unknown"];

export const GROUP_LABEL: Record<CardGroup, string> = {
  monster: "Monsters",
  spell: "Spells",
  trap: "Traps",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  link: "Link",
  other: "Other",
  unknown: "Details loading",
};
/** Singular, for the type chips. */
export const GROUP_CHIP: Record<CardGroup, string> = {
  monster: "Monster",
  spell: "Spell",
  trap: "Trap",
  fusion: "Fusion",
  synchro: "Synchro",
  xyz: "Xyz",
  link: "Link",
  other: "Other",
  unknown: "Loading",
};

/** The CSS color token of a group. The Extra groups are defined by the browser's stylesheet. */
export const GROUP_COLOR: Record<CardGroup, string> = {
  monster: "var(--k-mon)",
  spell: "var(--k-spell)",
  trap: "var(--k-trap)",
  fusion: "var(--k-fusion, #b583e8)",
  synchro: "var(--k-synchro, #e9ecf5)",
  xyz: "var(--k-xyz, #8e96b3)",
  link: "var(--k-link, #5ba4ff)",
  other: "var(--ink-3)",
  unknown: "var(--ink-4)",
};

export function cardGroup(card: Pick<PoolCard, "type" | "frameType"> | undefined): CardGroup {
  if (!card) return "unknown";
  if (isSpell(card.type)) return "spell";
  if (isTrap(card.type)) return "trap";
  if (isExtraDeckMonster(card)) {
    const frame = card.frameType.trim().toLowerCase();
    const type = card.type.toLowerCase();
    for (const g of EXTRA_GROUPS) {
      if (frame === g || frame.startsWith(`${g}_`) || new RegExp(`\\b${g}\\b`).test(type)) return g;
    }
  }
  return isMonster(card.type) ? "monster" : "other";
}

/** Level, or Rank for an Xyz monster. Link monsters have no level in the catalog. */
export function levelWord(card: Pick<PoolCard, "frameType">): "Level" | "Rank" {
  const frame = card.frameType.trim().toLowerCase();
  return frame === "xyz" || frame.startsWith("xyz_") ? "Rank" : "Level";
}

/* ---------- entries ---------- */

export interface PoolEntry {
  id: number;
  copies: number;
  lane: PoolLane;
  card: PoolCard | undefined;
  group: CardGroup;
  /** Position in the pool map: later means added more recently. */
  order: number;
}

/** One entry per different card, in the map's order. Entries with fewer than 1 copy are left out. */
export function entriesOf(pool: PoolCopies | undefined, lane: PoolLane, getCard: (id: number) => PoolCard | undefined): PoolEntry[] {
  const out: PoolEntry[] = [];
  if (!pool) return out;
  let order = 0;
  for (const [id, copies] of pool) {
    order += 1;
    if (!(copies >= 1)) continue;
    const card = getCard(id);
    out.push({ id, copies, lane, card, group: cardGroup(card), order });
  }
  return out;
}

export function nameOf(entry: Pick<PoolEntry, "id" | "card">): string {
  return entry.card?.name ?? `Card ${entry.id}`;
}

export interface LaneSummary {
  /** Copies, the number the draft deals from. */
  copies: number;
  /** Different cards. */
  distinct: number;
}

export function summarize(entries: readonly PoolEntry[]): LaneSummary {
  let copies = 0;
  for (const e of entries) copies += e.copies;
  return { copies, distinct: entries.length };
}

/* ---------- filters and sorting ---------- */

export type CopiesFilter = "all" | "single" | "multi" | "three";
export type TributeFilter = "any" | TributeTier;

export interface PoolFilters {
  query: string;
  /** One type chip, or "all". */
  chip: CardGroup | "all";
  copies: CopiesFilter;
  tribute: TributeFilter;
}

export const NO_FILTERS: PoolFilters = { query: "", chip: "all", copies: "all", tribute: "any" };

export function filtersActive(f: PoolFilters): boolean {
  return f.query.trim() !== "" || f.chip !== "all" || f.copies !== "all" || f.tribute !== "any";
}

/** Matches the name, the type line and the passcode, without regard to case. */
export function matchesQuery(entry: PoolEntry, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  const hay = `${nameOf(entry)} ${entry.card?.type ?? ""} ${entry.id}`.toLowerCase();
  return q.split(/\s+/).every((word) => hay.includes(word));
}

export function filterEntries(entries: readonly PoolEntry[], f: PoolFilters): PoolEntry[] {
  return entries.filter((e) => {
    if (f.chip !== "all" && e.group !== f.chip) return false;
    if (f.copies === "single" && e.copies !== 1) return false;
    if (f.copies === "multi" && e.copies < 2) return false;
    if (f.copies === "three" && e.copies < 3) return false;
    if (f.tribute !== "any") {
      if (e.group !== "monster" || tributeTierForLevel(e.card?.level) !== f.tribute) return false;
    }
    return matchesQuery(e, f.query);
  });
}

export type PoolSortBy = "added" | "name" | "level" | "copies";

const byName = (a: PoolEntry, b: PoolEntry) => nameOf(a).localeCompare(nameOf(b)) || a.id - b.id;

export function sortEntries(entries: readonly PoolEntry[], by: PoolSortBy): PoolEntry[] {
  const out = [...entries];
  switch (by) {
    case "name":
      return out.sort(byName);
    case "level":
      // Cards with a level first, low to high; spells, traps and Link monsters follow.
      return out.sort((a, b) => (a.card?.level ?? 99) - (b.card?.level ?? 99) || byName(a, b));
    case "copies":
      return out.sort((a, b) => b.copies - a.copies || byName(a, b));
    default:
      return out.sort((a, b) => b.order - a.order);
  }
}

/* ---------- grouping ---------- */

export type PoolGroupBy = "type" | "subtype" | "level" | "none";

export interface PoolSection {
  key: string;
  label: string;
  /** Sets the color bar. */
  group: CardGroup;
  copies: number;
  entries: PoolEntry[];
}

/**
 * Splits entries into sections, keeping the order the entries came in within each section.
 * type: Monsters / Spells / Traps (or Fusion / Synchro ...). subtype: the card's own type line, biggest first.
 * level: Level 1, 2, ... then Spells and Traps. none: one section.
 */
export function groupEntries(entries: readonly PoolEntry[], by: PoolGroupBy, lane: PoolLane): PoolSection[] {
  const map = new Map<string, PoolSection & { ord: number }>();
  const put = (key: string, label: string, group: CardGroup, ord: number, e: PoolEntry) => {
    let s = map.get(key);
    if (!s) {
      s = { key, label, group, copies: 0, entries: [], ord };
      map.set(key, s);
    }
    s.entries.push(e);
    s.copies += e.copies;
  };
  for (const e of entries) {
    if (by === "none") {
      put("all", "All cards", e.group, 0, e);
    } else if (by === "subtype") {
      const type = e.card?.type.trim() || "";
      put(`t:${type.toLowerCase()}`, type || GROUP_LABEL.unknown, e.group, 0, e);
    } else if (by === "level") {
      const level = e.card?.level;
      if (level && (e.group === "monster" || EXTRA_GROUPS.includes(e.group))) {
        const word = lane === "extra" ? "Level / Rank" : "Level";
        put(`L${level}`, `${word} ${level}`, lane === "extra" ? e.group : "monster", level, e);
      } else if (e.group === "spell" || e.group === "trap") {
        put("st", "Spells & Traps", e.group, 99, e);
      } else {
        put("nolevel", e.group === "unknown" ? GROUP_LABEL.unknown : "No level", e.group, 98, e);
      }
    } else {
      put(e.group, GROUP_LABEL[e.group], e.group, GROUP_ORDER.indexOf(e.group), e);
    }
  }
  const sections = [...map.values()];
  if (by === "subtype") sections.sort((a, b) => b.copies - a.copies || a.label.localeCompare(b.label));
  else sections.sort((a, b) => a.ord - b.ord);
  return sections.map(({ ord: _ord, ...s }) => s);
}

/* ---------- strips ---------- */

/** Copies per group. */
export function tallyGroups(entries: readonly PoolEntry[]): Record<CardGroup, number> {
  const t = Object.fromEntries(GROUP_ORDER.map((g) => [g, 0])) as Record<CardGroup, number>;
  for (const e of entries) t[e.group] += e.copies;
  return t;
}

/** The groups a lane view offers as chips. */
export function chipGroups(view: PoolLaneView): readonly CardGroup[] {
  return view === "main" ? MAIN_GROUPS : view === "extra" ? EXTRA_GROUPS : [...MAIN_GROUPS, ...EXTRA_GROUPS];
}

export const CURVE_LEVELS = 12;

/**
 * Copies per level 1..12 (index 0 is level 1; higher levels count in 12). The Main lane counts monsters; the Extra lane
 * counts every card that has a level or rank. Link monsters have none.
 */
export function levelCurve(entries: readonly PoolEntry[], lane: PoolLane): { counts: number[]; max: number } {
  const counts = new Array<number>(CURVE_LEVELS).fill(0);
  for (const e of entries) {
    const level = e.card?.level;
    if (!level || level < 1) continue;
    if (lane === "main" && e.group !== "monster") continue;
    if (lane === "extra" && !EXTRA_GROUPS.includes(e.group)) continue;
    counts[Math.min(CURVE_LEVELS, level) - 1] += e.copies;
  }
  return { counts, max: Math.max(0, ...counts) };
}

/* ---------- virtual rows ---------- */

export type PoolRow =
  | { kind: "header"; key: string; section: PoolSection; collapsed: boolean }
  | { kind: "cards"; key: string; entries: PoolEntry[] };

/** Flattens sections into one list of rows: a header, then the section's cards `perRow` at a time. Collapsed sections keep only the header. */
export function layoutRows(sections: readonly PoolSection[], perRow: number, isCollapsed: (key: string) => boolean): PoolRow[] {
  const size = Math.max(1, Math.floor(perRow));
  const rows: PoolRow[] = [];
  for (const section of sections) {
    const collapsed = isCollapsed(section.key);
    rows.push({ kind: "header", key: `h:${section.key}`, section, collapsed });
    if (collapsed) continue;
    for (let i = 0; i < section.entries.length; i += size) {
      rows.push({ kind: "cards", key: `c:${section.key}:${i / size}`, entries: section.entries.slice(i, i + size) });
    }
  }
  return rows;
}

export interface RowSpot {
  /** Index into the rows array. */
  row: number;
  col: number;
}

export function findInRows(rows: readonly PoolRow[], id: number): RowSpot | null {
  for (let row = 0; row < rows.length; row += 1) {
    const r = rows[row];
    if (r.kind !== "cards") continue;
    const col = r.entries.findIndex((e) => e.id === id);
    if (col >= 0) return { row, col };
  }
  return null;
}

/** Card ids in the order they are shown. */
export function idsInRows(rows: readonly PoolRow[]): number[] {
  const ids: number[] = [];
  for (const r of rows) if (r.kind === "cards") for (const e of r.entries) ids.push(e.id);
  return ids;
}

export type NavKey = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

/**
 * Where an arrow key goes from card `id`. Left and right walk the cards in order (across sections); up and down move
 * to the same column of the previous or next row of cards (the last card when that row is shorter). Returns the target
 * card and its row, or the same card at the ends, or null when `id` is not shown.
 */
export function navigate(rows: readonly PoolRow[], id: number, key: NavKey): { id: number; row: number } | null {
  const spot = findInRows(rows, id);
  if (!spot) return null;
  const cardRows: number[] = [];
  rows.forEach((r, i) => {
    if (r.kind === "cards") cardRows.push(i);
  });
  const at = (row: number, col: number) => {
    const r = rows[row] as Extract<PoolRow, { kind: "cards" }>;
    return { id: r.entries[Math.min(col, r.entries.length - 1)].id, row };
  };
  const here = cardRows.indexOf(spot.row);
  switch (key) {
    case "Home":
      return at(cardRows[0], 0);
    case "End":
      return at(cardRows[cardRows.length - 1], Number.MAX_SAFE_INTEGER);
    case "ArrowLeft":
      if (spot.col > 0) return at(spot.row, spot.col - 1);
      return here > 0 ? at(cardRows[here - 1], Number.MAX_SAFE_INTEGER) : at(spot.row, spot.col);
    case "ArrowRight": {
      const r = rows[spot.row] as Extract<PoolRow, { kind: "cards" }>;
      if (spot.col < r.entries.length - 1) return at(spot.row, spot.col + 1);
      return here < cardRows.length - 1 ? at(cardRows[here + 1], 0) : at(spot.row, spot.col);
    }
    case "ArrowUp":
      return here > 0 ? at(cardRows[here - 1], spot.col) : at(spot.row, spot.col);
    default:
      return here < cardRows.length - 1 ? at(cardRows[here + 1], spot.col) : at(spot.row, spot.col);
  }
}

/** The card to focus when `id` just left the rows: the one after it, else the one before it. */
export function neighborAfterRemoval(before: readonly number[], after: readonly number[], id: number): number | null {
  const at = before.indexOf(id);
  if (at < 0 || after.length === 0) return null;
  const present = new Set(after);
  for (let i = at + 1; i < before.length; i += 1) if (present.has(before[i])) return before[i];
  for (let i = at - 1; i >= 0; i -= 1) if (present.has(before[i])) return before[i];
  return after[0];
}

/* ---------- sizes ---------- */

export const CARD_RATIO = 614 / 421;
export const GRID_GAP = 8;
export const HEADER_HEIGHT = 40;
export const LIST_ROW_HEIGHT = 54;
export const LIST_GAP = 2;

export interface GridMetrics {
  perRow: number;
  /** Width of a tile (grid) or a row cell (list), in px. */
  cellWidth: number;
  /** Height of a row of cards including the gap under it. */
  rowHeight: number;
  /** Height of a tile or list row alone. */
  cellHeight: number;
}

/** Columns and sizes for a scroll area `inner` px wide. Grid: as many tiles of at least `tileMin` px as fit. List: two columns when wide. */
export function gridMetrics(layout: PoolLayout, inner: number, tileMin: number): GridMetrics {
  const width = Math.max(0, inner);
  if (layout === "list") {
    const perRow = width >= 640 ? 2 : 1;
    const cellWidth = (width - (perRow - 1) * 14) / perRow;
    return { perRow, cellWidth, cellHeight: LIST_ROW_HEIGHT, rowHeight: LIST_ROW_HEIGHT + LIST_GAP };
  }
  const perRow = Math.max(1, Math.floor((width + GRID_GAP) / (Math.max(40, tileMin) + GRID_GAP)));
  const cellWidth = (width - (perRow - 1) * GRID_GAP) / perRow;
  const cellHeight = Math.round(cellWidth * CARD_RATIO);
  return { perRow, cellWidth, cellHeight, rowHeight: cellHeight + GRID_GAP };
}

/* ---------- copy ---------- */

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function countsLine(copies: number, distinct: number): string {
  return `${plural(copies, "card")} · ${distinct} unique`;
}

export function copiesLabel(copies: number): string {
  return plural(copies, "copy", "copies");
}

/** The small card image for a passcode. */
export function tileImage(id: number): string {
  return cardImageUrl(id, "small");
}

/** The full card image for a passcode. */
export function fullImage(id: number): string {
  return cardImageUrl(id, "full");
}

/** The stat boxes of the inspector: ATK, DEF and level for a monster; type and deck for a spell or trap. */
export function statFacts(card: PoolCard | undefined, lane: PoolLane | null): Array<{ label: string; value: string }> {
  const deck = lane === "extra" ? "Extra" : lane === "main" ? "Main" : "-";
  if (!card) return [{ label: "Deck", value: deck }];
  const group = cardGroup(card);
  if (group === "spell" || group === "trap") {
    return [
      { label: "Type", value: GROUP_CHIP[group] },
      { label: "Deck", value: deck },
    ];
  }
  if (group === "other" || group === "unknown") return [{ label: "Deck", value: deck }];
  const q = (n: number | undefined) => (n === undefined || n === null ? "?" : String(n));
  const facts = [{ label: "ATK", value: q(card.atk) }];
  if (group !== "link") facts.push({ label: "DEF", value: q(card.def) });
  if (card.level) facts.push({ label: levelWord(card), value: String(card.level) });
  return facts;
}

/** Card text as paragraphs. A line like "[ Monster Effect ]" is a heading. */
export function textBlocks(text: string | undefined): Array<{ heading: boolean; text: string }> {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const m = /^\[\s*(.+?)\s*\]$/.exec(l);
      return m ? { heading: true, text: m[1] } : { heading: false, text: l };
    });
}

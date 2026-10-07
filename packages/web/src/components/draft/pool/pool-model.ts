/**
 * The pool editor's rules, kept free of React so they can be tested on their own.
 *
 * A pool is a Map of passcode to copies. The draft config stores it as `customCardIds`, one entry per copy.
 * Copies run from 1 to 99; the per-player cap of 3 is applied when packs are dealt, not here. What decides how many
 * players a pool can seat is its total copies (the deal needs players x packs per player x pack size copies).
 */

import { cardImageUrl } from "@/lib/card-image-url";
import { isExtraDeckMonster, isMonster, isSpell, isTrap, type CardSummary } from "@/lib/card-types";
import type { ListCorrection } from "@/lib/card-list-import";

export const MAX_COPIES = 99;
/** Copies a whole archetype or a single searched card starts with. Same default as the cube editor. */
export const DEFAULT_COPIES = 3;
/** The table size the rail checks the pool against. */
export const TARGET_PLAYERS = 8;

export type Pool = Map<number, number>;
/** The two pools of a cube draft: the main packs, and the one Extra Deck pack each player gets after them. */
export type Lane = "main" | "extra";
export type CardInfo = Pick<CardSummary, "id" | "name" | "type" | "frameType" | "imageUrlSmall" | "imageUrl">;

export type Kind = "monster" | "spell" | "trap";
export type KindFilter = "all" | Kind;

export interface PoolSource {
  cubeId: number;
  cubeName: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ---------- conversions ---------- */

export function clampCopies(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_COPIES, Math.max(1, Math.trunc(n)));
}

/** Passcodes with repeats (one per copy) to a pool. Repeats count as copies. */
export function poolFromIds(ids: Iterable<number>): Pool {
  const pool: Pool = new Map();
  for (const id of ids) pool.set(id, clampCopies((pool.get(id) ?? 0) + 1));
  return pool;
}

export function poolFromEntries(entries: Iterable<{ id: number; copies: number }>): Pool {
  const pool: Pool = new Map();
  for (const { id, copies } of entries) {
    if (!Number.isInteger(id) || id <= 0 || !(copies >= 1)) continue;
    pool.set(id, clampCopies((pool.get(id) ?? 0) + copies));
  }
  return pool;
}

/** One entry per copy, cards in the order they were added. This is what the draft config stores as `customCardIds`. */
export function poolToIds(pool: Pool): number[] {
  const ids: number[] = [];
  for (const [id, copies] of pool) for (let i = 0; i < copies; i += 1) ids.push(id);
  return ids;
}

export function poolToEntries(pool: Pool): Array<{ id: number; copies: number }> {
  return Array.from(pool, ([id, copies]) => ({ id, copies }));
}

export function totalCopies(pool: Pool): number {
  let total = 0;
  for (const copies of pool.values()) total += copies;
  return total;
}

export function distinctCount(pool: Pool): number {
  return pool.size;
}

/* ---------- editing ---------- */

/** One more or one fewer copy. Going to 0 removes the card; going past 99 stays at 99. Returns a new pool. */
export function stepCopies(pool: Pool, id: number, delta: number): Pool {
  const current = pool.get(id);
  if (current === undefined) return pool;
  const next = current + delta;
  const out = new Map(pool);
  if (next <= 0) out.delete(id);
  else out.set(id, Math.min(MAX_COPIES, next));
  return out;
}

export function removeCard(pool: Pool, id: number): Pool {
  if (!pool.has(id)) return pool;
  const out = new Map(pool);
  out.delete(id);
  return out;
}

export function setCopies(pool: Pool, id: number, copies: number): Pool {
  const out = new Map(pool);
  out.set(id, clampCopies(copies));
  return out;
}

export interface AddItem {
  card: Pick<CardSummary, "id" | "type" | "frameType">;
  /** Copies to give the card when it is new to the pool. */
  copies: number;
}

export interface AddOutcome {
  pool: Pool;
  /** The Extra pool, with any Extra Deck cards the batch brought. */
  extra: Pool;
  /** Distinct main-deck cards that were new to the pool. */
  added: number;
  /** Distinct Extra Deck cards that were new to the Extra pool. */
  extraAdded: number;
  /** Cards (main or Extra) that were already in their pool; their copies are left alone. */
  alreadyIn: number;
}

/**
 * Adds a batch of resolved cards (a set, an archetype). Extra Deck monsters go to the Extra pool and the rest to the
 * main pool; cards already in a pool keep the copies they have.
 */
export function mergeAdd(pool: Pool, items: AddItem[], extra: Pool = new Map()): AddOutcome {
  const out: Pool = new Map(pool);
  const outExtra: Pool = new Map(extra);
  let added = 0;
  let extraAdded = 0;
  let alreadyIn = 0;
  const seen = new Set<number>();
  for (const { card, copies } of items) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    const lane = isExtraDeckMonster(card) ? outExtra : out;
    if (lane.has(card.id)) {
      alreadyIn += 1;
    } else {
      lane.set(card.id, clampCopies(copies));
      if (lane === outExtra) extraAdded += 1;
      else added += 1;
    }
  }
  return { pool: out, extra: outExtra, added, extraAdded, alreadyIn };
}

/** Adds one copy of one card, up to 99. `changed` is false when the card is already at the cap. */
export function addOneCopy(pool: Pool, id: number): { pool: Pool; changed: boolean } {
  const current = pool.get(id) ?? 0;
  if (current >= MAX_COPIES) return { pool, changed: false };
  const out = new Map(pool);
  out.set(id, current + 1);
  return { pool: out, changed: true };
}

/* ---------- list imports ---------- */

/** One entry of the resolved list, as `/api/cards/resolve` returns it. */
export interface ListEntry {
  id: number;
  copies: number;
  pool: Lane;
}

/** What one import added, kept so "Remove" can take out exactly those copies. Gains are after the 99 cap. */
export interface ImportRecord {
  key: number;
  /** The file name, or "Pasted list". */
  label: string;
  main: ReadonlyMap<number, number>;
  extra: ReadonlyMap<number, number>;
  corrected: ListCorrection[];
  unknown: string[];
}

export interface ImportOutcome {
  main: Pool;
  extra: Pool;
  gainedMain: Map<number, number>;
  gainedExtra: Map<number, number>;
}

/** Every copy of a list goes to the pool the server chose for it. A card keeps at most 99 copies. */
export function applyListEntries(main: Pool, extra: Pool, entries: Iterable<ListEntry>): ImportOutcome {
  const out = { main: new Map(main), extra: new Map(extra) };
  const gained = { main: new Map<number, number>(), extra: new Map<number, number>() };
  for (const { id, copies, pool } of entries) {
    if (!Number.isInteger(id) || id <= 0 || !(copies >= 1)) continue;
    const lane = pool === "extra" ? "extra" : "main";
    const current = out[lane].get(id) ?? 0;
    const next = Math.min(MAX_COPIES, current + Math.trunc(copies));
    if (next === current) continue;
    out[lane].set(id, next);
    gained[lane].set(id, (gained[lane].get(id) ?? 0) + (next - current));
  }
  return { main: out.main, extra: out.extra, gainedMain: gained.main, gainedExtra: gained.extra };
}

/** Takes copies out of a pool, never below 0. `gains` is what the import ledger says the import still owns. */
export function subtractGains(pool: Pool, gains: ReadonlyMap<number, number>): Pool {
  let out: Pool | null = null;
  for (const [id, gain] of gains) {
    const current = pool.get(id);
    if (current === undefined) continue;
    out ??= new Map(pool);
    const next = current - Math.min(current, gain);
    if (next <= 0) out.delete(id);
    else out.set(id, next);
  }
  return out ?? pool;
}

export function sumGains(gains: ReadonlyMap<number, number>): number {
  let total = 0;
  for (const n of gains.values()) total += n;
  return total;
}

/** "Fusions.txt - 120 cards (95 Main, 25 Extra) - 2 names corrected - 1 line skipped". Zero parts are left out. */
export function importLine(entry: Pick<ImportRecord, "label" | "main" | "extra" | "corrected" | "unknown">): string {
  const main = sumGains(entry.main);
  const extra = sumGains(entry.extra);
  const parts = [entry.label, `${plural(main + extra, "card")} (${main} Main, ${extra} Extra)`];
  if (entry.corrected.length > 0) parts.push(`${plural(entry.corrected.length, "name")} corrected`);
  if (entry.unknown.length > 0) parts.push(`${plural(entry.unknown.length, "line")} skipped`);
  return parts.join(" - ");
}

/** The label of the next unnamed paste: "Pasted list", then "Pasted list 2" ... so stacked entries stay apart. */
export function pasteLabel(existing: Iterable<string>): string {
  const names = new Set(existing);
  if (!names.has("Pasted list")) return "Pasted list";
  let n = 2;
  while (names.has(`Pasted list ${n}`)) n += 1;
  return `Pasted list ${n}`;
}

/* ---------- comparing with the starting point ---------- */

export interface PoolDiff {
  /** Copies the pool has that the starting point does not. */
  added: number;
  /** Copies the starting point has that the pool does not. */
  removed: number;
  /** Cards whose copies differ, including new and removed ones. */
  changedIds: number[];
  /** Cards in the starting point that are gone from the pool. */
  goneIds: number[];
  any: boolean;
}

export function diffPools(base: Pool, pool: Pool): PoolDiff {
  let added = 0;
  let removed = 0;
  const changedIds: number[] = [];
  const goneIds: number[] = [];
  for (const [id, n] of pool) {
    const b = base.get(id) ?? 0;
    if (n > b) added += n - b;
    else if (n < b) removed += b - n;
    if (n !== b) changedIds.push(id);
  }
  for (const [id, b] of base) {
    if (!pool.has(id)) {
      removed += b;
      goneIds.push(id);
      changedIds.push(id);
    }
  }
  return { added, removed, changedIds, goneIds, any: added + removed > 0 };
}

/* ---------- kinds and tallies ---------- */

export function kindOf(card: Pick<CardSummary, "type">): Kind | null {
  if (isSpell(card.type)) return "spell";
  if (isTrap(card.type)) return "trap";
  if (isMonster(card.type)) return "monster";
  return null;
}

/** The type line in sentence case: "Effect monster", "Spell card". */
export function kindText(card: Pick<CardSummary, "type">): string {
  const t = card.type.trim();
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1).toLowerCase();
}

export interface PoolTallyCounts {
  total: number;
  monsters: number;
  spells: number;
  traps: number;
}

/** Copies by kind. A card with 3 copies counts three times. Cards whose details are not known yet are only in `total`. */
export function tallyCopies(pool: Pool, info: (id: number) => Pick<CardSummary, "type"> | undefined): PoolTallyCounts {
  const t: PoolTallyCounts = { total: 0, monsters: 0, spells: 0, traps: 0 };
  for (const [id, copies] of pool) {
    t.total += copies;
    const card = info(id);
    const kind = card ? kindOf(card) : null;
    if (kind === "monster") t.monsters += copies;
    else if (kind === "spell") t.spells += copies;
    else if (kind === "trap") t.traps += copies;
  }
  return t;
}

/** Different cards by kind, for the filter chips. */
export function tallyDistinct(pool: Pool, info: (id: number) => Pick<CardSummary, "type"> | undefined): Record<KindFilter, number> {
  const t: Record<KindFilter, number> = { all: pool.size, monster: 0, spell: 0, trap: 0 };
  for (const id of pool.keys()) {
    const card = info(id);
    const kind = card ? kindOf(card) : null;
    if (kind) t[kind] += 1;
  }
  return t;
}

/**
 * The ids to list, filtered, with the changed ones first when `pinned` is given and the rest by name.
 * `pinned` is captured when a card is added or restored, not while stepping, so rows do not jump under the pointer.
 */
export function listRows(
  pool: Pool,
  info: (id: number) => CardInfo | undefined,
  opts: { query: string; filter: KindFilter; pinned: ReadonlySet<number> },
): number[] {
  const q = opts.query.trim().toLowerCase();
  const rows: Array<{ id: number; name: string; pin: boolean }> = [];
  for (const id of pool.keys()) {
    const card = info(id);
    const name = card?.name ?? "";
    if (opts.filter !== "all" && (!card || kindOf(card) !== opts.filter)) continue;
    if (q && !name.toLowerCase().includes(q)) continue;
    rows.push({ id, name, pin: opts.pinned.has(id) });
  }
  rows.sort((a, b) => Number(b.pin) - Number(a.pin) || a.name.localeCompare(b.name) || a.id - b.id);
  return rows.map((r) => r.id);
}

/* ---------- copy ---------- */

export function cardsText(n: number): string {
  return plural(n, "card");
}

/** "Added 34 cards from Blue-Eyes. 6 Extra Deck cards went to the Extra pool. 3 were already in the pool." */
export function addedLine(source: string, o: Pick<AddOutcome, "added" | "alreadyIn" | "extraAdded">): string {
  const parts = [`Added ${plural(o.added, "card")} from ${source}.`];
  if (o.extraAdded > 0) parts.push(`${plural(o.extraAdded, "Extra Deck card")} went to the Extra pool.`);
  if (o.alreadyIn > 0) parts.push(`${o.alreadyIn} ${o.alreadyIn === 1 ? "was" : "were"} already in the pool.`);
  return parts.join(" ");
}

export function addCopyLine(name: string, changed: boolean, lane: Lane = "main"): string {
  if (!changed) return `${name} is already at ${MAX_COPIES} copies.`;
  return lane === "extra" ? `Added 1 copy of ${name} to the Extra pool.` : `Added 1 copy of ${name}.`;
}

/** What a cube's Extra Deck does for the draft. Used when the Extra round is off. */
export function extraNote(extraCount: number): string | null {
  if (extraCount <= 0) return null;
  return `${plural(extraCount, "Extra Deck card")} ${extraCount === 1 ? "stays" : "stay"} out of the main packs. Turn on the Extra Deck round to draft ${extraCount === 1 ? "it" : "them"}.`;
}

/** Cards in the extra pool the round needs: one pack for every player. */
export function extraNeed(players: number, size: number): number {
  return Math.max(0, players) * Math.max(0, size);
}

/**
 * Does the Extra pool cover the Extra Deck round? Every player gets one pack, so it needs players x size copies.
 * Null when the round is off or its size is 0.
 */
export function extraCheck(args: {
  on: boolean;
  size: number;
  total: number;
  players: number;
}): { enough: boolean; supported: number; text: string } | null {
  if (!args.on || args.size <= 0) return null;
  const supported = Math.floor(args.total / args.size);
  const need = extraNeed(args.players, args.size);
  if (args.total >= need) {
    return { enough: true, supported, text: `Extra pool: enough for ${plural(supported, "player")} at ${args.size} cards each.` };
  }
  return {
    enough: false,
    supported,
    text: `Extra pool is too small. ${plural(args.players, "player")} x ${args.size} needs ${need} Extra Deck cards, and the pool has ${args.total}${supported > 0 ? ` (enough for ${plural(supported, "player")})` : ""}. Add ${need - args.total} more.`,
  };
}

/** "24 cards added, 3 removed" or "3 cards removed". */
export function changesText(d: Pick<PoolDiff, "added" | "removed">): string {
  const parts: string[] = [];
  if (d.added > 0) parts.push(`${plural(d.added, "card")} added`);
  if (d.removed > 0) parts.push(d.added > 0 ? `${d.removed} removed` : `${plural(d.removed, "card")} removed`);
  return parts.join(", ");
}

export function editedHeadline(d: Pick<PoolDiff, "added" | "removed">): string {
  const changes = changesText(d);
  return changes ? `Edited for this draft. ${changes}.` : "Edited for this draft.";
}

export const NOT_SAVED_HEADLINE = "Not saved as a cube.";
export const NOT_SAVED_NOTE = "That's fine, the draft keeps its own copy.";

export function untouchedNote(cubeName: string): string {
  return `${cubeName} itself hasn't changed.`;
}

export function notOwnerNote(cubeName: string): string {
  return `Only ${cubeName}'s owner or an admin can change it.`;
}

export function replaceQuestion(cubeName: string, extraEdited = false): string {
  return extraEdited
    ? `Replace ${cubeName}'s main pool with this one? Its Extra pool and other settings stay. Your Extra pool changes stay in this draft.`
    : `Replace ${cubeName}'s main pool with this one? Its Extra pool and other settings stay.`;
}

export function nameTakenError(name: string): string {
  return `A cube named ${name} already exists. Pick another name.`;
}

export function savedLine(cubeName: string): string {
  return `Saved to ${cubeName}`;
}

/** The rail's Pool row: the name and the card count. */
export function railPool(args: { baseName: string | null; edited: boolean; total: number; empty: boolean }): { name: string; count: string } {
  if (args.empty) return { name: "Nothing yet", count: "" };
  const count = cardsText(args.total);
  if (!args.baseName) return { name: "Built for this draft", count };
  return { name: args.edited ? `${args.baseName}, edited` : args.baseName, count };
}

/** How many players this pool can seat, and what is missing to seat the target. The deal needs total copies >= players x cards dealt per player. */
export function seatCheck(
  totalCopies: number,
  perPlayer: number,
  target: number = TARGET_PLAYERS,
): { supported: number; enough: boolean; text: string } {
  const size = Math.max(1, perPlayer);
  const supported = Math.floor(totalCopies / size);
  if (supported >= target) {
    return { supported, enough: true, text: `Enough cards for ${target} players` };
  }
  const missing = target * size - totalCopies;
  return {
    supported,
    enough: false,
    text: `Only enough cards for ${plural(supported, "player")}. Add ${missing} more cards to seat ${target}.`,
  };
}

/** "Goat cube 2", "Goat cube 3", ... for a copy of `base`, or "My cube" from scratch. Compared without regard to case, like the server. */
export function freeCubeName(base: string | null, taken: Iterable<string>): string {
  const names = new Set(Array.from(taken, (n) => n.trim().toLowerCase()));
  if (!base) {
    if (!names.has("my cube")) return "My cube";
    let n = 2;
    while (names.has(`my cube ${n}`)) n += 1;
    return `My cube ${n}`;
  }
  let n = 2;
  while (names.has(`${base} ${n}`.toLowerCase())) n += 1;
  return `${base} ${n}`;
}

/** The count a cube row in the picker shows, or null when the pool still has to be resolved from sets. */
export function cubeCardCount(cube: { mainCopies: number; setNames: string[]; customCardIds: number[] }): number | null {
  if (cube.mainCopies > 0) return cube.mainCopies;
  if (cube.setNames.length === 0) return cube.customCardIds.length;
  return null;
}

/** The small card image for a passcode, from the host the catalog stores. */
export function thumbUrl(id: number): string {
  return cardImageUrl(id, "small");
}

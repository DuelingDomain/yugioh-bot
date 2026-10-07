/**
 * The pool editor's rules, kept free of React so they can be tested on their own.
 *
 * A pool is a Map of passcode to copies. The draft config stores it as `customCardIds`, one entry per copy.
 * Copies run from 1 to 99; the per-player cap of 3 is applied when packs are dealt, not here. What decides how many
 * players a pool can seat is its total copies (the deal needs players x packs per player x pack size copies).
 */

import { cardImageUrl } from "@/lib/card-image-url";
import { isExtraDeckMonster, isMonster, isSpell, isTrap, type CardSummary } from "@/lib/card-types";

export const MAX_COPIES = 99;
/** Copies a whole archetype or a single searched card starts with. Same default as the cube editor. */
export const DEFAULT_COPIES = 3;
/** The table size the rail checks the pool against. */
export const TARGET_PLAYERS = 8;

export type Pool = Map<number, number>;
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
  /** Distinct cards that were new to the pool. */
  added: number;
  /** Cards that were already in the pool; their copies are left alone. */
  alreadyIn: number;
  /** Extra Deck cards that were left out. */
  extraSkipped: number;
}

/**
 * Adds a batch of resolved cards (a set, an archetype, passcodes). Extra Deck cards stay out because cube drafts deal
 * main-deck cards; cards already in the pool keep the copies they have.
 */
export function mergeAdd(pool: Pool, items: AddItem[]): AddOutcome {
  const out: Pool = new Map(pool);
  let added = 0;
  let alreadyIn = 0;
  let extraSkipped = 0;
  const seen = new Set<number>();
  for (const { card, copies } of items) {
    if (seen.has(card.id)) continue;
    seen.add(card.id);
    if (isExtraDeckMonster(card)) {
      extraSkipped += 1;
    } else if (out.has(card.id)) {
      alreadyIn += 1;
    } else {
      out.set(card.id, clampCopies(copies));
      added += 1;
    }
  }
  return { pool: out, added, alreadyIn, extraSkipped };
}

/** Adds one copy of one card, up to 99. `changed` is false when the card is already at the cap. */
export function addOneCopy(pool: Pool, id: number): { pool: Pool; changed: boolean } {
  const current = pool.get(id) ?? 0;
  if (current >= MAX_COPIES) return { pool, changed: false };
  const out = new Map(pool);
  out.set(id, current + 1);
  return { pool: out, changed: true };
}

export interface PasscodesOutcome {
  pool: Pool;
  /** Different cards that gained copies. */
  added: number;
  /** Copies gained in all. */
  copies: number;
  /** Passcodes the card list does not have. */
  unknown: number;
  extraSkipped: number;
  /** Cards that could not take every copy because they reached 99. */
  atCap: number;
}

/**
 * Pasted passcodes: each time a passcode appears it is one more copy, whether or not the card is already in the pool.
 * `cards` are the passcodes the card list knew; the rest are `unknownIds`.
 */
export function mergePasscodes(
  pool: Pool,
  occurrences: ReadonlyMap<number, number>,
  cards: Array<Pick<CardSummary, "id" | "type" | "frameType">>,
  unknownIds: number[],
): PasscodesOutcome {
  const out: Pool = new Map(pool);
  let added = 0;
  let copies = 0;
  let extraSkipped = 0;
  let atCap = 0;
  for (const card of cards) {
    const wanted = occurrences.get(card.id) ?? 0;
    if (wanted <= 0) continue;
    if (isExtraDeckMonster(card)) {
      extraSkipped += 1;
      continue;
    }
    const current = out.get(card.id) ?? 0;
    const next = Math.min(MAX_COPIES, current + wanted);
    if (next === current) {
      atCap += 1;
      continue;
    }
    out.set(card.id, next);
    added += 1;
    copies += next - current;
    if (next - current < wanted) atCap += 1;
  }
  return { pool: out, added, copies, unknown: new Set(unknownIds).size, extraSkipped, atCap };
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

function stayOut(n: number): string {
  return `${plural(n, "Extra Deck card")} ${n === 1 ? "stays" : "stay"} out.`;
}

export function cardsText(n: number): string {
  return plural(n, "card");
}

/** "Added 34 cards from Blue-Eyes. 6 Extra Deck cards stay out. 3 were already in the pool." */
export function addedLine(source: string, o: Pick<AddOutcome, "added" | "alreadyIn" | "extraSkipped">): string {
  const parts = [`Added ${plural(o.added, "card")} from ${source}.`];
  if (o.extraSkipped > 0) parts.push(stayOut(o.extraSkipped));
  if (o.alreadyIn > 0) parts.push(`${o.alreadyIn} ${o.alreadyIn === 1 ? "was" : "were"} already in the pool.`);
  return parts.join(" ");
}

/** The line after pasting passcodes. */
export function passcodesLine(o: {
  added: number;
  copies: number;
  unknown: number;
  extraSkipped: number;
  atCap: number;
  invalid?: number;
}): string {
  const parts = [
    o.copies === o.added
      ? `Added ${plural(o.added, "card")}.`
      : `Added ${plural(o.copies, "copy", "copies")} of ${plural(o.added, "card")}.`,
  ];
  if (o.unknown > 0) parts.push(`${plural(o.unknown, "passcode")} ${o.unknown === 1 ? "isn't" : "aren't"} in the card list yet.`);
  if (o.extraSkipped > 0) parts.push(stayOut(o.extraSkipped));
  if (o.atCap > 0) parts.push(`${plural(o.atCap, "card")} already at ${MAX_COPIES} copies.`);
  if (o.invalid) parts.push(`${plural(o.invalid, "entry", "entries")} ${o.invalid === 1 ? "isn't a passcode" : "aren't passcodes"}.`);
  return parts.join(" ");
}

export function addCopyLine(name: string, changed: boolean): string {
  return changed ? `Added 1 copy of ${name}.` : `${name} is already at ${MAX_COPIES} copies.`;
}

export function extraNote(extraCount: number): string | null {
  if (extraCount <= 0) return null;
  return `${stayOut(extraCount)} Cube drafts deal main-deck cards.`;
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
  return `Only ${cubeName}'s owner can change it.`;
}

export function replaceQuestion(cubeName: string): string {
  return `Replace ${cubeName}'s main pool with this one? Its Extra Deck cards and other settings stay.`;
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

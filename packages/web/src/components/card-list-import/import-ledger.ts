/**
 * Which copies in a pool still belong to a list import.
 *
 * Each import keeps, per card, the copies it added and that are still there (its "remaining gain").
 * When the owner lowers a card by hand, the lost copies are taken from the gains of the newest import first.
 * "Remove" then takes out only what is left of the gain, so it never goes below what the owner chose,
 * and stacked imports can be removed in any order.
 *
 * Keys are strings such as "main:46986414", one per card and pool. The ledger never reads a "before" copy of the pool.
 */

export type LedgerKey = number | string;

export interface LedgerEntry {
  key: LedgerKey;
  /** Copies this import added that are still in the pool, by card key. */
  gains: ReadonlyMap<string, number>;
}

export interface Ledger {
  /** The copies each tracked card had when the ledger last looked. */
  seen: ReadonlyMap<string, number>;
  /** Oldest first. */
  entries: readonly LedgerEntry[];
}

export type CountOf = (cardKey: string) => number;

export const EMPTY_LEDGER: Ledger = { seen: new Map(), entries: [] };

export const cardKey = (pool: "main" | "extra", id: number) => `${pool}:${id}`;

/** Pool counts as a lookup. */
export function countsOf(...pools: Array<["main" | "extra", ReadonlyMap<number, number>]>): CountOf {
  const flat = new Map<string, number>();
  for (const [pool, map] of pools) for (const [id, copies] of map) flat.set(cardKey(pool, id), copies);
  return (key) => flat.get(key) ?? 0;
}

/**
 * Brings the ledger up to the pool as it is now. A card that has fewer copies than the ledger saw was lowered by the
 * owner: that many copies leave the gains, newest import first. A card with more copies only moves the mark up.
 * Call it after every change of the pool, and before a new import is recorded.
 */
export function settle(ledger: Ledger, count: CountOf): Ledger {
  if (ledger.seen.size === 0) return ledger;
  const seen = new Map<string, number>();
  const entries = ledger.entries.map((entry) => ({ key: entry.key, gains: new Map(entry.gains) }));
  let changed = false;
  for (const [key, was] of ledger.seen) {
    const now = count(key);
    if (now < was) {
      let lost = was - now;
      for (let i = entries.length - 1; i >= 0 && lost > 0; i -= 1) {
        const gain = entries[i]!.gains.get(key) ?? 0;
        if (gain <= 0) continue;
        const used = Math.min(gain, lost);
        entries[i]!.gains.set(key, gain - used);
        lost -= used;
      }
    }
    if (now !== was) changed = true;
    seen.set(key, now);
  }
  return changed ? prune({ seen, entries }) : ledger;
}

/** Records one import. `count` is the pool after the import; call `settle` with the pool before it first. */
export function record(ledger: Ledger, key: LedgerKey, gains: ReadonlyMap<string, number>, count: CountOf): Ledger {
  const kept = new Map<string, number>();
  for (const [card, copies] of gains) if (copies > 0) kept.set(card, copies);
  const seen = new Map(ledger.seen);
  for (const card of kept.keys()) seen.set(card, count(card));
  return { seen, entries: [...ledger.entries, { key, gains: kept }] };
}

/** The copies the import still owns, by card key. Never more than the pool holds. */
export function remaining(ledger: Ledger, key: LedgerKey, count?: CountOf): Map<string, number> {
  const entry = ledger.entries.find((e) => e.key === key);
  const out = new Map<string, number>();
  if (!entry) return out;
  for (const [card, copies] of entry.gains) {
    const take = count ? Math.min(copies, count(card)) : copies;
    if (take > 0) out.set(card, take);
  }
  return out;
}

/** The ledger after the import is gone and its remaining copies are out of the pool. */
export function withoutEntry(ledger: Ledger, key: LedgerKey): Ledger {
  const entry = ledger.entries.find((e) => e.key === key);
  if (!entry) return ledger;
  const seen = new Map(ledger.seen);
  for (const [card, copies] of entry.gains) {
    const was = seen.get(card);
    if (was !== undefined) seen.set(card, Math.max(0, was - copies));
  }
  return prune({ seen, entries: ledger.entries.filter((e) => e !== entry) });
}

/** Stops tracking a card when no import owns copies of it any more. */
function prune(ledger: { seen: Map<string, number>; entries: LedgerEntry[] }): Ledger {
  const owned = new Set<string>();
  for (const entry of ledger.entries) for (const [card, copies] of entry.gains) if (copies > 0) owned.add(card);
  const seen = new Map<string, number>();
  for (const [card, copies] of ledger.seen) if (owned.has(card)) seen.set(card, copies);
  return { seen, entries: ledger.entries };
}

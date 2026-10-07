/**
 * What a list import added to a cube.
 * The server does not record imports, so the editor compares the pools before and after one import to find its gains,
 * then tracks them in the import ledger (`card-list-import/import-ledger.ts`) so "Remove" takes out only what is left.
 */

import { cardKey, type CountOf } from "@/components/card-list-import/import-ledger";
import type { CubePoolName, CubePoolsDto } from "@/lib/cube-pools";

/** Copies one import added to one card. */
export interface CubeGain {
  id: number;
  pool: CubePoolName;
  copies: number;
}

const POOLS = ["main", "extra"] as const;

function totals(pools: CubePoolsDto): Map<number, number> {
  const out = new Map<number, number>();
  for (const pool of POOLS) for (const e of pools[pool]) out.set(e.catalogCardId, (out.get(e.catalogCardId) ?? 0) + e.maxCopies);
  return out;
}

/**
 * The copies each card gained between two states of the cube. Only a real rise in copies counts: a card that lost
 * copies, did not change, or only moved from one pool to the other is left out.
 */
export function gainsBetween(before: CubePoolsDto, after: CubePoolsDto): CubeGain[] {
  const gains: CubeGain[] = [];
  const wasTotal = totals(before);
  const rise = new Map(POOLS.map((pool) => [pool, new Map(before[pool].map((e) => [e.catalogCardId, e.maxCopies]))] as const));
  const seenTotal = new Map<number, number>();
  const afterTotal = totals(after);
  for (const pool of POOLS) {
    for (const entry of after[pool]) {
      const id = entry.catalogCardId;
      const poolRise = entry.maxCopies - (rise.get(pool)?.get(id) ?? 0);
      if (poolRise <= 0) continue;
      // The card's total is the limit: copies that moved between pools were there before.
      const room = (afterTotal.get(id) ?? 0) - (wasTotal.get(id) ?? 0) - (seenTotal.get(id) ?? 0);
      const copies = Math.min(poolRise, room);
      if (copies <= 0) continue;
      seenTotal.set(id, (seenTotal.get(id) ?? 0) + copies);
      gains.push({ id, pool, copies });
    }
  }
  return gains;
}

export function gainMap(gains: CubeGain[], pool: CubePoolName): Map<number, number> {
  return new Map(gains.filter((g) => g.pool === pool).map((g) => [g.id, g.copies]));
}

/** The gains as ledger keys. */
export function gainKeys(gains: CubeGain[]): Map<string, number> {
  return new Map(gains.map((g) => [cardKey(g.pool, g.id), g.copies]));
}

/** The pools as a ledger lookup. */
export function poolCounts(pools: CubePoolsDto): CountOf {
  const flat = new Map<string, number>();
  for (const pool of POOLS) for (const e of pools[pool]) flat.set(cardKey(pool, e.catalogCardId), e.maxCopies);
  return (key) => flat.get(key) ?? 0;
}

/** The body of the `subtract` op for the copies an import still owns. */
export function subtractEntries(left: ReadonlyMap<string, number>): Array<{ id: number; copies: number; pool: CubePoolName }> {
  return [...left].map(([key, copies]) => {
    const [pool, id] = key.split(":") as [CubePoolName, string];
    return { id: Number(id), copies, pool };
  });
}

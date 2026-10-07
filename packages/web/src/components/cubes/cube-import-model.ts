/**
 * What a list import added to a cube, and how to take exactly that out again.
 * The server does not record imports, so the editor compares the pools before and after, and keeps the gains.
 */

import type { CubeCardDto, CubePoolName, CubePoolsDto } from "@/lib/cube-pools";

/** Copies one import added to one card. */
export interface CubeGain {
  id: number;
  pool: CubePoolName;
  copies: number;
}

/** The copies each card gained between two states of the cube. A card that lost copies or did not change is left out. */
export function gainsBetween(before: CubePoolsDto, after: CubePoolsDto): CubeGain[] {
  const gains: CubeGain[] = [];
  for (const pool of ["main", "extra"] as const) {
    const was = new Map(before[pool].map((e) => [e.catalogCardId, e.maxCopies]));
    for (const entry of after[pool]) {
      const copies = entry.maxCopies - (was.get(entry.catalogCardId) ?? 0);
      if (copies > 0) gains.push({ id: entry.catalogCardId, pool, copies });
    }
  }
  return gains;
}

export function gainMap(gains: CubeGain[], pool: CubePoolName): Map<number, number> {
  return new Map(gains.filter((g) => g.pool === pool).map((g) => [g.id, g.copies]));
}

export type RemovalOp =
  | { op: "remove"; catalogCardId: number }
  | { op: "setMaxCopies"; catalogCardId: number; maxCopies: number };

export interface RemovalPlan {
  main: RemovalOp[];
  extra: RemovalOp[];
  /** The whole main pool after the removal, for one `replaceMain` call when there are many changes. */
  mainTarget: Array<{ id: number; copies: number }>;
}

/**
 * Lowers each gained card by the copies the import added; a card that falls to 0 is removed.
 * Copies the cube had before the import stay, and a card the owner already lowered or removed is not touched below 0.
 */
export function planRemoval(current: CubePoolsDto, gains: CubeGain[]): RemovalPlan {
  const plan: RemovalPlan = { main: [], extra: [], mainTarget: [] };
  for (const pool of ["main", "extra"] as const) {
    const gained = gainMap(gains, pool);
    for (const entry of current[pool] as CubeCardDto[]) {
      const take = gained.get(entry.catalogCardId) ?? 0;
      const left = entry.maxCopies - take;
      if (take > 0) {
        plan[pool].push(
          left <= 0
            ? { op: "remove", catalogCardId: entry.catalogCardId }
            : { op: "setMaxCopies", catalogCardId: entry.catalogCardId, maxCopies: left },
        );
      }
      if (pool === "main" && left > 0) plan.mainTarget.push({ id: entry.catalogCardId, copies: left });
    }
  }
  return plan;
}

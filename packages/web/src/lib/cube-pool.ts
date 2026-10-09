import type Database from "better-sqlite3";
import { createCardLookupBudget, type CardLookupBudget, type CardCatalogService } from "@yugidraft/shared/services";
import { IMPORT_MAX_DISTINCT, tooManyDistinct } from "./ydk-file";

const MAX_COPIES = 99;

export type PoolEntry = { id: number; copies: number };

/**
 * Validate a `cards` body field: ids are positive integers, copies whole numbers 1..99.
 * Duplicate ids are summed (capped at 99). Returns an error message for a 400.
 */
export function parsePoolEntries(value: unknown): { entries: PoolEntry[] } | { error: string } {
  if (!Array.isArray(value)) return { error: "cards must be a list" };
  const merged = new Map<number, number>();
  for (const item of value) {
    const card = item as { id?: unknown; copies?: unknown } | null;
    if (!card || typeof card !== "object") return { error: "Each card needs an id and copies" };
    if (!Number.isSafeInteger(card.id) || (card.id as number) <= 0) return { error: "Each card needs a valid id" };
    if (!Number.isInteger(card.copies) || (card.copies as number) < 1 || (card.copies as number) > MAX_COPIES) {
      return { error: `Copies must be a whole number from 1 to ${MAX_COPIES}` };
    }
    const id = card.id as number;
    merged.set(id, Math.min(MAX_COPIES, (merged.get(id) ?? 0) + (card.copies as number)));
  }
  if (merged.size > IMPORT_MAX_DISTINCT) return { error: tooManyDistinct(merged.size) };
  return { entries: [...merged].map(([id, copies]) => ({ id, copies })) };
}

/** Warm missing IDs within a request's shared remote budget; unresolved/skipped IDs remain unknown. */
export async function ensureCatalogCards(
  catalog: CardCatalogService,
  ids: number[],
  lookupBudget: CardLookupBudget = createCardLookupBudget(),
): Promise<number[]> {
  const missing = [...new Set(ids)].filter((id) => !catalog.hasCatalogRow(id));
  await catalog.prefetchCardsByIds(missing, { lookupBudget });
  for (const id of missing.filter((id) => !catalog.hasCatalogRow(id))) {
    try {
      await catalog.syncCardById(id, { lookupBudget });
    } catch (error) {
      // A lost connection is a real failure; ordinary unrecognized passcodes remain unknown.
      if (error instanceof Error && error.message.startsWith("Could not reach the card database")) throw error;
    }
  }
  return missing.filter((id) => !catalog.hasCatalogRow(id));
}

/**
 * Validate `config.poolSource` against the cubes in this guild. A valid id is stored with the cube's name
 * from the database; anything else drops the key. Normal extra rounds also use this cube's
 * extra rows when customExtraCardIds is absent. Explicit pools stay self-contained.
 * A config without the key is returned unchanged.
 */
export function sanitizePoolSource<T extends object>(
  db: Database.Database,
  guildId: string | undefined,
  config: T,
): T {
  if (!config || typeof config !== "object" || !("poolSource" in config)) return config;
  const { poolSource, ...rest } = config as T & { poolSource?: unknown };
  const cubeId = (poolSource as { cubeId?: unknown } | null | undefined)?.cubeId;
  if (!guildId || !Number.isSafeInteger(cubeId) || (cubeId as number) <= 0) return rest as T;
  const cube = db.prepare("select name from cubes where id = ? and guild_id = ?").get(cubeId, guildId) as
    | { name: string }
    | undefined;
  return (cube ? { ...rest, poolSource: { cubeId, cubeName: cube.name } } : rest) as T;
}

/**
 * The requests the pool editor makes. Each one returns plain data or throws an Error whose message is fit to show.
 * Kept apart from the hook so the hook reads as state, and so tests can stub `fetch` once.
 */

import type { CardSummary } from "@/lib/card-types";
import { isExtraDeckMonster } from "@/lib/card-types";
import { putCards } from "@/lib/cards-cache";
import { listImportErrorFrom, type ListDiagnostics } from "@/lib/card-list-import";
import { clampCopies, poolFromEntries, poolToIds, type Pool, type PoolSource } from "./pool-model";

export interface CubeOption {
  id: number;
  name: string;
  createdByUserId: string;
  createdByName: string | null;
  canEdit: boolean;
  draftType: string | null;
  /** Different cards in the main pool. */
  mainDistinct: number;
  /** Copies in the main pool. */
  mainCopies: number;
  extraCount: number;
  /** The first cards of the main pool, for the picker's thumbnails. */
  thumbIds: number[];
  /** Config-only cubes (made before cubes held cards) keep their pool here. */
  setNames: string[];
  customCardIds: number[];
}

interface CubeListRow {
  id: number;
  name: string;
  draftType?: string | null;
  createdByUserId?: string;
  createdByName?: string | null;
  canEdit?: boolean;
  extraCount?: number;
  setNames?: string[];
  customCardIds?: number[];
  mainCards?: Array<{ id: number; copies: number }>;
}

async function readError(res: Response, fallback: string): Promise<string> {
  const data = (await res.json().catch(() => ({}))) as { error?: unknown };
  return typeof data.error === "string" && data.error ? data.error : fallback;
}

export async function fetchCubeOptions(): Promise<CubeOption[]> {
  const res = await fetch("/api/cubes");
  if (!res.ok) return [];
  const data = (await res.json()) as { cubes?: CubeListRow[] };
  return (data.cubes ?? []).map((c) => {
    const main = c.mainCards ?? [];
    return {
      id: c.id,
      name: c.name,
      createdByUserId: c.createdByUserId ?? "",
      createdByName: c.createdByName ?? null,
      canEdit: c.canEdit ?? false,
      draftType: c.draftType ?? null,
      mainDistinct: main.length,
      mainCopies: main.reduce((sum, card) => sum + card.copies, 0),
      extraCount: c.extraCount ?? 0,
      thumbIds: main.slice(0, 3).map((card) => card.id),
      setNames: c.setNames ?? [],
      customCardIds: c.customCardIds ?? [],
    };
  });
}

export async function fetchSessionUserId(): Promise<string | null> {
  try {
    const res = await fetch("/api/auth/session");
    if (!res.ok) return null;
    const data = (await res.json()) as { user?: { id?: string } } | null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

export interface Resolved {
  cards: CardSummary[];
  unknownIds: number[];
}

/** Resolves cards through the card list and remembers them. Throws when the card database can't be reached. */
export async function resolveCards(body: {
  setNames?: string[];
  customCardIds?: number[];
  archetype?: string;
  fuzzyName?: string;
  /** With `fuzzyName`: also return Extra Deck monsters (the pool has an Extra pool for them). */
  includeExtra?: boolean;
}): Promise<Resolved> {
  const res = await fetch("/api/cards/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(await readError(res, "The card database may be unreachable."));
  const data = (await res.json()) as { cards?: CardSummary[]; unknownIds?: number[] };
  const cards = data.cards ?? [];
  putCards(cards);
  return { cards, unknownIds: data.unknownIds ?? [] };
}

export interface ResolvedList extends ListDiagnostics {
  cards: CardSummary[];
  entries: Array<{ id: number; copies: number; pool: "main" | "extra" }>;
}

/**
 * Reads a card list (names, passcodes, YDK or a ydke link) through the card list and remembers the cards.
 * Lines that are not cards are not an error: they come back in `unknown`. Writes nothing.
 */
export async function resolveCardList(listText: string): Promise<ResolvedList> {
  const res = await fetch("/api/cards/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ listText }),
  });
  if (!res.ok) throw await listImportErrorFrom(res, "The card database may be unreachable.");
  const data = (await res.json()) as Partial<ResolvedList>;
  const cards = data.cards ?? [];
  putCards(cards);
  return { cards, entries: data.entries ?? [], unknown: data.unknown ?? [], corrected: data.corrected ?? [] };
}

export interface CubeDetail {
  main: Pool;
  extra: Pool;
  extraCount: number;
}

/**
 * A cube's main pool as copies, with its cards remembered. A cube made before cubes held cards can also carry
 * sets and passcodes in its config, and a migrated cube can carry both. The pool is all of them; a card that
 * comes from more than one source keeps the largest count, not the sum.
 */
export async function fetchCubeDetail(cube: Pick<CubeOption, "id" | "setNames" | "customCardIds">): Promise<CubeDetail> {
  const res = await fetch(`/api/cubes/${cube.id}`);
  if (!res.ok) throw new Error(await readError(res, "Couldn't open that cube."));
  const data = (await res.json()) as {
    pools?: { main?: Array<{ catalogCardId: number; maxCopies: number }>; extra?: Array<{ catalogCardId: number; maxCopies: number }> };
    cards?: CardSummary[];
  };
  putCards(data.cards ?? []);
  const main = data.pools?.main ?? [];
  const extraCount = data.pools?.extra?.length ?? 0;
  const copies = new Map<number, number>();
  const take = (id: number, n: number) => {
    if (Number.isInteger(id) && id > 0 && n >= 1) copies.set(id, Math.max(copies.get(id) ?? 0, clampCopies(n)));
  };
  for (const c of main) take(c.catalogCardId, c.maxCopies);
  if (cube.setNames.length > 0) {
    const resolved = await resolveCards({ setNames: cube.setNames });
    for (const c of resolved.cards) if (!isExtraDeckMonster(c)) take(c.id, c.qty ?? 1);
  }
  if (cube.customCardIds.length > 0) {
    const counts = new Map<number, number>();
    for (const id of cube.customCardIds) counts.set(id, (counts.get(id) ?? 0) + 1);
    const resolved = await resolveCards({ customCardIds: Array.from(counts.keys()) });
    for (const c of resolved.cards) if (!isExtraDeckMonster(c)) take(c.id, counts.get(c.id) ?? 1);
  }
  return { main: poolFromEntries(Array.from(copies, ([id, n]) => ({ id, copies: n }))),
    extra: poolFromEntries((data.pools?.extra ?? []).map((c) => ({ id: c.catalogCardId, copies: c.maxCopies }))), extraCount };
}

/** Both authored pools, including extras when the extra round is currently OFF. */
export async function fetchDraftPools(slug: string): Promise<{ main: Pool; extra: Pool }> {
  const res = await fetch(`/api/drafts/${encodeURIComponent(slug)}/pool`);
  if (!res.ok) throw new Error(await readError(res, "Couldn't load the pool."));
  const data = (await res.json()) as { cards?: CardSummary[]; extraCards?: CardSummary[] };
  const cards = data.cards ?? [];
  putCards([...cards, ...(data.extraCards ?? [])]);
  return { main: poolFromEntries(cards.map((c) => ({ id: c.id, copies: c.qty ?? 1 }))),
    extra: poolFromEntries((data.extraCards ?? []).map((c) => ({ id: c.id, copies: c.qty ?? 1 }))) };
}

export interface SavedCube {
  id: number;
  name: string;
}

export class NameTakenError extends Error {}

/** Saves a pool as a real cube. `copyExtraFromCubeId` carries the Extra Deck of the cube the pool started from. */
export async function createPoolCube(args: {
  name: string;
  cards: Array<{ id: number; copies: number }>;
  /** Explicit extra pool (including []); overrides copyExtraFromCubeId. */
  extraCards?: Array<{ id: number; copies: number }>;
  copyExtraFromCubeId?: number;
}): Promise<SavedCube> {
  const res = await fetch("/api/cubes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      kind: "pool",
      name: args.name,
      cards: args.cards,
      ...(args.extraCards !== undefined ? { extraCards: args.extraCards } : {}),
      ...(args.copyExtraFromCubeId !== undefined ? { copyExtraFromCubeId: args.copyExtraFromCubeId } : {}),
    }),
  });
  if (res.status === 409) throw new NameTakenError(await readError(res, "That name is taken."));
  if (!res.ok) throw new Error(await readError(res, "Couldn't save the cube."));
  const data = (await res.json()) as { cube?: { id: number; name: string } };
  if (!data.cube) throw new Error("Couldn't save the cube.");
  return { id: data.cube.id, name: data.cube.name };
}

export async function replaceCubeMain(cubeId: number, cards: Array<{ id: number; copies: number }>): Promise<void> {
  const res = await fetch(`/api/cubes/${cubeId}/cards`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ op: "replaceMain", cards }),
  });
  if (res.status === 403) throw new Error("Only the cube's owner or an admin can change it.");
  if (!res.ok) throw new Error(await readError(res, "Couldn't save the changes."));
}

export interface SetInfo {
  setName: string;
  setCode: string;
  cardCount: number;
}

/** The server matches the text against set names and returns the first 25. */
export async function fetchSets(query = ""): Promise<SetInfo[]> {
  const q = query.trim();
  const res = await fetch(q ? `/api/sets?q=${encodeURIComponent(q)}` : "/api/sets");
  if (!res.ok) throw new Error("Couldn't load the sets.");
  const data = (await res.json()) as { sets?: SetInfo[] };
  return data.sets ?? [];
}

export async function fetchArchetypes(query: string): Promise<string[]> {
  const res = await fetch(`/api/archetypes?query=${encodeURIComponent(query)}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { archetypes?: string[] };
  return (data.archetypes ?? []).slice(0, 8);
}

/** The pool a draft config carries: one passcode per copy, no sets, and the cube it started from. */
export function configPool(pool: Pool, source: PoolSource | null, extra: Pool): {
  setNames: string[];
  customCardIds: number[];
  customExtraCardIds: number[];
  poolSource: PoolSource | null;
} {
  return { setNames: [], customCardIds: poolToIds(pool), customExtraCardIds: poolToIds(extra), poolSource: source };
}

import type Database from "better-sqlite3";
import { NextResponse } from "next/server";
import { createDraftService } from "@yugidraft/shared/services";
import { isExtraDeckMonster } from "@/lib/card-types";
import { normalizeDraftCardCodes } from "@/lib/draft-deck-codes";

/** A draft deck needs at least this many main deck cards (fewer only when the pool has fewer). */
export const DRAFT_MIN_MAIN = 40;

export type DraftPool =
  | {
      ok: true;
      /** Engine passcode -> copies drafted. */
      counts: Map<number, number>;
      /** Canonical engine passcode -> durable forced picks. */
      forcedCopies: Map<number, number>;
      /** Catalog and submitted deck ids -> canonical engine passcodes. */
      codeMap: Map<number, number | null>;
      /** Drafted copies that belong in the main deck. */
      mainPoolCount: number;
      /** YGOPRODeck ids the duel engine does not know; they are not in `counts`. */
      unresolved: number[];
    }
  | { ok: false; response: NextResponse };

/**
 * The player's draft pool as engine passcodes, through the host `normalize-codes` op
 * (in chunks, the host takes at most 1000 ids per call). The one loader for every
 * draft-deck check. The Main/Extra split counts Fusion, Synchro, Xyz and Link
 * Monsters, Pendulum variants included, as Extra Deck; a card missing from the
 * catalog counts as Main.
 */
export async function loadDraftPool(input: {
  db: Database.Database;
  guildId: string;
  playerId: number;
  draftId: number;
  /** Include the saved/submitted deck so both sides of the comparison use the same mapping. */
  deckCodes?: number[];
}): Promise<DraftPool> {
  let picks: Array<{ catalogCardId: number; forced: boolean }>;
  try {
    picks = createDraftService(input.db).pool(input.draftId, input.playerId);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to load the draft pool";
    const status = message === "Player has not joined this draft" ? 403 : 404;
    return { ok: false, response: NextResponse.json({ error: message }, { status }) };
  }

  const ids = [...new Set(picks.map((pick) => pick.catalogCardId))];
  const mapped = await normalizeDraftCardCodes({ ...input, codes: [...ids, ...(input.deckCodes ?? [])] });
  if (!mapped.ok) return mapped;
  const resolved = mapped.codes;

  const cards = ids.length
    ? (input.db
        .prepare(
          "select ygoprodeck_id, type, frame_type from card_catalog where ygoprodeck_id in (select value from json_each(?))",
        )
        .all(JSON.stringify(ids)) as Array<{ ygoprodeck_id: number; type: string; frame_type: string }>)
    : [];
  const extraIds = new Set(
    cards.filter((card) => isExtraDeckMonster({ type: card.type, frameType: card.frame_type })).map((card) => card.ygoprodeck_id),
  );

  const counts = new Map<number, number>();
  const forcedCopies = new Map<number, number>();
  for (const pick of picks) {
    const code = resolved.get(pick.catalogCardId);
    if (pick.forced && typeof code === "number") forcedCopies.set(code, (forcedCopies.get(code) ?? 0) + 1);
  }
  const unresolved = new Set<number>();
  let mainPoolCount = 0;
  for (const pick of picks) {
    const code = resolved.get(pick.catalogCardId);
    if (typeof code !== "number") {
      unresolved.add(pick.catalogCardId);
      continue;
    }
    counts.set(code, (counts.get(code) ?? 0) + 1);
    if (!extraIds.has(pick.catalogCardId) && counts.get(code)! <= 3 + (forcedCopies.get(code) ?? 0)) mainPoolCount += 1;
  }
  return { ok: true, counts, forcedCopies, codeMap: resolved, mainPoolCount, unresolved: [...unresolved].sort((a, b) => a - b) };
}

/** Null when the main deck size is fine for a draft deck, else the error text. */
export function draftMainSizeError(mainCount: number, mainPoolCount: number): string | null {
  const required = Math.min(DRAFT_MIN_MAIN, mainPoolCount);
  if (mainCount >= required) return null;
  return mainPoolCount < DRAFT_MIN_MAIN
    ? `A draft deck must use all ${mainPoolCount} main deck cards you drafted (it has ${mainCount}).`
    : `A draft deck needs at least ${DRAFT_MIN_MAIN} main deck cards (it has ${mainCount}).`;
}

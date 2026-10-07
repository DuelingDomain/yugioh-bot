import { withCardFetchErrors } from "@/lib/card-fetch-errors";
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createDraftService, createCardCatalogService, isExtraDeckFrame, normalizeImportedCardName, rankCardsByTypo } from "@yugidraft/shared/services";
import { toCardCounts } from "@/lib/custom-card-pool";
import type { CardSummary } from "@/lib/card-types";
import { CardListError } from "@/lib/card-list-parser";
import { prepareCubeListImport } from "@/lib/cube-list-import";

export const runtime = "nodejs";

function toCardSummary(c: {
  ygoprodeckId: number;
  name: string;
  type: string;
  frameType: string;
  attribute?: string;
  level?: number;
  effectText: string;
  atk?: number;
  def?: number;
  imageUrl: string;
  imageUrlSmall: string;
}): CardSummary {
  return {
    id: c.ygoprodeckId,
    name: c.name,
    type: c.type,
    frameType: c.frameType,
    attribute: c.attribute,
    level: c.level,
    effectText: c.effectText,
    atk: c.atk,
    def: c.def,
    imageUrl: c.imageUrl,
    imageUrlSmall: c.imageUrlSmall,
  };
}

function isUnreachable(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith("Could not reach the card database");
}

async function handlePOST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    setNames?: string[];
    customCardIds?: number[];
    cardName?: string;
    fuzzyName?: string;
    includeExtra?: boolean;
    archetype?: string;
    listText?: unknown;
  };
  const setNames = Array.isArray(body.setNames) ? body.setNames.filter((s): s is string => typeof s === "string") : [];
  const customCardIds = Array.isArray(body.customCardIds)
    ? body.customCardIds.filter((n): n is number => typeof n === "number" && Number.isInteger(n))
    : [];
  const cardName = typeof body.cardName === "string" ? body.cardName.trim() : "";
  const fuzzyName = typeof body.fuzzyName === "string" ? body.fuzzyName.trim() : "";
  const archetype = typeof body.archetype === "string" ? body.archetype.trim() : "";

  const db = getDb();
  const catalog = createCardCatalogService(db);

  if (body.listText !== undefined) {
    if ([body.setNames, body.customCardIds, body.cardName, body.fuzzyName, body.archetype, body.includeExtra]
      .some((option) => option !== undefined)) {
      return NextResponse.json({ error: "listText cannot be combined with other resolve options." }, { status: 400 });
    }
    try {
      // This preparation only resolves/warm-caches cards; it never opens a cube write transaction.
      const resolved = await prepareCubeListImport(catalog, body.listText);
      const cards = catalog.findByIds(resolved.entries.map((entry) => entry.id));
      const byId = new Map(cards.map((card) => [card.ygoprodeckId, card]));
      const entries = resolved.entries.map((entry) => ({
        id: entry.id,
        copies: entry.copies,
        pool: entry.pool === "extra" || isExtraDeckFrame(byId.get(entry.id)!) ? "extra" : "main",
      }));
      return NextResponse.json({ cards: cards.map(toCardSummary), entries, unknown: resolved.unknown, corrected: resolved.corrected, ...(resolved.lookupLimited ? { lookupLimited: true } : {}) });
    } catch (error) {
      if (!(error instanceof CardListError)) throw error;
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
  }

  if (archetype) {
    const { main, extra } = await catalog.syncByArchetype(archetype);
    const cards = [...main, ...extra].map(toCardSummary);
    return NextResponse.json({ cards, unknownIds: [] });
  }

  if (cardName) {
    const card = await catalog.syncCardByName(cardName);
    if (!card) {
      return NextResponse.json({ error: `No card found for "${cardName}".` }, { status: 404 });
    }

    return NextResponse.json({ cards: [toCardSummary(card)], unknownIds: [] });
  }

  if (fuzzyName) {
    // Best match first. Extra Deck monsters only when the caller can hold them (a cube has an Extra pool).
    const includeExtra = body.includeExtra === true;
    let cards = await catalog.syncCardsByFuzzyName(fuzzyName, { includeExtra });
    if (cards.length === 0) {
      // A typo ("drak hole") matches no name as written. Look up each long word on its own, then rank by near matches.
      const words = [...new Set(normalizeImportedCardName(fuzzyName).split(" ").filter((word) => word.length >= 4))].slice(0, 3);
      const found = new Map<number, Awaited<ReturnType<typeof catalog.syncCardsByFuzzyName>>[number]>();
      for (const word of words) {
        for (const card of await catalog.syncCardsByFuzzyName(word, { includeExtra, limit: 80 })) found.set(card.ygoprodeckId, card);
      }
      cards = rankCardsByTypo([...found.values()], fuzzyName).slice(0, 24);
    }
    return NextResponse.json({ cards: cards.map(toCardSummary), unknownIds: [] });
  }

  // Sets not in card_catalog yet are fetched first, the way POST /api/drafts does.
  if (setNames.length > 0) {
    await catalog.syncDraftPool({ setNames, customCardIds: [], includeNames: [], excludeNames: [] });
  }

  const missingCustomCardIds = [...new Set(customCardIds.filter((id) => !catalog.hasCatalogRow(id)))];

  if (missingCustomCardIds.length > 0) {
    const sync = (ids: number[]) =>
      catalog.syncDraftPool({ setNames: [], customCardIds: ids, includeNames: [], excludeNames: [] });
    try {
      await sync(missingCustomCardIds);
    } catch (error) {
      // The card database answers HTTP 400 for a passcode it lacks, which fails the whole batch.
      // Retry one by one so the real cards still resolve and the bad ones come back in unknownIds.
      // A lost connection is a real failure.
      if (isUnreachable(error)) throw error;
      for (const id of missingCustomCardIds) {
        try {
          await sync([id]);
        } catch (single) {
          if (isUnreachable(single)) throw single;
        }
      }
    }
  }

  const resolvedIds = createDraftService(db).resolvePoolCardIds({
    setNames,
    customCardIds,
  });
  // resolvedIds is the materialized-cube multiset (baseline + additive custom).
  // Collapse to one entry per distinct card but keep the copy count as qty so
  // the preview shows the true number of copies the draft will use.
  const counts = toCardCounts(resolvedIds);

  const cards: CardSummary[] = catalog.findByIds([...counts.keys()]).map((c) => ({
    id: c.ygoprodeckId,
    name: c.name,
    type: c.type,
    frameType: c.frameType,
    attribute: c.attribute,
    level: c.level,
    effectText: c.effectText,
    atk: c.atk,
    def: c.def,
    imageUrl: c.imageUrl,
    imageUrlSmall: c.imageUrlSmall,
    qty: counts.get(c.ygoprodeckId) ?? 1,
  }));

  const present = new Set(cards.map((c) => c.id));
  const unknownIds = customCardIds.filter((id) => !present.has(id));

  return NextResponse.json({ cards, unknownIds });
}

export const POST = withCardFetchErrors(handlePOST);

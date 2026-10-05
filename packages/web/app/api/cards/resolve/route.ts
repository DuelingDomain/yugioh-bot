import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { createDraftService, createCardCatalogService } from "@yugidraft/shared/services";
import { toCardCounts } from "@/lib/custom-card-pool";
import type { CardSummary } from "@/lib/card-types";

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

export async function POST(request: Request) {
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
  };
  const setNames = Array.isArray(body.setNames) ? body.setNames.filter((s): s is string => typeof s === "string") : [];
  const customCardIds = Array.isArray(body.customCardIds)
    ? body.customCardIds.filter((n): n is number => typeof n === "number" && Number.isInteger(n))
    : [];
  const cardName = typeof body.cardName === "string" ? body.cardName.trim() : "";
  const fuzzyName = typeof body.fuzzyName === "string" ? body.fuzzyName.trim() : "";
  const archetype = typeof body.archetype === "string" ? body.archetype.trim() : "";

  const db = getDb();
  const drafts = createDraftService(db);
  const catalog = createCardCatalogService(db);

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
    try {
      const cards = await catalog.syncCardsByFuzzyName(fuzzyName, { includeExtra: body.includeExtra === true });
      return NextResponse.json({ cards: cards.map(toCardSummary), unknownIds: [] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not search the card database. Try again.";
      return NextResponse.json({ error: message }, { status: 502 });
    }
  }

  // Sets not in card_catalog yet are fetched first, the way POST /api/drafts does.
  if (setNames.length > 0) {
    await catalog.syncDraftPool({ setNames, customCardIds: [], includeNames: [], excludeNames: [] });
  }

  const missingCustomCardIds = [...new Set(customCardIds.filter((id) => !catalog.hasArtworks(id)))];

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

  const resolvedIds = drafts.resolvePoolCardIds({
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

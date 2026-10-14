import { report } from "@yugidraft/shared/observability";
import { NextResponse } from "next/server";
import { createCardCatalogService, createDeckTypeLookup, deckEngineDataDirectory, isCardFetchError, loadArtworkIdentityCatalog } from "@yugidraft/shared/services";
import { requireSavedDeckActor } from "@/lib/saved-decks";
import { getDb } from "@/lib/db";
import { resolveDeckImport } from "@/lib/deck-import";
import { CardListError } from "@/lib/card-list-parser";

export const runtime = "nodejs";

/** Prepare only. Saving remains a separate, independently validated request. */
export async function POST(request: Request) {
  const actor = await requireSavedDeckActor();
  if (!actor.ok) return actor.response;
  try {
    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new CardListError("Expected a deck import object.");
    const db = getDb();
    const result = await resolveDeckImport(createCardCatalogService(db), body.text, body.mode,
      loadArtworkIdentityCatalog(deckEngineDataDirectory(db.name)), createDeckTypeLookup(db).snapshot());
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof CardListError) {
      return NextResponse.json({ error: error.message, code: "INVALID_DECK_IMPORT" }, { status: 400 });
    }
    if (isCardFetchError(error)) {
      return NextResponse.json({ error: "Card database is unavailable. Try again shortly.", code: "CARD_CATALOG_UNAVAILABLE" }, { status: 503 });
    }
    report(error, { userId: actor.ownerUserId, tags: { operation: "[api/decks/import] preparation" } });
    return NextResponse.json({ error: "Could not prepare this deck import.", code: "DECK_IMPORT_FAILED" }, { status: 500 });
  }
}

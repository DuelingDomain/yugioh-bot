import { requireWebAccess } from "@/lib/web-access";
import { cardFetchErrorResponse } from "@/lib/card-fetch-errors";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createCardCatalogService } from "@yugidraft/shared/services";

export const runtime = "nodejs";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ name: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { name } = await params;
  const decodedName = decodeURIComponent(name);
  const db = getDb();
  const catalog = createCardCatalogService(db, { memberId: actor.userId });

  try {
    const preview = await catalog.getSetPreview(decodedName);
    return NextResponse.json(preview);
  } catch (error) {
    const fetchFailure = cardFetchErrorResponse(error);
    if (fetchFailure) return fetchFailure;
    console.error("[api/sets/preview] error:", error);
    return NextResponse.json({ error: "Failed to load set preview" }, { status: 500 });
  }
}
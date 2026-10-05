import { withCardFetchErrors } from "@/lib/card-fetch-errors";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createCardCatalogService } from "@yugidraft/shared/services";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const query = request.nextUrl.searchParams.get("q") ?? undefined;
  const db = getDb();
  const catalog = createCardCatalogService(db);
  const sets = catalog.listSets(query);
  return NextResponse.json({ sets });
}

async function handlePOST() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const db = getDb();
  const catalog = createCardCatalogService(db);
  const sets = await catalog.syncSets();
  return NextResponse.json({ synced: sets.length });
}
export const POST = withCardFetchErrors(handlePOST);

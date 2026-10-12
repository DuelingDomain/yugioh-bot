import { createRateLimiter } from "@/lib/rate-limit";
import { withCardFetchErrors } from "@/lib/card-fetch-errors";
import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createCardCatalogService } from "@yugidraft/shared/services";
import { auth } from "@/lib/auth";

export const runtime = "nodejs";
const takeSync = createRateLimiter(10 * 60_000);

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

  const retry = takeSync([[`user:${session.user.id}`, 1]]);
  if (retry !== null) {
    return NextResponse.json({ error: "You recently requested a set sync. Try again in ten minutes." }, {
      status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" },
    });
  }

  const db = getDb();
  const catalog = createCardCatalogService(db, { memberId: Number(session.user.id) });
  const sets = await catalog.syncSets();
  return NextResponse.json({ synced: sets.length });
}
export const POST = withCardFetchErrors(handlePOST);

import { NextRequest, NextResponse } from "next/server";
import { resolve } from "node:path";
import { createCardCatalogService, readEngineCardInfo, withCatalogCardText } from "@yugidraft/shared/services";
import type { DeckCardInfo, DuelCardInfo } from "@yugidraft/shared/duels";
import { getDb } from "@/lib/db";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

function cardCatalog() {
  // Engine metadata supplies canonical artwork passcodes. Avoid a second CDB
  // identity lookup whose relative path would depend on the web process cwd.
  return createCardCatalogService(getDb(), { identityCatalog: new Map() });
}

function exactCardInfo(codes: number[]) {
  // Match getDb's workspace-relative defaults; Compose supplies an absolute
  // DUEL_DATA_DIR shared with the duel host. No YGOPRODeck request is needed.
  const directory = resolve(process.cwd(), "..", "..", process.env.DUEL_DATA_DIR ?? "data/duel-engine");
  return readEngineCardInfo(codes, directory, cardCatalog());
}

export async function GET(request: NextRequest) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;

  const query = request.nextUrl.searchParams.get("q") ?? "";
  const slug = request.nextUrl.searchParams.get("slug") ?? undefined;
  if (slug) {
    try {
      actor.duels.room(slug, actor.guildId, actor.playerId);
    } catch (error) {
      return duelErrorResponse(error);
    }
  }
  // Slug-bound searches must retain the host's announce-card permission checks.
  const code = /^\d+$/.test(query.trim()) ? Number(query) : null;
  const local = !slug && query.length <= 200 && code !== null && Number.isSafeInteger(code) && code > 0 && code <= 0xffffffff
    ? exactCardInfo([code]) : null;
  const result = await callDuelHost({
    op: "cards",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    query,
  });
  if (!result.ok) {
    if (result.response.status === 503 && local?.cards.length) return NextResponse.json({ cards: local.cards });
    return result.response;
  }
  if (local?.cards.length) {
    const data = result.data as { cards: DuelCardInfo[] };
    return NextResponse.json({ cards: [...local.cards, ...data.cards.filter(card => card.code !== code)] });
  }
  return NextResponse.json(result.data);
}

export async function POST(request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const codes = body && typeof body === "object" && "codes" in body ? body.codes : null;
  if (!Array.isArray(codes) || codes.length > 1000
    || codes.some((code) => !Number.isSafeInteger(code) || code <= 0 || code > 0xffffffff)) {
    return NextResponse.json({ error: "Provide at most 1000 positive card passcodes" }, { status: 400 });
  }
  const local = exactCardInfo(codes);
  if (local && local.missing.length === 0) return NextResponse.json(local);
  const result = await callDuelHost({
    op: "card-details",
    guildId: actor.guildId,
    playerId: actor.playerId,
    codes: local?.missing ?? codes,
  });
  if (!result.ok) {
    if (result.response.status === 503 && local?.cards.length) return NextResponse.json(local);
    return result.response;
  }
  const data = result.data as { cards: DeckCardInfo[]; missing: number[] };
  const cards = withCatalogCardText(data.cards, cardCatalog());
  if (!local) return NextResponse.json({ ...data, cards });
  const combined = new Map([...local.cards, ...cards].map(card => [card.code, card]));
  const ids = [...new Set<number>(codes)];
  return NextResponse.json({
    cards: ids.flatMap(code => combined.has(code) ? [combined.get(code)!] : []),
    missing: ids.filter(code => !combined.has(code)),
  });
}

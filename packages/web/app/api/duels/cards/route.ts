import { NextRequest, NextResponse } from "next/server";
import { createCardCatalogService } from "@yugidraft/shared/services";
import type { DeckCardInfo, DuelCardInfo } from "@yugidraft/shared/duels";
import { getDb } from "@/lib/db";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { hasSandboxQuery, requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions } from "@/lib/sandbox-access";

export const runtime = "nodejs";

let catalog: ReturnType<typeof createCardCatalogService> | undefined;
function cardCatalog() {
  // Artwork identity comes from the host; catalog lookups only read cached rows.
  return catalog ??= createCardCatalogService(getDb(), { identityCatalog: new Map() });
}

function hasName(code: number, name: string | undefined) {
  return !!name?.trim() && name.trim() !== `Card ${code}`;
}

function withCatalogCardText<T extends DuelCardInfo>(cards: T[]): T[] {
  const incomplete = cards.filter(card => !hasName(card.code, card.name) || !card.description?.trim());
  if (!incomplete.length) return cards;
  const ids = [...new Set(incomplete.flatMap(card => [card.code, card.canonicalPasscode ?? card.code]))];
  const cachedCards = new Map(cardCatalog().findByIds(ids).map(card => [card.ygoprodeckId, card]));
  return cards.map(card => {
    const cached = cachedCards.get(card.code) ?? cachedCards.get(card.canonicalPasscode ?? card.code);
    return {
      ...card,
      name: !hasName(card.code, card.name) && cached && hasName(cached.ygoprodeckId, cached.name) ? cached.name : card.name,
      description: !card.description?.trim() && cached?.effectText?.trim() ? cached.effectText : card.description,
    };
  });
}

export async function GET(request: NextRequest) {
  const sandboxQuery = hasSandboxQuery(request);
  const actor = await (sandboxQuery ? requireSandboxActor() : requireDuelActor());
  if (!actor.ok) return actor.response;
  try {
    const query = request.nextUrl.searchParams.get("q") ?? "";
    const slug = request.nextUrl.searchParams.get("slug") ?? undefined;
    const options = sandboxQueryOptions(request);
    if (slug) {
      const room = actor.duels.room(slug, actor.guildId, actor.playerId);
      if (room.session.sandbox && !sandboxQuery) {
        const sandboxActor = await requireSandboxActor();
        if (!sandboxActor.ok) return sandboxActor.response;
      }
    }
    const result = await callDuelHost({
      op: "cards", slug, guildId: actor.guildId, playerId: actor.playerId, query, ...options,
    });
    if (!result.ok) return result.response;
    const data = result.data as { cards: DuelCardInfo[] };
    return NextResponse.json({ ...data, cards: withCatalogCardText(data.cards) });
  } catch (error) {
    return sandboxErrorResponse(error);
  }
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
  const ids = [...new Set<number>(codes)];
  const result = await callDuelHost({
    op: "card-details",
    guildId: actor.guildId,
    playerId: actor.playerId,
    codes: ids,
  });
  if (!result.ok) return result.response;
  const data = result.data as { cards: DeckCardInfo[]; missing: number[] };
  return NextResponse.json({ ...data, cards: withCatalogCardText(data.cards) });
}

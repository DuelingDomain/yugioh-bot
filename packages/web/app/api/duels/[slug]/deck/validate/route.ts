import { NextRequest, NextResponse } from "next/server";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let format: string;
  try {
    format = actor.duels.room(slug, actor.guildId, actor.playerId).session.format;
  } catch (error) {
    return duelErrorResponse(error);
  }

  let deck: DuelDeck;
  try {
    deck = (await request.json()) as DuelDeck;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await callDuelHost({
    op: "validate-deck",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    deck,
  });
  if (!result.ok) {
    // A new table window can still show the lobby when Start locks the decks. This expected
    // state change must refresh that window without creating a browser resource error.
    if ((format === "ffa3" || format === "ffa4") && result.response.status === 409) {
      const body = await result.response.clone().json().catch(() => null);
      if (body?.error === "Decks are locked after the duel starts") {
        return NextResponse.json({ locked: true, error: body.error });
      }
    }
    return result.response;
  }
  return NextResponse.json(result.data);
}

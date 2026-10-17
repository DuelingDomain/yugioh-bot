import { NextResponse } from "next/server";
import { assertNormalDuelRequest, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/** Only player input calls this route. Room reads and socket renewals do not. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
    assertNormalDuelRequest(request, room);
    return NextResponse.json(actor.duels.touchWaiting(slug, actor.guildId, actor.playerId),
      { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

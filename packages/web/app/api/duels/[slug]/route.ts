import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor, redactDuelResult } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const spectate = new URL(request.url).searchParams.get("spectate") === "1";

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    const pending = room.session.status === "lobby" || room.series?.status === "between_games";
    const openingDue = room.session.status === "lobby" && room.opening
      && Date.parse(room.opening.deadlineAt) <= Date.now();
    // Spectators need the host only when an opening deadline has arrived.
    if ((pending && room.mySeat === null && !openingDue) || (!pending && room.session.status !== "active" && !spectate)) {
      return NextResponse.json(redactDuelResult(room, actor.guildId, actor.playerId));
    }
    try {
      const result = await callDuelHost({
        op: "view", slug, guildId: actor.guildId, playerId: actor.playerId,
        ...(spectate ? { spectate: true } : {}),
      });
      if (result.ok) return NextResponse.json(result.data);
      if (!pending || result.response.status < 500 || result.response.status >= 600) return result.response;
    } catch (error) {
      if (!pending) throw error;
    }
    return NextResponse.json(redactDuelResult(room, actor.guildId, actor.playerId));
  } catch (error) {
    return duelErrorResponse(error);
  }
}

import { NextResponse } from "next/server";
import { duelAnimationSpeed, readDuelControl, callDuelHost, duelErrorResponse, requireDuelActor, redactDuelResult } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const spectate = new URL(request.url).searchParams.get("spectate") === "1";
  const headers = { "cache-control": "private, no-store" };

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    const control = readDuelControl(request, room, "view");
    const fork = room.session.kind === "replay-fork";
    const pending = !fork && (room.session.status === "lobby" || room.series?.status === "between_games");
    const openingDue = room.session.status === "lobby" && room.opening != null
      && Date.parse(room.opening.deadlineAt) <= Date.now();
    // Spectators need the host only when an opening deadline has arrived.
    if (!fork && ((pending && room.mySeat === null && !openingDue) || (!pending && room.session.status !== "active" && !spectate))) {
      return NextResponse.json(redactDuelResult(room, actor.guildId, actor.playerId), { headers });
    }
    try {
      const result = await callDuelHost({
    ...duelAnimationSpeed(request),
        op: "view", slug, guildId: actor.guildId, playerId: actor.playerId,
        ...(actor.userId !== undefined ? { userId: actor.userId } : {}), ...control,
        ...(spectate ? { spectate: true } : {}),
      });
      if (result.ok) {
        if (fork) actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
        return NextResponse.json(result.data, { headers });
      }
      if (!pending || result.response.status < 500 || result.response.status >= 600) return result.response;
    } catch (error) {
      if (!pending) throw error;
    }
    return NextResponse.json(redactDuelResult(room, actor.guildId, actor.playerId), { headers });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

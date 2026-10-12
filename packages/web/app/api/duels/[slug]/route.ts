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
    // The host repairs locked copies and reports the viewer's own future-deck blocker.
    if (room.session.status !== "active" && room.session.status !== "lobby"
      && room.series?.status !== "between_games" && !spectate) {
      return NextResponse.json(redactDuelResult(room, actor.guildId, actor.playerId));
    }
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({
    op: "view",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    ...(spectate ? { spectate: true } : {}),
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}

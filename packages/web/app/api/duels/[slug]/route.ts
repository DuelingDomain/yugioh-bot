import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.status !== "active") {
      return NextResponse.json(room);
    }
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({
    op: "view",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}

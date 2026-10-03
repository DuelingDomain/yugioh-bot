import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    // A lobby with a timed-out rock-paper-scissors opening goes to the host, which settles it.
    const openingDue = room.session.status === "lobby" && room.opening != null
      && Date.parse(room.opening.deadlineAt) <= Date.now();
    if (room.session.status !== "active" && !openingDue) {
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

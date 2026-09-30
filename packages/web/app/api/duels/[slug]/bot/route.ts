import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor, sessionFromHost } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    actor.duels.room(slug, actor.guildId, actor.playerId);
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({
    op: "add-bot",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(sessionFromHost(result.data));
}

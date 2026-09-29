import { NextRequest, NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

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
  const result = await callDuelHost({
    op: "cards",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    query,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}

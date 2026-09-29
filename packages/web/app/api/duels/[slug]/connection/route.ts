import { NextResponse } from "next/server";
import { createDuelConnectionToken, DUEL_CONNECTION_TTL_MS } from "@yugidraft/shared/ws";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (!env.wsInternalSecret) {
      return NextResponse.json({ error: "Realtime is unavailable" }, { status: 503 });
    }
    const expiresAt = Date.now() + DUEL_CONNECTION_TTL_MS;
    const token = createDuelConnectionToken(
      {
        slug,
        guildId: actor.guildId,
        playerId: actor.playerId,
        seat: room.mySeat,
        expiresAt,
      },
      env.wsInternalSecret,
    );
    return NextResponse.json({ token, guildId: actor.guildId, expiresAt });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

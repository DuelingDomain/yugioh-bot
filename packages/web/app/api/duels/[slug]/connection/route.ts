import { NextResponse } from "next/server";
import { createDuelConnectionToken, DUEL_CONNECTION_TTL_MS } from "@yugidraft/shared/ws";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { env } from "@/lib/env";
import type { DuelRoom } from "@yugidraft/shared/duels";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const storedRoom = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (storedRoom.session.sandbox) {
      const admin = await requireDuelActor("admin");
      if (!admin.ok) return admin.response;
    }
    let room: DuelRoom = storedRoom;
    if (new URL(request.url).searchParams.get("spectate") === "1") {
      const result = await callDuelHost({ op: "view", slug, guildId: actor.guildId, playerId: actor.playerId, spectate: true });
      if (!result.ok) return result.response;
      room = result.data as DuelRoom;
    }
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

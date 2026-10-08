import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { findTournamentReadAccess } from "@yugidraft/shared/services";
import { createTournamentRoomToken, TOURNAMENT_ROOM_TOKEN_TTL_MS } from "@yugidraft/shared/ws";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const access = findTournamentReadAccess(getDb(), slug, env.discordGuildId, actor.userId);
  if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
  if (!env.wsInternalSecret) {
    return NextResponse.json({ error: "The live feed is unavailable. Try again later." }, { status: 503 });
  }
  const claims = {
    slug,
    guildId: env.discordGuildId,
    userId: actor.userId,
    expiresAt: Date.now() + TOURNAMENT_ROOM_TOKEN_TTL_MS,
  };
  return NextResponse.json({
    token: createTournamentRoomToken(claims, env.wsInternalSecret),
    userId: claims.userId,
    expiresAt: claims.expiresAt,
  }, { headers: { "Cache-Control": "no-store" } });
}

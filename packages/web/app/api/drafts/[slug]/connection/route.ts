import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { draftReadAccess } from "@/lib/draft-access";
import { env } from "@/lib/env";
import { createDraftRoomToken, DRAFT_ROOM_TOKEN_TTL_MS } from "@yugidraft/shared/ws";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const denied = draftReadAccess(getDb(), slug, env.discordGuildId, actor.userId);
  if (denied) return denied;
  if (!env.wsInternalSecret) {
    return NextResponse.json({ error: "The live feed is unavailable. Try again later." }, { status: 503 });
  }
  const claims = {
    slug,
    guildId: env.discordGuildId,
    userId: actor.userId,
    expiresAt: Date.now() + DRAFT_ROOM_TOKEN_TTL_MS,
  };
  return NextResponse.json({
    token: createDraftRoomToken(claims, env.wsInternalSecret),
    userId: claims.userId,
    expiresAt: claims.expiresAt,
  }, { headers: { "Cache-Control": "no-store" } });
}

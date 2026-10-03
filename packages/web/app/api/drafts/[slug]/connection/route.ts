import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { draftReadAccess } from "@/lib/draft-access";
import { env } from "@/lib/env";
import { createDraftRoomToken, DRAFT_ROOM_TOKEN_TTL_MS } from "@yugidraft/shared/ws";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { slug } = await params;
  const denied = draftReadAccess(getDb(), slug, env.discordGuildId, session.user.id);
  if (denied) return denied;
  if (!env.wsInternalSecret) {
    return NextResponse.json({ error: "The live feed is unavailable. Try again later." }, { status: 503 });
  }
  const claims = {
    slug,
    guildId: env.discordGuildId,
    userId: session.user.id,
    expiresAt: Date.now() + DRAFT_ROOM_TOKEN_TTL_MS,
  };
  return NextResponse.json({
    token: createDraftRoomToken(claims, env.wsInternalSecret),
    userId: claims.userId,
    expiresAt: claims.expiresAt,
  }, { headers: { "Cache-Control": "no-store" } });
}

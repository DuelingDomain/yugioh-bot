import { NextResponse } from "next/server";
import { createOpenNowService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import type { OpenNow } from "@/lib/open-now";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;

  try {
    const db = getDb();
    const viewer = db.prepare("select id from players where user_id = ? and guild_id = ? limit 1")
      .get(actor.userId, env.discordGuildId) as { id: number } | undefined;
    const open: OpenNow = createOpenNowService(db).forPlayer(env.discordGuildId, viewer?.id ?? null, actor.userId);
    return NextResponse.json(open, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[api/lobby/open]", error);
    return NextResponse.json({ error: "Failed to load open lobbies" }, { status: 500, headers: { "Cache-Control": "no-store" } });
  }
}

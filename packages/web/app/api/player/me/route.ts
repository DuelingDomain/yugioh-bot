import { env } from "@/lib/env";
export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";

export async function GET() {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;

  const db = getDb();
  const row = db
    .prepare("select id from players where user_id = ? and guild_id = ? limit 1")
    .get(actor.userId, env.discordGuildId) as { id: number } | undefined;

  if (!row) return NextResponse.json(null, { status: 404 });
  return NextResponse.json({ playerId: row.id });
}

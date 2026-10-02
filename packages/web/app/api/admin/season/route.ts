import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { env } from "@/lib/env";
import { createSeasonService } from "@yugidraft/shared/services";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;

  const seasons = createSeasonService(getDb());
  const active = seasons.getActive(env.discordGuildId);
  return NextResponse.json({ season: active ?? null });
}

export async function POST(request: Request) {
  const actor = await requireWebAccess("admin");
  if (!actor.ok) return actor.response;

  const { action, name } = (await request.json()) as { action: "start" | "end"; name?: string };
  const seasons = createSeasonService(getDb());
  try {
    const season = action === "start" ? seasons.start(env.discordGuildId, actor.userId, name) : seasons.end(env.discordGuildId);
    return NextResponse.json({ season: season ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

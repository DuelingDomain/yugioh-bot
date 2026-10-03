import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createGuildSettingsService } from "@yugidraft/shared/services";
import { requireWebAccess } from "@/lib/web-access";
import { env } from "@/lib/env";

export const runtime = "nodejs";

export async function GET() {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;

  const guildId = env.discordGuildId;
  const db = getDb();
  const settings = createGuildSettingsService(db);
  const guildSettings = settings.get(guildId);

  return NextResponse.json(guildSettings);
}

export async function PUT(request: NextRequest) {
  const actor = await requireWebAccess("admin");
  if (!actor.ok) return actor.response;

  const guildId = env.discordGuildId;
  const body = await request.json();
  const db = getDb();
  const settings = createGuildSettingsService(db);
  const updated = settings.update(guildId, body);

  return NextResponse.json(updated);
}

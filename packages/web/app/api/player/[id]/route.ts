import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { parseUserId } from "@/lib/user-id";
import { env } from "@/lib/env";
import { createScoringService } from "@yugidraft/shared/services";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  const viewerUserId = parseUserId(session?.user?.id);
  if (viewerUserId === null) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const scope = new URL(request.url).searchParams.get("scope") === "all" ? "all" : "season";
  const db = getDb();
  const player = db.prepare("select id from players where id = ? and guild_id = ?").get(Number(id), env.discordGuildId);
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 });
  const scoring = createScoringService(db);
  return NextResponse.json(scoring.getProfile(env.discordGuildId, Number(id), scope, viewerUserId));
}

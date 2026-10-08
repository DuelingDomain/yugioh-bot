import { NextRequest, NextResponse } from "next/server";
import { duelErrorResponse, requireDuelActor, redactDuelResult } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let body: { inviteCode?: unknown };
  try {
    body = (await request.json()) as { inviteCode?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.inviteCode !== "string") {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400 });
  }

  try {
    actor.duels.admit(slug, actor.guildId, actor.playerId, body.inviteCode);
    return NextResponse.json(redactDuelResult(actor.duels.room(slug, actor.guildId, actor.playerId), actor.guildId, actor.playerId));
  } catch (error) {
    return duelErrorResponse(error);
  }
}

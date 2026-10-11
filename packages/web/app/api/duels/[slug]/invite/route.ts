import { NextRequest, NextResponse } from "next/server";
import { readDuelControl, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

import { assertDuelForkAccess } from "@/lib/replay-fork-access";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  try {
    const target = assertDuelForkAccess(slug, actor);
    if (target.kind === "replay-fork") return NextResponse.json({ error: "Replay forks cannot accept invites" }, { status: 409, headers: { "cache-control": "private, no-store" } });
    readDuelControl(request);
  } catch (error) { return duelErrorResponse(error); }

  let body: { inviteCode?: unknown };
  try {
    body = (await request.json()) as { inviteCode?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.inviteCode !== "string") {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }

  try {
    actor.duels.admit(slug, actor.guildId, actor.playerId, body.inviteCode);
    return NextResponse.json(actor.duels.room(slug, actor.guildId, actor.playerId));
  } catch (error) {
    return duelErrorResponse(error);
  }
}

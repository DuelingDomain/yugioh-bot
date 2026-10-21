import { NextRequest, NextResponse } from "next/server";
import { readDuelControl, callDuelHost, duelErrorResponse, requireDuelActor, redactDuelResult } from "@/lib/duel-host";

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

  let body: { inviteCode?: unknown; playerId?: unknown };
  try {
    body = (await request.json()) as { inviteCode?: unknown; playerId?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }
  // Only the host can clear a removal; a shared invite code never clears it.
  if (body && typeof body === "object" && !Array.isArray(body) && "playerId" in body) {
    if (typeof body.playerId !== "number" || !Number.isSafeInteger(body.playerId) || body.playerId <= 0 || "inviteCode" in body) {
      return NextResponse.json({ error: "A valid playerId is required" }, { status: 400 });
    }
    const result = await callDuelHost({ op: "invite-player", slug, guildId: actor.guildId,
      playerId: actor.playerId, targetPlayerId: body.playerId });
    if (!result.ok) return result.response;
    return NextResponse.json(result.data, { headers: { "cache-control": "private, no-store" } });
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || typeof body.inviteCode !== "string") {
    return NextResponse.json({ error: "Invite code is required" }, { status: 400, headers: { "cache-control": "private, no-store" } });
  }

  try {
    actor.duels.admit(slug, actor.guildId, actor.playerId, body.inviteCode);
    return NextResponse.json(redactDuelResult(actor.duels.room(slug, actor.guildId, actor.playerId), actor.guildId, actor.playerId));
  } catch (error) {
    return duelErrorResponse(error);
  }
}

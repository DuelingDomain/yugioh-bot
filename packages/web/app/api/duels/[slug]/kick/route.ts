import { NextResponse } from "next/server";
import { assertNormalDuelRequest, callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  try {
    assertNormalDuelRequest(request, actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false }));
    let body: unknown;
    try { body = await request.json(); }
    catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
    if (!body || typeof body !== "object" || Array.isArray(body) || !("playerId" in body)
      || typeof body.playerId !== "number" || !Number.isSafeInteger(body.playerId) || body.playerId <= 0) {
      return NextResponse.json({ error: "A valid playerId is required" }, { status: 400 });
    }
    // Check both here and in the signed host operation. The host serializes with starts and actions.
    actor.duels.kickTarget(slug, actor.guildId, actor.playerId, body.playerId);
    const result = await callDuelHost({ op: "kick", slug, guildId: actor.guildId,
      playerId: actor.playerId, targetPlayerId: body.playerId });
    if (!result.ok) return result.response;
    return NextResponse.json(result.data, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return duelErrorResponse(error); }
}

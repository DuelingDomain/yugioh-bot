import { requireSandboxActor } from "@/lib/sandbox-access";
import { NextResponse } from "next/server";
import { assertNormalDuelRequest, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
    if (room.session.sandbox) {
      const sandboxActor = await requireSandboxActor();
      if (!sandboxActor.ok) return sandboxActor.response;
    }
    assertNormalDuelRequest(request, room);
  }
  catch (error) { return duelErrorResponse(error); }

  try {
    const session = actor.duels.leaveLobby(slug, actor.guildId, actor.playerId);
    try {
      await notifyDuelChange(session.slug, actor.guildId);
    } catch {
      // Leave already committed.
    }
    return NextResponse.json({ session }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

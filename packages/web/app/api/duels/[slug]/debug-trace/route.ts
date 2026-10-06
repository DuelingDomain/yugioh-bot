import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor, scenariosEnabled, scenariosOffResponse } from "@/lib/duel-host";

export const runtime = "nodejs";

/**
 * Dev only (DUEL_SCENARIOS=1). The host's debug trace of one duel: every seat view, the bot rule trace and the worker state.
 * The host answers it even when the core is stuck. 404 when scenarios are off.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  if (!scenariosEnabled()) return scenariosOffResponse();
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    // Same access rule as the room: throws when this player may not see the duel.
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox) {
      const admin = await requireDuelActor("admin");
      if (!admin.ok) return admin.response;
    }
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({ op: "debug-trace", slug, guildId: actor.guildId, playerId: actor.playerId });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { headers: { "cache-control": "no-store" } });
}

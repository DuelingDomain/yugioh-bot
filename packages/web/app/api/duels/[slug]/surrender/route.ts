import { NextResponse } from "next/server";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

import { hasSandboxQuery, requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const sandboxQuery = hasSandboxQuery(request);
  const actor = await (sandboxQuery ? requireSandboxActor() : requireDuelActor());
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox && !sandboxQuery) {
      const admin = await requireSandboxActor();
      if (!admin.ok) return admin.response;
    }
    const result = await callDuelHost({
      op: "surrender", slug, guildId: actor.guildId, playerId: actor.playerId, ...sandboxQueryOptions(request),
    });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

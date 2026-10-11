import { NextResponse } from "next/server";
import { readDuelControl, callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

import { requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let fork = false;
  let control: ReturnType<typeof readDuelControl>;
  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId, { ownerRead: false, includeStoredBoard: false });
    if (room.session.sandbox) {
      const sandboxActor = await requireSandboxActor();
      if (!sandboxActor.ok) return sandboxActor.response;
    }
    control = room.session.sandbox ? sandboxQueryOptions(request) : readDuelControl(request, room);
    fork = room.session.kind === "replay-fork";
  } catch (error) {
    return sandboxErrorResponse(error);
  }

  const result = await callDuelHost({
    op: "surrender",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId, ...(actor.userId !== undefined ? { userId: actor.userId } : {}), ...control,
  });
  if (!result.ok) return result.response;
  if (fork) {
    try { actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false }); }
    catch (error) { return duelErrorResponse(error); }
  }
  return NextResponse.json(result.data, fork ? { headers: { "cache-control": "private, no-store" } } : undefined);
}

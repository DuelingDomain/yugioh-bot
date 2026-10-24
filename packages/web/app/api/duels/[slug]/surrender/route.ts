import { authorizeDuelControl, sandboxErrorResponse } from "@/lib/sandbox-access";
import { NextResponse } from "next/server";
import { readDuelControl, callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let fork = false;
  let control: { as?: number; reveal?: boolean };
  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false });
    const authorized = await authorizeDuelControl(request, room, room.session.sandbox ? "action" : "none");
    if (!authorized.ok) return authorized.response;
    control = authorized.control;
    fork = room?.session.kind === "replay-fork";
  } catch (error) {
    return sandboxErrorResponse(error);
  }

  const result = await callDuelHost({
    ...control,
    op: "surrender",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId, ...(actor.userId !== undefined ? { userId: actor.userId } : {}),
  });
  if (!result.ok) return result.response;
  if (fork) {
    try { actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false }); }
    catch (error) { return duelErrorResponse(error); }
  }
  return NextResponse.json(result.data, fork ? { headers: { "cache-control": "private, no-store" } } : undefined);
}

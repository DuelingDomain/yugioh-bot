import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, readDuelControl, requireDuelActor } from "@/lib/duel-host";
import { requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const spectate = new URL(request.url).searchParams.get("spectate") === "1";

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox) {
      const allowed = await requireSandboxActor();
      if (!allowed.ok) return allowed.response;
    }
    const control = room.session.sandbox ? sandboxQueryOptions(request) : readDuelControl(request, room, "view");
    const fork = room.session.kind === "replay-fork";
    const pending = !room.session.sandbox && !fork
      && (room.session.status === "lobby" || room.series?.status === "between_games");
    const openingDue = room.session.status === "lobby" && room.opening != null
      && Date.parse(room.opening.deadlineAt) <= Date.now();
    // Players need the host's deck blocker. Spectators need it only to settle an opening deadline.
    if (!room.session.sandbox && !fork
      && ((pending && room.mySeat === null && !openingDue) || (!pending && room.session.status !== "active" && !spectate))) {
      return NextResponse.json(room);
    }
    try {
      const result = await callDuelHost({
        op: "view", slug, guildId: actor.guildId, playerId: actor.playerId,
        ...(actor.userId !== undefined ? { userId: actor.userId } : {}), ...control,
        ...(spectate ? { spectate: true } : {}),
      });
      if (!result.ok) {
        if (!pending || result.response.status < 500 || result.response.status >= 600) return result.response;
      } else {
        if (fork) {
          try { actor.duels.room(slug, actor.guildId, actor.playerId, { includeStoredBoard: false }); }
          catch (error) { return duelErrorResponse(error); }
        }
        return NextResponse.json(result.data, { headers: { "cache-control": "private, no-store" } });
      }
    } catch (error) {
      if (!pending) throw error;
    }
    return NextResponse.json(room);
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

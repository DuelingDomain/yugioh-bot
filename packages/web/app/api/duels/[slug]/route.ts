import { NextResponse } from "next/server";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";
import { hasSandboxQuery, requireSandboxActor, sandboxErrorResponse, sandboxQueryOptions } from "@/lib/sandbox-access";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const sandboxQuery = hasSandboxQuery(request);
  const actor = await (sandboxQuery ? requireSandboxActor() : requireDuelActor());
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const spectate = new URL(request.url).searchParams.get("spectate") === "1";

  try {
    const options = sandboxQueryOptions(request);
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox && !sandboxQuery) {
      const sandboxActor = await requireSandboxActor();
      if (!sandboxActor.ok) return sandboxActor.response;
    }
    // A lobby with a timed-out rock-paper-scissors opening goes to the host, which settles it.
    const openingDue = room.session.status === "lobby" && room.opening != null
      && Date.parse(room.opening.deadlineAt) <= Date.now();
    // Sandbox views always reach the host for organizer, seat and reveal checks.
    if (!room.session.sandbox && !sandboxQuery && room.session.status !== "active" && !openingDue && !spectate) {
      return NextResponse.json(room);
    }
    const result = await callDuelHost({
      op: "view", slug, guildId: actor.guildId, playerId: actor.playerId,
      ...(spectate ? { spectate: true } : {}), ...options,
    });
    return result.ok ? NextResponse.json(result.data) : result.response;
  } catch (error) {
    return sandboxErrorResponse(error);
  }
}

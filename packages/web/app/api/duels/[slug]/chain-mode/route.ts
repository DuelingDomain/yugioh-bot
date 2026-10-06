import { NextRequest, NextResponse } from "next/server";
import { isDuelChainMode } from "@yugidraft/shared/duels";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/**
 * The chain response switch (Auto, Always, Off) for the caller's own seat. The duel host applies it, journals it and,
 * when it passes a window that is open now, pushes the change. No other seat is told.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const mode = body && typeof body === "object" ? (body as { mode?: unknown }).mode : undefined;
  if (!isDuelChainMode(mode)) {
    return NextResponse.json({ error: "Choose Auto, Always or Off" }, { status: 400 });
  }

  try {
    const room = actor.duels.room(slug, actor.guildId, actor.playerId);
    if (room.session.sandbox) {
      const admin = await requireDuelActor("admin");
      if (!admin.ok) return admin.response;
    }
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({
    op: "chain-mode",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    chainMode: mode,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}

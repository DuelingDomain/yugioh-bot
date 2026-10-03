import { MULTI_CORE_UNAVAILABLE_MESSAGE, multiplayerSeatsBlockReason, multiplayerTablesEnabled, seatCountFor, type DuelTableCapabilities } from "@yugidraft/shared/duels";
import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const { session: { format } } = actor.duels.room(slug, actor.guildId, actor.playerId);
    const blocked = multiplayerSeatsBlockReason(seatCountFor(format), multiplayerTablesEnabled());
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
    if (format !== "1v1") {
      const result = await callDuelHost({ op: "capabilities", guildId: actor.guildId, playerId: actor.playerId });
      if (!result.ok) return result.response;
      const data = result.data as Partial<DuelTableCapabilities> | null;
      if (data?.multiCoreReady !== true) return NextResponse.json({ error: MULTI_CORE_UNAVAILABLE_MESSAGE }, { status: 409 });
    }
    const session = actor.duels.join(slug, actor.guildId, actor.playerId);
    try {
      await notifyDuelChange(session.slug, actor.guildId);
    } catch {
      // Join already committed.
    }
    return NextResponse.json({ session });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

import { multiplayerSeatsBlockReason, multiplayerTablesEnabled, seatCountFor } from "@yugidraft/shared/duels";
import { NextResponse } from "next/server";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const { format } = actor.duels.get(slug, actor.guildId);
    const blocked = multiplayerSeatsBlockReason(seatCountFor(format), multiplayerTablesEnabled());
    if (blocked) return NextResponse.json({ error: blocked }, { status: 403 });
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

import { NextResponse } from "next/server";
import { callDuelHost, duelErrorResponse, requireDuelActor, sessionFromHost } from "@/lib/duel-host";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    actor.duels.room(slug, actor.guildId, actor.playerId);
  } catch (error) {
    return duelErrorResponse(error);
  }

  const result = await callDuelHost({
    op: "add-bot",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(sessionFromHost(result.data));
}

/** Takes the practice bot out of its seat. A lobby-only seat change, so it needs no duel engine (like taking and leaving seats). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  try {
    const session = actor.duels.removePracticeBot(slug, actor.guildId, actor.playerId);
    await notifyDuelChange(session.slug, actor.guildId);
    return NextResponse.json({ session });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

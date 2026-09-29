import { NextRequest, NextResponse } from "next/server";
import type { DuelDeck } from "@yugidraft/shared/duels";
import { callDuelHost, requireDuelActor, sessionFromHost } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  let deck: DuelDeck;
  try {
    deck = (await request.json()) as DuelDeck;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await callDuelHost({
    op: "deck",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
    deck,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(sessionFromHost(result.data));
}

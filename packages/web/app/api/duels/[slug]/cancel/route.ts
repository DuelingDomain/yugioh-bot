import { NextResponse } from "next/server";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug } = await params;

  const result = await callDuelHost({
    op: "cancel",
    slug,
    guildId: actor.guildId,
    playerId: actor.playerId,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data);
}

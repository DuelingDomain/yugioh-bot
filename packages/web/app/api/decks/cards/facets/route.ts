import { NextResponse } from "next/server";
import { callDuelHost, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/** Archetype list and banlist limits for the deck editor filters. */
export async function GET() {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const result = await callDuelHost({
    op: "card-facets",
    guildId: actor.guildId,
    playerId: actor.playerId,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { headers: { "Cache-Control": "private, max-age=3600" } });
}

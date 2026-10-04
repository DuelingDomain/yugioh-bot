import { NextResponse } from "next/server";
import { createLiveNowService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

/**
 * What the sidebar's "Live now" row shows: the signed-in player's own duel that
 * needs them (running, between games, or waiting in a lobby), and how many duels
 * in progress they can see. Small database reads, no duel-host calls; the sidebar polls it.
 */
export async function GET() {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  try {
    const live = createLiveNowService(getDb()).forPlayer(actor.guildId, actor.playerId);
    return NextResponse.json(live, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

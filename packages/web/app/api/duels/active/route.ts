import { NextResponse } from "next/server";
import { createActiveDuelService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";

export const runtime = "nodejs";

export async function GET(_request: Request) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  try {
    const active = createActiveDuelService(getDb()).forPlayer(actor.guildId, actor.playerId);
    return NextResponse.json({ active }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

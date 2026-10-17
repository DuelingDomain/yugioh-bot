import { NextResponse } from "next/server";
import { callDuelHost } from "@/lib/duel-host";
import { requireReplayOwnerActor } from "@/lib/replay-fork-access";

export const runtime = "nodejs";
const noStore = (response: NextResponse) => { response.headers.set("cache-control", "private, no-store"); return response; };

export async function GET(request: Request) {
  const actor = await requireReplayOwnerActor();
  if (!actor.ok) return noStore(actor.response);
  if (new URL(request.url).searchParams.size > 0) {
    return noStore(NextResponse.json({ error: "Invalid fork list request", code: "INVALID_CURSOR" }, { status: 400 }));
  }
  const result = await callDuelHost({ op: "fork-list", guildId: actor.guildId, playerId: actor.playerId, userId: actor.userId });
  if (!result.ok) return noStore(result.response);
  const current = await requireReplayOwnerActor();
  if (!current.ok) return noStore(current.response);
  if (current.userId !== actor.userId || current.playerId !== actor.playerId || current.guildId !== actor.guildId) {
    return noStore(NextResponse.json({ error: "Replay access changed", code: "ACCESS_DENIED" }, { status: 404 }));
  }
  return noStore(NextResponse.json(result.data));
}

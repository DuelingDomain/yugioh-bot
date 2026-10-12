import { NextResponse } from "next/server";
import { callDuelHost, readReplayQuery } from "@/lib/duel-host";
import { requireOwnerReplaySource, requireReplayOwnerActor } from "@/lib/replay-fork-access";
import { getDb } from "@/lib/db";
import { savedReplayBoardResponse } from "@/lib/saved-replay-board";

export const runtime = "nodejs";
const noStore = (response: NextResponse) => { response.headers.set("cache-control", "private, no-store"); return response; };

export async function GET(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (new URL(request.url).searchParams.get("unchecked") === "1") {
    const owner = await requireReplayOwnerActor();
    if (!owner.ok) return owner.response.status === 404
      ? noStore(NextResponse.json({ error: "Unchecked replay requires owner access", code: "ACCESS_DENIED" }, { status: 403 })) : owner.response;
  }
  const actor = await requireOwnerReplaySource(slug);
  if (!actor.ok) return actor.response;
  const query = readReplayQuery(request, true);
  if (!query.ok) return query.response;
  const result = await callDuelHost({ op: "owner-replay", slug, guildId: actor.guildId,
    playerId: actor.playerId, userId: actor.userId, ...query.input });
  if (!result.ok && result.response.status !== 413 && result.response.status !== 409) return noStore(result.response);
  // A long engine build must not return private cards after access is revoked.
  const current = await requireOwnerReplaySource(slug);
  if (!current.ok) return current.response;
  if (current.userId !== actor.userId || current.playerId !== actor.playerId || current.guildId !== actor.guildId) {
    return noStore(NextResponse.json({ error: "Replay access changed. Reload the replay.", code: "ACCESS_DENIED" }, { status: 404 }));
  }
  if (!result.ok) {
    const fallback = await savedReplayBoardResponse(result.response, {
      db: getDb(), session: current.duels.get(slug, current.guildId), playerId: current.playerId,
      owner: true, ...query.input,
    });
    if (fallback) {
      const verified = await requireOwnerReplaySource(slug);
      if (!verified.ok) return verified.response;
      if (verified.userId !== current.userId || verified.playerId !== current.playerId || verified.guildId !== current.guildId) {
        return noStore(NextResponse.json({ error: "Replay access changed. Reload the replay.", code: "ACCESS_DENIED" }, { status: 404 }));
      }
    }
    return fallback ?? noStore(result.response);
  }
  return noStore(NextResponse.json(result.data));
}

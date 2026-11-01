import { notifyRemoteChange, remoteBody, remoteError, remoteJson, remoteSeatCount, requireRemoteActor } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const scope = new URL(request.url).searchParams.get("scope") ?? "mine";
    remoteAssert(scope === "mine" || scope === "open", "Invalid table scope");
    return remoteJson({ tables: actor.remote.list(actor.guildId, actor.userId, scope) });
  } catch (error) { return remoteError(error); }
}
export async function POST(request: Request) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const body = await remoteBody(request, ["gameId", "seatCount"]);
    remoteAssert(typeof body.gameId === "string", "Invalid game");
    const room = actor.remote.create({ guildId: actor.guildId, userId: actor.userId, displayName: actor.displayName,
      gameId: body.gameId, seatCount: remoteSeatCount(body.seatCount) });
    await notifyRemoteChange(room.slug, actor.guildId);
    return remoteJson(room, 201);
  } catch (error) { return remoteError(error); }
}

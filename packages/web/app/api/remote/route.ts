import { notifyRemoteChange, remoteBody, remoteError, remoteJson, remoteSeatCount, requireRemoteActor } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const scope = new URL(request.url).searchParams.get("scope") ?? "mine";
    remoteAssert(scope === "mine" || scope === "open" || scope === "live", "Invalid table scope");
    return remoteJson({ tables: actor.remote.list(actor.guildId, actor.userId, scope) });
  } catch (error) { return remoteError(error); }
}
export async function POST(request: Request) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const body = await remoteBody(request, ["gameId", "seatCount", "solo", "format", "rules", "showCardsSetFromDeck"]);
    remoteAssert(typeof body.gameId === "string", "Invalid game");
    remoteAssert(body.solo === undefined || typeof body.solo === "boolean", "Invalid solo setting");
    remoteAssert(body.showCardsSetFromDeck === undefined || typeof body.showCardsSetFromDeck === "boolean", "Invalid Deck publicity setting");
    const room = actor.remote.create({ guildId: actor.guildId, userId: actor.userId, displayName: actor.displayName,
      gameId: body.gameId, seatCount: remoteSeatCount(body.seatCount), solo: body.solo as boolean | undefined, format: body.format, rules: body.rules, showCardsSetFromDeck: body.showCardsSetFromDeck as boolean | undefined });
    await notifyRemoteChange(room.slug, actor.guildId);
    return remoteJson(room, 201);
  } catch (error) { return remoteError(error); }
}

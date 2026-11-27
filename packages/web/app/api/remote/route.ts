import { notifyRemoteChange, remoteBody, remoteMaxLiveRooms, remoteError, remoteJson, remoteRoomForViewer, remoteSeatCount, requireRemoteActor } from "@/lib/remote-duels";
import { remoteAssert, remoteBestOfSchema, type RemoteFirstPlayerMode, type RemoteRevealedHand, type RemoteVisibility } from "@yugidraft/shared/remote";
export const runtime = "nodejs";
export async function GET(request: Request) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const scope = new URL(request.url).searchParams.get("scope") ?? "mine";
    remoteAssert(scope === "mine" || scope === "open" || scope === "live" || scope === "all", "Invalid table scope");
    return remoteJson({ tables: actor.remote.list(actor.guildId, actor.userId, scope) });
  } catch (error) { return remoteError(error); }
}
export async function POST(request: Request) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const body = await remoteBody(request, ["gameId", "seatCount", "bestOf", "solo", "format", "rules", "showCardsSetFromDeck", "revealedHand", "firstPlayer", "visibility", "matchTimeMinutes"]);
    remoteAssert(body.visibility === undefined || body.visibility === "public" || body.visibility === "private", "Invalid visibility");
    remoteAssert(typeof body.gameId === "string", "Invalid game");
    remoteAssert(body.solo === undefined || typeof body.solo === "boolean", "Invalid solo setting");
    remoteAssert(body.revealedHand === undefined || body.revealedHand === 'until-played' || body.revealedHand === 'one-turn', 'Invalid revealed hand setting');
    remoteAssert(body.firstPlayer === undefined || body.firstPlayer === "dice" || body.firstPlayer === "own", "Invalid first player setting");
    remoteAssert(body.showCardsSetFromDeck === undefined || typeof body.showCardsSetFromDeck === "boolean", "Invalid Deck publicity setting");
    const bestOf = remoteBestOfSchema.optional().safeParse(body.bestOf);
    remoteAssert(bestOf.success, "Match bestOf must be 1 or 3");
    // A new room ends this host's own empty lobbies (same as an online table), so a setup left with Back never stacks up.
    let replaced: string[] = [];
    const room = actor.remote.create({ replaceEmptyLobbies: slugs => { replaced = slugs; }, maxLiveRooms: remoteMaxLiveRooms(), guildId: actor.guildId, userId: actor.userId, displayName: actor.displayName,
      gameId: body.gameId, seatCount: remoteSeatCount(body.seatCount), bestOf: bestOf.data, solo: body.solo as boolean | undefined, format: body.format, rules: body.rules, showCardsSetFromDeck: body.showCardsSetFromDeck as boolean | undefined, revealedHand: body.revealedHand as RemoteRevealedHand | undefined, firstPlayer: body.firstPlayer as RemoteFirstPlayerMode | undefined, visibility: body.visibility as RemoteVisibility | undefined, matchTimeMinutes: body.matchTimeMinutes });
    await Promise.all([room.slug, ...replaced].map(slug => notifyRemoteChange(slug, actor.guildId)));
    return remoteJson(remoteRoomForViewer(room, actor.userId), 201);
  } catch (error) { return remoteError(error); }
}

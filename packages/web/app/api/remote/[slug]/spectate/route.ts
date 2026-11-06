import { removeSpectatorVideo } from "@/lib/remote/spectator-server";
import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
export const runtime = "nodejs";
/** Takes or keeps a spectator slot and returns the spectator view. requireRemoteActor applies REMOTE_DUELS_USERS as on every remote route. */
export async function POST(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    return remoteJson(actor.remote.spectate(slug, actor.guildId, actor.userId));
  } catch (error) { return remoteError(error); }
}
export async function DELETE(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    actor.remote.stopSpectating(slug, actor.guildId, actor.userId);
    await removeSpectatorVideo(slug, actor.userId);
    return remoteJson({ ok: true });
  } catch (error) { return remoteError(error); }
}

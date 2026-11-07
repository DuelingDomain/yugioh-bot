import { removeSpectatorVideo } from "@/lib/remote/spectator-server";
import { notifyRemoteChange, remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { isOwnerUser } from "@/lib/owner-access";
export const runtime = "nodejs";
/**
 * Takes or keeps a spectator slot and returns the spectator view. requireRemoteActor applies REMOTE_DUELS_USERS as on every remote route.
 * `{ "admin": true }` asks to watch a private table; it works only for the owner list. Anyone else gets the public rule.
 */
export async function POST(request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const asked = ((await request.json().catch(() => null)) as { admin?: unknown } | null)?.admin === true;
    const now = Date.now();
    const view = actor.remote.spectate(slug, actor.guildId, actor.userId, now, { admin: asked && isOwnerUser(actor.userId) });
    // An admin join adds one public log line (stamped `now`): the players hear of it at once.
    if (view.events.some(event => event.at === now && event.userId === actor.userId && event.action.type === "admin.watching")) await notifyRemoteChange(slug, actor.guildId);
    return remoteJson(view);
  } catch (error) { return remoteError(error); }
}
export async function DELETE(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    actor.remote.stopSpectating(slug, actor.guildId, actor.userId);
    await removeSpectatorVideo(slug, actor.userId);
    await notifyRemoteChange(slug, actor.guildId);
    return remoteJson({ ok: true });
  } catch (error) { return remoteError(error); }
}

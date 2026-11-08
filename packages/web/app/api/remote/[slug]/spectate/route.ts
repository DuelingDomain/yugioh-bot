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
    const body = (await request.json().catch(() => null)) as { admin?: unknown; tab?: unknown } | null;
    const asked = body?.admin === true;
    const now = Date.now();
    // The first take of a slot by an admin changes the badge, and may add a log line: the players hear of it at once. Polls do not notify.
    const tookSlot = isOwnerUser(actor.userId) && !actor.remote.isSpectating(slug, actor.guildId, actor.userId, now);
    const view = actor.remote.spectate(slug, actor.guildId, actor.userId, now, { admin: asked && isOwnerUser(actor.userId), tab: tabId(body?.tab) });
    if (tookSlot || view.events.some(event => event.at === now && event.action.type === "admin.watching")) await notifyRemoteChange(slug, actor.guildId);
    return remoteJson(view);
  } catch (error) { return remoteError(error); }
}
/** A tab id is a short token the page makes up; anything else is ignored. */
const tabId = (value: unknown) => typeof value === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(value) ? value : undefined;
export async function DELETE(request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const tab = tabId(new URL(request.url).searchParams.get("tab"));
    actor.remote.stopSpectating(slug, actor.guildId, actor.userId, Date.now(), tab);
    // Another open tab of this person keeps the slot, and the video with it.
    if (!actor.remote.isSpectating(slug, actor.guildId, actor.userId)) await removeSpectatorVideo(slug, actor.userId);
    await notifyRemoteChange(slug, actor.guildId);
    return remoteJson({ ok: true });
  } catch (error) { return remoteError(error); }
}

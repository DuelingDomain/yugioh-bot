import { createRemoteConnectionToken, REMOTE_CONNECTION_TTL_MS } from "@yugidraft/shared/ws";
import { remoteAssert } from "@yugidraft/shared/remote";
import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
export const runtime = "nodejs";
export async function GET(request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    remoteAssert(new URL(request.url).searchParams.size === 0, "Connection identity cannot be changed");
    const { slug } = await context.params;
    const access = actor.remote.connectionAccess(slug, actor.guildId, actor.userId);
    remoteAssert(access.status !== "ended" && Date.now() - access.lastEventAt < 10 * 60_000, "Table has ended", 409, "TABLE_ENDED");
    const secret = process.env.WS_INTERNAL_SECRET;
    if (!secret) return remoteJson({ error: "Realtime is unavailable", code: "REALTIME_UNAVAILABLE" }, 503);
    const expiresAt = Date.now() + REMOTE_CONNECTION_TTL_MS;
    const token = createRemoteConnectionToken({ slug, guildId: actor.guildId, userId: actor.userId, seat: access.seat, expiresAt }, secret);
    return remoteJson({ token, guildId: actor.guildId, seat: access.seat, expiresAt });
  } catch (error) { return remoteError(error); }
}

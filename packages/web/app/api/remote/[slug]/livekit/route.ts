import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
export const runtime = "nodejs";
/** Video-worker extension point. Never mint permissive tokens or return API secrets. */
export async function POST(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const room = actor.remote.get(slug, actor.guildId, actor.userId);
    remoteAssert(room.status !== "ended", "Table has ended", 409);
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return remoteJson({ error: "Video is not configured", code: "LIVEKIT_UNAVAILABLE" }, 503);
    }
    return remoteJson({ error: "Video token provider is not installed", code: "LIVEKIT_NOT_IMPLEMENTED" }, 503);
  } catch (error) { return remoteError(error); }
}

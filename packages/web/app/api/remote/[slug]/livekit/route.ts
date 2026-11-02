import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
import { AccessToken, TrackSource } from "livekit-server-sdk";
export const runtime = "nodejs";
/** Membership is checked before reading media configuration; identities are never client supplied. */
export async function POST(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const room = actor.remote.get(slug, actor.guildId, actor.userId);
    remoteAssert(room.status !== "ended" && Date.now() - room.lastEventAt < 10 * 60_000, "Table has ended", 409);
    if (room.solo && new URL(_request.url).searchParams.get("receive") !== "1") return remoteJson({ mode: "solo", required: false, code: "SOLO_LOCAL_PREVIEW", message: "Solo tables use a local camera preview; no LiveKit token is needed." });
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return remoteJson({ error: "Video is not configured", code: "LIVEKIT_UNAVAILABLE" }, 503);
    }
    const name = `remote-${room.slug}`;
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: `remote-user-${actor.userId}`, ttl: 300,
      name: room.seats.find(seat => seat.seat === room.mySeat)!.displayName,
      metadata: JSON.stringify({ guildId: actor.guildId, tableId: room.slug, seat: room.mySeat, userId: actor.userId }),
    });
    token.addGrant({ roomJoin: true, room: name, canPublish: true, canSubscribe: true,
      canPublishData: true, canPublishSources: [TrackSource.CAMERA, TrackSource.MICROPHONE], canUpdateOwnMetadata: false });
    return remoteJson({ url: process.env.LIVEKIT_URL, token: await token.toJwt(), room: name, seat: room.mySeat });
  } catch (error) { return remoteError(error); }
}

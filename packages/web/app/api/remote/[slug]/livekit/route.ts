import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
import { AccessToken, TrackSource } from "livekit-server-sdk";
import { admitSpectator, makeRoomForPlayer, remoteVoiceRoom } from "@/lib/remote/spectator-server";
export const runtime = "nodejs";
/** Membership is checked before reading media configuration; identities are never client supplied. */
export async function POST(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const room = actor.remote.connectionAccess(slug, actor.guildId, actor.userId);
    remoteAssert(room.status !== "ended" && Date.now() - room.lastEventAt < 10 * 60_000, "Table has ended", 409);
    if (room.solo && new URL(_request.url).searchParams.get("receive") !== "1") return remoteJson({ mode: "solo", required: false, code: "SOLO_LOCAL_PREVIEW", message: "Solo tables use a local camera preview; no LiveKit token is needed." });
    if (!process.env.LIVEKIT_URL || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return remoteJson({ error: "Video is not configured", code: "LIVEKIT_UNAVAILABLE" }, 503);
    }
    const name = `remote-${room.slug}`;
    if (new URL(_request.url).searchParams.get("voice") === "1") {
      // Voice has its own room, and only this seated branch mints a token for it. A LiveKit grant cannot limit a subscriber by track source.
      remoteAssert(room.seat !== null, "Spectators have no voice", 403, "SPECTATOR_READ_ONLY");
      const talk = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: `remote-user-${actor.userId}`, ttl: 300, name: room.displayName,
        metadata: JSON.stringify({ guildId: actor.guildId, tableId: room.slug, seat: room.seat, userId: actor.userId }),
      });
      const voiceRoom = remoteVoiceRoom(room.slug);
      talk.addGrant({ roomJoin: true, room: voiceRoom, canPublish: true, canSubscribe: true, canPublishData: false, canPublishSources: [TrackSource.MICROPHONE], canUpdateOwnMetadata: false });
      return remoteJson({ url: process.env.LIVEKIT_URL, token: await talk.toJwt(), room: voiceRoom, seat: room.seat });
    }
    if (room.seat === null) {
      await admitSpectator(room.slug, actor.userId);
      // Receive only, and hidden from the players' participant lists. The identity can never match a seat.
      const watcher = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
        identity: `remote-spectator-${actor.userId}`, ttl: 300, name: "Spectator",
        metadata: JSON.stringify({ guildId: actor.guildId, tableId: room.slug, role: "spectator", userId: actor.userId }),
      });
      watcher.addGrant({ roomJoin: true, room: name, canPublish: false, canPublishData: false, canSubscribe: true, hidden: true, canUpdateOwnMetadata: false });
      return remoteJson({ url: process.env.LIVEKIT_URL, token: await watcher.toJwt(), room: name, seat: null });
    }
    await makeRoomForPlayer(room.slug, `remote-user-${actor.userId}`);
    const token = new AccessToken(process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET, {
      identity: `remote-user-${actor.userId}`, ttl: 300,
      name: room.displayName,
      metadata: JSON.stringify({ guildId: actor.guildId, tableId: room.slug, seat: room.seat, userId: actor.userId }),
    });
    token.addGrant({ roomJoin: true, room: name, canPublish: true, canSubscribe: true,
      canPublishData: true, canPublishSources: [TrackSource.CAMERA], canUpdateOwnMetadata: false });
    return remoteJson({ url: process.env.LIVEKIT_URL, token: await token.toJwt(), room: name, seat: room.seat });
  } catch (error) { return remoteError(error); }
}

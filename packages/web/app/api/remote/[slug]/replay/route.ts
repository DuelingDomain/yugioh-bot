import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
export const runtime = "nodejs";
/** An ended Remote table as board steps. The service checks the guild and the privacy: players, admins, or anyone for a public table. */
export async function GET(_request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    return remoteJson(await actor.remote.replayFramesAsync(slug, actor.guildId, actor.userId));
  } catch (error) { return remoteError(error); }
}

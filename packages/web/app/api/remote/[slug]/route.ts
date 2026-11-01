import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from "@/lib/remote-duels";
import { remoteAssert } from "@yugidraft/shared/remote";
export const runtime = "nodejs";
export async function GET(request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const { slug } = await context.params;
    const raw = new URL(request.url).searchParams.get("afterSeq");
    remoteAssert(raw === null || /^(0|[1-9]\d*)$/.test(raw), "Invalid event cursor");
    return remoteJson(actor.remote.get(slug, actor.guildId, actor.userId, raw === null ? undefined : Number(raw)));
  } catch (error) { return remoteError(error); }
}

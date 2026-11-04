import { remoteError, remoteJson, requireRemoteActor, type RemoteRouteContext } from '@/lib/remote-duels';
export const runtime = 'nodejs';
export async function GET(request: Request, context: RemoteRouteContext) {
  const actor = await requireRemoteActor(); if (!actor.ok) return actor.response;
  try {
    const {slug} = await context.params, params = new URL(request.url).searchParams;
    return remoteJson({candidates:actor.remote.searchCandidates(slug, actor.guildId, actor.userId, Number(params.get('seat')), Number(params.get('recentCardId')))});
  } catch (error) { return remoteError(error); }
}

import { createTournamentRemoteService, findTournamentReadAccess, TournamentRemoteError } from "@yugidraft/shared/services";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { broadcaster } from "@/lib/notify";
import { remoteError, remoteJson, remoteMaxLiveRooms } from "@/lib/remote-duels";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ slug: string; tmId: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  try {
    const { slug, tmId } = await params;
    const db = getDb();
    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) throw new TournamentRemoteError("Tournament not found", 404, "TOURNAMENT_NOT_FOUND");
    const tournamentMatchId = Number(tmId);
    if (!Number.isSafeInteger(tournamentMatchId) || tournamentMatchId <= 0) {
      throw new TournamentRemoteError("Tournament match not found", 404, "TOURNAMENT_MATCH_NOT_FOUND");
    }
    const result = createTournamentRemoteService(db).startMatch({ guildId: env.discordGuildId,
      tournamentId: access.id, tournamentMatchId, actorUserId: actor.userId, maxLiveRooms: remoteMaxLiveRooms() });
    if (result.created) void broadcaster.tournament({ kind: "match-updated", slug });
    return remoteJson({ ...result, tableUrl: `/duels/remote/${result.table.slug}` }, result.created ? 201 : 200);
  } catch (error) { return remoteError(error); }
}

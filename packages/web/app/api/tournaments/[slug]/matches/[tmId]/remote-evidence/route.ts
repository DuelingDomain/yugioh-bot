import { findTournamentReadAccess, TournamentRemoteError } from "@yugidraft/shared/services";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { isOwnerUser } from "@/lib/owner-access";
import { remoteError, remoteJson } from "@/lib/remote-duels";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string; tmId: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) {
    actor.response.headers.set("cache-control", "private, no-store");
    return actor.response;
  }
  try {
    const { slug, tmId } = await params;
    const db = getDb();
    const admin = isOwnerUser(actor.userId);
    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access || (!access.canRead && !admin)) {
      throw new TournamentRemoteError("Tournament not found", 404, "TOURNAMENT_NOT_FOUND");
    }
    const organizer = db.prepare("select id from tournaments where id=? and guild_id=? and created_by_user_id=?")
      .get(access.id, env.discordGuildId, actor.userId);
    if (!organizer && !admin) {
      throw new TournamentRemoteError("Only the organizer or an admin can read evidence", 403, "ORGANIZER_REQUIRED");
    }
    const tournamentMatchId = Number(tmId);
    if (!Number.isSafeInteger(tournamentMatchId) || tournamentMatchId <= 0) {
      throw new TournamentRemoteError("Tournament match not found", 404, "TOURNAMENT_MATCH_NOT_FOUND");
    }
    const evidence = db.prepare(`select e.* from tournament_remote_evidence e
      join tournament_matches tm on tm.id=e.tournament_match_id
      where tm.id=? and tm.tournament_id=?`).get(tournamentMatchId, access.id);
    if (!evidence) {
      throw new TournamentRemoteError("Remote evidence not found", 404, "REMOTE_EVIDENCE_NOT_FOUND");
    }
    return remoteJson({ evidence });
  } catch (error) { return remoteError(error); }
}

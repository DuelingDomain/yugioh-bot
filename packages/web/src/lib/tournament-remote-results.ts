import { createMatchService, createTournamentRemoteResultService, findTournamentReadAccess, TournamentRemoteError } from "@yugidraft/shared/services";
import { requireWebAccess } from "./web-access";
import { getDb } from "./db";
import { env } from "./env";
import { announcer, broadcaster } from "./notify";
import { notifyRemoteChange, remoteError, remoteJson } from "./remote-duels";
import { readSmallJsonObject } from "./read-small-body";

export type TournamentRemoteResultContext = {params:Promise<{slug:string;tmId:string}>};

/** Same tournament invalidations/completion announcement used by other result writers. */
export async function notifyTournamentRemoteResult(slug:string, tournamentMatchId:number) {
  const db=getDb();
  const row=db.prepare(`select t.id,t.status,t.guild_id,r.table_slug from tournament_matches tm
    join tournaments t on t.id=tm.tournament_id left join tournament_remote_matches r on r.tournament_match_id=tm.id
    where tm.id=? and t.web_slug=? and t.guild_id=?`).get(tournamentMatchId,slug,env.discordGuildId) as
    {id:number;status:string;guild_id:string;table_slug:string|null} | undefined;
  if (!row) return;
  await broadcaster.tournament({kind:"match-updated",slug});
  if (row.table_slug) await notifyRemoteChange(row.table_slug,row.guild_id);
  if (row.status === "completed") {
    if (env.discordBotEnabled && createMatchService(db).claimTournamentCompletionAnnouncement(row.id)) {
      void announcer.announce({kind:"tournament-completed",tournamentId:row.id});
    }
    await broadcaster.tournament({kind:"completed",slug});
  }
}

export async function tournamentRemoteResultRequest(request:Request, context:TournamentRemoteResultContext,
  operation:"get"|"confirm"|"dispute"|"void") {
  const actor=await requireWebAccess();
  if (!actor.ok) { actor.response.headers.set("cache-control","private, no-store"); return actor.response; }
  try {
    const {slug,tmId}=await context.params, db=getDb();
    const access=findTournamentReadAccess(db,slug,env.discordGuildId,actor.userId);
    if (!access?.canRead) throw new TournamentRemoteError("Tournament not found",404,"TOURNAMENT_NOT_FOUND");
    const tournamentMatchId=Number(tmId);
    if (!Number.isSafeInteger(tournamentMatchId) || tournamentMatchId <= 0 || !db.prepare(
      "select 1 from tournament_matches where id=? and tournament_id=?").get(tournamentMatchId,access.id)) {
      throw new TournamentRemoteError("Tournament match not found",404,"TOURNAMENT_MATCH_NOT_FOUND");
    }
    const service=createTournamentRemoteResultService(db), input={tournamentMatchId,actorUserId:actor.userId};
    if (operation === "get") return remoteJson({remoteResult:service.get(input)});
    const body=await readSmallJsonObject(request,8192);
    if (!body || Object.keys(body).some(key=>operation === "confirm" || key !== "note") ||
      (body.note !== undefined && (typeof body.note !== "string" || body.note.length > 280))) {
      throw new TournamentRemoteError("Invalid Remote report",400,"INVALID_REMOTE_REPORT");
    }
    const remoteResult=operation === "confirm" ? service.confirm(input)
      : operation === "dispute" ? service.dispute({...input,note:body.note}) : service.void({...input,note:body.note});
    await notifyTournamentRemoteResult(slug,tournamentMatchId);
    return remoteJson({remoteResult});
  } catch (error) { return remoteError(error); }
}

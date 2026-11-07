import { report as reportError } from "../observability/index.js";
import type Database from "better-sqlite3";
import type { RemoteState } from "../remote/types.js";
import { createMatchService } from "./matches.js";
import { createTournamentService } from "./tournaments.js";
import { TournamentRemoteError } from "./tournament-remote-access.js";
import { captureTournamentEvidence } from "./tournament-remote-evidence.js";

export const REMOTE_RESULT_CONFIRM_MS = 2 * 60 * 60 * 1000;
type Choice = "confirm" | "dispute";
type ResultRow = {
  tournament_match_id: number; table_id: number | null; table_slug: string;
  player_one_id: number; player_two_id: number; status: "playing" | "proposed" | "disputed" | "final" | "void";
  winner_player_id: number | null; player_one_wins: number | null; player_two_wins: number | null;
  result_source: "concede" | "declared" | "lp" | null; proposed_at: number | null; confirm_deadline_at: number | null;
  player_one_choice: Choice | null; player_two_choice: Choice | null;
  player_one_note: string | null; player_two_note: string | null;
  player_one_responded_at: number | null; player_two_responded_at: number | null;
  finalized_at: number | null; finalization_reason: "both_confirmed" | "timeout" | "organizer" | null;
  organizer_user_id: number | null; organizer_decided_at: number | null; organizer_note: string | null;
};
export type TournamentRemoteResult = ReturnType<typeof mapResult>;
function mapResult(r: ResultRow) {
  return {
    tournamentMatchId:r.tournament_match_id, tableSlug:r.table_slug, status:r.status,
    winnerPlayerId:r.winner_player_id,
    score:r.player_one_wins === null || r.player_two_wins === null ? null : {playerOne:r.player_one_wins,playerTwo:r.player_two_wins},
    source:r.result_source, proposedAt:r.proposed_at, confirmDeadlineAt:r.confirm_deadline_at,
    reports:[{playerId:r.player_one_id,choice:r.player_one_choice,note:r.player_one_note,at:r.player_one_responded_at},
      {playerId:r.player_two_id,choice:r.player_two_choice,note:r.player_two_note,at:r.player_two_responded_at}],
    finalizedAt:r.finalized_at, finalizationReason:r.finalization_reason,
    organizerDecision:r.organizer_decided_at === null ? null : {userId:r.organizer_user_id,
      winnerPlayerId:r.status === "void" ? null : r.winner_player_id,void:r.status === "void",note:r.organizer_note,at:r.organizer_decided_at},
  };
}
function fail(message: string, status: number, code: string): never { throw new TournamentRemoteError(message,status,code); }
function noteValue(note: unknown): string | null {
  if (note === undefined) return null;
  if (typeof note !== "string" || note.length > 280) fail("Note must be at most 280 characters",400,"INVALID_REMOTE_REPORT");
  return note;
}

/** Used by every manual reporting entry point, under its recording transaction. */
export function assertNoOpenRemoteMatch(db: Database.Database, tournamentMatchId: number): void {
  if (db.prepare(`select 1 from remote_tables where tournament_match_id=? and status!='ended'
    union all select 1 from tournament_remote_matches where tournament_match_id=? and status in ('proposed','disputed') limit 1`)
    .get(tournamentMatchId,tournamentMatchId)) {
    fail("This match has an open Remote table or result. Confirm or dispute it, or ask the organizer to set the result.",409,"REMOTE_MATCH_OPEN");
  }
}

/** Organizer rulings close a live room too, so its later actions cannot propose another result. */
export function recordRemoteOrganizerDecision(db: Database.Database, input: {
  tournamentMatchId:number; organizerUserId:number; winnerPlayerId:number; recordedMatchId:number;
}, now = Date.now()): void {
  db.prepare(`update remote_tables set status='ended',ended_at=?,end_reason='organizer'
    where tournament_match_id=? and status!='ended'`).run(now,input.tournamentMatchId);
  db.prepare(`update tournament_remote_matches set status='final',winner_player_id=?,recorded_match_id=?,
    finalized_at=?,finalization_reason='organizer',organizer_user_id=?,organizer_decided_at=?,organizer_note=null,updated_at=?
    where tournament_match_id=?`).run(input.winnerPlayerId,input.recordedMatchId,now,input.organizerUserId,now,now,input.tournamentMatchId);
}

/** Shared with the established round-robin reopen action. */
export function voidRemoteResult(db:Database.Database, tournamentMatchId:number, organizerUserId:number, note:string|null, now=Date.now()): void {
  db.prepare("update remote_tables set status='ended',ended_at=?,end_reason='organizer' where tournament_match_id=? and status!='ended'")
    .run(now,tournamentMatchId);
  db.prepare(`update tournament_remote_matches set status='void',winner_player_id=null,finalized_at=null,finalization_reason=null,
    recorded_match_id=null,organizer_user_id=?,organizer_decided_at=?,organizer_note=?,updated_at=? where tournament_match_id=?`)
    .run(organizerUserId,now,note,now,tournamentMatchId);
}

export function createTournamentRemoteResultService(db: Database.Database) {
  const row = (id:number) => db.prepare("select * from tournament_remote_matches where tournament_match_id=?").get(id) as ResultRow | undefined;
  const required = (id:number) => row(id) ?? fail("Remote result not found",404,"REMOTE_RESULT_NOT_FOUND");
  const slot = (id:number) => {
    const found = db.prepare(`select tm.*,t.guild_id,t.web_slug,t.status as tournament_status,t.format,t.duel_type,t.created_by_user_id,
      p1.user_id as user_one_id,p2.user_id as user_two_id from tournament_matches tm
      join tournaments t on t.id=tm.tournament_id join players p1 on p1.id=tm.player_one_id
      left join players p2 on p2.id=tm.player_two_id where tm.id=?`).get(id) as {
        id:number;tournament_id:number;player_one_id:number;player_two_id:number|null;status:string;match_id:number|null;
        guild_id:string;web_slug:string|null;tournament_status:string;format:string;duel_type:string;created_by_user_id:number;
        user_one_id:number;user_two_id:number|null;
      } | undefined;
    return found ?? fail("Tournament match not found",404,"TOURNAMENT_MATCH_NOT_FOUND");
  };
  const active = (s:ReturnType<typeof slot>) => {
    if (s.tournament_status !== "active") fail("Tournament is not active",409,"TOURNAMENT_NOT_ACTIVE");
    if (s.status !== "open") fail("Tournament match is unavailable",409,"TOURNAMENT_MATCH_UNAVAILABLE");
  };
  const playerSide = (s:ReturnType<typeof slot>, userId:number) => {
    if (s.user_one_id === userId) return "one";
    if (s.user_two_id === userId) return "two";
    return fail("Only paired players may report a Remote result",403,"REMOTE_RESULT_PLAYER_REQUIRED");
  };
  const finalize = (r:ResultRow, reason:"both_confirmed"|"timeout", now:number) => {
    const s=slot(r.tournament_match_id); active(s);
    if (r.status !== "proposed" || r.winner_player_id === null) fail("Result is not proposed",409,"REMOTE_RESULT_NOT_PROPOSED");
    const match=createMatchService(db).recordConfirmedResult({guildId:s.guild_id,
      playerOneId:r.player_one_id,playerTwoId:r.player_two_id,winnerId:r.winner_player_id,
      source:"tournament",tournamentMatchId:s.id}, {strictScoring:true});
    db.prepare(`update tournament_remote_matches set status='final',finalized_at=?,finalization_reason=?,recorded_match_id=?,updated_at=?
      where tournament_match_id=?`).run(now,reason,match.id,now,s.id);
    return mapResult(required(s.id));
  };
  const report = (input:{tournamentMatchId:number;actorUserId:number;note?:unknown}, choice:Choice, now:number) => db.transaction(() => {
    const s=slot(input.tournamentMatchId), side=playerSide(s,input.actorUserId);
    const note=noteValue(input.note), r=required(s.id);
    if (r.status === "disputed") {
      if (choice === "dispute" && r[`player_${side}_choice`] === "dispute") return mapResult(r);
      if (choice === "confirm") fail("Remote result is disputed",409,"REMOTE_RESULT_DISPUTED");
    }
    if (r.status === "final") {
      if (choice === "confirm" && r[`player_${side}_choice`] === "confirm") return mapResult(r);
      fail("Remote result is final",409,"REMOTE_RESULT_FINAL");
    }
    if (r.status !== "proposed" && !(r.status === "disputed" && choice === "dispute")) fail("Remote result is not proposed",409,"REMOTE_RESULT_NOT_PROPOSED");
    active(s);
    if (choice === "confirm" && r[`player_${side}_choice`] === "confirm") return mapResult(r);
    db.prepare(`update tournament_remote_matches set player_${side}_choice=?,player_${side}_note=?,player_${side}_responded_at=?,
      status=?,updated_at=? where tournament_match_id=?`).run(choice,note,now,choice === "dispute" ? "disputed" : "proposed",now,s.id);
    const updated=required(s.id);
    return updated.player_one_choice === "confirm" && updated.player_two_choice === "confirm"
      ? finalize(updated,"both_confirmed",now) : mapResult(updated);
  }).immediate();

  return {
    get(input:{tournamentMatchId:number;actorUserId:number}): TournamentRemoteResult | null {
      const s=slot(input.tournamentMatchId);
      if (s.created_by_user_id !== input.actorUserId) playerSide(s,input.actorUserId);
      const r=row(s.id); return r ? mapResult(r) : null;
    },
    /** Called in the same transaction as the terminal reducer action. Idle/creator-left never call this. */
    propose(tableId:number, state:RemoteState, now=Date.now()): void {
      const r=db.prepare("select * from tournament_remote_matches where table_id=? and status='playing'").get(tableId) as ResultRow | undefined;
      if (!r || state.match.phase !== "done" || state.match.winnerSeat == null) return;
      const s=slot(r.tournament_match_id);
      if (s.tournament_status !== "active" || s.status !== "open") return;
      const seats=db.prepare(`select rs.seat,p.id as player_id from remote_seats rs join players p on p.user_id=rs.user_id
        where rs.table_id=? and p.guild_id=?`).all(tableId,s.guild_id) as {seat:number;player_id:number}[];
      const winner=seats.find(seat=>seat.seat === state.match.winnerSeat)?.player_id;
      if (!winner || ![r.player_one_id,r.player_two_id].includes(winner)) fail("Remote winner has no paired player",409,"TOURNAMENT_MATCH_UNAVAILABLE");
      const last=state.match.games.at(-1);
      if (!last || !["lp","concede","declared"].includes(last.reason)) fail("Remote result has no valid source",409,"REMOTE_RESULT_NOT_PROPOSED");
      const wins=(playerId:number) => state.match.games.filter(game=>game.winnerSeat != null && seats.find(seat=>seat.seat === game.winnerSeat)?.player_id === playerId).length;
      db.prepare(`update tournament_remote_matches set status='proposed',winner_player_id=?,player_one_wins=?,player_two_wins=?,
        result_source=?,proposed_at=?,confirm_deadline_at=?,updated_at=? where tournament_match_id=? and status='playing'`)
        .run(winner,wins(r.player_one_id),wins(r.player_two_id),last.reason,now,now+REMOTE_RESULT_CONFIRM_MS,now,r.tournament_match_id);
      captureTournamentEvidence(db,tableId);
    },
    /** A successful terminal Undo invalidates the proposal and every report of that outcome. */
    retractProposal(tableId:number,now=Date.now()) {
      const r=db.prepare("select * from tournament_remote_matches where table_id=?").get(tableId) as ResultRow | undefined;
      if (!r) fail("Remote result is not proposed",409,"REMOTE_RESULT_NOT_PROPOSED");
      if (r.status === "final") fail("Remote result is final",409,"REMOTE_RESULT_FINAL");
      if (r.status === "disputed") fail("Remote result is disputed",409,"REMOTE_RESULT_DISPUTED");
      if (r.status !== "proposed") fail("Remote result is not proposed",409,"REMOTE_RESULT_NOT_PROPOSED");
      db.prepare(`update tournament_remote_matches set status='playing',winner_player_id=null,player_one_wins=null,player_two_wins=null,
        result_source=null,proposed_at=null,confirm_deadline_at=null,player_one_choice=null,player_one_note=null,player_one_responded_at=null,
        player_two_choice=null,player_two_note=null,player_two_responded_at=null,updated_at=? where tournament_match_id=?`)
        .run(now,r.tournament_match_id);
    },
    confirm(input:{tournamentMatchId:number;actorUserId:number},now=Date.now()) { return report(input,"confirm",now); },
    dispute(input:{tournamentMatchId:number;actorUserId:number;note?:unknown},now=Date.now()) { return report(input,"dispute",now); },
    finalizeDue(now=Date.now()) {
      const due=db.prepare(`select r.tournament_match_id from tournament_remote_matches r
        join tournament_matches tm on tm.id=r.tournament_match_id join tournaments t on t.id=tm.tournament_id
        where r.status='proposed' and r.confirm_deadline_at<=? and t.status='active' and tm.status='open'
        and (r.player_one_choice='confirm' or r.player_two_choice='confirm' or r.result_source in ('concede','declared'))
        order by r.confirm_deadline_at,r.tournament_match_id`).all(now) as {tournament_match_id:number}[];
      const changes = [];
      for (const {tournament_match_id:id} of due) {
        try {
          const change=db.transaction(() => {
            // Recheck under the write lock: another process may have confirmed or disputed since the scan.
            const r=required(id), s=slot(id);
            if (r.status !== "proposed" || s.status !== "open" || s.tournament_status !== "active" ||
              r.confirm_deadline_at === null || r.confirm_deadline_at > now ||
              !(r.player_one_choice === "confirm" || r.player_two_choice === "confirm" || r.result_source === "concede" || r.result_source === "declared")) return null;
            finalize(r,"timeout",now);
            return {tournamentId:s.tournament_id,slug:s.web_slug,tournamentCompleted:
              (db.prepare("select status from tournaments where id=?").get(s.tournament_id) as {status:string}).status === "completed"};
          }).immediate();
          if (change) changes.push(change);
        } catch (error) {
          // Retry this proposal next tick without starving other proposals or losing their notifications.
          reportError(error,{tags:{operation:"remote-result-timeout"},extra:{tournamentMatchId:id}});
        }
      }
      return changes;
    },
    void(input:{tournamentMatchId:number;actorUserId:number;note?:unknown},now=Date.now()) {
      return db.transaction(() => {
        const s=slot(input.tournamentMatchId);
        if (s.created_by_user_id !== input.actorUserId) fail("Only the organizer can void a result",403,"ORGANIZER_REQUIRED");
        const note=noteValue(input.note), r=required(s.id);
        if (r.status === "void") return mapResult(r);
        if (s.status === "completed") {
          if (s.format !== "round_robin") fail("Completed single-elimination matches cannot be replayed",409,"REMOTE_REPLAY_UNAVAILABLE");
          createTournamentService(db).reopenTournamentMatch(s.id,input.actorUserId);
        } else {
          if (s.tournament_status !== "active") fail("Tournament is not active",409,"TOURNAMENT_NOT_ACTIVE");
          if (s.status !== "open") fail("Resolve the pending manual report first",409,"REMOTE_REPLAY_UNAVAILABLE");
        }
        voidRemoteResult(db,s.id,input.actorUserId,note,now);
        return mapResult(required(s.id));
      }).immediate();
    },
  };
}

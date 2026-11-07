import type Database from "better-sqlite3";

/** Keep the copy current even when reports arrive after its room has been purged. */
export function migrateTournamentRemoteEvidence(db: Database.Database): void {
  const refresh = (matchId: string) => `update tournament_remote_evidence set
    reports_json=(select json_array(
      json_object('userId',player_one_user_id,'choice',r.player_one_choice,'note',r.player_one_note,'at',r.player_one_responded_at),
      json_object('userId',player_two_user_id,'choice',r.player_two_choice,'note',r.player_two_note,'at',r.player_two_responded_at))
      from tournament_remote_matches r where r.tournament_match_id=tournament_remote_evidence.tournament_match_id),
    purge_after_at=(select case
      when r.organizer_decided_at is not null then min(hard_delete_at,r.organizer_decided_at+172800000)
      when r.status='disputed' then null
      when r.status='final' and r.finalization_reason='both_confirmed' then r.finalized_at
      when r.status='final' and r.finalized_at is not null then min(hard_delete_at,r.finalized_at+172800000)
      when r.status!='proposed' and r.proposed_at is null then min(hard_delete_at,table_ended_at+172800000)
      else null end from tournament_remote_matches r
      where r.tournament_match_id=tournament_remote_evidence.tournament_match_id)
    where tournament_match_id=${matchId} and table_slug=(select table_slug from tournament_remote_matches where tournament_match_id=${matchId});`;
  db.exec(`
    drop trigger if exists tournament_remote_evidence_insert;
    drop trigger if exists tournament_remote_evidence_reports;
    create trigger tournament_remote_evidence_insert after insert on tournament_remote_evidence
      begin ${refresh("new.tournament_match_id")} end;
    create trigger tournament_remote_evidence_reports after update of
      status,proposed_at,player_one_choice,player_one_note,player_one_responded_at,
      player_two_choice,player_two_note,player_two_responded_at,finalized_at,finalization_reason,organizer_decided_at
      on tournament_remote_matches begin ${refresh("new.tournament_match_id")} end;
    create trigger if not exists tournament_remote_evidence_cancel after update of status on tournaments
      when new.status='cancelled' begin
        delete from tournament_remote_evidence where tournament_match_id in
          (select id from tournament_matches where tournament_id=new.id);
      end;
    -- Apply the deadline to copies created before this migration, preserving older replay copies.
    ${refresh("tournament_remote_evidence.tournament_match_id")}
  `);
}

import { randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type { RemoteSystemAction } from "../remote/types.js";

/** End linked rooms inside the transaction that closes a tournament or resolves its pairing. */
export function endTournamentRemoteTables(db: Database.Database,
  scope: { tournamentId: number } | { tournamentMatchId: number },
  reason: "tournament-closed" | "match-completed" | "match-voided", now = Date.now()): void {
  const rooms = db.prepare(`select r.id,r.last_seq from remote_tables r
    join tournament_matches tm on tm.id=r.tournament_match_id
    where ${"tournamentId" in scope ? "tm.tournament_id" : "tm.id"}=? and (r.status!='ended' or r.end_reason='game')`)
    .all("tournamentId" in scope ? scope.tournamentId : scope.tournamentMatchId) as { id: number; last_seq: number }[];
  const action: RemoteSystemAction = { type: "table.ended", reason };
  for (const room of rooms) {
    db.prepare(`insert into remote_events(table_id,seq,idempotency_key,action_json,created_at)
      values(?,?,?,?,?)`).run(room.id, room.last_seq + 1, `sys:${randomUUID()}`, JSON.stringify(action), now);
    db.prepare(`update remote_tables set status='ended',ended_at=?,end_reason=?,last_seq=last_seq+1,
      last_event_at=?,idle_warning_at=null where id=?`).run(now, reason, now, room.id);
  }
}

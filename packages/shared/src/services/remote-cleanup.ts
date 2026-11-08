import { anonymizeRemoteData } from "./remote-anonymization.js";
import { randomUUID } from "node:crypto";
import { readRemoteState, writeRemoteState } from "../remote/storage.js";
import { captureRemoteTournamentEvidence } from "./tournament-remote-evidence.js";
import { getRemoteGame } from "../remote/index.js";
import type { RemoteAction } from "../remote/actions.js";
import type { RemoteSystemAction } from "../remote/types.js";
import type Database from "better-sqlite3";

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name);
}

/** Call inside the caller's writer transaction. Optional web tables have no room FK. */
export function deleteRemoteRooms(db: Database.Database, rooms: {id: number; slug: string}[]): number {
  if (!rooms.length) return 0;
  const children = ["remote_phone_pairs", "remote_phone_modes", "remote_phone_attempts"]
    .filter(name => hasTable(db, name)).map(name => db.prepare(`delete from ${name} where slug=?`));
  const remove = db.prepare("delete from remote_tables where id=?");
  let deleted = 0;
  for (const room of rooms) {
    for (const child of children) child.run(room.slug);
    // Room triggers collect events, seats, spectators, state references and unused facts/positions.
    deleted += remove.run(room.id).changes;
  }
  return deleted;
}

/** Remove ended-room sessions and expired rate limits; keep all replay/history inputs. */
export function pruneRemoteSessions(db: Database.Database, now: number): void {
  // These are live session bookkeeping, never inputs to history, replay or Undo.
  // Leave time for phone teardown retries and the ten-minute game-end Undo window.
  const endedBefore = now - 15 * 60_000;
  for (const name of ["remote_phone_pairs", "remote_phone_modes", "remote_phone_attempts"]) {
    if (hasTable(db, name)) db.prepare(`delete from ${name} where exists (select 1 from remote_tables t where t.slug=${name}.slug and t.status='ended' and t.ended_at<?)`).run(endedBefore);
  }
  for (const name of ["remote_spectators", "remote_spectator_tabs", "remote_admin_watch"]) {
    db.prepare(`delete from ${name} where exists (select 1 from remote_tables t where t.id=${name}.table_id and t.status='ended' and t.ended_at<?)`).run(endedBefore);
  }
  if (hasTable(db, "remote_phone_attempts")) {
    db.prepare("delete from remote_phone_attempts where slug is null or started_at<=?").run(now - 5 * 60_000);
  }
  if (hasTable(db, "remote_vision_ai_limits")) {
    db.prepare("delete from remote_vision_ai_limits where window_started_at<=?").run(now - 3_600_000);
  }
}

export function deleteUserRemoteData(db: Database.Database, userId: number, deletedName = "Deleted player"): { deleted: number; tables: {slug: string; guildId: string}[] } {
  if (!db.inTransaction) throw new Error("Remote privacy deletion requires a transaction");
  const rooms = db.prepare(`select id,slug,guild_id,game_id,seat_count,status,created_by from remote_tables t where created_by=?
    or exists(select 1 from remote_seats s where s.table_id=t.id and s.user_id=?)
    or exists(select 1 from remote_events e where e.table_id=t.id and e.user_id=?)`)
    .all(userId, userId, userId) as {id:number;slug:string;guild_id:string;game_id:string;seat_count:number;status:string;created_by:number|null}[];
  const now = Date.now();
  for (const room of rooms) {
    const seat = db.prepare("select seat from remote_seats where table_id=? and user_id=?").get(room.id,userId) as {seat:number} | undefined;
    // Historical actors have no live seat to vacate. Ended rooms keep their original outcome.
    if (room.status === "ended" || !seat) continue;
    let action: RemoteSystemAction | RemoteAction;
    let effects: string | null = null;
    let ended = false;
    const idempotencyKey = `sys:${randomUUID()}`;
    if (room.status === "lobby" && room.created_by !== userId) {
      db.prepare("delete from remote_seats where table_id=? and user_id=?").run(room.id,userId);
      const {state_json} = db.prepare("select state_json from remote_tables where id=?").get(room.id) as {state_json:string};
      const state = readRemoteState(db,state_json);
      delete state.deckChecks.registrations[seat.seat];
      db.prepare("update remote_tables set state_json=? where id=?").run(writeRemoteState(db,room.id,state),room.id);
      action = {type:"seat.left",seat:seat.seat,userId:null};
    } else if (room.status === "active" && room.seat_count > 2) {
      const {state_json} = db.prepare("select state_json from remote_tables where id=?").get(room.id) as {state_json:string};
      const before = readRemoteState(db,state_json);
      action = {type:"player.concede",actorSeat:seat.seat,idempotencyKey,at:now};
      const context = {accountDeletion:1,showCardsSetFromDeck:before.showCardsSetFromDeck,undoVersion:1,matchFlowVersion:1,twinPlacementGuard:5,fieldFaceState:1,pileArrivalGuard:2,handKnowledge:1,handReview:1,handCountCorrections:1} as const;
      const state = getRemoteGame(room.game_id).reduce(before,action,context);
      effects = JSON.stringify(context);
      ended = state.match.phase === "done";
      db.prepare("update remote_tables set state_json=?,status=?,ended_at=?,end_reason=? where id=?")
        .run(writeRemoteState(db,room.id,state),ended ? "ended" : "active",ended ? now : null,ended ? "game" : null,room.id);
    } else {
      // A 1v1 concession can leave a best-of-three table waiting for the deleted player.
      const reason = room.status === "lobby" ? "creator-left" : "account-deleted";
      action = {type:"table.ended",reason};
      ended = true;
      db.prepare("update remote_tables set status='ended',ended_at=?,end_reason=? where id=?").run(now,reason,room.id);
    }
    db.prepare(`insert into remote_events(table_id,seq,idempotency_key,actor_seat,user_id,action_json,effects_json,created_at)
      select id,last_seq+1,?,?,null,?,?,? from remote_tables where id=?`)
      .run(idempotencyKey,seat.seat,JSON.stringify(action),effects,now,room.id);
    db.prepare("update remote_tables set last_seq=last_seq+1,last_event_at=?,idle_warning_at=null where id=?").run(now,room.id);
    if (ended) captureRemoteTournamentEvidence(db,room.id,now);
  }
  // Capture any new end evidence before scrubbing identity and authored text.
  anonymizeRemoteData(db,userId,deletedName,rooms.map(room=>room.id));
  const empty: typeof rooms = [];
  for (const room of rooms) {
    if (!db.prepare("select 1 from remote_seats where table_id=? and user_id is not null").get(room.id)) empty.push(room);
  }
  const deleted = deleteRemoteRooms(db, empty);
  db.prepare("delete from remote_spectators where user_id=?").run(userId);
  db.prepare("delete from remote_spectator_tabs where user_id=?").run(userId);
  db.prepare("delete from remote_admin_watch where user_id=?").run(userId);
  for (const name of ["remote_phone_pairs", "remote_phone_modes", "remote_vision_ai_limits"]) {
    if (hasTable(db, name)) db.prepare(`delete from ${name} where user_id=?`).run(userId);
  }
  // Phone rate buckets are shared by room/IP, with no user link. Only room collection
  // or expiry may remove them; account deletion must preserve other players' limits.
  return {deleted,tables:rooms.map(room=>({slug:room.slug,guildId:room.guild_id}))};
}

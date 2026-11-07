import type Database from "better-sqlite3";

function hasTable(db: Database.Database, name: string): boolean {
  return !!db.prepare("select 1 from sqlite_master where type='table' and name=?").get(name);
}

/** Call inside the caller's writer transaction. Optional web tables have no room FK. */
export function deleteRemoteRooms(db: Database.Database, rooms: {id: number; slug: string}[]): number {
  if (!rooms.length) return 0;
  const children = ["remote_phone_pairs", "remote_phone_modes", "remote_phone_attempts"]
    .filter(name => hasTable(db, name)).map(name => db.prepare(`delete from ${name} where slug=?${name === "remote_phone_attempts" ? " or slug is null" : ""}`));
  const remove = db.prepare("delete from remote_tables where id=?");
  let deleted = 0;
  for (const room of rooms) {
    for (const child of children) child.run(room.slug);
    // Room triggers collect events, seats, spectators, state references and unused facts/positions.
    deleted += remove.run(room.id).changes;
  }
  return deleted;
}

/** No image, user or room association exists in legacy hashed pairing buckets. */
export function pruneRemoteSessions(db: Database.Database, now: number): void {
  if (hasTable(db, "remote_phone_attempts")) {
    db.prepare("delete from remote_phone_attempts where slug is null or started_at<=?").run(now - 5 * 60_000);
  }
  if (hasTable(db, "remote_vision_ai_limits")) {
    db.prepare("delete from remote_vision_ai_limits where window_started_at<=?").run(now - 3_600_000);
  }
}

export function deleteUserRemoteData(db: Database.Database, userId: number): number {
  db.prepare('delete from tournament_remote_evidence where player_one_user_id=? or player_two_user_id=?').run(userId,userId);
  const rooms = db.prepare(`select id,slug from remote_tables t where created_by=?
    or exists(select 1 from remote_seats s where s.table_id=t.id and s.user_id=?)
    or exists(select 1 from remote_events e where e.table_id=t.id and e.user_id=?)`)
    .all(userId, userId, userId) as {id: number; slug: string}[];
  const deleted = deleteRemoteRooms(db, rooms);
  db.prepare("delete from remote_spectators where user_id=?").run(userId);
  for (const name of ["remote_phone_pairs", "remote_phone_modes", "remote_vision_ai_limits"]) {
    if (hasTable(db, name)) db.prepare(`delete from ${name} where user_id=?`).run(userId);
  }
  // Old buckets cannot be attributed to a user; discard them rather than keep them indefinitely.
  if (hasTable(db, "remote_phone_attempts")) db.prepare("delete from remote_phone_attempts where slug is null").run();
  return deleted;
}

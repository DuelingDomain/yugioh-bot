import type Database from "better-sqlite3";

/** Run inside the account operation's transaction, before the source user is removed. */
export function transferIdeaAccount(db: Database.Database, sourceId: number, targetId: number): void {
  // Copy only new keys: an existing survivor vote, notice or permission keeps all its fields.
  db.prepare(`insert or ignore into idea_votes(idea_id,user_id,value,created_at,updated_at)
    select idea_id,?,value,created_at,updated_at from idea_votes where user_id=?`).run(targetId, sourceId);
  db.prepare(`insert or ignore into idea_notices(user_id,idea_id,kind,note,created_at,read_at)
    select ?,idea_id,kind,note,created_at,read_at from idea_notices where user_id=?`).run(targetId, sourceId);
  db.prepare(`insert or ignore into user_permissions(user_id,permission,granted_at,granted_by_user_id)
    select ?,permission,granted_at,granted_by_user_id from user_permissions where user_id=?`).run(targetId, sourceId);
  for (const table of ["idea_votes", "idea_notices", "user_permissions"]) {
    db.prepare(`delete from ${table} where user_id=?`).run(sourceId);
  }
  db.prepare("update ideas set author_user_id=? where author_user_id=?").run(targetId, sourceId);
  db.prepare("update ideas set decided_by_user_id=? where decided_by_user_id=?").run(targetId, sourceId);
  db.prepare("update user_permissions set granted_by_user_id=? where granted_by_user_id=?").run(targetId, sourceId);
  // Aggregate max ignores a null timestamp and returns null when neither account saw a prompt.
  db.prepare(`update users set ideas_prompt_at=(select max(ideas_prompt_at) from users where id in (?,?))
    where id=?`).run(sourceId, targetId, targetId);
}

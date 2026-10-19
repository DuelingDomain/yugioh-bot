import type Database from "better-sqlite3";
import { notificationSubjectHash } from "./subject.js";

/** Use before scrubbing identity. Runs in the caller's deletion transaction. */
export function clearDiscordSubject(db: Database.Database, subject: {
  email?: string | null; subjectId?: string | null; siteUserId?: number; discordUserId?: string | null;
}): { actions: number; outbox: number; modActions: number; signups: number } {
  let outbox = 0;
  let actions = 0;
  let signups = 0;
  const hashes = new Set<string>();
  for (const input of [{ email: subject.email ?? undefined }, { subjectId: subject.subjectId ?? undefined }]) {
    const hash = notificationSubjectHash(input);
    if (hash) hashes.add(hash);
  }
  // Read old subject hashes and local signup IDs before cascades erase the links.
  // Current email alone is insufficient after a Clerk email change.
  const linked = db.prepare<[number | null, string | null], { subject_hash: string | null; waitlist_signup_id: number | null }>(`
    select subject_hash,waitlist_signup_id from discord_waitlist_actions
    where subject_user_id=? or subject_clerk_id=?`).all(subject.siteUserId ?? null, subject.subjectId ?? null);
  for (const row of linked) if (row.subject_hash) hashes.add(row.subject_hash);
  if (subject.subjectId) for (const row of db.prepare<[string], { subject_hash: string }>(
    "select subject_hash from discord_join_subjects where clerk_user_id=?").all(subject.subjectId)) hashes.add(row.subject_hash);
  if (subject.subjectId) for (const row of db.prepare<[string], { subject_hash: string | null }>(
    "select subject_hash from discord_outbox where subject_clerk_id=?").all(subject.subjectId)) {
    if (row.subject_hash) hashes.add(row.subject_hash);
  }
  for (const hash of hashes) {
    outbox += db.prepare("delete from discord_outbox where subject_hash=?").run(hash).changes;
    actions += db.prepare("delete from discord_waitlist_actions where subject_hash=?").run(hash).changes;
    db.prepare("delete from join_request_notifications where subject_hash=?").run(hash);
    db.prepare("delete from discord_join_subjects where subject_hash=?").run(hash);
  }
  if (subject.siteUserId !== undefined) actions += db.prepare(`delete from discord_waitlist_actions
    where subject_user_id=? or actor_user_id=?`).run(subject.siteUserId, subject.siteUserId).changes;
  if (subject.subjectId) {
    outbox += db.prepare("delete from discord_outbox where subject_clerk_id=?").run(subject.subjectId).changes;
    actions += db.prepare("delete from discord_waitlist_actions where subject_clerk_id=?").run(subject.subjectId).changes;
  }
  if (subject.siteUserId !== undefined) for (const row of linked) if (row.waitlist_signup_id !== null) {
    signups += db.prepare("delete from waitlist_signups where id=?").run(row.waitlist_signup_id).changes;
  }
  const identity = [subject.siteUserId ?? null, subject.siteUserId ?? null,
    subject.discordUserId ?? null, subject.discordUserId ?? null, subject.discordUserId ?? null];
  const matchesIdentity = `actor_user_id=? or target_user_id=?
    or (? is not null and (actor_discord_id=? or target_discord_id=?))`;
  // Lock snapshots and successful unlock markers are also operational state.
  // Keep only channel recovery data, clearing FKs before account deletion so a
  // cascade cannot lose a saved overwrite or resurrect a restored snapshot.
  const retained = db.prepare(`update mod_actions set actor_user_id=null,actor_discord_id=null,
    target_user_id=null,target_discord_id=null,reason=null,
    params_json=case when action='lock_snapshot' then json_object(
      'channelId',json_extract(params_json,'$.channelId'),
      'previousOverwrite',json_extract(params_json,'$.previousOverwrite'))
      else json_object('channelId',json_extract(params_json,'$.channelId'),
        'snapshotId',json_extract(params_json,'$.snapshotId')) end
    where (${matchesIdentity}) and (action='lock_snapshot' or (action='unlock' and result='success'))
    returning id`).all(...identity) as { id: number }[];
  for (const row of retained) outbox += db.prepare("delete from discord_outbox where mod_action_id=?").run(row.id).changes;
  const modActions = retained.length + db.prepare(`delete from mod_actions where ${matchesIdentity}`).run(...identity).changes;
  if (subject.discordUserId) db.prepare("delete from mod_warnings where actor_discord_id=? or target_discord_id=?")
    .run(subject.discordUserId, subject.discordUserId);
  return { actions, outbox, modActions, signups };
}

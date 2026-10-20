import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { createClerkBackend, type ClerkBackend } from "../clerk/backend.js";
import { isAdminActor, lookupSiteAccount, type AdminActor } from "../discord-admin/access.js";
import { enqueueOutbox } from "../discord-admin/outbox.js";
import { recordModAction } from "../discord-admin/moderation.js";
import { notificationSubjectHash, normalizedNoticeEmail } from "../discord-admin/subject.js";

export type WaitlistDecision = "approve" | "reject";
export interface WaitlistAction {
  id: string; subject_hash: string | null; clerk_entry_id: string | null;
  waitlist_signup_id: number | null; subject_user_id: number | null; subject_clerk_id: string | null;
  decision: WaitlistDecision | null; actor_user_id: number | null; actor_discord_id: string | null;
  actor_name: string | null; source: "web" | "discord" | null; attempted_at: number | null;
  lease_token: string | null; lease_expires_at: number | null; completed_at: number | null;
  channel_id: string | null; message_id: string | null; discord_updated_at: number | null; created_at: number;
}
export class WaitlistDecisionError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code); this.name = "WaitlistDecisionError";
  }
}
export function getWaitlistAction(db: Database.Database, id: string): WaitlistAction | null {
  return db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where id=?").get(id) ?? null;
}

export function waitlistDecisionPayload(row: WaitlistAction): Record<string, unknown> {
  const name = (row.actor_name ?? "owner").replace(/[\\`*_~|<>\r\n]/g, " ").slice(0, 80);
  return { content: `${row.decision === "approve" ? "Approved" : "Rejected"} by ${name} (${row.source === "discord" ? "Discord" : "web"})`,
    embeds: [], components: [], allowed_mentions: { parse: [] } };
}

function enqueueDecisionEdit(db: Database.Database, row: WaitlistAction): void {
  const channelId = row.channel_id ?? process.env.DISCORD_WAITLIST_CHANNEL_ID?.trim();
  const payload = waitlistDecisionPayload(row);
  // A decision made before posting must never send an actionable or email-bearing alert.
  db.prepare(`update discord_outbox set payload_json=json_set(?, '$.nonce',json_extract(payload_json,'$.nonce'),
    '$.enforce_nonce',json('true')) where waitlist_action_id=?
    and operation='post' and status not in ('posted','dead')`).run(JSON.stringify(payload), row.id);
  // A web-first decision may have no Discord alert to update.
  const hasPost = row.message_id !== null || db.prepare(`select 1 from discord_outbox
    where waitlist_action_id=? and operation='post' and status!='dead' limit 1`).get(row.id);
  if (channelId && hasPost) enqueueOutbox(db, { idempotencyKey: `waitlist-decision:${row.id}`, kind: "waitlist_decision",
    operation: "edit", channelId, messageId: row.message_id, waitlistActionId: row.id,
    subjectHash: row.subject_hash ?? undefined, payload });
}

/** Bind local joins and Clerk deliveries before alert dedupe. Store hashes, not email text. */
export function prepareWaitlistAction(db: Database.Database, input: { email?: string; clerkEntryId?: string }): WaitlistAction {
  const hash = notificationSubjectHash(input);
  if (!hash && !input.clerkEntryId) throw new WaitlistDecisionError(400, "missing_waitlist_identity");
  return db.transaction(() => {
    const byHash = hash ? db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where subject_hash=?").get(hash) : undefined;
    const byClerk = input.clerkEntryId ? db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where clerk_entry_id=?").get(input.clerkEntryId) : undefined;
    let row = byHash ?? byClerk;
    // /admin can decide before the Clerk webhook binds a local form alert. Keep
    // the local action ID (already used by buttons) and move the decision to it.
    if (byHash && byClerk && byHash.id !== byClerk.id) {
      if (byHash.decision || byHash.lease_token || byClerk.lease_token) throw new WaitlistDecisionError(409, "waitlist_identity_busy");
      db.prepare("update discord_outbox set waitlist_action_id=? where waitlist_action_id=?").run(byHash.id, byClerk.id);
      db.prepare("delete from discord_waitlist_actions where id=?").run(byClerk.id);
      db.prepare(`update discord_waitlist_actions set decision=?,actor_user_id=?,actor_discord_id=?,actor_name=?,
        source=?,attempted_at=?,completed_at=? where id=?`).run(byClerk.decision, byClerk.actor_user_id,
        byClerk.actor_discord_id, byClerk.actor_name, byClerk.source, byClerk.attempted_at, byClerk.completed_at, byHash.id);
      // The decision key must follow the surviving action too.
      db.prepare("update discord_outbox set idempotency_key=? where idempotency_key=?")
        .run(`waitlist-decision:${byHash.id}`, `waitlist-decision:${byClerk.id}`);
      row = getWaitlistAction(db, byHash.id)!;
    }
    const email = input.email ? normalizedNoticeEmail(input.email) : null;
    const signup = email ? db.prepare<[string], { id: number }>("select id from waitlist_signups where email=?").get(email) : undefined;
    const user = email ? db.prepare<[string], { id: number; clerk_user_id: string | null }>("select id,clerk_user_id from users where email=?").get(email) : undefined;
    const signupNotice = hash ? db.prepare<[string], { clerk_user_id: string }>(
      "select clerk_user_id from discord_join_subjects where subject_hash=?").get(hash) : undefined;
    const id = row?.id ?? randomUUID();
    if (!row) db.prepare(`insert into discord_waitlist_actions(id,created_at) values(?,?)`).run(id, Date.now());
    db.prepare(`update discord_waitlist_actions set subject_hash=coalesce(subject_hash,?),clerk_entry_id=coalesce(clerk_entry_id,?),
      waitlist_signup_id=coalesce(waitlist_signup_id,?),subject_user_id=coalesce(subject_user_id,?),
      subject_clerk_id=coalesce(subject_clerk_id,?) where id=?`)
      .run(hash, input.clerkEntryId || null, signup?.id ?? null, user?.id ?? null, user?.clerk_user_id ?? signupNotice?.clerk_user_id ?? null, id);
    const result = getWaitlistAction(db, id)!;
    if (result.completed_at !== null) enqueueDecisionEdit(db, result);
    return result;
  }).immediate();
}

export interface WaitlistDecisionInput {
  /** Supply email for a web-first decision with no existing alert. Only its hash is stored. */
  clerkEntryId: string; decision: WaitlistDecision; actor: AdminActor; source: "web" | "discord"; email?: string;
}
export interface WaitlistDecisionResult {
  status: "completed" | "already_decided" | "in_progress" | "conflict";
  action: WaitlistAction;
}

/** One server-side service for /admin and bot buttons. The first decision and actor stay pinned on retry. */
export async function decideWaitlistEntry(db: Database.Database, input: WaitlistDecisionInput, backend?: ClerkBackend): Promise<WaitlistDecisionResult> {
  if (!isAdminActor(db, input.actor)) throw new WaitlistDecisionError(403, "admin_required");
  if (!input.clerkEntryId || !["approve", "reject"].includes(input.decision) || !["web", "discord"].includes(input.source)) {
    throw new WaitlistDecisionError(400, "invalid_decision");
  }
  const account = lookupSiteAccount(db, input.actor)!;
  const claimed = db.transaction(() => {
    const row = prepareWaitlistAction(db, { clerkEntryId: input.clerkEntryId, email: input.email });
    if (!row.subject_hash) throw new WaitlistDecisionError(409, "waitlist_identity_not_ready");
    if (row.completed_at !== null) return { status: "already_decided" as const, action: row };
    if (row.decision && row.decision !== input.decision) return { status: "conflict" as const, action: row };
    const now = Date.now();
    if (row.lease_expires_at !== null && row.lease_expires_at > now) return { status: "in_progress" as const, action: row };
    if (!backend && !process.env.CLERK_SECRET_KEY) throw new WaitlistDecisionError(503, "clerk_not_configured");
    db.prepare(`update discord_waitlist_actions set decision=?,actor_user_id=coalesce(actor_user_id,?),
      actor_discord_id=coalesce(actor_discord_id,?),actor_name=coalesce(actor_name,?),source=coalesce(source,?),
      attempted_at=?,lease_token=?,lease_expires_at=? where id=?`).run(input.decision, account.siteUserId,
      account.discordUserId, account.displayName.slice(0, 80), input.source, now, randomUUID(), now + 30_000, row.id);
    return { status: "claimed" as const, action: getWaitlistAction(db, row.id)! };
  }).immediate();
  if (claimed.status !== "claimed") return claimed;
  const row = claimed.action;
  try {
    const clerk = backend ?? createClerkBackend({ secretKey: process.env.CLERK_SECRET_KEY! });
    if (row.decision === "approve") await clerk.inviteWaitlistEntry(input.clerkEntryId);
    else await clerk.rejectWaitlistEntry(input.clerkEntryId);
  } catch {
    db.transaction(() => {
      const changed = db.prepare(`update discord_waitlist_actions set lease_token=null,lease_expires_at=null
        where id=? and lease_token=?`).run(row.id, row.lease_token).changes;
      if (changed) recordModAction(db, { guildId: process.env.DISCORD_GUILD_ID ?? "", actorSiteUserId: row.actor_user_id!,
        actorDiscordId: row.actor_discord_id ?? undefined, targetSiteUserId: row.subject_user_id ?? undefined,
        action: `waitlist.${row.decision}`, result: "failure", params: { actionId: row.id, source: row.source, code: "clerk_unavailable" } });
    }).immediate();
    throw new WaitlistDecisionError(503, "clerk_unavailable");
  }
  return db.transaction(() => {
    const now = Date.now();
    const changed = db.prepare(`update discord_waitlist_actions set completed_at=?,lease_token=null,lease_expires_at=null
      where id=? and lease_token=? and completed_at is null`).run(now, row.id, row.lease_token).changes;
    // Deletion or a newer lease during HTTP must not resurrect the row or overwrite its result.
    if (!changed) throw new WaitlistDecisionError(409, "decision_lease_lost");
    const complete = getWaitlistAction(db, row.id)!;
    enqueueDecisionEdit(db, complete);
    recordModAction(db, { guildId: process.env.DISCORD_GUILD_ID ?? "", actorSiteUserId: complete.actor_user_id!,
      targetSiteUserId: complete.subject_user_id ?? undefined,
      actorDiscordId: complete.actor_discord_id ?? undefined, action: `waitlist.${complete.decision}`, result: "success",
      params: { actionId: complete.id, source: complete.source } });
    return { status: "completed" as const, action: complete };
  }).immediate();
}

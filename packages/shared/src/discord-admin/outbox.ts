import type Database from "better-sqlite3";
import { createHash, randomUUID } from "node:crypto";

export interface OutboxRow {
  id: number; idempotency_key: string; kind: string; operation: "post" | "edit";
  channel_id: string; message_id: string | null; payload_json: string | null;
  status: "pending" | "processing" | "posted" | "failed" | "dead";
  attempts: number; available_at: number; lease_token: string | null; lease_expires_at: number | null;
  last_error: string | null; waitlist_action_id: string | null; mod_action_id: number | null;
  subject_hash: string | null; subject_clerk_id: string | null; created_at: number; posted_at: number | null;
}
export type ClaimedOutbox = OutboxRow & { payload_json: string; lease_token: string; lease_expires_at: number };
export interface OutboxInput {
  idempotencyKey: string; kind: string; operation?: "post" | "edit";
  channelId: string; messageId?: string | null; payload: Record<string, unknown>;
  waitlistActionId?: string; modActionId?: number; subjectHash?: string; subjectClerkId?: string; availableAt?: number;
}

/** Call in the same transaction as the domain write. Dedupe keys remain after delivery. */
export function enqueueOutbox(db: Database.Database, input: OutboxInput): number {
  if (!input.channelId.trim() || !input.idempotencyKey) throw new Error("Outbox destination and key are required");
  // Mention policy is set here for all messages, including future consumers.
  const payload = JSON.stringify({ ...input.payload, allowed_mentions: { parse: [] },
    ...((input.operation ?? "post") === "post" ? {
      nonce: createHash("sha256").update(input.idempotencyKey).digest("hex").slice(0, 24), enforce_nonce: true,
    } : {}),
  });
  const now = Date.now();
  db.prepare(`insert into discord_outbox(idempotency_key,kind,operation,channel_id,message_id,payload_json,
    available_at,waitlist_action_id,mod_action_id,subject_hash,subject_clerk_id,created_at) values(?,?,?,?,?,?,?,?,?,?,?,?)
    on conflict(idempotency_key) do nothing`).run(input.idempotencyKey, input.kind, input.operation ?? "post",
    input.channelId, input.messageId ?? null, payload, input.availableAt ?? now, input.waitlistActionId ?? null,
    input.modActionId ?? null, input.subjectHash ?? null, input.subjectClerkId ?? null, now);
  return db.prepare<[string], { id: number }>("select id from discord_outbox where idempotency_key=?").get(input.idempotencyKey)!.id;
}

/** Atomically reserve due work and the shared 30-attempt/minute budget. No network I/O. */
export function claimOutbox(db: Database.Database, limit = 10, options: { now?: number; leaseMs?: number } = {}): ClaimedOutbox[] {
  const now = options.now ?? Date.now();
  const leaseMs = options.leaseMs ?? 60_000;
  if (!Number.isSafeInteger(limit) || limit <= 0) return [];
  if (!Number.isFinite(leaseMs) || leaseMs <= 0) throw new Error("Invalid outbox lease");
  return db.transaction(() => {
    db.prepare(`insert into discord_outbox_budget(id,window_started_at,attempts) values(1,?,0)
      on conflict(id) do update set window_started_at=excluded.window_started_at, attempts=0
      where discord_outbox_budget.window_started_at<=?`).run(now, now - 60_000);
    const budget = db.prepare<[], { attempts: number }>("select attempts from discord_outbox_budget where id=1").get()!;
    const remaining = Math.min(limit, Math.max(0, 30 - budget.attempts));
    if (!remaining) return [];
    // Edits wait until markPosted has saved the original message ID. A failed post
    // cannot block unrelated rows. Each claim has a new fencing token.
    const rows = db.prepare<[number, number, number], OutboxRow>(`select o.* from discord_outbox o
      where ((o.status in ('pending','failed') and o.available_at<=?)
        or (o.status='processing' and o.lease_expires_at<=?))
      and (o.operation='post' or o.message_id is not null)
      and (o.kind!='waitlist_alert' or exists (select 1 from discord_waitlist_actions a
        where a.id=o.waitlist_action_id and (a.clerk_entry_id is not null or a.completed_at is not null)))
      order by o.id limit ?`).all(now, now, remaining);
    for (const row of rows) {
      db.prepare(`update discord_outbox set status='processing', attempts=attempts+1,
        lease_token=?, lease_expires_at=? where id=?`).run(randomUUID(), now + leaseMs, row.id);
    }
    db.prepare("update discord_outbox_budget set attempts=attempts+? where id=1").run(rows.length);
    return rows.map(row => db.prepare<[number], ClaimedOutbox>("select * from discord_outbox where id=?").get(row.id)!);
  }).immediate();
}

/** Save the Discord response and discard the transient message body. A stale worker cannot finish a new lease. */
export function markPosted(db: Database.Database, row: ClaimedOutbox, posted: { messageId: string; channelId?: string }, now = Date.now()): boolean {
  return db.transaction(() => {
    const channelId = posted.channelId ?? row.channel_id;
    const changed = db.prepare(`update discord_outbox set status='posted',message_id=?,channel_id=?,posted_at=?,
      payload_json=null,last_error=null,lease_token=null,lease_expires_at=null
      where id=? and status='processing' and lease_token=?`).run(posted.messageId, channelId, now, row.id, row.lease_token).changes;
    if (!changed) return false;
    if (row.waitlist_action_id) {
      if (row.operation === "post") {
        db.prepare("update discord_waitlist_actions set channel_id=?,message_id=? where id=?").run(channelId, posted.messageId, row.waitlist_action_id);
        db.prepare(`update discord_outbox set channel_id=?,message_id=? where waitlist_action_id=?
          and operation='edit' and status in ('pending','failed')`).run(channelId, posted.messageId, row.waitlist_action_id);
      } else db.prepare("update discord_waitlist_actions set discord_updated_at=? where id=?").run(now, row.waitlist_action_id);
    }
    return true;
  }).immediate();
}

export interface OutboxFailure {
  code?: "transport" | "rate_limited" | "rejected" | "invalid_payload";
  retryAfterMs?: number; permanent?: boolean;
}

/** Store only a fixed error code, never an HTTP error body, token or email. */
export function markFailed(db: Database.Database, row: ClaimedOutbox, failure: OutboxFailure = {}, now = Date.now()): boolean {
  const dead = failure.permanent === true || row.attempts >= 8;
  const delay = Math.max(1000 * 2 ** Math.min(row.attempts - 1, 10),
    Number.isFinite(failure.retryAfterMs) ? Math.max(0, failure.retryAfterMs!) : 0);
  const code = ["transport", "rate_limited", "rejected", "invalid_payload"].includes(failure.code ?? "") ? failure.code! : "transport";
  return db.prepare(`update discord_outbox set status=?,available_at=?,last_error=?,lease_token=null,lease_expires_at=null,
    payload_json=case when ? then null else payload_json end
    where id=? and status='processing' and lease_token=?`).run(dead ? "dead" : "failed", now + delay, code, dead ? 1 : 0, row.id, row.lease_token).changes !== 0;
}

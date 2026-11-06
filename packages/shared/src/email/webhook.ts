import type Database from "better-sqlite3";
import { createHmac, timingSafeEqual } from "node:crypto";
import { suppressEmail } from "./storage.js";

/** Svix v1 signature over the raw bytes, with its five-minute timestamp tolerance. */
export function verifyResendWebhook(body: string, headers: Headers, secret: string, now = Date.now()): boolean {
  const id = headers.get("svix-id"), timestamp = headers.get("svix-timestamp"), signature = headers.get("svix-signature");
  if (!id || id.length > 200 || !timestamp || !/^\d{1,12}$/.test(timestamp) || !signature || signature.length > 2000
    || Math.abs(now / 1000 - Number(timestamp)) > 300 || !secret.startsWith("whsec_")) return false;
  const key = Buffer.from(secret.slice(6), "base64"); if (key.length < 16) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest();
  return signature.split(" ").some(part => {
    const [version, value] = part.split(","); if (version !== "v1" || !value) return false;
    const actual = Buffer.from(value, "base64"); return actual.length === expected.length && timingSafeEqual(actual, expected);
  });
}
/** Call only after signature verification. Receipts and state/suppression changes commit together. */
export function recordResendWebhook(db: Database.Database, eventId: string, event: unknown, now = Date.now()): void {
  const value = event as { type?: unknown; data?: { email_id?: unknown; tags?: Record<string, unknown>; bounce?: { type?: unknown } } } | null;
  db.transaction(() => {
    if (!db.prepare("insert into email_webhook_receipts(event_id,received_at) values(?,?) on conflict(event_id) do nothing").run(eventId, now).changes) return;
    const data = value?.data;
    if (!data || typeof data.email_id !== "string" || data.email_id.length > 200) return;
    const tags = data.tags;
    type Row = { id: number; recipient_key: string; provider_id: string | null };
    const row = db.prepare<[string], Row>("select id,recipient_key,provider_id from release_email_deliveries where provider_id=?").get(data.email_id)
      ?? (typeof tags?.release_send === "string" && typeof tags?.release_recipient === "string"
        ? db.prepare<[string, string], Row>("select id,recipient_key,provider_id from release_email_deliveries where send_id=? and recipient_key=?")
          .get(tags.release_send, tags.release_recipient) : undefined);
    if (!row || (row.provider_id && row.provider_id !== data.email_id)) return;
    if (value?.type === "email.delivered" || value?.type === "email.sent") {
      db.prepare(`update release_email_deliveries set provider_id=?,accepted_at=coalesce(accepted_at,?),payload_encrypted=null,subject_clerk_id=null,
        status=case when status='delivered' or ? then 'delivered' else 'accepted' end,
        delivered_at=case when ? then coalesce(delivered_at,?) else delivered_at end,lease_token=null,lease_expires_at=null,last_error=null
        where id=? and status not in ('failed')`).run(data.email_id, now, value.type === "email.delivered" ? 1 : 0, value.type === "email.delivered" ? 1 : 0, now, row.id);
    } else if (value?.type === "email.complained" || value?.type === "email.bounced" || value?.type === "email.failed" || value?.type === "email.suppressed") {
      if (value.type === "email.complained" || (value.type === "email.bounced" && data.bounce?.type === "Permanent") || value.type === "email.suppressed") {
        suppressEmail(db, row.recipient_key, value.type === "email.complained" ? "complaint" : "hard_bounce", now);
      }
      db.prepare(`update release_email_deliveries set status='failed',provider_id=?,payload_encrypted=null,subject_clerk_id=null,
        last_error=?,lease_token=null,lease_expires_at=null where id=?`).run(data.email_id, value.type, row.id);
    }
  }).immediate();
}

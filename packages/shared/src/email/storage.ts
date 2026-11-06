import type Database from "better-sqlite3";
import { createHash, createHmac, randomBytes, createCipheriv, createDecipheriv } from "node:crypto";
import { emailKey } from "../util/email-key.js";
import { ReleaseError } from "../services/releases.js";

export interface EmailConfig {
  apiKey: string; postalAddress: string; from: string; replyTo: string; webUrl: string;
  encryptionSecret: string; dailyLimit: number;
}
export function emailConfig(env: Record<string, string | undefined> = process.env): EmailConfig {
  const limit = Number(env.MAIL_DAILY_LIMIT ?? "100");
  return {
    apiKey: env.RESEND_API_KEY?.trim() ?? "", postalAddress: env.MAIL_POSTAL_ADDRESS?.trim() ?? "",
    from: env.MAIL_FROM?.trim() || "Dueling Domain <news@updates.duelingdomain.com>",
    replyTo: env.MAIL_REPLY_TO?.trim() || "support@duelingdomain.com",
    webUrl: (env.WEB_URL ?? "").replace(/\/+$/, ""),
    encryptionSecret: env.MAIL_ENCRYPTION_KEY || env.CLERK_SECRET_KEY || "",
    dailyLimit: Number.isSafeInteger(limit) && limit > 0 ? limit : 100,
  };
}
export function missingEmailConfig(config: EmailConfig): string[] {
  return [!config.apiKey && "RESEND_API_KEY", !config.postalAddress && "MAIL_POSTAL_ADDRESS"].filter((v): v is string => !!v);
}
export const hash = (text: string): string => createHash("sha256").update(text).digest("hex");
/** A persisted, independent HMAC key keeps suppression stable across Clerk/provider credential rotation. */
export function recipientKey(db: Database.Database, email: string): string | null {
  const inbox = emailKey(email); if (!inbox) return null;
  const key = db.prepare<[], { secret: string }>("select secret from email_identity_secret where id=1").get()!.secret;
  return createHmac("sha256", key).update(inbox).digest("hex");
}
function subjectKey(db: Database.Database, clerkUserId: string): string {
  const key = db.prepare<[], { secret: string }>("select secret from email_identity_secret where id=1").get()!.secret;
  return createHmac("sha256", key).update("clerk-subject\0").update(clerkUserId).digest("hex");
}
/** Call inside the discovery transaction. Preserve HMAC associations for deletion of verified fallback inboxes. */
export function rememberEmailSubject(db: Database.Database, clerkUserId: string, email: string): void {
  const key = recipientKey(db, email); if (!key) return;
  const subject = subjectKey(db, clerkUserId);
  if (db.prepare("select 1 from email_deleted_subjects where subject_key=?").get(subject)) { suppressEmail(db, key, "deleted_account"); return; }
  db.prepare("insert into email_subject_recipients(subject_key,recipient_key) values(?,?) on conflict do nothing").run(subject, key);
}
function encryptionKey(config: EmailConfig): Buffer {
  if (!config.encryptionSecret) throw new ReleaseError("email_encryption_not_configured", 503);
  return createHash("sha256").update("release-email-v1\0").update(config.encryptionSecret).digest();
}
export function encrypt(value: unknown, config: EmailConfig): string {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", encryptionKey(config), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}
export function decrypt<T>(value: string, config: EmailConfig): T {
  const buffer = Buffer.from(value, "base64url");
  const cipher = createDecipheriv("aes-256-gcm", encryptionKey(config), buffer.subarray(0, 12));
  cipher.setAuthTag(buffer.subarray(12, 28));
  return JSON.parse(Buffer.concat([cipher.update(buffer.subarray(28)), cipher.final()]).toString("utf8")) as T;
}
export function recordEmailConsent(db: Database.Database, email: string, evidence: { source?: string; provenance: string; textVersion: string }, _config?: EmailConfig): void {
  const key = recipientKey(db, email);
  if (!key || !evidence.provenance.trim() || !evidence.textVersion.trim()) throw new ReleaseError("invalid_consent");
  db.prepare(`insert into email_consents(recipient_key,scope,source,provenance,text_version,consented_at)
    select ?,'alpha-news',?,?,?,? where not exists(select 1 from email_unsubscribes where recipient_key=?)
    on conflict(recipient_key) do nothing`).run(key, evidence.source ?? evidence.provenance, evidence.provenance, evidence.textVersion, Date.now(), key);
}
/** Owner's alpha-news basis applies to existing and future members/invitees and the historical waitlist. */
export function recordOwnerEmailBasis(db: Database.Database, email: string): void {
  recordEmailConsent(db, email, { source: "owner_basis_2026-11-04",
    provenance: "owner instruction; alpha news; unsubscribe in every email", textVersion: "alpha-news-2026-11-04" });
}
export function suppressEmail(db: Database.Database, key: string, reason: "unsubscribe" | "hard_bounce" | "complaint" | "deleted_account", now = Date.now()): void {
  db.transaction(() => {
    db.prepare("insert into email_unsubscribes(recipient_key,reason,suppressed_at) values(?,?,?) on conflict(recipient_key) do nothing").run(key, reason, now);
    // Stop pending work and discard private data, retaining the permanent send guard.
    db.prepare(`update release_email_deliveries set status='suppressed',payload_encrypted=null,lease_token=null,lease_expires_at=null
      where recipient_key=? and status in ('pending','retry','processing')`).run(key);
    db.prepare("update release_email_deliveries set payload_encrypted=null,subject_clerk_id=null where recipient_key=?").run(key);
    db.prepare("delete from email_consents where recipient_key=?").run(key);
  }).immediate();
}
/** Tokens carry no inbox or expiry; hashes remain valid independently of deployment credentials. */
export function unsubscribeToken(db: Database.Database, email: string, _config?: EmailConfig): string {
  const key = recipientKey(db, email); if (!key) throw new ReleaseError("invalid_email");
  const token = randomBytes(32).toString("base64url");
  db.prepare("insert into email_unsubscribe_tokens(token_hash,recipient_key) values(?,?)").run(hash(token), key);
  return token;
}
export function unsubscribeTokenExists(db: Database.Database, token: string): boolean {
  return /^[A-Za-z0-9_-]{43}$/.test(token) && !!db.prepare("select 1 from email_unsubscribe_tokens where token_hash=?").get(hash(token));
}
export function unsubscribeByToken(db: Database.Database, token: string): boolean {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
  const row = db.prepare<[string], { recipient_key: string }>("select recipient_key from email_unsubscribe_tokens where token_hash=?").get(hash(token));
  if (!row) return false;
  suppressEmail(db, row.recipient_key, "unsubscribe"); return true;
}

/** Invoke inside the account-deletion transaction, before its email and Clerk identity are erased. */
export function suppressDeletedAccountEmail(db: Database.Database, email: string | null, clerkUserId: string | null): void {
  const keys = new Set<string>();
  if (email) { const key = recipientKey(db, email); if (key) keys.add(key); }
  if (clerkUserId) {
    const subject = subjectKey(db, clerkUserId);
    db.prepare("insert into email_deleted_subjects(subject_key) values(?) on conflict do nothing").run(subject);
    for (const row of db.prepare<[string], { recipient_key: string }>("select recipient_key from email_subject_recipients where subject_key=?").all(subject)) keys.add(row.recipient_key);
    for (const row of db.prepare<[string], { recipient_key: string }>("select distinct recipient_key from release_email_deliveries where subject_clerk_id=?").all(clerkUserId)) keys.add(row.recipient_key);
    db.prepare("delete from email_subject_recipients where subject_key=?").run(subject);
  }
  for (const key of keys) suppressEmail(db, key, "deleted_account");
  // Preview snapshots can contain this person among other inboxes. Discard them rather than preserve private copies.
  if (keys.size) db.prepare("delete from release_email_previews").run();
}

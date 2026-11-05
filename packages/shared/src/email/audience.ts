import type Database from "better-sqlite3";
import type { ClerkDiscoveryBackend, ClerkInvitationJson } from "../clerk/backend.js";
import { normalizeJoinEmail } from "../util/join-email.js";
import { recipientKey, rememberEmailSubject, recordOwnerEmailBasis } from "./storage.js";

export type AudienceClerk = Pick<ClerkDiscoveryBackend, "listAllUsers" | "listAllInvitations" | "listAllWaitlistEntries">;
export interface EmailRecipient {
  key: string; email: string; variant: "members" | "invited" | "waitlist";
  sourceId: string; inviteUrl: string | null; inviteExpiresAt: number | null;
}
export interface AudienceCounts {
  members: number; invited: number; waitlist: number; total: number; excluded: { reason: string; count: number }[];
}
export interface EmailAudience { recipients: EmailRecipient[]; counts: AudienceCounts }
export function invitationLink(invite: ClerkInvitationJson | null | undefined, now: number): string | null {
  if (!invite || invite.status !== "pending" || invite.revoked || typeof invite.expires_at !== "number" || invite.expires_at <= now || !invite.url) return null;
  try { const url = new URL(invite.url); return url.protocol === "https:" && !url.username && !url.password ? url.href : null; } catch { return null; }
}
/** Finish every page of every source before persisting any confirmation snapshot. Never mutates Clerk. */
export async function discoverEmailAudience(db: Database.Database, clerk: AudienceClerk, now = Date.now()): Promise<EmailAudience> {
  const [users, invitations, pending, invited] = await Promise.all([
    clerk.listAllUsers(), clerk.listAllInvitations(), clerk.listAllWaitlistEntries("pending"), clerk.listAllWaitlistEntries("invited"),
  ]);
  const candidates = new Map<string, EmailRecipient>(), excluded = new Map<string, number>();
  const subjects: { userId: string; email: string }[] = [];
  const exclude = (reason: string) => excluded.set(reason, (excluded.get(reason) ?? 0) + 1);
  const add = (raw: unknown, variant: EmailRecipient["variant"], sourceId: string, invitation?: ClerkInvitationJson | null) => {
    const email = normalizeJoinEmail(raw), key = email ? recipientKey(db, email) : null;
    if (!email || !key) { exclude("invalid_email"); return; }
    if (candidates.has(key)) { exclude("duplicate_inbox"); return; }
    candidates.set(key, { key, email, variant, sourceId,
      inviteUrl: invitationLink(invitation, now), inviteExpiresAt: invitation?.expires_at ?? null });
  };
  for (const user of users) {
    if (!Array.isArray(user.email_addresses)) throw new Error("Invalid Clerk user emails");
    const verified = user.email_addresses.filter(address => address.verification?.status === "verified");
    for (const email of verified) subjects.push({ userId: user.id, email: email.email_address });
    const address = verified.find(address => address.id === user.primary_email_address_id) ?? verified[0];
    if (!address) { exclude("unverified_email"); continue; }
    add(address.email_address, "members", user.id);
  }
  for (const invite of invitations) {
    if (invite.status !== "pending" || invite.revoked) { exclude("inactive_invitation"); continue; }
    add(invite.email_address, "invited", invite.id, invite);
  }
  // Invited waitlist entries outrank pending entries for the same inbox.
  for (const entry of [...invited, ...pending]) {
    if (entry.status !== "pending" && entry.status !== "invited") { exclude("inactive_waitlist"); continue; }
    add(entry.email_address, "waitlist", entry.id, entry.status === "invited" ? entry.invitation : null);
  }
  // Local historical signups may predate Clerk's waitlist. Clerk candidates retain priority.
  for (const entry of db.prepare<[], { id: number; email: string }>("select id,email from waitlist_signups").all()) {
    const key = recipientKey(db, entry.email);
    if (key && candidates.has(key)) continue;
    add(entry.email, "waitlist", `signup/${entry.id}`);
  }
  const recipients: EmailRecipient[] = [];
  // All Clerk calls and validation finish before this single write transaction. Repeated discovery is idempotent.
  db.transaction(() => {
    for (const subject of subjects) rememberEmailSubject(db, subject.userId, subject.email);
    for (const recipient of candidates.values()) {
      if (db.prepare("select 1 from email_unsubscribes where recipient_key=?").get(recipient.key)) { exclude("suppressed"); continue; }
      recordOwnerEmailBasis(db, recipient.email);
      recipients.push(recipient);
    }
  }).immediate();
  recipients.sort((a, b) => a.key.localeCompare(b.key));
  return { recipients, counts: {
    members: recipients.filter(r => r.variant === "members").length, invited: recipients.filter(r => r.variant === "invited").length,
    waitlist: recipients.filter(r => r.variant === "waitlist").length, total: recipients.length,
    excluded: [...excluded].sort(([a], [b]) => a.localeCompare(b)).map(([reason, count]) => ({ reason, count })),
  } };
}

import { log } from "@yugidraft/shared/observability";
import { createClerkBackend, ClerkBackendError, profileFromClerkUser } from "@yugidraft/shared/clerk";
import { createUserService, type LinkOutcome } from "@yugidraft/shared/services";
import { createCreatorAccessService } from "@yugidraft/shared/services/creator-access";
import { normalizeEmailDomain } from "@yugidraft/shared/util/email-domain";
import { parseHeardFrom } from "@yugidraft/shared/util/heard-from";
import type { ClerkUserJson } from "@yugidraft/shared/clerk";
import { getDb } from "./db";

/**
 * Sign-up source, after the profile is saved. Local SQLite writes only; a failure is logged with a fixed line (no
 * email) and never fails the sign-in.
 * 1. Heard-from: the sign-up answer (unsafe_metadata, untrusted survey data, checked against the list), else the
 *    waitlist answer for the same email. Written only while users.heard_from is empty.
 * 2. Creator attribution: binds the creator grant (public_metadata.ddGrant, else the email key) to this user.
 *    It runs here, not in the first-sign-in transaction, because only this code has the Clerk user JSON.
 */
function recordSignUpSource(json: ClerkUserJson, userId: number, email: string | null): void {
  const db = getDb();
  try {
    const answer = parseHeardFrom(json.unsafe_metadata?.heardFrom, json.unsafe_metadata?.heardFromDetail);
    if (answer) {
      db.prepare("update users set heard_from=?, heard_from_detail=? where id=? and heard_from is null").run(answer.heardFrom, answer.detail, userId);
    } else if (email) {
      const lower = email.trim().toLowerCase();
      const row = db.prepare("select heard_from, heard_from_detail from waitlist_signups where email in (?, ?) and heard_from is not null limit 1")
        .get(lower, normalizeEmailDomain(lower) ?? lower) as { heard_from: string; heard_from_detail: string | null } | undefined;
      const copied = row ? parseHeardFrom(row.heard_from, row.heard_from_detail) : null;
      if (copied) db.prepare("update users set heard_from=?, heard_from_detail=? where id=? and heard_from is null").run(copied.heardFrom, copied.detail, userId);
    }
  } catch {
    log("warn", "[clerk-sync] Heard-from update failed");
  }
  try {
    const raw = json.public_metadata?.ddGrant;
    const grantId = typeof raw === "number" && Number.isSafeInteger(raw) && raw > 0 ? raw : null;
    createCreatorAccessService(db).attributeSignUp({ userId, email, grantId });
  } catch {
    log("warn", "[clerk-sync] Creator attribution failed");
  }
}
const inFlight = new Map<string, Promise<LinkOutcome>>();
export async function settleClerkSync(clerkUserId: string): Promise<void> {
  try { await inFlight.get(clerkUserId); } catch {}
}
export function syncClerkUser(clerkUserId: string): Promise<LinkOutcome> {
  const pending = inFlight.get(clerkUserId);
  if (pending) return pending;
  const promise = (async () => {
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new ClerkBackendError("Clerk secret is unavailable", 0, "missing_secret", null);
    const backend = createClerkBackend({ secretKey });
    // Remote I/O must finish before the shared service acquires SQLite's writer lock.
    const json = await backend.getUser(clerkUserId);
    if (!json || json.id !== clerkUserId) throw new ClerkBackendError("Clerk user is unavailable", 0, "missing_user", null);
    const users = createUserService(getDb());
    const profile = profileFromClerkUser(json);
    const current = users.findByClerkId(clerkUserId);
    const hasDiscord = json.external_accounts.some(account => account.provider === "oauth_discord" && account.verification?.status === "verified");
    // Bootstrap metadata preserves a current link; it cannot restore a removed one.
    if (!hasDiscord && current && current.discordUserId !== profile.discordUserId) profile.discordUserId = null;
    const outcome = users.resolveClerkProfile(profile);
    recordSignUpSource(json, outcome.user.id, outcome.user.email);
    // Recovery metadata bootstraps the link until Clerk owns it; then unlinking
    // the external account must also revoke application recovery.
    const recoveredDiscord = json.private_metadata?.existingPlayerDiscordId;
    if (typeof recoveredDiscord === "string" && /^[0-9]{1,25}$/.test(recoveredDiscord) && json.external_accounts.some(account =>
      account.provider === "oauth_discord" && account.verification?.status === "verified" && account.provider_user_id === recoveredDiscord)) {
      void (async () => { await backend.updateUserMetadata(clerkUserId, { privateMetadata: { existingPlayerDiscordId: null } }); })().catch(() => {});
    }
    if (outcome.foldedUserId !== null || json.external_id !== String(outcome.user.id)) {
      void (async () => {
        for (let attempt = 0; attempt < 3; attempt++) {
          try { await backend.updateUserExternalId(clerkUserId, String(outcome.user.id)); break; }
          catch { if (attempt === 2) log("warn", "[clerk-sync] External identity repair failed"); }
        }
      })().catch(() => {});
    }
    return outcome;
  })();
  inFlight.set(clerkUserId, promise);
  void promise.finally(() => { if (inFlight.get(clerkUserId) === promise) inFlight.delete(clerkUserId); }).catch(() => {});
  return promise;
}

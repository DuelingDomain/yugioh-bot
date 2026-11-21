import { createClerkBackend, ClerkBackendError } from "@yugidraft/shared/clerk";
import { log } from "@yugidraft/shared/observability";
import { createWaitlistService } from "@yugidraft/shared/services";
import { createCreatorAccessService } from "@yugidraft/shared/services/creator-access";
import { emailKey } from "@yugidraft/shared/util/email-key";
import { releaseOwnerSends, reserveOwnerSends } from "@/lib/creator-send-limit";
import { getDb } from "@/lib/db";

/**
 * "joined": on the list as pending (new or already there). "invited": an invitation is out, or was just sent again.
 * "account": the email is proven to belong to a Clerk user. "declined": the owner rejected this email; it stays rejected.
 * "rejected": Clerk refused the email and it is neither listed nor a user. "retry": local row saved, Clerk call failed or
 * is unreachable. "error": nothing saved.
 */
export type WaitlistJoinOutcome = "joined" | "invited" | "account" | "declined" | "rejected" | "retry" | "error";
export interface WaitlistJoinMeta {
  source: string; userAgent?: string | null; heardFrom?: unknown; heardFromDetail?: unknown;
  /** The Discord sign-in path: remembered so the invite page can skip the password form. */
  viaDiscord?: boolean;
}

/**
 * An email with a live allowlist grant (creator fast-track) gets its Clerk invitation again in place of a waitlist
 * entry, and the waitlist join is skipped. Returns "joined"/"retry" (the same answers as a normal join) when the grant
 * handled the email, or null to continue with the normal waitlist.
 */
async function handledByAllowlist(email: string): Promise<"joined" | "invited" | "retry" | null> {
  try {
    const creators = createCreatorAccessService(getDb());
    // A re-send uses the shared Clerk budget. Over budget: skip the re-send, but still keep a granted email off the
    // waitlist (Clerk entry and Discord alert would ask the owner to approve a person who is already in).
    if (reserveOwnerSends(1) !== null) {
      const key = emailKey(email);
      return key !== null && creators.grantedEmailKeys().has(key) ? "joined" : null;
    }
    const result = await creators.resendAllowlistForWaitlist(email);
    if (result === "none" || result === "not_due" || result === "invited") releaseOwnerSends(1);
    // A failed re-send sent nothing: ask for a retry, as a failed Clerk waitlist call does on the normal path. A re-send, or
    // a valid invitation still in the inbox, means the person is invited: the page must say so, not "on the waitlist".
    if (result === "none") return null;
    return result === "failed" ? "retry" : result === "resent" || result === "invited" ? "invited" : "joined";
  } catch {
    // Fall back to the normal waitlist. Never log the email.
    log("warn", "[waitlist] allowlist check failed");
    return null;
  }
}

/**
 * Invited only when the owner approved it and the invitation is still usable: status "invited", or a still-pending invitation.
 * An entry can carry an old revoked or expired invitation object (seen on prod 2026-11-20), which must not count as an invite.
 */
function invitedEntry(entry: { status: string; invitation?: { status?: string } | null }): boolean {
  const stale = entry.invitation?.status === "revoked" || entry.invitation?.status === "expired";
  return entry.invitation?.status === "pending" || (entry.status === "invited" && !stale);
}

type WaitlistEntry = { id: string; email_address: string; status: string; invitation?: { status?: string } | null };

/** The exact-email entry (paged). null when there is none or Clerk could not be asked: the normal create then goes on. */
async function findEntry(backend: ReturnType<typeof createClerkBackend>, email: string): Promise<WaitlistEntry | null> {
  try {
    for (let offset = 0; ;) {
      const page = await backend.listWaitlistEntries({ query: email, offset, limit: 100 });
      const entry = page.data.find(item => item.email_address.trim().toLowerCase() === email);
      if (entry) return entry;
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.totalCount) return null;
    }
  } catch { return null; }
}

/**
 * An entry the owner already acted on and that is no longer live: its invitation was revoked or expired, or the person
 * finished sign-up and the account is gone. Clerk keeps these and may mail the old invitation again, and the Waitlist tab
 * shows no pending person. Such an entry is deleted and made again as pending, so the owner sees the person.
 */
function staleEntry(entry: WaitlistEntry): boolean {
  if (entry.status === "rejected" || invitedEntry(entry)) return false;
  return entry.status === "completed" || entry.invitation?.status === "revoked" || entry.invitation?.status === "expired";
}

/** What an existing entry says, or null when the normal create should run. */
async function classifyEntry(backend: ReturnType<typeof createClerkBackend>, email: string, entry: WaitlistEntry): Promise<WaitlistJoinOutcome | null> {
  // The owner said no: the sign-up stays rejected and the page says so. It never goes back to pending.
  if (entry.status === "rejected") return "declined";
  if (invitedEntry(entry)) return "invited";
  if (!staleEntry(entry)) return null;
  // A finished sign-up whose Clerk user still exists is an account, not a person to put back on the list.
  if (entry.status === "completed" && (await backend.listUsers({ emailAddress: email })).length > 0) return "account";
  await backend.deleteWaitlistEntriesByEmail(email);
  return null;
}

/**
 * Clerk refused the create with a 4xx. Find out why from facts, not from the status: an exact-email waitlist entry
 * (paged, like deleteWaitlistEntriesByEmail) or a proven Clerk user. Neither found: "rejected" (Clerk disliked the email).
 */
async function resolveRefusal(backend: ReturnType<typeof createClerkBackend>, email: string): Promise<WaitlistJoinOutcome> {
  try {
    for (let offset = 0; ;) {
      const page = await backend.listWaitlistEntries({ query: email, offset, limit: 100 });
      const entry = page.data.find(item => item.email_address.trim().toLowerCase() === email);
      if (entry) return invitedEntry(entry) ? "invited" : "joined";
      offset += page.data.length;
      if (page.data.length === 0 || offset >= page.totalCount) break;
    }
    return (await backend.listUsers({ emailAddress: email })).length > 0 ? "account" : "rejected";
  } catch {
    return "retry";
  }
}

/**
 * The one waitlist join: allowlist check, atomic local row, then the Clerk waitlist entry. Used by the public form and by
 * the Discord sign-in path. Callers decide how much of the outcome a visitor may see.
 */
export async function joinWaitlist(email: string, meta: WaitlistJoinMeta): Promise<WaitlistJoinOutcome> {
  const allowlisted = await handledByAllowlist(email);
  if (allowlisted) return allowlisted;
  try {
    createWaitlistService(getDb()).join(email, {
      source: meta.source,
      userAgent: meta.userAgent,
      viaDiscord: meta.viaDiscord,
      // Untrusted survey answer: the service checks it against the list and drops unknown values.
      heardFrom: meta.heardFrom,
      heardFromDetail: meta.heardFromDetail,
    });
  } catch {
    // Never return/log request data or database errors containing an email address.
    return "error";
  }

  // The atomic local join has committed before any HTTP call. Retry even on
  // "exists" so a previous Clerk failure can heal without replacing metadata.
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) { log("warn", "[waitlist] CLERK_SECRET_KEY is not set"); return "retry"; }
  const backend = createClerkBackend({ secretKey });
  try {
    // Look first: creating an entry for a revoked or rejected email must not undo what the owner decided.
    const existing = await findEntry(backend, email);
    const decided = existing ? await classifyEntry(backend, email, existing) : null;
    if (decided) return decided;
    // For an email already on the list Clerk answers 2xx with the existing entry, so its status says whether it is invited.
    const entry = await backend.createWaitlistEntry({ emailAddress: email, notify: true });
    return entry?.status === "rejected" ? "declined" : entry && invitedEntry(entry) ? "invited" : "joined";
  } catch (error) {
    // Status and Clerk's error code only: never the message, the email or upstream data.
    const failure = error instanceof ClerkBackendError ? `status=${error.status} code=${error.code ?? "none"}` : "unknown";
    log("warn", `[waitlist] Clerk waitlist entry failed ${failure}`);
    // A 4xx is not a reason to tell the person to retry for ever: find out what Clerk objects to.
    if (error instanceof ClerkBackendError && error.status >= 400 && error.status < 500 && error.status !== 429 && error.status !== 401 && error.status !== 403) {
      return resolveRefusal(backend, email);
    }
    return "retry";
  }
}

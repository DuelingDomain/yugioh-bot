/**
 * Creator fast-track (docs/adr/0007-creator-fast-track.md).
 *
 * CONTRACT FILE. The exported names, types and signatures below are frozen: web routes, UI and tests code against
 * them. Implementers fill in the bodies; any change to an exported shape must go through the lead.
 *
 * Model: a grant is "this email may join now, because of creator X". Every fast-track path makes one grant row,
 * then sends one Clerk invitation (Clerk mails the ticket link; the ticket URL never leaves the server).
 *   creator --< link --< grant >-- user (after sign-up)
 *   creator --< grant (allowlist email, link_id null)
 */
import type Database from "better-sqlite3";
import type { ClerkBackend } from "../clerk/backend.js";

export type GrantKind = "allowlist" | "link";
export type GrantStatus = "sending" | "sent" | "failed" | "signed_up" | "revoked";
/** `expired` is computed: status sent/sending with expires_at <= now. Never stored. */
export type GrantView = GrantStatus | "expired";
export type LinkState = "open" | "full" | "expired" | "revoked";

/** Clerk invitation lifetime per grant kind. An unused link invitation frees its use after this time. */
export const LINK_INVITE_DAYS = 7;
export const ALLOWLIST_INVITE_DAYS = 30;
/** A grant in `sending` counts as used for this long, so a crash mid-send frees the use by itself. */
export const SENDING_LEASE_MS = 10 * 60_000;
/** A repeat waitlist join with an allowlisted email re-sends at most once per this period. */
export const RESEND_COOLDOWN_MS = 10 * 60_000;
export const MAX_LINK_USES = 500;
export const MAX_LINK_DAYS = 90;
export const MAX_EMAILS_PER_ADD = 20;
export const LINK_PRESETS = {
  personal: { label: "Personal", maxUses: 1, expiresInDays: 14 },
  community: { label: "Community", maxUses: 50, expiresInDays: 30 },
} as const;
/** 12 chars base62 from crypto.randomBytes (about 71 bits). */
export const LINK_CODE_PATTERN = /^[A-Za-z0-9]{12}$/;

export interface Creator {
  id: number;
  name: string;
  channelUrl: string | null;
  notes: string | null;
  /** The creator's own account (users.id), when known. */
  userId: number | null;
  createdAt: number;
  archivedAt: number | null;
}

export interface CreatorSummary extends Creator {
  /** Links that are open now (not full, expired or revoked). */
  openLinks: number;
  links: number;
  /** Grants whose invitation went out: status sent or signed_up (expired ones included). */
  sent: number;
  signedUp: number;
  /** Signed-up people seen in the last 7 days (users.last_seen_at). */
  active7d: number;
  lastSignUpAt: number | null;
  /** Sign-ups at or after `since` (see listCreators). */
  signUpsSince: number;
}

export interface CreatorLink {
  id: number;
  creatorId: number;
  code: string;
  label: string | null;
  maxUses: number;
  /** signed_up, plus sent/sending that is not expired. */
  used: number;
  signedUp: number;
  expiresAt: number;
  revokedAt: number | null;
  createdAt: number;
  state: LinkState;
}

export interface CreatorGrant {
  id: number;
  creatorId: number;
  linkId: number | null;
  linkLabel: string | null;
  kind: GrantKind;
  /** Full email. The admin UI masks it until "Show emails". */
  email: string;
  status: GrantStatus;
  view: GrantView;
  createdAt: number;
  sentAt: number | null;
  expiresAt: number | null;
  /** True for failed, and for sent/sending that expired. */
  resendable: boolean;
}

export interface CreatorJoinedPerson {
  userId: number;
  displayName: string;
  username: string;
  imageUrl: string | null;
  signedUpAt: number;
  linkId: number | null;
  /** Link label, or "Email" for an allowlist grant. */
  via: string;
  lastSeenAt: number | null;
  active7d: boolean;
}

export interface CreatorDetail {
  creator: CreatorSummary;
  links: CreatorLink[];
  /** Grants that did not sign up yet (all statuses except signed_up), newest first. */
  grants: CreatorGrant[];
  /** Newest first. */
  joined: CreatorJoinedPerson[];
}

/** What the public /join/<code> page may show. No email, count of grants, or creator id. */
export interface PublicLinkView {
  state: LinkState;
  creatorName: string;
  spotsLeft: number;
}

export type ClaimResult =
  /** A new or re-opened grant in `sending`. The caller must call sendGrant(grant.id) next. */
  | { kind: "claimed"; grantId: number }
  /** Same inbox has a live grant, or the email already has an account. Answer generically; send nothing. */
  | { kind: "already" }
  | { kind: "full" }
  | { kind: "expired" }
  | { kind: "revoked" }
  | { kind: "not_found" };

export type SendResult =
  | { kind: "sent" }
  /** Clerk says the email has an account (422 form_identifier_exists). The grant row is deleted, the use freed. */
  | { kind: "existing_account" }
  /** Grant is now `failed` and counts as no use. */
  | { kind: "failed"; retryable: boolean; retryAfterMs: number | null };

export type AddEmailOutcome = "sent" | "already" | "existing_account" | "failed" | "invalid";
export interface AddEmailResult { email: string; outcome: AddEmailOutcome }

export type ResendResult = SendResult | { kind: "not_resendable" } | { kind: "full" };

export class CreatorAccessError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code);
    this.name = "CreatorAccessError";
  }
}

export interface CreatorAccessOptions {
  /** Defaults to createClerkBackend({ secretKey: CLERK_SECRET_KEY }) at first use; throws 503 clerk_not_configured without one. */
  clerk?: ClerkBackend;
  /** Origin for the invitation redirect `${webUrl}/sign-up?via=creator`. Defaults to WEB_URL. */
  webUrl?: string;
  now?: () => number;
  /** Code generator, for tests. Default: 12 chars base62 from crypto.randomBytes with rejection sampling. */
  newCode?: () => string;
}

export interface CreatorAccessService {
  /** name 1-80 chars (trimmed), channelUrl http(s) up to 300, notes up to 1000. 400 invalid_* on bad input. */
  createCreator(input: { name: string; channelUrl?: string | null; notes?: string | null; userId?: number | null; actorUserId: number }): Creator;
  /** null when the creator does not exist. `archived: true` sets archived_at; archived creators' links read as revoked. */
  updateCreator(id: number, patch: { name?: string; channelUrl?: string | null; notes?: string | null; archived?: boolean }): Creator | null;
  /** Newest first. Archived ones only with includeArchived. `since` (epoch ms) drives signUpsSince; default now - 24 h. */
  listCreators(opts?: { includeArchived?: boolean; since?: number }): CreatorSummary[];
  creatorDetail(id: number): CreatorDetail | null;
  /** Total creator sign-ups (signed_up_at >= since). For the Overview tile. */
  creatorSignUpsSince(since: number): number;

  /** maxUses 1-500, expiresInDays 1-90, label up to 60. null when the creator is missing or archived. */
  createLink(creatorId: number, input: { label?: string | null; maxUses: number; expiresInDays: number; actorUserId: number }): CreatorLink | null;
  /**
   * Stops new uses at once (revoked_at), marks the link's grants in sending/sent `revoked` (signed_up stays), then
   * best-effort revokes their Clerk invitations. null when the link is not this creator's.
   */
  revokeLink(creatorId: number, linkId: number): Promise<{ invitationsRevoked: number } | null>;

  /** null for an unknown or malformed code. Archived creator -> state revoked. */
  publicLink(code: string): PublicLinkView | null;
  /**
   * One BEGIN IMMEDIATE transaction: check the link, count uses, check the email key, insert or re-open the grant
   * in `sending` (expires_at = now + SENDING_LEASE_MS). An existing grant for the same email key is re-opened (moved
   * to this link and creator) only when it is failed, revoked, or expired; otherwise -> already. An email that
   * belongs to a users row -> already. `email` must be already validated and lower-cased by the caller.
   */
  claimLinkGrant(code: string, email: string, meta?: { ipKey?: string | null }): ClaimResult;
  /**
   * Sends the Clerk invitation for a grant in `sending`: notify true, redirect `${webUrl}/sign-up?via=creator`,
   * public_metadata { ddGrant: id }, expires_in_days by kind. 400 duplicate_record -> one retry with
   * ignoreExisting. Success -> sent, sent_at, expires_at = now + days, clerk_invitation_id.
   */
  sendGrant(grantId: number): Promise<SendResult>;
  /**
   * Owner path: up to 20 emails (more -> 400 too_many_emails). Each: validate (same rules as /api/waitlist), make
   * or re-open an allowlist grant, send. Sequential. Live grant for the email key -> already.
   */
  addAllowlistEmails(creatorId: number, emails: string[], actorUserId: number): Promise<AddEmailResult[]>;
  /** Owner Resend: only when resendable. Revokes the old Clerk invitation first. A link grant needs a free use. */
  resendGrant(grantId: number): Promise<ResendResult>;
  /**
   * Waitlist route: the email has an allowlist grant that is not signed_up or revoked. Re-sends when failed, expired,
   * or last sent more than RESEND_COOLDOWN_MS ago. "none" -> no such grant: continue with the normal waitlist.
   */
  resendAllowlistForWaitlist(email: string): Promise<"resent" | "not_due" | "failed" | "none">;
  /** Email keys with a grant in sending, sent or signed_up. The admin waitlist hides these emails. */
  grantedEmailKeys(): Set<string>;

  /**
   * After Clerk sync (clerk-sync.ts), in one transaction. Finds the grant by `grantId` (Clerk public_metadata
   * ddGrant) when its email key matches the user's email or the user has no email, else by the email key. Sets
   * status signed_up, user_id, signed_up_at; users.creator_id = coalesce(creator_id, grant.creator_id);
   * users.heard_from = coalesce(heard_from, 'creator'). Idempotent; a grant already bound to another user is left.
   */
  attributeSignUp(input: { userId: number; email: string | null; grantId?: number | null }): { creatorId: number } | null;
}

export function createCreatorAccessService(db: Database.Database, opts: CreatorAccessOptions = {}): CreatorAccessService {
  void db; void opts;
  throw new Error("createCreatorAccessService: not implemented yet");
}

/** Account deletion: remove every grant bound to the user or to the email's key. Returns rows deleted. */
export function deleteCreatorGrantsForUser(db: Database.Database, userId: number, email: string | null): number {
  void db; void userId; void email;
  throw new Error("deleteCreatorGrantsForUser: not implemented yet");
}

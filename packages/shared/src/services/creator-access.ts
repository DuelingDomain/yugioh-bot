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
import { randomBytes } from "node:crypto";
import { ClerkBackendError, createClerkBackend, type ClerkBackend, type ClerkInvitationJson } from "../clerk/backend.js";
import { emailKey } from "../util/email-key.js";
import { normalizeJoinEmail } from "../util/join-email.js";

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
  friends: { label: "Friends", maxUses: 3, expiresInDays: 14 },
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
  /** Grants whose invitation went out: sent or signed_up, plus revoked ones that were sent (expired included). */
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
  /** Owner-only display address. Never include this in PublicLinkView. */
  lockedEmail: string | null;
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
  /** Different inbox from the link's lock. Does not reveal the address or look up an account. */
  | { kind: "email_mismatch" }
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
  /**
   * Archive: sets archived_at (kept when already set), marks the creator's grants in sending/sent `revoked`
   * (signed_up stays), then best-effort revokes their Clerk invitations. null when the creator does not exist.
   */
  archiveCreator(id: number): Promise<{ creator: Creator; invitationsRevoked: number } | null>;
  /** Newest first. Archived ones only with includeArchived. `since` (epoch ms) drives signUpsSince; default now - 24 h. */
  listCreators(opts?: { includeArchived?: boolean; since?: number }): CreatorSummary[];
  creatorDetail(id: number): CreatorDetail | null;
  /** Total creator sign-ups (signed_up_at >= since). For the Overview tile. */
  creatorSignUpsSince(since: number): number;

  /** maxUses 1-500, expiresInDays 1-90, label up to 60, optional validated email lock. null when the creator is missing or archived. */
  createLink(creatorId: number, input: { label?: string | null; maxUses: number; expiresInDays: number; lockedEmail?: string | null; actorUserId: number }): CreatorLink | null;
  /**
   * Stops new uses at once (revoked_at), marks the link's grants in sending/sent `revoked` (signed_up stays), then
   * best-effort revokes their Clerk invitations. null when the link is not this creator's.
   */
  revokeLink(creatorId: number, linkId: number): Promise<{ invitationsRevoked: number } | null>;

  /** null for an unknown or malformed code. Archived creator -> state revoked. */
  publicLink(code: string): PublicLinkView | null;
  /**
   * One BEGIN IMMEDIATE transaction: check the link and email lock before account/grant lookup, count uses, insert or re-open the grant
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
   * Waitlist route: the email has an allowlist grant that is not signed_up or revoked. Re-sends only when failed or
   * expired; a valid invitation, or an archived creator -> "not_due" (no waitlist entry either).
   * "none" -> no such grant: continue with the normal waitlist.
   */
  resendAllowlistForWaitlist(email: string): Promise<"resent" | "not_due" | "failed" | "none">;
  /** Email keys with a live grant: signed_up, or sending/sent not expired. The admin waitlist hides these emails. */
  grantedEmailKeys(): Set<string>;

  /**
   * After Clerk sync (clerk-sync.ts), in one transaction. Finds the grant by `grantId` (Clerk public_metadata
   * ddGrant) when its email key matches the user's email or the user has no email, else by the email key; the
   * email-key match binds only when users.first_sign_in_at is null or not before the grant (an old account is
   * never credited). Sets
   * status signed_up, user_id, signed_up_at; users.creator_id = coalesce(creator_id, grant.creator_id);
   * users.heard_from = coalesce(heard_from, 'creator'). Idempotent; a grant already bound to another user is left.
   */
  attributeSignUp(input: { userId: number; email: string | null; grantId?: number | null }): { creatorId: number } | null;
}

const DAY_MS = 86_400_000;
const ACTIVE_MS = 7 * DAY_MS;
const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
/** Control characters and bidi overrides: never in a name or label shown on the public join page. */
const UNSAFE_TEXT = /[\p{Cc}\u202A-\u202E\u2066-\u2069]/u;

/** SQL: the grant holds a use (signed up, or an invitation or send lease that has not expired). Binds @now. */
const LIVE = (g: string) => `(${g}.status = 'signed_up' or (${g}.status in ('sending', 'sent') and ${g}.expires_at > @now))`;

interface CreatorRow {
  id: number; name: string; channel_url: string | null; notes: string | null; user_id: number | null;
  created_at: number; archived_at: number | null;
}
interface SummaryRow extends CreatorRow {
  links: number; open_links: number; sent: number; signed_up: number; active7d: number;
  last_sign_up_at: number | null; sign_ups_since: number;
}
interface LinkRow {
  id: number; creator_id: number; code: string; label: string | null; max_uses: number; expires_at: number;
  locked_email: string | null;
  revoked_at: number | null; created_at: number; creator_archived_at: number | null; creator_name: string;
  used: number; signed_up: number;
}
interface GrantRow {
  id: number; creator_id: number; link_id: number | null; kind: GrantKind; email: string; email_key: string;
  status: GrantStatus; clerk_invitation_id: string | null; ip_key: string | null; created_at: number;
  sent_at: number | null; expires_at: number | null; user_id: number | null; signed_up_at: number | null;
}
interface JoinedRow {
  user_id: number; signed_up_at: number; link_id: number | null; kind: GrantKind; label: string | null;
  max_uses: number | null; display_name: string; username: string; image_url: string | null; last_seen_at: number | null;
}

/** 12 chars base62. Bytes >= 248 (4 * 62) are dropped so every character is equally likely. */
function defaultCode(): string {
  let code = "";
  while (code.length < 12) {
    for (const byte of randomBytes(16)) if (byte < 248 && code.length < 12) code += BASE62[byte % 62];
  }
  return code;
}

const bad = (code: string) => new CreatorAccessError(400, code);

function cleanText(value: unknown, max: number, code: string, opts: { required?: boolean; plain?: boolean } = {}): string | null {
  if (value === undefined || value === null) {
    if (opts.required) throw bad(code);
    return null;
  }
  if (typeof value !== "string") throw bad(code);
  const trimmed = value.trim();
  if (!trimmed) {
    if (opts.required) throw bad(code);
    return null;
  }
  if (trimmed.length > max || (opts.plain && UNSAFE_TEXT.test(trimmed))) throw bad(code);
  return trimmed;
}

function cleanChannelUrl(value: unknown): string | null {
  const url = cleanText(value, 300, "invalid_channel_url", { plain: true });
  if (url === null) return null;
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw bad("invalid_channel_url"); }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw bad("invalid_channel_url");
  return url;
}

const isLive = (grant: GrantRow, now: number) => grant.status === "signed_up"
  || ((grant.status === "sending" || grant.status === "sent") && grant.expires_at !== null && grant.expires_at > now);
const isExpired = (grant: GrantRow, now: number) => (grant.status === "sending" || grant.status === "sent")
  && (grant.expires_at === null || grant.expires_at <= now);

function linkState(row: LinkRow, now: number): LinkState {
  if (row.revoked_at !== null || row.creator_archived_at !== null) return "revoked";
  if (row.expires_at <= now) return "expired";
  return row.used >= row.max_uses ? "full" : "open";
}

const toCreator = (row: CreatorRow): Creator => ({
  id: row.id, name: row.name, channelUrl: row.channel_url, notes: row.notes, userId: row.user_id,
  createdAt: row.created_at, archivedAt: row.archived_at,
});

const toSummary = (row: SummaryRow): CreatorSummary => ({
  ...toCreator(row), openLinks: row.open_links, links: row.links, sent: row.sent, signedUp: row.signed_up,
  active7d: row.active7d, lastSignUpAt: row.last_sign_up_at, signUpsSince: row.sign_ups_since,
});

const toLink = (row: LinkRow, now: number): CreatorLink => ({
  id: row.id, creatorId: row.creator_id, code: row.code, label: row.label, maxUses: row.max_uses, used: row.used,
  signedUp: row.signed_up, expiresAt: row.expires_at, revokedAt: row.revoked_at, createdAt: row.created_at,
  lockedEmail: row.locked_email,
  state: linkState(row, now),
});

function viaLabel(row: { kind: GrantKind; link_id: number | null; label: string | null; max_uses: number | null }): string {
  if (row.kind === "allowlist") return "Email";
  if (row.label) return row.label;
  if (row.max_uses === null) return "Link";
  return row.max_uses === 1 ? "Personal link" : "Community link";
}

const SUMMARY_SELECT = `
  select c.id, c.name, c.channel_url, c.notes, c.user_id, c.created_at, c.archived_at,
    (select count(*) from creator_links l where l.creator_id = c.id) as links,
    (select count(*) from creator_links l where l.creator_id = c.id and c.archived_at is null and l.revoked_at is null
      and l.expires_at > @now
      and (select count(*) from creator_grants g where g.link_id = l.id and ${LIVE("g")}) < l.max_uses) as open_links,
    (select count(*) from creator_grants g where g.creator_id = c.id and (g.status in ('sent', 'signed_up') or (g.status = 'revoked' and g.sent_at is not null))) as sent,
    (select count(*) from creator_grants g where g.creator_id = c.id and g.status = 'signed_up') as signed_up,
    (select count(*) from creator_grants g join users u on u.id = g.user_id
      where g.creator_id = c.id and g.status = 'signed_up' and u.last_seen_at >= @activeSince) as active7d,
    (select max(g.signed_up_at) from creator_grants g where g.creator_id = c.id and g.status = 'signed_up') as last_sign_up_at,
    (select count(*) from creator_grants g
      where g.creator_id = c.id and g.status = 'signed_up' and g.signed_up_at >= @since) as sign_ups_since
  from creators c`;

const LINK_SELECT = `
  select l.id, l.creator_id, l.code, l.label, l.max_uses, l.expires_at, l.revoked_at, l.created_at, l.locked_email,
    c.archived_at as creator_archived_at, c.name as creator_name,
    (select count(*) from creator_grants g where g.link_id = l.id and ${LIVE("g")}) as used,
    (select count(*) from creator_grants g where g.link_id = l.id and g.status = 'signed_up') as signed_up
  from creator_links l join creators c on c.id = l.creator_id`;

export function createCreatorAccessService(db: Database.Database, opts: CreatorAccessOptions = {}): CreatorAccessService {
  const clock = opts.now ?? Date.now;
  const newCode = opts.newCode ?? defaultCode;
  let clerk: ClerkBackend | undefined = opts.clerk;

  /** Clerk is needed only to send or revoke; list and detail work without it. */
  function getClerk(): ClerkBackend {
    if (clerk) return clerk;
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!secretKey) throw new CreatorAccessError(503, "clerk_not_configured");
    clerk = createClerkBackend({ secretKey });
    return clerk;
  }
  function redirectUrl(): string {
    const origin = (opts.webUrl ?? process.env.WEB_URL ?? "").trim().replace(/\/+$/, "");
    if (!origin) throw new CreatorAccessError(503, "web_url_missing");
    return `${origin}/sign-up?via=creator`;
  }
  /** Throws the 503 errors before any row changes, so a missing setting never burns a grant. */
  function requireSender(): { clerk: ClerkBackend; redirect: string } {
    return { clerk: getClerk(), redirect: redirectUrl() };
  }

  const creatorRow = (id: number) => db.prepare<[number], CreatorRow>(
    "select id, name, channel_url, notes, user_id, created_at, archived_at from creators where id = ?").get(id);
  const grantById = (id: number) => db.prepare<[number], GrantRow>("select * from creator_grants where id = ?").get(id);
  const grantByKey = (key: string) => db.prepare<[string], GrantRow>("select * from creator_grants where email_key = ?").get(key);
  /** An account for the same inbox (email key), not only the exact address. Scans users of the same domain. */
  function hasAccount(email: string, key: string): boolean {
    if (db.prepare<[string], { one: number }>("select 1 as one from users where email = ?").get(email)) return true;
    const domain = key.slice(key.lastIndexOf("@") + 1);
    const sameDomain = db.prepare<[string], { email: string }>("select email from users where email like ? escape '\\'");
    for (const candidate of domain === "gmail.com" ? ["gmail.com", "googlemail.com"] : [domain]) {
      for (const row of sameDomain.all(`%@${candidate.replace(/[\\%_]/g, "\\$&")}`)) if (emailKey(row.email) === key) return true;
    }
    return false;
  }
  /** Best effort: the grants are already revoked, so a Clerk failure only leaves a ticket to expire. */
  async function revokeInvitations(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    let backend: ClerkBackend;
    try { backend = getClerk(); } catch { return 0; }
    let revoked = 0;
    for (const id of ids) {
      try { await backend.revokeInvitation(id); revoked++; } catch { /* best effort */ }
    }
    return revoked;
  }
  const linkUses = (linkId: number, now: number) => (db.prepare(
    `select count(*) as used from creator_grants g where g.link_id = @linkId and ${LIVE("g")}`).get({ linkId, now }) as { used: number }).used;
  const linkById = (id: number, now: number) => db.prepare(`${LINK_SELECT} where l.id = @id`).get({ id, now }) as LinkRow | undefined;

  function summaries(where: string, params: Record<string, number>, since?: number): CreatorSummary[] {
    const now = clock();
    const rows = db.prepare(`${SUMMARY_SELECT} ${where} order by c.created_at desc, c.id desc`)
      .all({ ...params, now, activeSince: now - ACTIVE_MS, since: since ?? now - DAY_MS }) as SummaryRow[];
    return rows.map(toSummary);
  }

  /** Grant -> sending with a fresh lease. Insert, or re-open the row that already holds this email key. */
  function openGrant(existing: GrantRow | undefined, fields: {
    creatorId: number; linkId: number | null; kind: GrantKind; email: string; key: string; ipKey: string | null; now: number;
  }): number {
    const params = { ...fields, lease: fields.now + SENDING_LEASE_MS };
    if (existing) {
      // clerk_invitation_id stays: sendGrant revokes that old invitation before it creates the new one.
      db.prepare(`update creator_grants set creator_id = @creatorId, link_id = @linkId, kind = @kind, email = @email,
        status = 'sending', expires_at = @lease, sent_at = null, created_at = @now, ip_key = @ipKey,
        user_id = null, signed_up_at = null where id = @id`).run({ ...params, id: existing.id });
      return existing.id;
    }
    return Number(db.prepare(`insert into creator_grants
        (creator_id, link_id, kind, email, email_key, status, ip_key, created_at, expires_at)
      values (@creatorId, @linkId, @kind, @email, @key, 'sending', @ipKey, @now, @lease)`).run(params).lastInsertRowid);
  }

  const markFailed = (grantId: number) => db.prepare(
    "update creator_grants set status = 'failed', expires_at = null where id = ? and status = 'sending'").run(grantId);

  async function sendGrant(grantId: number): Promise<SendResult> {
    const grant = grantById(grantId);
    if (!grant || grant.status !== "sending") return { kind: "failed", retryable: false, retryAfterMs: null };
    let sender: { clerk: ClerkBackend; redirect: string };
    try { sender = requireSender(); } catch (error) {
      markFailed(grantId);
      throw error;
    }
    // A re-opened grant may still have a pending invitation; revoke it so only one ticket is live.
    if (grant.clerk_invitation_id) await sender.clerk.revokeInvitation(grant.clerk_invitation_id).catch(() => {});
    const create = (ignoreExisting: boolean) => sender.clerk.createInvitation({
      emailAddress: grant.email, redirectUrl: sender.redirect, publicMetadata: { ddGrant: grant.id },
      expiresInDays: grant.kind === "link" ? LINK_INVITE_DAYS : ALLOWLIST_INVITE_DAYS, notify: true,
      ...(ignoreExisting ? { ignoreExisting: true } : {}),
    });
    let invitation: ClerkInvitationJson;
    try {
      try { invitation = await create(false); } catch (error) {
        if (!(error instanceof ClerkBackendError && error.status === 400 && error.code === "duplicate_record")) throw error;
        invitation = await create(true);
      }
    } catch (error) {
      if (error instanceof ClerkBackendError && error.status === 422 && error.code === "form_identifier_exists") {
        // The email has an account: no grant is needed, and the use is free again.
        db.prepare("delete from creator_grants where id = ? and status = 'sending'").run(grantId);
        return { kind: "existing_account" };
      }
      markFailed(grantId);
      return error instanceof ClerkBackendError
        ? { kind: "failed", retryable: error.retryable, retryAfterMs: error.retryAfterMs }
        : { kind: "failed", retryable: true, retryAfterMs: null };
    }
    const stored = db.transaction(() => {
      const now = clock();
      const days = grant.kind === "link" ? LINK_INVITE_DAYS : ALLOWLIST_INVITE_DAYS;
      return db.prepare(`update creator_grants set status = 'sent', sent_at = @now, expires_at = @expires,
        clerk_invitation_id = @invitation where id = @id and status = 'sending'`)
        .run({ now, expires: now + days * DAY_MS, invitation: invitation.id, id: grantId }).changes > 0;
    }).immediate();
    if (!stored) {
      // A revoke (or account deletion) during the call wins: the new ticket must not stay usable.
      await sender.clerk.revokeInvitation(invitation.id).catch(() => {});
      return { kind: "failed", retryable: false, retryAfterMs: null };
    }
    return { kind: "sent" };
  }

  return {
    createCreator(input) {
      const name = cleanText(input.name, 80, "invalid_name", { required: true, plain: true })!;
      const channelUrl = cleanChannelUrl(input.channelUrl);
      const notes = cleanText(input.notes, 1000, "invalid_notes");
      const userId = input.userId ?? null;
      if (userId !== null && (!Number.isSafeInteger(userId)
        || !db.prepare<[number], { one: number }>("select 1 as one from users where id = ?").get(userId))) throw bad("invalid_user_id");
      const id = Number(db.prepare(`insert into creators (name, channel_url, notes, user_id, created_by_user_id, created_at)
        values (?, ?, ?, ?, (select id from users where id = ?), ?)`)
        .run(name, channelUrl, notes, userId, input.actorUserId, clock()).lastInsertRowid);
      return toCreator(creatorRow(id)!);
    },

    updateCreator(id, patch) {
      const existing = creatorRow(id);
      if (!existing) return null;
      const name = patch.name === undefined ? existing.name : cleanText(patch.name, 80, "invalid_name", { required: true, plain: true })!;
      const channelUrl = patch.channelUrl === undefined ? existing.channel_url : cleanChannelUrl(patch.channelUrl);
      const notes = patch.notes === undefined ? existing.notes : cleanText(patch.notes, 1000, "invalid_notes");
      const archivedAt = patch.archived === undefined ? existing.archived_at
        : patch.archived ? existing.archived_at ?? clock() : null;
      db.prepare("update creators set name = ?, channel_url = ?, notes = ?, archived_at = ? where id = ?")
        .run(name, channelUrl, notes, archivedAt, id);
      return toCreator(creatorRow(id)!);
    },

    async archiveCreator(id) {
      const invitations = db.transaction((): string[] | null => {
        if (!creatorRow(id)) return null;
        db.prepare("update creators set archived_at = coalesce(archived_at, ?) where id = ?").run(clock(), id);
        const open = db.prepare<[number], { clerk_invitation_id: string | null }>(
          "select clerk_invitation_id from creator_grants where creator_id = ? and status in ('sending', 'sent')").all(id);
        db.prepare("update creator_grants set status = 'revoked' where creator_id = ? and status in ('sending', 'sent')").run(id);
        return open.flatMap(row => row.clerk_invitation_id ? [row.clerk_invitation_id] : []);
      }).immediate();
      if (invitations === null) return null;
      const invitationsRevoked = await revokeInvitations(invitations);
      return { creator: toCreator(creatorRow(id)!), invitationsRevoked };
    },

    listCreators(listOpts = {}) {
      return summaries(listOpts.includeArchived ? "" : "where c.archived_at is null", {}, listOpts.since);
    },

    creatorDetail(id) {
      const [creator] = summaries("where c.id = @id", { id });
      if (!creator) return null;
      const now = clock();
      const links = (db.prepare(`${LINK_SELECT} where l.creator_id = @id order by l.created_at desc, l.id desc`)
        .all({ id, now }) as LinkRow[]).map(row => toLink(row, now));
      const grants = (db.prepare(`select g.*, l.label as link_label from creator_grants g
          left join creator_links l on l.id = g.link_id
          where g.creator_id = ? and g.status <> 'signed_up' order by g.created_at desc, g.id desc`)
        .all(id) as (GrantRow & { link_label: string | null })[]).map((row): CreatorGrant => {
        const expired = isExpired(row, now);
        return {
          id: row.id, creatorId: row.creator_id, linkId: row.link_id, linkLabel: row.link_label, kind: row.kind,
          email: row.email, status: row.status, view: expired ? "expired" : row.status, createdAt: row.created_at,
          sentAt: row.sent_at, expiresAt: row.expires_at, resendable: row.status === "failed" || expired,
        };
      });
      const joined = (db.prepare(`select g.user_id, coalesce(g.signed_up_at, g.created_at) as signed_up_at, g.link_id,
          g.kind, l.label, l.max_uses, u.display_name, u.username, u.image_url, u.last_seen_at
        from creator_grants g join users u on u.id = g.user_id left join creator_links l on l.id = g.link_id
        where g.creator_id = ? and g.status = 'signed_up' order by signed_up_at desc, g.id desc`)
        .all(id) as JoinedRow[]).map((row): CreatorJoinedPerson => ({
        userId: row.user_id, displayName: row.display_name, username: row.username, imageUrl: row.image_url,
        signedUpAt: row.signed_up_at, linkId: row.link_id, via: viaLabel(row), lastSeenAt: row.last_seen_at,
        active7d: row.last_seen_at !== null && row.last_seen_at >= now - ACTIVE_MS,
      }));
      return { creator, links, grants, joined };
    },

    creatorSignUpsSince(since) {
      return (db.prepare("select count(*) as n from creator_grants where status = 'signed_up' and signed_up_at >= ?")
        .get(since) as { n: number }).n;
    },

    createLink(creatorId, input) {
      if (!Number.isInteger(input.maxUses) || input.maxUses < 1 || input.maxUses > MAX_LINK_USES) throw bad("invalid_max_uses");
      if (!Number.isInteger(input.expiresInDays) || input.expiresInDays < 1 || input.expiresInDays > MAX_LINK_DAYS) {
        throw bad("invalid_expires_in_days");
      }
      const label = cleanText(input.label, 60, "invalid_label", { plain: true });
      const rawLock = input.lockedEmail;
      const hasLock = rawLock !== undefined && rawLock !== null && !(typeof rawLock === "string" && rawLock.trim() === "");
      const lockedEmail = hasLock ? normalizeJoinEmail(rawLock) : null;
      const lockedEmailKey = lockedEmail ? emailKey(lockedEmail) : null;
      if (hasLock && (!lockedEmail || !lockedEmailKey)) throw bad("invalid_locked_email");
      if (hasLock && input.maxUses !== 1) throw bad("invalid_max_uses");
      const creator = creatorRow(creatorId);
      if (!creator || creator.archived_at !== null) return null;
      const insert = db.prepare(`insert into creator_links
        (creator_id, code, label, max_uses, expires_at, locked_email, locked_email_key, created_by_user_id, created_at)
        values (@creatorId, @code, @label, @maxUses, @expiresAt, @lockedEmail, @lockedEmailKey, (select id from users where id = @actor), @now)`);
      for (let attempt = 0; attempt < 5; attempt++) {
        const code = newCode();
        if (!LINK_CODE_PATTERN.test(code)) throw new CreatorAccessError(500, "invalid_link_code");
        const now = clock();
        try {
          const id = Number(insert.run({ creatorId, code, label, lockedEmail, lockedEmailKey, maxUses: input.maxUses,
            expiresAt: now + input.expiresInDays * DAY_MS, actor: input.actorUserId, now }).lastInsertRowid);
          return toLink(linkById(id, now)!, now);
        } catch (error) {
          if ((error as { code?: unknown }).code !== "SQLITE_CONSTRAINT_UNIQUE") throw error;
        }
      }
      throw new CreatorAccessError(500, "link_code_conflict");
    },

    async revokeLink(creatorId, linkId) {
      const invitations = db.transaction((): string[] | null => {
        const link = db.prepare<[number, number], { id: number }>("select id from creator_links where id = ? and creator_id = ?")
          .get(linkId, creatorId);
        if (!link) return null;
        db.prepare("update creator_links set revoked_at = coalesce(revoked_at, ?), locked_email = null where id = ?").run(clock(), linkId);
        const open = db.prepare<[number], { clerk_invitation_id: string | null }>(
          "select clerk_invitation_id from creator_grants where link_id = ? and status in ('sending', 'sent')").all(linkId);
        db.prepare("update creator_grants set status = 'revoked' where link_id = ? and status in ('sending', 'sent')").run(linkId);
        return open.flatMap(row => row.clerk_invitation_id ? [row.clerk_invitation_id] : []);
      }).immediate();
      if (invitations === null) return null;
      return { invitationsRevoked: await revokeInvitations(invitations) };
    },

    publicLink(code) {
      if (typeof code !== "string" || !LINK_CODE_PATTERN.test(code)) return null;
      const now = clock();
      const row = db.prepare(`${LINK_SELECT} where l.code = @code`).get({ code, now }) as LinkRow | undefined;
      if (!row) return null;
      const state = linkState(row, now);
      return { state, creatorName: row.creator_name, spotsLeft: state === "open" ? row.max_uses - row.used : 0 };
    },

    claimLinkGrant(code, email, meta = {}) {
      return db.transaction((): ClaimResult => {
        const now = clock();
        if (typeof code !== "string" || !LINK_CODE_PATTERN.test(code)) return { kind: "not_found" };
        const link = db.prepare<[string], { id: number; creator_id: number; max_uses: number; expires_at: number;
          locked_email_key: string | null; revoked_at: number | null; creator_archived_at: number | null }>(`select l.id, l.creator_id, l.max_uses, l.expires_at, l.locked_email_key,
          l.revoked_at, c.archived_at as creator_archived_at from creator_links l join creators c on c.id = l.creator_id
          where l.code = ?`).get(code);
        if (!link) return { kind: "not_found" };
        if (link.revoked_at !== null || link.creator_archived_at !== null) return { kind: "revoked" };
        if (link.expires_at <= now) return { kind: "expired" };
        const address = email.trim().toLowerCase();
        const key = emailKey(address);
        if (!key) throw bad("invalid_email");
        if (link.locked_email_key !== null && key !== link.locked_email_key) return { kind: "email_mismatch" };
        if (hasAccount(address, key)) return { kind: "already" };
        const existing = grantByKey(key);
        if (existing && isLive(existing, now)) return { kind: "already" };
        if (linkUses(link.id, now) >= link.max_uses) return { kind: "full" };
        const grantId = openGrant(existing, { creatorId: link.creator_id, linkId: link.id, kind: "link", email: address, key,
          ipKey: meta.ipKey?.slice(0, 200) ?? null, now });
        return { kind: "claimed", grantId };
      }).immediate();
    },

    sendGrant,

    async addAllowlistEmails(creatorId, emails, actorUserId) {
      void actorUserId;
      if (!Array.isArray(emails)) throw bad("invalid_emails");
      if (emails.length > MAX_EMAILS_PER_ADD) throw bad("too_many_emails");
      const creator = creatorRow(creatorId);
      if (!creator) throw new CreatorAccessError(404, "not_found");
      if (creator.archived_at !== null) throw new CreatorAccessError(409, "creator_archived");
      if (emails.length === 0) return [];
      requireSender();
      const results: AddEmailResult[] = [];
      for (const raw of emails) {
        const email = normalizeJoinEmail(raw);
        const key = email ? emailKey(email) : null;
        if (!email || !key) {
          results.push({ email: typeof raw === "string" ? raw.trim().slice(0, 254) : "", outcome: "invalid" });
          continue;
        }
        const claim = db.transaction((): AddEmailOutcome | number => {
          const now = clock();
          if (hasAccount(email, key)) return "existing_account";
          const existing = grantByKey(key);
          if (existing && isLive(existing, now)) return "already";
          return openGrant(existing, { creatorId, linkId: null, kind: "allowlist", email, key, ipKey: null, now });
        }).immediate();
        if (typeof claim === "string") {
          results.push({ email, outcome: claim });
          continue;
        }
        const sent = await sendGrant(claim);
        results.push({ email, outcome: sent.kind === "sent" ? "sent" : sent.kind === "existing_account" ? "existing_account" : "failed" });
      }
      return results;
    },

    async resendGrant(grantId) {
      requireSender();
      const claim = db.transaction((): ResendResult | number => {
        const now = clock();
        const grant = grantById(grantId);
        if (!grant) throw new CreatorAccessError(404, "not_found");
        if (!(grant.status === "failed" || isExpired(grant, now))) return { kind: "not_resendable" };
        if (creatorRow(grant.creator_id)?.archived_at !== null) return { kind: "not_resendable" };
        if (grant.kind === "link") {
          const link = grant.link_id === null ? undefined : linkById(grant.link_id, now);
          if (!link || link.revoked_at !== null || link.expires_at <= now) return { kind: "not_resendable" };
          // This grant is not live, so it is not in `used`.
          if (link.used >= link.max_uses) return { kind: "full" };
        }
        db.prepare("update creator_grants set status = 'sending', expires_at = ? where id = ? and status = ?")
          .run(now + SENDING_LEASE_MS, grant.id, grant.status);
        return grant.id;
      }).immediate();
      return typeof claim === "number" ? sendGrant(claim) : claim;
    },

    async resendAllowlistForWaitlist(email) {
      const key = emailKey(email);
      if (!key) return "none";
      const grant = grantByKey(key);
      if (!grant || grant.kind !== "allowlist" || grant.status === "signed_up" || grant.status === "revoked") return "none";
      try { requireSender(); } catch (error) {
        if (error instanceof CreatorAccessError) return "failed";
        throw error;
      }
      if (creatorRow(grant.creator_id)?.archived_at !== null) return "not_due";
      const claim = db.transaction((): "none" | "not_due" | number => {
        const now = clock();
        const current = grantByKey(key);
        if (!current || current.kind !== "allowlist" || current.status === "signed_up" || current.status === "revoked") return "none";
        if (creatorRow(current.creator_id)?.archived_at !== null) return "not_due";
        // A valid invitation is still in the inbox: re-send only a failed or expired one.
        if (!(current.status === "failed" || isExpired(current, now))) return "not_due";
        db.prepare("update creator_grants set status = 'sending', expires_at = ? where id = ? and status = ?")
          .run(now + SENDING_LEASE_MS, current.id, current.status);
        return current.id;
      }).immediate();
      if (typeof claim === "string") return claim;
      let result: SendResult;
      try { result = await sendGrant(claim); } catch (error) {
        if (error instanceof CreatorAccessError) return "failed";
        throw error;
      }
      // An existing account needs no invitation and no waitlist entry: answer like a cooldown.
      return result.kind === "sent" ? "resent" : result.kind === "existing_account" ? "not_due" : "failed";
    },

    grantedEmailKeys() {
      return new Set((db.prepare(`select g.email_key from creator_grants g where ${LIVE("g")}`)
        .all({ now: clock() }) as { email_key: string }[]).map(row => row.email_key));
    },

    attributeSignUp(input) {
      return db.transaction((): { creatorId: number } | null => {
        if (!db.prepare<[number], { one: number }>("select 1 as one from users where id = ?").get(input.userId)) return null;
        const key = input.email ? emailKey(input.email) : null;
        let grant: GrantRow | undefined;
        if (typeof input.grantId === "number" && Number.isSafeInteger(input.grantId)) {
          const byId = grantById(input.grantId);
          if (byId && (key === null || byId.email_key === key)) grant = byId;
        }
        if (!grant && key) {
          const byKey = grantByKey(key);
          // An account that signed in before the grant existed did not join through it.
          const firstSignIn = db.prepare<[number], { first_sign_in_at: number | null }>(
            "select first_sign_in_at from users where id = ?").get(input.userId)!.first_sign_in_at;
          if (byKey && (byKey.user_id === input.userId || firstSignIn === null || firstSignIn >= byKey.created_at)) grant = byKey;
        }
        if (!grant || (grant.user_id !== null && grant.user_id !== input.userId)) return null;
        // signed_up even when revoked or expired: the person did sign up with this grant.
        db.prepare(`update creator_grants set status = 'signed_up', user_id = @userId,
          signed_up_at = coalesce(signed_up_at, @now) where id = @id`).run({ userId: input.userId, now: clock(), id: grant.id });
        db.prepare(`update users set heard_from = coalesce(heard_from, 'creator'), creator_id = coalesce(creator_id, @creatorId)
          where id = @userId`).run({ creatorId: grant.creator_id, userId: input.userId });
        return { creatorId: grant.creator_id };
      }).immediate();
    },
  };
}

/** Account deletion: scrub/revoke matching email locks, then remove bound/same-inbox grants. Returns grants deleted. */
export function deleteCreatorGrantsForUser(db: Database.Database, userId: number, email: string | null): number {
  const key = email ? emailKey(email) : null;
  // Revocation preserves the restriction after its personal data is erased. Read bound grant keys before deleting them,
  // including when the account's email has since changed or been cleared.
  db.prepare(`update creator_links set locked_email = null, locked_email_key = null, revoked_at = coalesce(revoked_at, ?)
    where locked_email_key = ? or locked_email_key in (select email_key from creator_grants where user_id = ?)`)
    .run(Date.now(), key, userId);
  return db.prepare("delete from creator_grants where user_id = ? or email_key = ?").run(userId, key).changes;
}

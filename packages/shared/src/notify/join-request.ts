import { log } from "../observability/index.js";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { normalizeEmailDomain } from "../util/email-domain.js";
import { enqueueOutbox } from "../discord-admin/outbox.js";
import { notificationSubjectHash } from "../discord-admin/subject.js";
import { prepareWaitlistAction, waitlistDecisionPayload } from "../services/waitlist-decisions.js";

export interface JoinRequestNotice {
  email?: string;
  /** Used for a Clerk user without an email address. Never included in the message. */
  subjectId?: string;
  /** Clerk waitlist entry ID, bound even when the form already queued the alert. */
  clerkEntryId?: string;
  source: "marketing waitlist" | "app waitlist" | "Clerk waitlist" | "sign-up";
  createdAt?: string;
}

const TIMEOUT_MS = 2000;
const MAX_RETRY_SECONDS = 30;
const ALERT_WINDOW_MS = 60 * 60 * 1000;
const MAX_ALERTS_PER_WINDOW = 30;
let alertWindow = { expiresAt: 0, count: 0, warned: false };
const CLERK_DASHBOARD = "https://dashboard.clerk.com/";
const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}\[\]()<>#+\-.!|~:/]/g, "\\$&");

function emailCode(value: string): string {
  // Backslashes do not escape backticks inside code. Replace user delimiters
  // and line breaks so even unvalidated Clerk text stays in one code span.
  return "`" + value.replace(/`/g, "\u02cb").replace(/[\r\n\u2028\u2029]/g, " ") + "`";
}

function takeAlertSlot(): boolean {
  const now = Date.now();
  if (now >= alertWindow.expiresAt) alertWindow = { expiresAt: now + ALERT_WINDOW_MS, count: 0, warned: false };
  if (alertWindow.count < MAX_ALERTS_PER_WINDOW) {
    alertWindow.count++;
    return true;
  }
  if (!alertWindow.warned) {
    alertWindow.warned = true;
    log("warn", "[join-alert] Process limit reached (30 alerts/hour); further alerts dropped");
  }
  return false;
}

function dashboardUrl(): string {
  try {
    const url = new URL(process.env.DISCORD_ADMIN_DASHBOARD_URL || CLERK_DASHBOARD);
    return url.protocol === "https:" ? url.href : CLERK_DASHBOARD;
  } catch { return CLERK_DASHBOARD; }
}

function maskedEmail(email: string): string {
  const at = email.lastIndexOf("@");
  return at > 0 ? `${Array.from(email)[0]}***${email.slice(at)}` : "Email unavailable";
}

/** Durable bot path. Call inside the webhook receipt transaction; storage errors must be retried. */
export function enqueueJoinRequest(db: Database.Database, notice: JoinRequestNotice): void {
  const signup = notice.source === "sign-up";
  const hash = notificationSubjectHash(notice);
  // Preserve the deletion link even if the owner disables signup alerts and the
  // user has not yet signed in locally. Email changes must not orphan a waitlist alert.
  if (signup && notice.subjectId && hash) db.transaction(() => {
    db.prepare(`insert into discord_join_subjects(subject_hash,clerk_user_id) values(?,?)
      on conflict(subject_hash) do update set clerk_user_id=excluded.clerk_user_id`).run(hash, notice.subjectId);
    db.prepare(`update discord_waitlist_actions set subject_clerk_id=coalesce(subject_clerk_id,?)
      where subject_hash=?`).run(notice.subjectId, hash);
  }).immediate();
  const enabled = signup ? (process.env.DISCORD_SIGNUP_ALERTS_ENABLED ?? "1") === "1"
    : (process.env.DISCORD_JOIN_REQUEST_ALERTS_ENABLED ?? "1") === "1";
  const channelId = process.env.DISCORD_WAITLIST_CHANNEL_ID?.trim();
  if (!enabled) return;
  if (!channelId) throw new Error("Discord waitlist channel is not configured");
  let email = notice.email?.trim().toLowerCase();
  if (email) email = normalizeEmailDomain(email) ?? email;
  if (!hash) return;
  db.transaction(() => {
    const action = signup ? null : prepareWaitlistAction(db, { email, clerkEntryId: notice.clerkEntryId });
    const now = new Date().toISOString();
    const inserted = db.prepare(`insert into join_request_notifications(kind,subject_hash,attempted_at) values(?,?,?)
      on conflict(kind,subject_hash) do nothing`).run(signup ? "signup" : "join", hash, now);
    if (!inserted.changes) return;
    if (action) db.prepare("update discord_waitlist_actions set channel_id=coalesce(channel_id,?) where id=?").run(channelId, action.id);
    const payload = action?.completed_at !== null && action ? waitlistDecisionPayload(action) : {
      embeds: [{ title: signup ? "New user sign-up" : "New join request", url: dashboardUrl(), timestamp: notice.createdAt ?? now,
        fields: [{ name: "Email", value: email ? emailCode(maskedEmail(email)) : "Email unavailable" },
          { name: "Source", value: escapeMarkdown(notice.source) }] }],
      ...(action ? { components: [{ type: 1, components: [
        { type: 2, style: 3, label: "Approve", custom_id: `wl:approve:${action.id}` },
        { type: 2, style: 4, label: "Reject", custom_id: `wl:reject:${action.id}` },
      ] }] } : {}),
    };
    enqueueOutbox(db, { idempotencyKey: `join:${signup ? "signup" : "join"}:${hash}`, kind: signup ? "signup_alert" : "waitlist_alert",
      channelId, waitlistActionId: action?.id, subjectHash: hash, subjectClerkId: notice.subjectId, payload });
  }).immediate();
}

async function post(url: string, body: string): Promise<number | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body, signal: controller.signal,
    });
    if (response.status === 429) {
      const payload = await response.json().catch(() => null) as { retry_after?: unknown } | null;
      const header = response.headers.get("Retry-After");
      const seconds = typeof payload?.retry_after === "number" ? payload.retry_after
        : header !== null && /^\d+(?:\.\d+)?$/.test(header.trim()) ? Number(header) : NaN;
      // Long delays would retain timers and deliver stale alerts.
      if (!controller.signal.aborted && Number.isFinite(seconds) && seconds >= 0 && seconds <= MAX_RETRY_SECONDS) return seconds * 1000;
    }
    if (!response.ok) log("warn", "[join-alert] Discord rejected an alert", { status: response.status });
    return null;
  } finally { clearTimeout(timer); }
}

/**
 * Best-effort, one attempt per person and alert type. Call with `void` after commit;
 * this promise never rejects, and no Discord failure can fail the user request.
 * Claims record attempts, not delivery: a crash or transport failure can lose an alert.
 */
export async function notifyJoinRequest(db: Database.Database, notice: JoinRequestNotice): Promise<void> {
  try {
    if (process.env.DISCORD_BOT_ENABLED === "1") {
      enqueueJoinRequest(db, notice);
      return;
    }
    const url = process.env.DISCORD_ADMIN_WEBHOOK_URL?.trim();
    const signup = notice.source === "sign-up";
    const enabled = signup ? process.env.DISCORD_SIGNUP_ALERTS_ENABLED === "1"
      : (process.env.DISCORD_JOIN_REQUEST_ALERTS_ENABLED ?? "1") === "1";
    if (!url || !enabled) return;

    let email = notice.email?.trim().toLowerCase();
    // Match the waitlist route's normalization; keep unusable Clerk text literal.
    if (email) email = normalizeEmailDomain(email) ?? email;
    const subject = email ? `email:${email}` : notice.subjectId ? `clerk:${notice.subjectId}` : null;
    if (!subject) return;
    const now = new Date().toISOString();
    const claim = db.prepare(`
      insert into join_request_notifications (kind, subject_hash, attempted_at) values (?, ?, ?)
      on conflict(kind, subject_hash) do nothing
    `).run(signup ? "signup" : "join", createHash("sha256").update(subject).digest("hex"), now);
    if (claim.changes === 0) return;
    // Retain dropped claims so replays cannot turn a flood into a later burst.
    if (!takeAlertSlot()) return;

    const emailText = !email ? "Email unavailable"
      : process.env.DISCORD_ADMIN_SHOW_FULL_EMAIL === "1" ? email : maskedEmail(email);
    const body = JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: signup ? "New user sign-up" : "New join request",
        url: dashboardUrl(), timestamp: notice.createdAt ?? now,
        fields: [
          { name: "Email", value: email ? emailCode(emailText) : emailText },
          { name: "Source", value: escapeMarkdown(notice.source) },
        ],
      }],
    });
    const retryAfterMs = await post(url, body);
    if (retryAfterMs !== null) {
      await new Promise<void>(resolve => {
        // A long rate limit must not keep a one-off owner process alive.
        const timer = setTimeout(resolve, retryAfterMs);
        timer.unref();
      });
      await post(url, body);
    }
  } catch {
    // Fetch errors can include the secret URL or email. Never log the exception.
    log("warn", "[join-alert] Could not send an alert");
  }
}

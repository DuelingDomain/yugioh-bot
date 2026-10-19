import { log } from "../observability/index.js";
import type Database from "better-sqlite3";
import { createHash } from "node:crypto";
import { normalizeEmailDomain } from "../util/email-domain.js";
import { prepareWaitlistAction, waitlistActionOrigin, waitlistActionToken } from "./waitlist-actions.js";
import { webhookHash } from "./discord-webhook.js";

export interface JoinRequestNotice {
  email?: string;
  /** Used for a Clerk user without an email address. Never included in the message. */
  subjectId?: string;
  source: "marketing waitlist" | "app waitlist" | "Clerk waitlist" | "sign-up";
  createdAt?: string;
  clerkEntryId?: string;
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

async function post(url: string, body: string, delivered?: (id: string) => void): Promise<number | null> {
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
    else if (delivered) {
      const message = await response.json().catch(() => null) as { id?: unknown } | null;
      if (typeof message?.id === "string" && /^\d{1,25}$/.test(message.id)) delivered(message.id);
    }
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
    const hash = createHash("sha256").update(subject).digest("hex");
    const action = signup ? null : prepareWaitlistAction(db, hash, notice.clerkEntryId);
    const now = new Date().toISOString();
    const claim = db.prepare(`
      insert into join_request_notifications (kind, subject_hash, attempted_at) values (?, ?, ?)
      on conflict(kind, subject_hash) do nothing
    `).run(signup ? "signup" : "join", hash, now);
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
          ...(action ? [{ name: "Owner action", value: (["approve", "reject"] as const).map(decision =>
            `[${decision === "approve" ? "Approve" : "Reject"}](${waitlistActionOrigin()}/admin/waitlist/${waitlistActionToken(action, decision)})`).join(" · ") }] : []),
        ],
      }],
    });
    const target = new URL(url);
    if (action) target.searchParams.set("wait", "true");
    const delivered = action ? (id: string) => {
      db.prepare("update discord_waitlist_actions set discord_message_id=?,webhook_hash=?,message_json=? where id=?")
        .run(id, webhookHash(url), body, action.id);
    } : undefined;
    const retryAfterMs = await post(target.href, body, delivered);
    if (retryAfterMs !== null) {
      await new Promise<void>(resolve => {
        // A long rate limit must not keep a one-off owner process alive.
        const timer = setTimeout(resolve, retryAfterMs);
        timer.unref();
      });
      await post(target.href, body, delivered);
    }
  } catch {
    // Fetch errors can include the secret URL or email. Never log the exception.
    log("warn", "[join-alert] Could not send an alert");
  }
}

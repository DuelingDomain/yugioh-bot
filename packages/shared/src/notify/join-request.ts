import type Database from "better-sqlite3";
import { createHash } from "node:crypto";

export interface JoinRequestNotice {
  email?: string;
  /** Used for a Clerk user without an email address. Never included in the message. */
  subjectId?: string;
  source: "marketing waitlist" | "app waitlist" | "Clerk waitlist" | "sign-up";
  createdAt?: string;
}

const TIMEOUT_MS = 2000;
const CLERK_DASHBOARD = "https://dashboard.clerk.com/";
const escapeMarkdown = (value: string) => value.replace(/[\\`*_{}\[\]()<>#+\-.!|~]/g, "\\$&");

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
      // Reject invalid/overflowing timers rather than retrying before Discord permits it.
      if (!controller.signal.aborted && Number.isFinite(seconds) && seconds >= 0 && seconds * 1000 <= 2_147_483_647) return seconds * 1000;
    }
    if (!response.ok) console.warn("[join-alert] Discord rejected an alert");
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

    const email = notice.email?.trim().toLowerCase();
    const subject = email ? `email:${email}` : notice.subjectId ? `clerk:${notice.subjectId}` : null;
    if (!subject) return;
    const now = new Date().toISOString();
    const claim = db.prepare(`
      insert into join_request_notifications (kind, subject_hash, attempted_at) values (?, ?, ?)
      on conflict(kind, subject_hash) do nothing
    `).run(signup ? "signup" : "join", createHash("sha256").update(subject).digest("hex"), now);
    if (claim.changes === 0) return;

    const emailText = !email ? "Email unavailable"
      : process.env.DISCORD_ADMIN_SHOW_FULL_EMAIL === "1" ? email : maskedEmail(email);
    const body = JSON.stringify({
      allowed_mentions: { parse: [] },
      embeds: [{
        title: signup ? "New user sign-up" : "New join request",
        url: dashboardUrl(), timestamp: notice.createdAt ?? now,
        fields: [
          { name: "Email", value: escapeMarkdown(emailText) },
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
    console.warn("[join-alert] Could not send an alert");
  }
}

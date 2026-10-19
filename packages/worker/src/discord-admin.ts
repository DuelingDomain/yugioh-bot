import type Database from "better-sqlite3";
import { createClerkBackend } from "@yugidraft/shared/clerk";
import { clearOldPresence, ONLINE_WINDOW_MS, PRESENCE_ROUTES, isPresenceRoute } from "@yugidraft/shared/presence";
import { discordText, discordWebhook, updateWaitlistMessage, webhookHash } from "@yugidraft/shared/notify";
import { log } from "@yugidraft/shared/observability";

interface StatusState {
  webhook_hash: string | null; message_id: string | null; pending_count: number | null;
  pending_checked_at: number | null; pending_attempted_at: number | null; retry_at: number;
}
const CACHE_MS = 5 * 60_000;
const EDIT_RETRY_GRACE_MS = 15 * 60_000;
async function pendingCount(db: Database.Database, state: StatusState, now: number): Promise<string> {
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (secretKey && (state.pending_attempted_at === null || state.pending_attempted_at <= now - CACHE_MS)) {
    // Persist attempts too, to bound provider calls during an outage and restarts.
    db.prepare("update discord_admin_status set pending_attempted_at=? where id=1").run(now);
    try {
      const result = await createClerkBackend({ secretKey }).listWaitlistEntries({ status: "pending", limit: 1 });
      if (Number.isSafeInteger(result.totalCount) && result.totalCount >= 0) {
        db.prepare("update discord_admin_status set pending_count=?,pending_checked_at=? where id=1").run(result.totalCount, now);
        state.pending_count = result.totalCount; state.pending_checked_at = now;
      }
    } catch { /* Keep last known count; never report a provider error with private data. */ }
  }
  return state.pending_count === null ? "unavailable"
    : `${state.pending_count}${state.pending_checked_at === null || state.pending_checked_at <= now - CACHE_MS ? " (stale)" : ""}`;
}

function statusContent(db: Database.Database, pending: string, now: number): string {
  const total = db.prepare<[number], { n: number }>("select count(*) n from users where last_seen_at>?").get(now - ONLINE_WINDOW_MS)!.n;
  const users = db.prepare<[number], { display_name: string; last_route: string }>(
    "select display_name,last_route from users where last_seen_at>? order by last_seen_at desc,id limit 25").all(now - ONLINE_WINDOW_MS);
  const guild = process.env.DISCORD_GUILD_ID ?? "";
  const day = new Date(now).toISOString().slice(0, 10);
  const signups = db.prepare<[string], { n: number }>("select count(*) n from users where date(created_at)=?").get(day)!.n;
  const live = db.prepare<[string], { format: string; n: number }>(
    "select format,count(*) n from duels where guild_id=? and kind='play' and status='active' group by format").all(guild);
  const counts = new Map(live.map(row => [row.format, row.n]));
  const finished = db.prepare<[string, string], { n: number }>(
    "select count(*) n from duels where guild_id=? and kind='play' and status='completed' and date(ended_at)=?").get(guild, day)!.n;
  const drafts = db.prepare<[string], { n: number }>("select count(*) n from drafts where guild_id=? and status='active'").get(guild)!.n;
  const stats = `\n\nSign-ups today (UTC): ${signups}\nWaitlist pending: ${pending}\nDuels live — 1v1: ${counts.get("1v1") ?? 0} | Tag: ${counts.get("tag") ?? 0} | 3-way: ${counts.get("ffa3") ?? 0} | 4-way: ${counts.get("ffa4") ?? 0}\nDuels finished today (UTC): ${finished}\nDrafts live: ${drafts}`;
  // Reserve room for all stats and the overflow line, even with Unicode/Markdown names.
  let content = `Online now: ${total}`;
  let shown = 0;
  for (const user of users) {
    const label = isPresenceRoute(user.last_route) ? PRESENCE_ROUTES[user.last_route] : "App";
    const line = `\n${discordText(user.display_name, 30)} — ${label}`;
    if (content.length + line.length + stats.length + 30 > 2000) break;
    content += line; shown++;
  }
  if (total > shown) content += `\n+${total - shown} more`;
  return content + stats;
}

/** One worker per DB. Called by the worker's coalescing, drainable 60-second loop. */
export async function tickDiscordAdmin(db: Database.Database): Promise<void> {
  const now = Date.now();
  clearOldPresence(db, now);
  // The alert body contains an email. Keep it only while an edit can still need it,
  // including a short grace after link expiry for decisions made near the deadline.
  const pruneActions = db.transaction(() => {
    db.prepare(`update discord_waitlist_actions set message_json=null
      where message_json is not null and (discord_updated_at is not null or expires_at<=?)`).run(now - EDIT_RETRY_GRACE_MS);
    db.prepare(`delete from discord_waitlist_actions where expires_at<=?
      and (completed_at is null or discord_updated_at is not null or discord_message_id is null or message_json is null)
      and (completed_at is not null or attempted_at is null or attempted_at<=?)`).run(now, now - 30_000);
  });
  pruneActions.immediate();
  const alertUrl = process.env.DISCORD_ADMIN_WEBHOOK_URL?.trim();
  if (alertUrl) {
    const edits = db.prepare<[string, number], { id: string }>(`select id from discord_waitlist_actions
      where completed_at is not null and discord_updated_at is null and discord_message_id is not null
        and message_json is not null and webhook_hash=? and discord_retry_at<=? order by completed_at limit 10`).all(webhookHash(alertUrl), now);
    for (const edit of edits) await updateWaitlistMessage(db, edit.id);
  }
  const url = process.env.DISCORD_ADMIN_STATUS_WEBHOOK_URL?.trim();
  if (process.env.DISCORD_ONLINE_STATUS_ENABLED !== "1" || !url) return;
  db.prepare("insert or ignore into discord_admin_status(id) values(1)").run();
  const state = db.prepare<[], StatusState>("select * from discord_admin_status where id=1").get()!;
  const hash = webhookHash(url);
  if (state.webhook_hash !== hash) {
    // An ID belongs to one webhook. Switching channels must create in the new channel.
    db.prepare("update discord_admin_status set webhook_hash=?,message_id=null,retry_at=0 where id=1").run(hash);
    state.message_id = null; state.retry_at = 0;
  }
  if (state.retry_at > now) return;
  const pending = await pendingCount(db, state, now);
  const body = { content: statusContent(db, pending, now), allowed_mentions: { parse: [] } };
  let result = await discordWebhook(url, state.message_id ? "PATCH" : "POST", body, state.message_id ?? undefined);
  // Discord 10008 is Unknown Message. Other 404s can mean an invalid webhook.
  if (state.message_id && result.status === 404 && result.unknownMessage) {
    db.prepare("update discord_admin_status set message_id=null where id=1").run();
    result = await discordWebhook(url, "POST", body);
  }
  if (result.ok && result.messageId) db.prepare("update discord_admin_status set message_id=?,retry_at=0 where id=1").run(result.messageId);
  else if (!result.ok) db.prepare("update discord_admin_status set retry_at=? where id=1").run(now + Math.max(60_000, result.retryAfterMs ?? 0));
  if (!result.ok && state.retry_at === 0) log("warn", "[discord-status] Delivery is failing", { status: result.status });
  else if (result.ok && result.messageId && state.retry_at !== 0) log("warn", "[discord-status] Delivery recovered", { status: result.status });
}

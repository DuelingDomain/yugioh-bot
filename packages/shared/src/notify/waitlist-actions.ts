import type Database from "better-sqlite3";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ClerkBackendError, createClerkBackend } from "../clerk/backend.js";
import { discordText, discordWebhook, webhookHash } from "./discord-webhook.js";

export type WaitlistDecision = "approve" | "reject";
export interface WaitlistAction {
  id: string; subject_hash: string; clerk_entry_id: string | null; expires_at: number;
  decision: WaitlistDecision | null; actor_user_id: number | null; actor_name: string | null;
  attempted_at: number | null; completed_at: number | null;
  discord_message_id: string | null; webhook_hash: string | null; message_json: string | null;
  discord_updated_at: number | null; discord_retry_at: number;
}
function signingSecret() { const secret = process.env.DISCORD_ADMIN_ACTION_SIGNING_SECRET; return secret && secret.length >= 32 ? secret : null; }
function signature(payload: string, secret: string) { return createHmac("sha256", secret).update(`dd-waitlist:v1:${payload}`).digest(); }
export function waitlistActionToken(row: WaitlistAction, decision: WaitlistDecision): string {
  const secret = signingSecret();
  if (!secret) throw new Error("Waitlist links are not configured");
  const payload = `${row.id}.${decision}.${row.expires_at}`;
  return `${payload}.${signature(payload, secret).toString("hex")}`;
}
export function waitlistActionOrigin(): string | null {
  try {
    const url = new URL(process.env.WEB_URL ?? "");
    return url.protocol === "https:" || (url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname)) ? url.origin : null;
  } catch { return null; }
}

/** Called before alert deduplication, so a later Clerk event binds a local alert too. */
export function prepareWaitlistAction(db: Database.Database, hash: string, clerkEntryId?: string): WaitlistAction | null {
  if (!signingSecret() || !waitlistActionOrigin()) return null;
  db.prepare(`insert into discord_waitlist_actions(id,subject_hash,clerk_entry_id,expires_at) values(?,?,?,?)
    on conflict(subject_hash) do update set clerk_entry_id=coalesce(discord_waitlist_actions.clerk_entry_id,excluded.clerk_entry_id)`)
    .run(randomBytes(18).toString("hex"), hash, clerkEntryId || null, Date.now() + 24 * 60 * 60_000);
  return db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where subject_hash=?").get(hash)!;
}
export class WaitlistActionError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export function readWaitlistAction(db: Database.Database, token: string): { row: WaitlistAction; decision: WaitlistDecision } {
  const secret = signingSecret();
  if (!secret) throw new WaitlistActionError(503, "Waitlist links are not configured.");
  const match = /^([a-f0-9]{36})\.(approve|reject)\.(\d{13})\.([a-f0-9]{64})$/.exec(token);
  if (!match) throw new WaitlistActionError(400, "This link is invalid.");
  const expected = signature(token.slice(0, token.lastIndexOf(".")), secret);
  if (!timingSafeEqual(expected, Buffer.from(match[4], "hex"))) throw new WaitlistActionError(400, "This link is invalid.");
  const row = db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where id=?").get(match[1]);
  if (!row || row.expires_at !== Number(match[3])) throw new WaitlistActionError(400, "This link is invalid.");
  if (row.expires_at <= Date.now()) throw new WaitlistActionError(410, "This link has expired. Use the Clerk dashboard.");
  return { row, decision: match[2] as WaitlistDecision };
}
export function waitlistActionResult(row: WaitlistAction): string {
  return `${row.decision === "approve" ? "Approved" : "Rejected"} by ${row.actor_name ?? "owner"}`;
}

/** Retryable Discord-only effect: a failed edit never replays the Clerk operation. */
export async function updateWaitlistMessage(db: Database.Database, id: string): Promise<void> {
  const row = db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where id=?").get(id);
  const url = process.env.DISCORD_ADMIN_WEBHOOK_URL?.trim();
  if (!row?.completed_at || row.discord_updated_at || !row.discord_message_id || !row.message_json
    || !url || row.webhook_hash !== webhookHash(url) || row.discord_retry_at > Date.now()) return;
  const message = JSON.parse(row.message_json);
  message.embeds[0].fields = message.embeds[0].fields.filter((field: { name: string }) => field.name !== "Owner action");
  message.embeds[0].fields.push({ name: "Decision", value: discordText(waitlistActionResult(row), 120) });
  const result = await discordWebhook(url, "PATCH", message, row.discord_message_id);
  if (result.ok || result.status === 404) {
    // A deleted alert stays deleted. Only the singleton status message is recreated.
    db.prepare("update discord_waitlist_actions set discord_updated_at=?,message_json=null where id=?").run(Date.now(), id);
  } else db.prepare("update discord_waitlist_actions set discord_retry_at=? where id=?").run(Date.now() + Math.max(60_000, result.retryAfterMs ?? 0), id);
}

/** The caller must resolve an authenticated owner. No link can grant access. */
export async function decideWaitlistAction(db: Database.Database, token: string, actor: { userId: number; name: string }): Promise<WaitlistAction> {
  const claimed = db.transaction(() => {
    const { row, decision } = readWaitlistAction(db, token);
    if (row.decision && row.decision !== decision) throw new WaitlistActionError(409, "A decision has already been made.");
    if (row.completed_at) return { row, complete: true };
    if (!row.clerk_entry_id) throw new WaitlistActionError(409, "The Clerk entry is not ready. Try again shortly or use the Clerk dashboard.");
    if (!process.env.CLERK_SECRET_KEY) throw new WaitlistActionError(503, "Clerk is not configured.");
    if (row.attempted_at && row.attempted_at > Date.now() - 30_000) throw new WaitlistActionError(409, "This decision is in progress. Try again shortly.");
    db.prepare(`update discord_waitlist_actions set decision=?,actor_user_id=coalesce(actor_user_id,?),
      actor_name=coalesce(actor_name,?),attempted_at=? where id=?`).run(decision, actor.userId, actor.name.slice(0, 80), Date.now(), row.id);
    return { row: { ...row, decision }, complete: false };
  }).immediate();
  const { row } = claimed;
  if (!claimed.complete) {
    try {
      const backend = createClerkBackend({ secretKey: process.env.CLERK_SECRET_KEY! });
      const result = row.decision === "approve" ? await backend.inviteWaitlistEntry(row.clerk_entry_id!) : await backend.rejectWaitlistEntry(row.clerk_entry_id!);
      if (result.id !== row.clerk_entry_id || result.status !== (row.decision === "approve" ? "invited" : "rejected")) throw new Error("Unexpected Clerk result");
    } catch (error) {
      const alreadyDone = error instanceof ClerkBackendError && error.status === 409
        && error.code === (row.decision === "approve" ? "waitlist_entry_already_invited" : "waitlist_entry_already_rejected");
      if (!alreadyDone) {
        db.prepare("update discord_waitlist_actions set attempted_at=null where id=?").run(row.id);
        throw new WaitlistActionError(503, "Clerk could not confirm this decision. Retry the same button or check the Clerk dashboard.");
      }
    }
    db.prepare("update discord_waitlist_actions set completed_at=? where id=?").run(Date.now(), row.id);
  }
  await updateWaitlistMessage(db, row.id);
  return db.prepare<[string], WaitlistAction>("select * from discord_waitlist_actions where id=?").get(row.id)!;
}

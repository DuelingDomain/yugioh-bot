import { NextResponse, type NextRequest } from "next/server";
import { createClerkBackend } from "@yugidraft/shared/clerk";
import { createWaitlistService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { sameOrigin } from "@/lib/existing-player";
import { clientIpKey, createRateLimiter } from "@/lib/rate-limit";
import { readSmallBody } from "@/lib/read-small-body";

export const runtime = "nodejs";
const take = createRateLimiter(10 * 60 * 1000);
const PENDING_TTL_MS = 60_000;
const MAX_PENDING_PAGES = 20;
let pendingCache: { at: number; list: Map<string, string> } | null = null;
let pendingScan: Promise<Map<string, string>> | null = null;

/** Pending invitations, cached for a minute with one shared scan, so tickets cannot make Clerk scan the list on every call. */
async function pendingInvitations(secretKey: string): Promise<Map<string, string>> {
  if (pendingCache && Date.now() - pendingCache.at < PENDING_TTL_MS) return pendingCache.list;
  pendingScan ??= (async () => {
    const list = await createClerkBackend({ secretKey }).pendingInvitations?.(MAX_PENDING_PAGES) ?? new Map<string, string>();
    pendingCache = { at: Date.now(), list };
    return list;
  })().finally(() => { pendingScan = null; });
  return pendingScan;
}
const headers = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };
const answer = (discord: boolean, status = 200) => NextResponse.json({ discord }, { status, headers });

/** The invitation id inside a Clerk invite ticket (`sid`). Only read here: Clerk checks the ticket itself at sign-up. */
function invitationId(ticket: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(ticket.split(".")[1] ?? "", "base64url").toString("utf8")) as { sid?: unknown; st?: unknown };
    return payload.st === "invitation" && typeof payload.sid === "string" && /^inv_[A-Za-z0-9]{1,64}$/.test(payload.sid) ? payload.sid : null;
  } catch { return null; }
}

/**
 * Invite page: did this invited person join the waitlist by signing in with Discord? Then the page sends them straight to
 * Discord and shows no password form. The answer needs a ticket whose invitation is still pending, so it cannot be used to
 * look up an email. Any doubt answers false (the normal form).
 */
export async function POST(request: NextRequest) {
  if (!sameOrigin(request)) return answer(false, 403);
  if (take([[clientIpKey(request), 20]]) !== null) return answer(false, 429);
  try {
    const body = JSON.parse(await readSmallBody(request, 4096)) as { ticket?: unknown };
    const id = typeof body.ticket === "string" ? invitationId(body.ticket) : null;
    const secretKey = process.env.CLERK_SECRET_KEY;
    if (!id || !secretKey) return answer(false);
    const email = (await pendingInvitations(secretKey)).get(id);
    return answer(Boolean(email) && createWaitlistService(getDb()).joinedViaDiscord(email!));
  } catch { return answer(false); }
}

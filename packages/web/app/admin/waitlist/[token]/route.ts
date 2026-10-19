import type { NextRequest } from "next/server";
import { decideWaitlistAction, readWaitlistAction, WaitlistActionError, waitlistActionOrigin, waitlistActionResult } from "@yugidraft/shared/notify";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { isOwnerUser } from "@/lib/owner-access";

const headers = {
  // no-referrer makes Chromium send Origin:null on native form POSTs.
  // Send only the origin, never the signed path, while retaining CSRF checks.
  "Cache-Control": "private, no-store", "Referrer-Policy": "strict-origin", "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
  "Content-Type": "text/html; charset=utf-8",
};
const escape = (text: string) => text.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
function page(message: string, status = 200, button?: string) {
  return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Waitlist — Dueling Domain</title>
    <style>body{color:#eee;background:#111018;font:18px system-ui;margin:10vh auto;padding:24px;max-width:560px}h1{font-size:28px}button{font:inherit;padding:12px 24px;cursor:pointer;background:#e8d094;border:0;border-radius:4px;color:#18151e}p{line-height:1.6}</style>
    <main><h1>Waitlist request</h1><p>${escape(message)}</p>${button ? `<form method="post"><button type="submit">${escape(button)}</button></form>` : ""}</main></html>`, { status, headers });
}
async function owner() {
  const access = await requireWebAccess();
  if (!access.ok) return { response: page(access.response.status === 401 ? "Sign in to continue." : "Sign-in is unavailable. Try again.", access.response.status) };
  if (!isOwnerUser(access.userId)) return { response: page("Only the app owner can manage waitlist requests.", 403) };
  return { actor: { userId: access.userId, name: access.userName } };
}
function failure(error: unknown) {
  return error instanceof WaitlistActionError ? page(error.message, error.status) : page("This request is unavailable. Try again.", 503);
}
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: NextRequest, context: Context): Promise<Response> {
  const access = await owner();
  if (access.response) return access.response;
  try {
    const { row, decision } = readWaitlistAction(getDb(), (await context.params).token);
    if (row.completed_at) return page(waitlistActionResult(row));
    if (row.decision && row.decision !== decision) return page("A decision has already been made.", 409);
    if (!row.clerk_entry_id) return page("The Clerk entry is not ready. Try again shortly or use the Clerk dashboard.", 409);
    const email = row.message_json ? JSON.parse(row.message_json)?.embeds?.[0]?.fields?.find((field: { name: string }) => field.name === "Email")?.value : null;
    const target = typeof email === "string" ? ` (${email.replace(/`/g, "")})` : "";
    return page(decision === "approve" ? `Send a Clerk invitation for this waitlist request${target}?` : `Reject this waitlist request${target}?`,
      200, decision === "approve" ? "Approve request" : "Reject request");
  } catch (error) { return failure(error); }
}
export async function POST(request: NextRequest, context: Context): Promise<Response> {
  const access = await owner();
  if (access.response) return access.response;
  // A signed link is not CSRF protection. Require a same-origin browser POST too.
  const origin = waitlistActionOrigin();
  if (!origin || request.headers.get("origin") !== origin) return page("This request must come from the app.", 403);
  try {
    const result = await decideWaitlistAction(getDb(), (await context.params).token, access.actor!);
    return page(waitlistActionResult(result));
  } catch (error) { return failure(error); }
}
export const runtime = "nodejs";

import { unsubscribeByToken, unsubscribeTokenExists, escapeHtml } from "@yugidraft/shared/email";
import { getDb } from "@/lib/db";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer",
  "content-security-policy": "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" };
const page = (content: string, status = 200) => new Response(`<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Dueling Domain release emails</title></head><body><main>${content}</main></body></html>`, { status, headers });
const invalid = () => page("<h1>Invalid unsubscribe link</h1><p>Use the unsubscribe link in your release email.</p>", 400);
/** GET only confirms intent; email scanners must not silently unsubscribe people. */
export async function GET(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!unsubscribeTokenExists(getDb(), token)) return invalid();
  return page(`<h1>Unsubscribe from release emails</h1><p>Stop Dueling Domain alpha news emails.</p><form method="post" action="/unsubscribe?t=${escapeHtml(token)}"><button type="submit">Unsubscribe</button></form>`);
}
/** Opaque token authorizes both browser form submission and RFC 8058 one-click POST, without a session or Origin. */
export async function POST(request: Request): Promise<Response> {
  const token = new URL(request.url).searchParams.get("t") ?? "";
  if (!unsubscribeByToken(getDb(), token)) return invalid();
  return page("<h1>You are unsubscribed</h1><p>You will no longer receive Dueling Domain alpha news emails.</p>");
}

import { recordResendWebhook, verifyResendWebhook } from "@yugidraft/shared/email";
import { getDb } from "@/lib/db";
import { readSmallBody } from "@/lib/read-small-body";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const json = (body: unknown, status: number) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
export async function POST(request: Request): Promise<Response> {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) return json({ error: "not_configured" }, 503);
  let body: string;
  try { body = await readSmallBody(request, 64 * 1024); } catch { return json({ error: "body_too_large" }, 413); }
  if (!verifyResendWebhook(body, request.headers, secret)) return json({ error: "invalid_signature" }, 400);
  let event: unknown; try { event = JSON.parse(body); } catch { return json({ error: "invalid_body" }, 400); }
  try { recordResendWebhook(getDb(), request.headers.get("svix-id")!, event); }
  catch { return json({ error: "retry_later" }, 503); }
  return json({ received: true }, 200);
}

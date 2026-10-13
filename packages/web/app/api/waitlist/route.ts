import { clientIpKey, createRateLimiter } from "@/lib/rate-limit";
import { createWaitlistService } from "@yugidraft/shared/services";
import { createClerkBackend } from "@yugidraft/shared/clerk";
import { normalizeEmailDomain } from "@yugidraft/shared/util/email-domain";
import { getDb } from "@/lib/db";

const MAX_BODY_BYTES = 2048;
const take = createRateLimiter(10 * 60 * 1000);

function retryAfter(request: Request): number | null {
  return take([[clientIpKey(request), 5]]);
}

async function readBody(request: Request): Promise<string> {
  if (Number(request.headers.get("content-length")) > MAX_BODY_BYTES) throw new Error("body_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let size = 0;
  let body = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return body + decoder.decode();
      size += value.byteLength;
      if (size > MAX_BODY_BYTES) {
        await reader.cancel();
        throw new Error("body_too_large");
      }
      body += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
}

type Outcome = "joined" | "invalid" | "limited" | "retry" | "error";

export async function POST(request: Request): Promise<Response> {
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const isForm = type === "application/x-www-form-urlencoded";
  const headers = new Headers({ "Cache-Control": "no-store" });
  function respond(outcome: Outcome): Response {
    if (isForm) {
      // A relative redirect stays on the marketing host behind Caddy.
      headers.set("Location", `/?waitlist=${outcome}#join`);
      return new Response(null, { status: 303, headers });
    }
    if (outcome === "invalid") return Response.json({ error: "invalid_email" }, { status: 400, headers });
    if (outcome === "limited") return Response.json({ error: "rate_limited" }, { status: 429, headers });
    if (outcome === "retry") return Response.json({ error: "retry_later" }, { status: 503, headers });
    if (outcome === "error") return Response.json({ error: "server_error" }, { status: 500, headers });
    return Response.json({ status: "joined" }, { status: 201, headers });
  }

  if (!isForm && type !== "application/json") {
    return Response.json({ error: "unsupported_media_type" }, { status: 415, headers });
  }
  const retry = retryAfter(request);
  if (retry !== null) {
    headers.set("Retry-After", String(retry));
    return respond("limited");
  }

  let data: Record<string, unknown>;
  try {
    const body = await readBody(request);
    const parsed: unknown = isForm ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond("invalid");
    data = parsed as Record<string, unknown>;
  } catch {
    // Malformed or oversized bodies use the same validation response for both encodings.
    return respond("invalid");
  }

  if (typeof data.company === "string" && data.company.length > 0) return respond("joined");
  const rawEmail = typeof data.email === "string" ? data.email : "";
  // Check before trimming, which would remove a leading U+FEFF format character.
  if (/\p{Cf}/u.test(rawEmail.slice(0, rawEmail.lastIndexOf("@")))) return respond("invalid");
  const submittedEmail = rawEmail.trim().toLowerCase();
  if (submittedEmail.length > 254) return respond("invalid");
  // Storage, notification claims and Clerk all use the same ASCII domain.
  const email = normalizeEmailDomain(submittedEmail);
  if (!email || email.length > 254) return respond("invalid");
  const domain = email.slice(email.lastIndexOf("@") + 1);
  const hostLabel = "[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?";
  if (!new RegExp(`^${hostLabel}(?:\\.${hostLabel})+$`).test(domain)) return respond("invalid");

  try {
    createWaitlistService(getDb()).join(email, {
      source: typeof data.source === "string" ? data.source : "form",
      userAgent: request.headers.get("user-agent"),
    });
  } catch {
    // Never return/log request data or database errors containing an email address.
    return respond("error");
  }

  // The atomic local join has committed before any HTTP call. Retry even on
  // "exists" so a previous Clerk failure can heal without replacing metadata.
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return respond("retry");
  try {
    await createClerkBackend({ secretKey }).createWaitlistEntry({ emailAddress: email, notify: true });
  } catch {
    // Keep the local row for retries/reconciliation; never expose upstream data.
    return respond("retry");
  }
  return respond("joined");
}

export const runtime = "nodejs";

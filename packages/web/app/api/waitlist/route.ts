import { clientIpKey, createRateLimiter } from "@/lib/rate-limit";
import { createWaitlistService } from "@yugidraft/shared/services";
import { createCreatorAccessService } from "@yugidraft/shared/services/creator-access";
import { createClerkBackend } from "@yugidraft/shared/clerk";
import { log } from "@yugidraft/shared/observability";
import { emailKey } from "@yugidraft/shared/util/email-key";
import { normalizeJoinEmail } from "@yugidraft/shared/util/join-email";
import { releaseOwnerSends, reserveOwnerSends } from "@/lib/creator-send-limit";
import { getDb } from "@/lib/db";
import { readSmallBody } from "@/lib/read-small-body";

const MAX_BODY_BYTES = 2048;
const take = createRateLimiter(10 * 60 * 1000);

function retryAfter(request: Request): number | null {
  return take([[clientIpKey(request), 5]]);
}

/**
 * An email with a live allowlist grant (creator fast-track) gets its Clerk invitation again in place of a waitlist
 * entry. Returns true when the normal waitlist join must be skipped. The browser answer does not change either way.
 */
/** "joined"/"retry" when an allowlist grant handled the email; null to continue with the normal waitlist. */
async function handledByAllowlist(email: string): Promise<"joined" | "retry" | null> {
  try {
    const creators = createCreatorAccessService(getDb());
    // A re-send uses the shared Clerk budget. Over budget: skip the re-send, but still keep a granted email off the
    // waitlist (Clerk entry and Discord alert would ask the owner to approve a person who is already in).
    if (reserveOwnerSends(1) !== null) {
      const key = emailKey(email);
      return key !== null && creators.grantedEmailKeys().has(key) ? "joined" : null;
    }
    const result = await creators.resendAllowlistForWaitlist(email);
    if (result === "none" || result === "not_due") releaseOwnerSends(1);
    // A failed re-send sent nothing: ask for a retry, as a failed Clerk waitlist call does on the normal path.
    return result === "none" ? null : result === "failed" ? "retry" : "joined";
  } catch {
    // Fall back to the normal waitlist. Never log the email.
    log("warn", "[waitlist] allowlist check failed");
    return null;
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
    const body = await readSmallBody(request, MAX_BODY_BYTES);
    const parsed: unknown = isForm ? Object.fromEntries(new URLSearchParams(body)) : JSON.parse(body);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return respond("invalid");
    data = parsed as Record<string, unknown>;
  } catch {
    // Malformed or oversized bodies use the same validation response for both encodings.
    return respond("invalid");
  }

  if (typeof data.company === "string" && data.company.length > 0) return respond("joined");
  const email = normalizeJoinEmail(data.email);
  if (!email) return respond("invalid");
  const allowlisted = await handledByAllowlist(email);
  if (allowlisted) return respond(allowlisted);

  try {
    createWaitlistService(getDb()).join(email, {
      source: typeof data.source === "string" ? data.source : "form",
      userAgent: request.headers.get("user-agent"),
      // Untrusted survey answer: the service checks it against the list and drops unknown values.
      heardFrom: data.heardFrom,
      heardFromDetail: data.heardFromDetail,
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

import { recordEmailConsent } from "@yugidraft/shared/email";
import { clientIpKey, createRateLimiter } from "@/lib/rate-limit";
import { normalizeJoinEmail } from "@yugidraft/shared/util/join-email";
import { waitForAnswerFloor } from "@/lib/answer-floor";
import { getDb } from "@/lib/db";
import { readSmallBody } from "@/lib/read-small-body";
import { joinWaitlist } from "@/lib/waitlist-join";

const MAX_BODY_BYTES = 2048;
const take = createRateLimiter(10 * 60 * 1000);

function retryAfter(request: Request): number | null {
  return take([[clientIpKey(request), 5]]);
}

type Outcome = "joined" | "invalid" | "limited" | "retry" | "error";

export async function POST(request: Request): Promise<Response> {
  const startedAt = Date.now();
  const type = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const isForm = type === "application/x-www-form-urlencoded";
  const headers = new Headers({ "Cache-Control": "no-store" });
  async function respond(outcome: Outcome): Promise<Response> {
    // "joined" and "retry" wait for the answer floor on every path (allowlist re-send, normal join, honeypot), so
    // the time of the answer does not tell whether the email has a creator grant.
    if (outcome === "joined" || outcome === "retry") await waitForAnswerFloor(startedAt);
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
  // This form explicitly offers alpha news under the current public privacy notice. Do not infer consent for old rows.
  try { recordEmailConsent(getDb(), email, { provenance: "public-waitlist-form", textVersion: "alpha-news-2026-11-04" }); }
  catch { return respond("error"); }
  const outcome = await joinWaitlist(email, {
    source: typeof data.source === "string" ? data.source : "form",
    userAgent: request.headers.get("user-agent"),
    heardFrom: data.heardFrom,
    heardFromDetail: data.heardFromDetail,
  });
  // The public form never reveals whether an email is invited or already has an account.
  return respond(outcome === "retry" || outcome === "error" ? outcome : "joined");
}

export const runtime = "nodejs";

import { createWaitlistService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";

const MAX_BODY_BYTES = 2048;
const WINDOW_MS = 10 * 60 * 1000;
const MAX_CLIENTS = 10_000;
const clients = new Map<string, { count: number; expiresAt: number }>();

/** Per-process fixed window. IPs only live in this bounded, expiring memory map. */
function retryAfter(request: Request): number | null {
  const now = Date.now();
  // Insertion order is expiry order: active windows are never extended/reinserted.
  for (const [ip, entry] of clients) {
    if (entry.expiresAt > now) break;
    clients.delete(ip);
  }
  // Caddy overwrites untrusted incoming X-Forwarded-For. Keep web private in production.
  const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim().slice(0, 128) || "unknown";
  const entry = clients.get(ip);
  if (entry) {
    if (entry.count >= 5) return Math.max(1, Math.ceil((entry.expiresAt - now) / 1000));
    entry.count++;
    return null;
  }
  if (clients.size >= MAX_CLIENTS) {
    // Refuse new clients until space frees; don't evict another client's active limit.
    const earliest = clients.values().next().value!;
    return Math.max(1, Math.ceil((earliest.expiresAt - now) / 1000));
  }
  clients.set(ip, { count: 1, expiresAt: now + WINDOW_MS });
  return null;
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

type Outcome = "joined" | "exists" | "invalid" | "limited";

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
    return Response.json({ status: outcome }, { status: outcome === "joined" ? 201 : 200, headers });
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
  const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
  if (email.length > 254 || !/^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/.test(email)) return respond("invalid");

  try {
    const result = createWaitlistService(getDb()).join(email, {
      source: typeof data.source === "string" ? data.source : "form",
      userAgent: request.headers.get("user-agent"),
    });
    return respond(result.status);
  } catch {
    // Never return/log request data or database errors containing an email address.
    return Response.json({ error: "server_error" }, { status: 500, headers });
  }
}

export const runtime = "nodejs";

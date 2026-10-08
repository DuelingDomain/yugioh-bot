import { NextResponse } from "next/server";

const WINDOW_MS = 60_000;
const MAX_CLIENTS = 10_000;
const clients = new Map<string, { count: number; expiresAt: number }>();

/** Same per-process fixed-window pattern as waitlist/recovery; bound user and IP attempts separately. */
export function draftInviteRateLimit(request: Request, userId: number): NextResponse | null {
  const now = Date.now();
  // Insertion order is expiry order; active windows are never extended.
  for (const [key, entry] of clients) {
    if (entry.expiresAt > now) break;
    clients.delete(key);
  }
  // Caddy overwrites this header. Web stays private behind the proxy.
  const ip = request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim().slice(0, 128) || "unknown";
  const buckets = [[`user:${userId}`, 10], [`ip:${ip}`, 30]] as const;
  const missing = buckets.filter(([key]) => !clients.has(key)).length;
  const limited = buckets.map(([key]) => clients.get(key)).find((entry, index) => entry && entry.count >= buckets[index][1]);
  const blockedUntil = limited?.expiresAt
    ?? (clients.size + missing > MAX_CLIENTS ? clients.values().next().value!.expiresAt : null);
  if (blockedUntil !== null) {
    return NextResponse.json({ error: "Too many invite attempts. Try again shortly." }, {
      status: 429, headers: { "Retry-After": String(Math.max(1, Math.ceil((blockedUntil - now) / 1000))), "Cache-Control": "no-store" },
    });
  }
  for (const [key] of buckets) {
    const entry = clients.get(key);
    if (entry) entry.count++;
    else clients.set(key, { count: 1, expiresAt: now + WINDOW_MS });
  }
  return null;
}

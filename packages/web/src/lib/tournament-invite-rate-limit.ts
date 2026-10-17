import { clientIpKey, createRateLimiter } from "./rate-limit";
import { NextResponse } from "next/server";

const take = createRateLimiter(60_000);

/** Same per-process fixed-window pattern as waitlist/recovery; bound user and IP attempts separately. */
export function tournamentInviteRateLimit(request: Request, userId: number): NextResponse | null {
  const retry = take([[`user:${userId}`, 10], [`ip:${clientIpKey(request)}`, 30]]);
  if (retry !== null) {
    return NextResponse.json({ error: "Too many invite attempts. Try again shortly." }, {
      status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" },
    });
  }
  return null;
}

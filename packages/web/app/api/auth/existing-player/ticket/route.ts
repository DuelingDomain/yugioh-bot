import { NextResponse, type NextRequest } from "next/server";
import { clearTicketCookie, openCookie, recoveryError, recoveryRateLimit, sameOrigin, TICKET_COOKIE } from "@/lib/existing-player";

export const runtime = "nodejs";
export async function POST(request: NextRequest) {
  try {
    if (!sameOrigin(request)) return recoveryError("Invalid request origin.", 403);
    const limited = recoveryRateLimit(request, "ticket"); if (limited) return limited;
    const proof = openCookie<{ ticket: string }>("ticket", request.cookies.get(TICKET_COOKIE)?.value);
    if (!proof || typeof proof.ticket !== "string" || !proof.ticket) return clearTicketCookie(recoveryError("Sign-in expired. Try Discord sign-in again.", 400));
    return clearTicketCookie(NextResponse.json({ ticket: proof.ticket }, { headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } }));
  } catch { return clearTicketCookie(recoveryError("Sign-in is unavailable. Try again in a moment.", 503)); }
}

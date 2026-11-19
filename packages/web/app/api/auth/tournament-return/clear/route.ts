import { NextResponse, type NextRequest } from "next/server";
import { sameOrigin } from "@/lib/existing-player";
import { clearTournamentReturnCookie } from "@/lib/tournament-auth-return";

export function POST(request: NextRequest) {
  if (!sameOrigin(request)) return new NextResponse(null, { status: 403 });
  const response = new NextResponse(null, { status: 204, headers: { "Cache-Control": "no-store" } });
  clearTournamentReturnCookie(response);
  return response;
}

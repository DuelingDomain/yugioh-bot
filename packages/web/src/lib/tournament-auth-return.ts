import { NextResponse } from "next/server";

export const TOURNAMENT_RETURN_COOKIE = "__Host-dd_tournament_return";
export const TOURNAMENT_RETURN_MARKER = "1";
const COOKIE_OPTIONS = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/" };
const BRIDGE_HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" };

export function tournamentSignInRedirect(start: URL, status: number): NextResponse {
  const signIn = new URL("/sign-in", start);
  signIn.searchParams.set("redirect_url", start.pathname + start.search);
  const response = NextResponse.redirect(signIn, { status, headers: BRIDGE_HEADERS });
  response.cookies.set(TOURNAMENT_RETURN_COOKIE, TOURNAMENT_RETURN_MARKER, { ...COOKIE_OPTIONS, maxAge: 30 * 24 * 60 * 60 });
  return response;
}

export function tournamentCallbackRedirect(callback: URL, clearReturn: boolean): NextResponse {
  const response = NextResponse.redirect(callback, { status: 302, headers: BRIDGE_HEADERS });
  if (clearReturn) response.cookies.set(TOURNAMENT_RETURN_COOKIE, "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}

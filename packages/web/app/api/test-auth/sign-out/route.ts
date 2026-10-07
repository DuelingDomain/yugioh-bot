import { NextResponse } from "next/server";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled } from "@/lib/e2e-auth";
export async function POST() {
  if (!isE2EAuthEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const response = new NextResponse(null, { status: 204 });
  response.cookies.set(E2E_SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
  return response;
}

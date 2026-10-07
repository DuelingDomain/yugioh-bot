import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createUserService } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { E2E_SESSION_COOKIE, E2E_SESSION_TTL_SECONDS, isE2EAuthEnabled, signE2ESession } from "@/lib/e2e-auth";
export async function POST(request: Request) {
  if (!isE2EAuthEnabled()) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const body = await request.json().catch(() => null);
  const expected = createHash("sha256").update(process.env.E2E_AUTH_SECRET!).digest();
  const actual = createHash("sha256").update(typeof body?.secret === "string" ? body.secret : "").digest();
  if (!timingSafeEqual(expected, actual)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!Number.isSafeInteger(body?.userId) || body.userId <= 0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const user = createUserService(getDb()).findById(body.userId);
  if (!user) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const response = NextResponse.json({ user: { id: String(user.id), name: user.displayName } });
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(E2E_SESSION_COOKIE, signE2ESession(user.id, process.env.E2E_AUTH_SECRET!), { path: "/", httpOnly: true, sameSite: "lax", maxAge: E2E_SESSION_TTL_SECONDS, secure: new URL(request.url).protocol === "https:" });
  return response;
}

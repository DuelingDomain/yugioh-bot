import { NextResponse } from "next/server";
import { ClerkBackendError, createClerkBackend } from "@yugidraft/shared/clerk";
import { createUserService, deleteUserAccount } from "@yugidraft/shared/services";
import { readJsonBody } from "@/lib/bug-reports/read-body";
import { getDb } from "@/lib/db";
import { E2E_SESSION_COOKIE, isE2EAuthEnabled } from "@/lib/e2e-auth";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

const headers = { "Cache-Control": "no-store" };
const fail = (error: string, status: number) => Response.json({ error }, { status, headers });

/**
 * Self-serve account deletion. The person types their current username to confirm. The Clerk user is deleted
 * first (a 404 counts as gone) so no live session can re-create a row; only then does one database transaction
 * anonymise or remove the account. A Clerk failure changes nothing (503). A database failure after Clerk is
 * logged with the user ID only (500); `npm run ops -- delete-user --apply` finishes it.
 */
export async function POST(request: Request) {
  const access = await requireWebAccess();
  if (!access.ok) return access.response;

  const body = await readJsonBody(request, 4 * 1024);
  if (!body.ok) return body.response;
  const db = getDb();
  const user = createUserService(db).findById(access.userId);
  if (!user) return fail("unauthorized", 401);
  const confirm = body.value !== null && typeof body.value === "object" ? (body.value as { confirm?: unknown }).confirm : undefined;
  if (typeof confirm !== "string" || confirm.trim() !== user.username) return fail("confirm_mismatch", 400);

  const e2e = isE2EAuthEnabled();
  if (!e2e && user.clerkUserId) {
    const secretKey = process.env.CLERK_SECRET_KEY;
    try {
      if (!secretKey) throw new ClerkBackendError("Clerk secret is unavailable", 0, "missing_secret", null);
      await createClerkBackend({ secretKey }).deleteUser(user.clerkUserId);
    } catch (error) {
      console.error(`[account-delete] Clerk deletion failed for user ${access.userId} (status ${error instanceof ClerkBackendError ? error.status : 0})`);
      return fail("retry_later", 503);
    }
  }

  try {
    deleteUserAccount(db, access.userId);
  } catch {
    console.error(`[account-delete] database step failed after Clerk deletion for user ${access.userId}; finish with the delete-user ops command`);
    return fail("server_error", 500);
  }

  const response = NextResponse.json({ ok: true }, { headers });
  if (e2e) response.cookies.set(E2E_SESSION_COOKIE, "", { path: "/", httpOnly: true, sameSite: "lax", maxAge: 0 });
  return response;
}

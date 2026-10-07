import { NextResponse } from "next/server";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

/**
 * GET /api/admin/access -> { admin: boolean }. Lets the shell show owner-only links.
 * It is a hint for the UI only: every owner route still checks access itself.
 * No session = 401; session unavailable = 503; anyone not in OWNER_USER_IDS = 200 { admin: false }.
 */
export async function GET() {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  return NextResponse.json({ admin: isOwnerUser(actor.userId) }, { headers: NO_STORE });
}

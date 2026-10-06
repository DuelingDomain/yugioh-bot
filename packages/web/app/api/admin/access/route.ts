import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { checkDiscordWebAccess } from "@/lib/discord-web-access";

export const runtime = "nodejs";

const NO_STORE = { "cache-control": "no-store" };

/**
 * GET /api/admin/access -> { admin: boolean }. Lets the shell show admin-only links.
 * It is a hint for the UI only: every admin route still checks access itself.
 * No session = 401; verification unavailable = 503; a member without admin rights = 200 { admin: false }.
 */
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const decision = await checkDiscordWebAccess(session.user.id, "admin");
  if (decision.ok) return NextResponse.json({ admin: true }, { headers: NO_STORE });
  if (decision.status === 503) return NextResponse.json({ error: "Cannot verify permissions" }, { status: 503, headers: NO_STORE });
  return NextResponse.json({ admin: false }, { headers: NO_STORE });
}

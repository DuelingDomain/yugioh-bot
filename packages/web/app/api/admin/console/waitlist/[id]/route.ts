import { NextResponse } from "next/server";
import { ClerkBackendError, createClerkBackend } from "@yugidraft/shared/clerk";
import { bustWaitlistCache } from "@/lib/admin-console/waitlist";
import { webOrigin } from "@/lib/existing-player";
import { isOwnerUser } from "@/lib/owner-access";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers });

/** Approve (invite) or reject one waitlist entry. Owner only; repeating an action is not an error. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  if (!isOwnerUser(actor.userId)) return json({ error: "not_found" }, 404);
  let origin: string | null = null;
  try { origin = webOrigin(); } catch { /* WEB_URL missing: refuse below. */ }
  if (!origin || request.headers.get("origin") !== origin) return json({ error: "invalid_origin" }, 403);
  const { id } = await params;
  if (!/^[A-Za-z0-9_]{1,80}$/.test(id)) return json({ error: "invalid_id" }, 400);
  const action = await request.json().then((b: unknown) => (b as { action?: unknown } | null)?.action).catch(() => null);
  if (action !== "approve" && action !== "reject") return json({ error: "invalid_action" }, 400);
  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return json({ error: "not_configured" }, 503);
  try {
    const backend = createClerkBackend({ secretKey });
    if (action === "approve") await backend.inviteWaitlistEntry(id);
    else await backend.rejectWaitlistEntry(id);
  } catch (error) {
    if (error instanceof ClerkBackendError && error.status === 404) { bustWaitlistCache(); return json({ error: "not_found" }, 404); }
    return json({ error: "clerk_unavailable" }, 502);
  }
  bustWaitlistCache();
  return json({ ok: true }, 200);
}

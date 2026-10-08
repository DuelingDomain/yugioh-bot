import { NextResponse } from "next/server";
import { createDraftVisibilityService, DraftVisibilityServiceError } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { draftInviteRateLimit } from "@/lib/draft-invite-rate-limit";
import { draftInviteResponse, draftNotFound, runDraftCreatorRoute } from "@/lib/draft-visibility";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runDraftCreatorRoute(params, ({ slug, guildId, userId, privacy }) =>
    draftInviteResponse(slug, privacy.invite(slug, guildId, userId)));
}

/** Redemption is available to every signed-in application user, including users without a player row. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const limited = draftInviteRateLimit(request, actor.userId);
  if (limited) return limited;
  const { slug } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return draftNotFound(); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("code" in body)) return draftNotFound();
  try {
    createDraftVisibilityService(getDb()).admit(slug, env.discordGuildId, actor.userId, body.code);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof DraftVisibilityServiceError) return draftNotFound();
    console.error("[draft invite] admission failed:", error);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}

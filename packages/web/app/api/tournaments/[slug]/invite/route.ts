import { NextResponse } from "next/server";
import { createTournamentVisibilityService, TournamentVisibilityServiceError } from "@yugidraft/shared/services";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { tournamentInviteRateLimit } from "@/lib/tournament-invite-rate-limit";
import { tournamentInviteResponse, tournamentNotFound, runTournamentCreatorRoute } from "@/lib/tournament-visibility";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: Promise<{ slug: string }> }) {
  return runTournamentCreatorRoute(params, ({ slug, guildId, userId, privacy }) =>
    tournamentInviteResponse(slug, privacy.invite(slug, guildId, userId)));
}

/** Redemption is available to every signed-in application user, including users without a player row. */
export async function POST(request: Request, { params }: { params: Promise<{ slug: string }> }) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const limited = tournamentInviteRateLimit(request, actor.userId);
  if (limited) return limited;
  const { slug } = await params;
  let body: unknown;
  try { body = await request.json(); } catch { return tournamentNotFound(); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !("code" in body)) return tournamentNotFound();
  try {
    createTournamentVisibilityService(getDb()).admit(slug, env.discordGuildId, actor.userId, body.code);
    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof TournamentVisibilityServiceError) return tournamentNotFound();
    console.error("[tournament invite] admission failed:", error);
    return NextResponse.json({ error: "Failed to accept invite" }, { status: 500 });
  }
}

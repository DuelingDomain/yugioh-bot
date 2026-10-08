import { NextResponse } from "next/server";
import { createTournamentVisibilityService, TournamentVisibilityServiceError } from "@yugidraft/shared/services";
import { getDb } from "./db";
import { env } from "./env";
import { requireWebAccess } from "./web-access";

export const tournamentNotFound = () => NextResponse.json({ error: "Tournament not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export function tournamentInviteResponse(slug: string, inviteCode: string) {
  return NextResponse.json({ inviteCode, inviteUrl: `${env.webUrl}/tournament/${slug}?invite=${inviteCode}` }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function runTournamentCreatorRoute(
  params: Promise<{ slug: string }>,
  work: (context: { slug: string; guildId: string; userId: number; privacy: ReturnType<typeof createTournamentVisibilityService> }) => Response | Promise<Response>,
) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const db = getDb();
  const guildId = env.discordGuildId;
  // Resolve ownership before reading bodies or returning status/validation errors.
  if (!db.prepare("select id from tournaments where web_slug=? and guild_id=? and created_by_user_id=?").get(slug, guildId, actor.userId)) {
    return tournamentNotFound();
  }
  try {
    return await work({ slug, guildId, userId: actor.userId, privacy: createTournamentVisibilityService(db) });
  } catch (error) {
    if (error instanceof TournamentVisibilityServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[tournament visibility] action failed:", error);
    return NextResponse.json({ error: "Failed to update tournament" }, { status: 500 });
  }
}

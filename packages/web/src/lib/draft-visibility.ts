import { NextResponse } from "next/server";
import { createDraftVisibilityService, DraftVisibilityServiceError } from "@yugidraft/shared/services";
import { getDb } from "./db";
import { env } from "./env";
import { requireWebAccess } from "./web-access";

export const draftNotFound = () => NextResponse.json({ error: "Draft not found" }, { status: 404, headers: { "Cache-Control": "no-store" } });

export function draftInviteResponse(slug: string, inviteCode: string) {
  return NextResponse.json({ inviteCode, inviteUrl: `${env.webUrl}/draft/${slug}?invite=${inviteCode}` }, {
    headers: { "Cache-Control": "no-store" },
  });
}

export async function runDraftCreatorRoute(
  params: Promise<{ slug: string }>,
  work: (context: { slug: string; guildId: string; userId: number; privacy: ReturnType<typeof createDraftVisibilityService> }) => Response | Promise<Response>,
) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor.response;
  const { slug } = await params;
  const db = getDb();
  const guildId = env.discordGuildId;
  // Resolve ownership before reading bodies or returning status/validation errors.
  if (!db.prepare("select id from drafts where web_slug=? and guild_id=? and created_by_user_id=?").get(slug, guildId, actor.userId)) {
    return draftNotFound();
  }
  try {
    return await work({ slug, guildId, userId: actor.userId, privacy: createDraftVisibilityService(db) });
  } catch (error) {
    if (error instanceof DraftVisibilityServiceError) {
      return NextResponse.json({ error: error.message }, { status: error.status, headers: { "Cache-Control": "no-store" } });
    }
    console.error("[draft visibility] action failed:", error);
    return NextResponse.json({ error: "Failed to update draft" }, { status: 500 });
  }
}

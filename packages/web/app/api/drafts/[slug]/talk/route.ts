import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { broadcaster } from "@/lib/notify";
import { talkLimiter } from "@/lib/draft-talk";
import { isTalkLine } from "@yugidraft/shared/ws";

export const runtime = "nodejs";

/**
 * A seated player says one of the fixed table-talk lines. The body is `{ line: "<id>" }`; free text
 * is refused. The line is relayed to everyone in the draft room and says nothing about picks.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { line?: unknown } | null;
  const line = body?.line;
  if (!isTalkLine(line)) {
    return NextResponse.json({ error: "Pick one of the lines from the list" }, { status: 400 });
  }

  const { slug } = await params;
  const db = getDb();
  const draft = db
    .prepare("select id, guild_id, status from drafts where web_slug = ? and guild_id = ?")
    .get(slug, env.discordGuildId) as { id: number; guild_id: string; status: string } | undefined;
  if (!draft) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  // Only players seated in this draft can talk, not its host or a guest.
  const player = db
    .prepare(
      `select p.id from players p
       join draft_players dp on dp.player_id = p.id
       where dp.draft_id = ? and p.guild_id = ? and p.discord_user_id = ?`,
    )
    .get(draft.id, draft.guild_id, session.user.id) as { id: number } | undefined;
  if (!player) {
    return NextResponse.json({ error: "Only players in this draft can talk" }, { status: 403 });
  }

  if (draft.status !== "active") {
    return NextResponse.json({ error: "Draft is not active" }, { status: 409 });
  }

  const limit = talkLimiter().take(`${draft.id}:${player.id}`);
  if (!limit.ok) {
    return NextResponse.json(
      { error: "Wait a moment before saying something else", retryAfterMs: limit.retryAfterMs },
      { status: 429, headers: { "Retry-After": String(Math.ceil(limit.retryAfterMs / 1000)) } },
    );
  }

  await broadcaster.draft({ kind: "talk", slug, playerId: player.id, line });
  return NextResponse.json({ ok: true });
}

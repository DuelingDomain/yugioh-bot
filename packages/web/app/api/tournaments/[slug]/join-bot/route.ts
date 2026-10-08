import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { createPlayerService, findTournamentReadAccess } from "@yugidraft/shared/services";
import { broadcaster } from "@/lib/notify";

export const runtime = "nodejs";

const TOURNAMENT_BOTS = [
  { discordUserId: "tournament_bot_dev_1", displayName: "Bot 1" },
  { discordUserId: "tournament_bot_dev_2", displayName: "Bot 2" },
  { discordUserId: "tournament_bot_dev_3", displayName: "Bot 3" },
] as const;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();
    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const tournament = db
      .prepare("select id, guild_id, status, created_by_user_id from tournaments where web_slug = ? and guild_id = ?")
      .get(slug, env.discordGuildId) as { id: number; guild_id: string; status: string; created_by_user_id: number } | undefined;

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.status !== "pending") {
      return NextResponse.json({ error: "Tournament has already started" }, { status: 400 });
    }

    if (tournament.created_by_user_id !== actor.userId) {
      return NextResponse.json({ error: "Only the organizer can add bots" }, { status: 403 });
    }

    const players = createPlayerService(db);

    for (const botIdentity of TOURNAMENT_BOTS) {
      const bot = players.findOrCreateTestPlayer(tournament.guild_id, botIdentity.discordUserId, botIdentity.displayName);
      const existing = db
        .prepare("select 1 from tournament_participants where tournament_id = ? and player_id = ?")
        .get(tournament.id, bot.id);

      if (existing) {
        continue;
      }

      db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(tournament.id, bot.id);

      void broadcaster.tournament(
        {
          kind: "participant-joined",
          slug,
          playerId: bot.id,
          displayName: bot.displayName,
        },
      );

      return NextResponse.json({ success: true, playerId: bot.id, displayName: bot.displayName });
    }

    return NextResponse.json({ error: "No more dev bots available" }, { status: 400 });
  } catch (error) {
    console.error("[api/tournaments/[slug]/join-bot] error:", error);
    return NextResponse.json({ error: "Failed to add bot to tournament" }, { status: 500 });
  }
}

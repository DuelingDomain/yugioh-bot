import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { createTournamentService } from "@yugidraft/shared/services";
import { broadcaster } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();

    const tournament = db
      .prepare("select id, guild_id, status from tournaments where web_slug = ? and guild_id = ?")
      .get(slug, env.discordGuildId) as { id: number; guild_id: string; status: string } | undefined;

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    const player = db
      .prepare("select id from players where guild_id = ? and user_id = ?")
      .get(tournament.guild_id, actor.userId) as { id: number } | undefined;

    if (!player) {
      return NextResponse.json({ error: "You are not a participant in this tournament" }, { status: 400 });
    }

    const tournaments = createTournamentService(db);
    tournaments.leave(tournament.id, player.id);

    void broadcaster.tournament(
      { kind: "participant-left", slug, playerId: player.id },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to leave tournament";
    console.error("[api/tournaments/[slug]/leave] error:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

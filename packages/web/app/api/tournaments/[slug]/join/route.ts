import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { createPlayerService } from "@yugidraft/shared/services";
import { broadcaster } from "@/lib/notify";
import { backfillDraftDecks, linkDraftDeck } from "@/lib/draft-decks";

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

    if (tournament.status !== "pending") {
      return NextResponse.json({ error: "Tournament has already started" }, { status: 400 });
    }

    const tournamentId = tournament.id;
    const guildId = tournament.guild_id;

    const players = createPlayerService(db);
    const player = players.findOrCreate(guildId, actor.userId, actor.userName);

    const existing = db
      .prepare("select 1 from tournament_participants where tournament_id = ? and player_id = ?")
      .get(tournamentId, player.id);

    if (existing) {
      return NextResponse.json({ error: "You have already joined this tournament" }, { status: 400 });
    }

    db.prepare(
      "insert into tournament_participants (tournament_id, player_id) values (?, ?)"
    ).run(tournamentId, player.id);

    // A draft tournament entry takes the player's drafted deck at once (a no-op for any other tournament).
    backfillDraftDecks(guildId, actor.userId, db);
    linkDraftDeck(tournamentId, player.id, db);

    void broadcaster.tournament(
      {
        kind: "participant-joined",
        slug,
        playerId: player.id,
        displayName: player.displayName,
      },
    );

    return NextResponse.json({ success: true, playerId: player.id, displayName: player.displayName });
  } catch (error) {
    console.error("[api/tournaments/[slug]/join] error:", error);
    return NextResponse.json(
      { error: "Failed to join tournament" },
      { status: 500 }
    );
  }
}

import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { createPlayerService, findTournamentReadAccess } from "@yugidraft/shared/services";
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

    // Read authorization and entry creation share the write lock, including player creation.
    const result = db.transaction(() => {
      const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
      if (!access?.canRead) return { response: NextResponse.json({ error: "Tournament not found" }, { status: 404 }) };
      if (!access.canJoin) {
        return { response: NextResponse.json({ error: access.status === "pending" && access.isParticipant
          ? "You have already joined this tournament" : "Tournament has already started" }, { status: 400 }) };
      }
      const guildId = env.discordGuildId;
      const player = createPlayerService(db).findOrCreate(guildId, actor.userId, actor.userName);
      db.prepare("insert into tournament_participants (tournament_id, player_id) values (?, ?)").run(access.id, player.id);
      // A draft tournament entry takes the player's drafted deck immediately.
      backfillDraftDecks(guildId, actor.userId, db);
      linkDraftDeck(access.id, player.id, db);
      return { player };
    }).immediate();
    if (result.response) return result.response;
    const { player } = result;

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

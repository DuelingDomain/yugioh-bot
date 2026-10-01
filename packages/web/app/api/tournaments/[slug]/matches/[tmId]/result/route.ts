import { NextResponse } from "next/server";
import { createMatchService, createTournamentDuelService, TournamentDuelError } from "@yugidraft/shared/services";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { announcer, broadcaster } from "@/lib/notify";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

/** The organizer sets a bracket result by hand; this cancels the open online series of the slot. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; tmId: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const { slug, tmId } = await params;
    const tournamentMatchId = Number(tmId);

    let body: { winnerPlayerId?: unknown };
    try {
      body = (await request.json()) as { winnerPlayerId?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const winnerPlayerId = body?.winnerPlayerId;
    if (typeof winnerPlayerId !== "number" || !Number.isInteger(winnerPlayerId) || winnerPlayerId < 1) {
      return NextResponse.json({ error: "winnerPlayerId is required" }, { status: 400 });
    }

    const db = getDb();
    const tournament = db
      .prepare("select id, guild_id from tournaments where web_slug = ?")
      .get(slug) as { id: number; guild_id: string } | undefined;
    if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const slot = Number.isInteger(tournamentMatchId)
      ? (db.prepare("select tournament_id from tournament_matches where id = ?").get(tournamentMatchId) as
          | { tournament_id: number }
          | undefined)
      : undefined;
    if (!slot || slot.tournament_id !== tournament.id) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const result = createTournamentDuelService(db).setResultByOrganizer({
      tournamentMatchId,
      organizerUserId: session.user.id,
      winnerPlayerId,
    });

    // Games of a cancelled series change for the players watching them.
    for (const gameSlug of result.changedDuelSlugs) await notifyDuelChange(gameSlug, tournament.guild_id);
    void broadcaster.tournament({ kind: "match-updated", slug });

    // The bot sweep covers a missed announce.
    if (result.tournamentCompleted) {
      if (createMatchService(db).claimTournamentCompletionAnnouncement(tournament.id)) {
        void announcer.announce({ kind: "tournament-completed", tournamentId: tournament.id });
      }
      void broadcaster.tournament({ kind: "completed", slug });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof TournamentDuelError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("[api/tournaments/[slug]/matches/[tmId]/result] error:", error);
    return NextResponse.json({ error: "Failed to set result" }, { status: 500 });
  }
}

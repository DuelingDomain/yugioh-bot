import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { auth } from "@/lib/auth";
import { createTournamentService, createMatchService } from "@yugidraft/shared/services";
import { announcer, broadcaster } from "@/lib/notify";
import { notifyDuelChange } from "@/lib/notify-duel";

export const runtime = "nodejs";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { slug } = await params;
    const db = getDb();

    const tournament = db
      .prepare("select id, guild_id, status, created_by_user_id from tournaments where web_slug = ?")
      .get(slug) as { id: number; guild_id: string; status: string; created_by_user_id: string } | undefined;

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.created_by_user_id !== session.user.id) {
      return NextResponse.json({ error: "Only the tournament creator can end it" }, { status: 403 });
    }

    if (tournament.status !== "active") {
      return NextResponse.json({ error: `Cannot end a ${tournament.status} tournament` }, { status: 400 });
    }

    const tournaments = createTournamentService(db);
    const { tournament: completed, changedDuelSlugs } = tournaments.completeWithChanges(tournament.id);

    const matches = createMatchService(db);
    if (matches.claimTournamentCompletionAnnouncement(completed.id)) {
      void announcer.announce({ kind: "tournament-completed", tournamentId: completed.id });
    }

    void broadcaster.tournament({ kind: "completed", slug });
    for (const duelSlug of changedDuelSlugs) void notifyDuelChange(duelSlug, tournament.guild_id);

    return NextResponse.json({ id: completed.id, status: completed.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to end tournament";
    console.error("[api/tournaments/[slug]/complete] error:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

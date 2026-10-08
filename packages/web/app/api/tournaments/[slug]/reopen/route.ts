import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { requireWebAccess } from "@/lib/web-access";
import { createTournamentService, findTournamentReadAccess } from "@yugidraft/shared/services";
import { broadcaster } from "@/lib/notify";

export const runtime = "nodejs";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();
    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const body = (await request.json()) as { tournamentMatchId?: number };
    if (!body.tournamentMatchId) {
      return NextResponse.json({ error: "Missing tournamentMatchId" }, { status: 400 });
    }

    const tournament = db
      .prepare("select id from tournaments where web_slug = ? and guild_id = ?")
      .get(slug, env.discordGuildId) as { id: number } | undefined;
    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    const tm = db
      .prepare("select tournament_id from tournament_matches where id = ?")
      .get(body.tournamentMatchId) as { tournament_id: number } | undefined;
    if (!tm || tm.tournament_id !== tournament.id) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    try {
      createTournamentService(db).reopenTournamentMatch(body.tournamentMatchId, actor.userId);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to reopen";
      const status = /organizer/i.test(message) ? 403 : 400;
      return NextResponse.json({ error: message }, { status });
    }

    void broadcaster.tournament(
      { kind: "match-updated", slug },
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[api/tournaments/[slug]/reopen] error:", error);
    return NextResponse.json({ error: "Failed to reopen match" }, { status: 500 });
  }
}

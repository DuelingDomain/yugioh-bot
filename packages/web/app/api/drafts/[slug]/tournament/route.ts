import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { env } from "@/lib/env";
import { createDraftTournamentService, TournamentDuelError, findTournamentReadAccess } from "@yugidraft/shared/services";
import { broadcaster } from "@/lib/notify";
import { draftReadAccess } from "@/lib/draft-access";

export const runtime = "nodejs";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;
    const userId = actor.userId;

    const { slug } = await params;
    const db = getDb();
    const guildId = env.discordGuildId;
    const denied = draftReadAccess(db, slug, guildId, userId);
    if (denied) return denied;

    const draft = db
      .prepare("select id, created_by_user_id, status, tournament_id from drafts where web_slug = ? and guild_id = ?")
      .get(slug, guildId) as {
        id: number;
        created_by_user_id: number;
        status: string;
        tournament_id: number | null;
      } | undefined;

    if (!draft) {
      return NextResponse.json({ error: "Draft not found" }, { status: 404 });
    }

    if (draft.created_by_user_id !== userId) return NextResponse.json({ error: "Only the draft creator can create a tournament" }, { status: 403 });

    if (draft.tournament_id !== null) {
      if (!findTournamentReadAccess(db, draft.tournament_id, guildId, userId)?.canRead) {
        return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
      }
      const existing = db
        .prepare("select id, name, web_slug, format, visibility from tournaments where id = ?")
        .get(draft.tournament_id) as { id: number; name: string; web_slug: string | null; format: string; visibility: "open" | "private" } | undefined;
      if (existing) {
        return NextResponse.json(
          { id: existing.id, name: existing.name, webSlug: existing.web_slug, format: existing.format, visibility: existing.visibility },
          { status: 409 },
        );
      }
    }

    const body = await request.json();
    const { format, bestOf: rawBestOf } = body as { format?: string; bestOf?: unknown };

    if (!format || (format !== "round_robin" && format !== "single_elim")) {
      return NextResponse.json({ error: "format must be round_robin or single_elim" }, { status: 400 });
    }

    // Best of 3 unless the creator picks a single game.
    const bestOf = rawBestOf === undefined ? 3 : rawBestOf;
    if (bestOf !== 1 && bestOf !== 3) {
      return NextResponse.json({ error: "bestOf must be 1 or 3" }, { status: 400 });
    }

    const service = createDraftTournamentService(db);
    const result = service.createTournamentFromDraft({
      draftId: draft.id,
      format,
      createdByUserId: userId,
      bestOf,
    });
    void broadcaster.draft({ kind: "seats", slug });

    const tournament = db
      .prepare("select id, name, web_slug, format, visibility from tournaments where id = ?")
      .get(result.tournamentId) as { id: number; name: string; web_slug: string | null; format: string; visibility: "open" | "private" };

    return NextResponse.json(
      { id: tournament.id, name: tournament.name, webSlug: tournament.web_slug, format: tournament.format, visibility: tournament.visibility },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof TournamentDuelError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error) {
      if (
        error.message.includes("Only the draft creator") ||
        error.message.includes("must be completed")
      ) {
        return NextResponse.json({ error: error.message }, { status: 403 });
      }
    }
    console.error("[api/drafts/[slug]/tournament POST] error:", error);
    return NextResponse.json({ error: "Failed to create tournament" }, { status: 500 });
  }
}

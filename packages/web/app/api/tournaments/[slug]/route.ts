import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";
import { env } from "@/lib/env";
import {
  createDuelSeriesService,
  createSavedDeckService,
  createTournamentDuelService,
  createTournamentService,
  findTournamentReadAccess,
  findDraftReadAccess,
  TournamentDuelError,
} from "@yugidraft/shared/services";
import type { DuelBestOf, DuelSeriesSummary } from "@yugidraft/shared/duels";
import { announcer, broadcaster } from "@/lib/notify";
import { notifyDuelChange } from "@/lib/notify-duel";
import { viewerStakes } from "@/lib/tournament-stakes";
import { backfillDraftDecks, draftDeckNoteFor, linkDraftDeck } from "@/lib/draft-decks";

export const runtime = "nodejs";

type TournamentRow = {
  id: number;
  guild_id: string;
  name: string;
  format: string;
  status: string;
  created_by_user_id: number;
  web_slug: string | null;
  deadline_at: string | null;
  report_confirm_window_hours: number | null;
  created_at: string;
  started_at: string | null;
};

/** A settings (deadline / report window) step failed inside the PUT transaction. */
class SettingsUpdateError extends Error {}

function resolveTournamentBySlug(db: ReturnType<typeof getDb>, slug: string): TournamentRow | undefined {
  return db.prepare("select * from tournaments where web_slug = ? and guild_id = ?").get(slug, env.discordGuildId) as TournamentRow | undefined;
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;
    const { slug } = await params;
    const db = getDb();

    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const tournament = resolveTournamentBySlug(db, slug);

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    const tournamentId = tournament.id;

    // A draft tournament entry uses the player's draft deck: save a missing one and register it
    // before the participants are read, so the viewer sees the deck in.
    {
      const viewer = db
        .prepare("select id from players where guild_id = ? and user_id = ?")
        .get(tournament.guild_id, actor.userId) as { id: number } | undefined;
      const draftRow = viewer
        ? db.prepare("select id from drafts where tournament_id = ? and guild_id = ?").get(tournamentId, tournament.guild_id)
        : undefined;
      if (viewer && draftRow) {
        backfillDraftDecks(tournament.guild_id, actor.userId, db);
        linkDraftDeck(tournamentId, viewer.id, db);
      }
    }

    const participants = db
      .prepare(
        `
        select p.id as player_id, p.display_name, tp.deck_registered_at, tp.deck_locked_at
        from tournament_participants tp
        inner join players p on p.id = tp.player_id
        where tp.tournament_id = ?
        order by tp.joined_at asc, tp.rowid asc
      `
      )
      .all(tournamentId)
      .map((row: any) => ({
        playerId: row.player_id,
        displayName: row.display_name,
        deckRegistered: row.deck_registered_at != null,
        deckLocked: row.deck_locked_at != null,
      }));

    const matches = db
      .prepare(
        `
        select
          tm.id,
          tm.tournament_id,
          tm.match_id,
          tm.player_one_id,
          tm.player_two_id,
          tm.round_number,
          tm.status,
          tm.metadata_json,
          m.winner_id,
          m.reporter_id,
          m.approver_id,
          m.resolved_at
        from tournament_matches tm
        left join matches m on m.id = tm.match_id
        where tm.tournament_id = ?
        order by tm.round_number asc, tm.id asc
      `
      )
      .all(tournamentId)
      .map((row: any) => ({
        id: row.id,
        tournamentId: row.tournament_id,
        matchId: row.match_id,
        playerOneId: row.player_one_id,
        playerTwoId: row.player_two_id,
        roundNumber: row.round_number,
        status: row.status,
        metadata: JSON.parse(row.metadata_json),
        winnerId: row.winner_id,
        reporterId: row.reporter_id,
        approverId: row.approver_id,
        resolvedAt: row.resolved_at,
      }));

    const playerMap = new Map(participants.map((p) => [p.playerId, p.displayName]));

    const seriesService = createDuelSeriesService(db);
    const selectSeriesId = db.prepare(
      `select id from duel_series where tournament_match_id = ?
       order by case when status in ('active', 'between_games') then 0 else 1 end, id desc
       limit 1`,
    );
    // The open series of the slot, else the latest one.
    const seriesFor = (tournamentMatchId: number): DuelSeriesSummary | null => {
      const row = selectSeriesId.get(tournamentMatchId) as { id: number } | undefined;
      if (!row) return null;
      try {
        return seriesService.get(row.id, tournament.guild_id);
      } catch (error) {
        console.warn(`[api/tournaments/[slug] GET] series ${row.id} unavailable`, error);
        return null;
      }
    };

    const tournamentDuels = createTournamentDuelService(db);
    const duelRules = tournamentDuels.rules(tournamentId);
    const rulesLocked = tournamentDuels.rulesLocked(tournamentId);
    const draftSlug = duelRules.draftId && findDraftReadAccess(db, duelRules.draftId, tournament.guild_id, actor.userId)?.canRead
      ? ((db.prepare("select web_slug from drafts where id = ? and guild_id = ?").get(duelRules.draftId, tournament.guild_id) as
          | { web_slug: string | null }
          | undefined)?.web_slug ?? null)
      : null;

    const matchesWithNames = matches.map((match) => ({
      ...match,
      series: seriesFor(match.id),
      playerOneName: playerMap.get(match.playerOneId) ?? `Player ${match.playerOneId}`,
      playerTwoName: match.playerTwoId ? (playerMap.get(match.playerTwoId) ?? `Player ${match.playerTwoId}`) : null,
    }));

    let isParticipant = false;
    let currentUserPlayerId: number | null = null;
    if (actor.ok) {
      const currentPlayer = db
        .prepare("select id from players where guild_id = ? and user_id = ?")
        .get(tournament.guild_id, actor.userId) as { id: number } | undefined;
      if (currentPlayer) {
        currentUserPlayerId = currentPlayer.id;
        isParticipant = participants.some((p) => p.playerId === currentPlayer.id);
      }
    }

    // The size note for the viewer's draft deck: the registered deck, else the saved draft deck.
    let deckNote = null;
    if (isParticipant && currentUserPlayerId !== null && duelRules.draftId && actor.ok) {
      const deck =
        tournamentDuels.registration(tournamentId, currentUserPlayerId)?.deck ??
        createSavedDeckService(db).findByDraft(tournament.guild_id, actor.userId, duelRules.draftId)?.deck;
      if (deck) deckNote = draftDeckNoteFor(db, { draftId: duelRules.draftId, playerId: currentUserPlayerId, deck });
    }

    return NextResponse.json({
      id: tournament.id,
      discordEnabled: env.discordBotEnabled,
      guildId: tournament.guild_id,
      name: tournament.name,
      format: tournament.format,
      status: tournament.status,
      visibility: access.visibility,
      canJoin: access.canJoin,
      ...(tournament.created_by_user_id === actor.userId ? { canManageInvite: true } : {}),
      createdByUserId: tournament.created_by_user_id,
      webSlug: tournament.web_slug ?? undefined,
      deadlineAt: tournament.deadline_at ?? undefined,
      reportConfirmWindowHours: tournament.report_confirm_window_hours ?? undefined,
      startedAt: tournament.started_at ?? null,
      createdAt: tournament.created_at,
      bestOf: duelRules.bestOf,
      duelRules,
      rulesLocked,
      draftId: duelRules.draftId,
      draftSlug,
      participants,
      matches: matchesWithNames,
      isParticipant,
      currentUserPlayerId,
      deckNote,
      // Elo for the viewer's current or next match; null for non-players and when nothing is left to play.
      stakes: viewerStakes({
        db,
        guildId: tournament.guild_id,
        tournamentStatus: tournament.status,
        matches: matches.map((match) => ({ id: match.id, playerOneId: match.playerOneId, playerTwoId: match.playerTwoId, status: match.status, reporterId: match.reporterId })),
        playerId: isParticipant ? currentUserPlayerId : null,
      }),
    });
  } catch (error) {
    console.error("[api/tournaments/[slug] GET] error:", error);
    return NextResponse.json(
      { error: "Failed to load tournament" },
      { status: 500 }
    );
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();

    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const tournament = resolveTournamentBySlug(db, slug);

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.created_by_user_id !== actor.userId) {
      return NextResponse.json({ error: "Only the tournament creator can cancel it" }, { status: 403 });
    }

    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return NextResponse.json({ error: `Tournament is already ${tournament.status}` }, { status: 400 });
    }

    // Cancels the tournament and closes its open duel series in one transaction.
    const { changedDuelSlugs } = createTournamentService(db).cancelWithChanges(tournament.id);

    void broadcaster.tournament(
      { kind: "cancelled", slug },
    );
    for (const duelSlug of changedDuelSlugs) void notifyDuelChange(duelSlug, tournament.guild_id);

    return NextResponse.json({ id: tournament.id, status: "cancelled" });
  } catch (error) {
    console.error("[api/tournaments/[slug] DELETE] error:", error);
    return NextResponse.json({ error: "Failed to cancel tournament" }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();

    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const tournament = resolveTournamentBySlug(db, slug);

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.created_by_user_id !== actor.userId) {
      return NextResponse.json({ error: "Only the tournament creator can modify it" }, { status: 403 });
    }

    if (tournament.status === "completed" || tournament.status === "cancelled") {
      return NextResponse.json({ error: `Cannot edit a ${tournament.status} tournament` }, { status: 400 });
    }

    const tournamentId = tournament.id;
    const body = await request.json();
    const { name, deadlineAt, reportConfirmWindowHours, bestOf, duelRules } = body as {
      name?: string;
      deadlineAt?: string | null;
      reportConfirmWindowHours?: number | null;
      bestOf?: DuelBestOf;
      duelRules?: { mode?: unknown; masterRule?: unknown; settings?: unknown } | null;
    };

    if (name !== undefined) {
      if (tournament.status !== "pending") {
        return NextResponse.json(
          { error: "Name can only be changed before the tournament starts" },
          { status: 400 }
        );
      }
      if (!name.trim()) {
        return NextResponse.json({ error: "Name cannot be empty" }, { status: 400 });
      }

      const existing = db
        .prepare(
          "select id from tournaments where guild_id = ? and name = ? and status in ('pending', 'active') and id != ?"
        )
        .get(tournament.guild_id, name, tournamentId) as { id: number } | undefined;

      if (existing) {
        return NextResponse.json({ error: "A tournament with that name already exists" }, { status: 400 });
      }
    }

    if (deadlineAt !== undefined && deadlineAt !== null) {
      const ts = Date.parse(deadlineAt);
      if (Number.isNaN(ts) || ts <= Date.now()) {
        return NextResponse.json({ error: "deadline must be a valid future date" }, { status: 400 });
      }
    }

    const tournaments = createTournamentService(db);
    const patch: { deadlineAt?: string | null; reportConfirmWindowHours?: number | null } = {};
    if (deadlineAt !== undefined) patch.deadlineAt = deadlineAt;
    if (reportConfirmWindowHours !== undefined) patch.reportConfirmWindowHours = reportConfirmWindowHours;
    const userId = actor.userId;
    const rulesChange = bestOf !== undefined || (duelRules !== undefined && duelRules !== null);

    // All updates apply together: a failing step rolls the earlier ones back.
    const applyUpdates = db.transaction(() => {
      if (name !== undefined) {
        db.prepare("update tournaments set name = ? where id = ?").run(name, tournamentId);
      }
      if (Object.keys(patch).length > 0) {
        try {
          tournaments.updateSettings(tournamentId, patch);
        } catch (err) {
          throw new SettingsUpdateError(err instanceof Error ? err.message : "Failed to update settings");
        }
      }
      if (rulesChange) {
        createTournamentDuelService(db).setRules(tournamentId, userId, {
          bestOf,
          mode: duelRules?.mode as never,
          masterRule: duelRules?.masterRule as never,
          settings: duelRules?.settings,
        });
      }
    });
    try {
      applyUpdates();
    } catch (err) {
      if (err instanceof SettingsUpdateError) {
        return NextResponse.json({ error: err.message }, { status: 400 });
      }
      if (err instanceof TournamentDuelError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
    }
    if (name !== undefined || Object.keys(patch).length > 0 || rulesChange) {
      void broadcaster.tournament({ kind: "match-updated", slug });
    }

    const updated = db
      .prepare(
        "select id, name, format, status, web_slug, deadline_at, report_confirm_window_hours from tournaments where id = ?"
      )
      .get(tournamentId) as any;

    const rules = createTournamentDuelService(db).rules(tournamentId);

    return NextResponse.json({
      id: updated.id,
      name: updated.name,
      format: updated.format,
      status: updated.status,
      webSlug: updated.web_slug ?? undefined,
      deadlineAt: updated.deadline_at ?? undefined,
      reportConfirmWindowHours: updated.report_confirm_window_hours ?? undefined,
      bestOf: rules.bestOf,
      duelRules: rules,
    });
  } catch (error) {
    console.error("[api/tournaments/[slug] PUT] error:", error);
    return NextResponse.json({ error: "Failed to update tournament" }, { status: 500 });
  }
}

// The spec names PATCH; the dashboard already calls PUT.
export const PATCH = PUT;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const { slug } = await params;
    const db = getDb();

    const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
    if (!access?.canRead) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const tournament = resolveTournamentBySlug(db, slug);

    if (!tournament) {
      return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    }

    if (tournament.created_by_user_id !== actor.userId) {
      return NextResponse.json({ error: "Only the tournament creator can start it" }, { status: 403 });
    }

    const tournaments = createTournamentService(db);
    const started = tournaments.start(tournament.id);

    if (env.discordBotEnabled) void announcer.announce(
      {
        kind: "tournament-started",
        tournamentId: started.id,
        channelId: env.discordDefaultChannelId,
        name: started.name,
        format: started.format,
        webSlug: started.webSlug ?? "",
      },
    );

    void broadcaster.tournament(
      { kind: "started", slug },
    );

    return NextResponse.json({
      id: started.id,
      status: started.status,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to start tournament";
    console.error("[api/tournaments/[slug] POST] error:", error);
    return NextResponse.json({ error: message }, { status: 400 });
  }
}

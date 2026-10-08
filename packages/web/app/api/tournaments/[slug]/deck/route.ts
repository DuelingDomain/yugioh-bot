import { NextRequest, NextResponse } from "next/server";
import { checkDeckAgainstPool } from "@yugidraft/shared/duels";
import type { DuelDeck, DuelDeckValidation } from "@yugidraft/shared/duels";
import {
  createPlayerService,
  findTournamentReadAccess,
  findDraftReadAccess,
  createSavedDeckService,
  createTournamentDuelService,
  SavedDeckServiceError,
  TournamentDuelError,
} from "@yugidraft/shared/services";
import { requireWebAccess } from "@/lib/web-access";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { callDuelHost } from "@/lib/duel-host";
import { draftMainSizeError, loadDraftPool } from "@/lib/tournament-deck";
import { broadcaster } from "@/lib/notify";
import { backfillDraftDecks, draftDeckNoteFor, linkDraftDeck } from "@/lib/draft-decks";

export const runtime = "nodejs";

type TournamentRow = { id: number; guild_id: string };

function serviceError(error: unknown) {
  if (error instanceof TournamentDuelError || error instanceof SavedDeckServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  console.error("[api/tournaments/[slug]/deck] error:", error);
  return NextResponse.json({ error: "Failed to process the tournament deck" }, { status: 500 });
}

/** The signed-in participant, or a response that explains why not. */
async function loadCaller(slug: string) {
  const actor = await requireWebAccess();
  if (!actor.ok) return actor;
  const db = getDb();
  const access = findTournamentReadAccess(db, slug, env.discordGuildId, actor.userId);
  if (!access?.canRead) return { ok: false as const, response: NextResponse.json({ error: "Tournament not found" }, { status: 404 }) };
  const tournament = db.prepare("select id, guild_id from tournaments where web_slug = ? and guild_id = ?").get(slug, env.discordGuildId) as
    | TournamentRow
    | undefined;
  if (!tournament) {
    return { ok: false as const, response: NextResponse.json({ error: "Tournament not found" }, { status: 404 }) };
  }
  const player = createPlayerService(db).findByGuildAndUser(tournament.guild_id, actor.userId);
  const isParticipant =
    player &&
    db
      .prepare("select 1 from tournament_participants where tournament_id = ? and player_id = ?")
      .get(tournament.id, player.id);
  if (!player || !isParticipant) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: "You are not a player in this tournament" }, { status: 403 }),
    };
  }
  return { ok: true as const, db, tournament, player, userId: actor.userId };
}

export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const caller = await loadCaller(slug);
    if (!caller.ok) return caller.response;
    const { db, tournament, player, userId } = caller;

    const tournamentDuels = createTournamentDuelService(db);
    const rules = tournamentDuels.rules(tournament.id);
    if (rules.draftId !== null) {
      // The draft deck is saved when the draft ends; this catches an older draft or a missed save,
      // and registers it for a player who has no deck in yet.
      backfillDraftDecks(tournament.guild_id, userId, db);
      linkDraftDeck(tournament.id, player.id, db);
    }
    const registration = tournamentDuels.registration(tournament.id, player.id);

    const savedDecks = createSavedDeckService(db);
    let decks = savedDecks.list(tournament.guild_id, userId).filter((deck) => deck.mode === rules.mode);
    let draft: { id: number; slug: string } | null = null;
    if (rules.draftId !== null) {
      // A draft tournament takes only the player's deck of that draft.
      const draftDeck = savedDecks.findByDraft(tournament.guild_id, userId, rules.draftId);
      decks = draftDeck ? [draftDeck] : [];
      const row = db.prepare("select web_slug from drafts where id = ? and guild_id = ?").get(rules.draftId, tournament.guild_id) as
        | { web_slug: string | null }
        | undefined;
      draft = row?.web_slug && findDraftReadAccess(db, rules.draftId, tournament.guild_id, userId)?.canRead ? { id: rules.draftId, slug: row.web_slug } : null;
    }

    const deckNote =
      rules.draftId !== null
        ? draftDeckNoteFor(db, {
            draftId: rules.draftId,
            playerId: player.id,
            deck: registration?.deck ?? decks[0]?.deck ?? { main: [], extra: [], side: [] },
          })
        : null;

    return NextResponse.json({
      registration,
      rules,
      draft,
      deckNote: registration || decks.length > 0 ? deckNote : null,
      savedDeckOptions: decks.map((deck) => ({
        id: deck.id,
        name: deck.name,
        mode: deck.mode,
        draftId: deck.draftId ?? null,
        mainCount: deck.deck.main.length,
        extraCount: deck.deck.extra.length,
        sideCount: deck.deck.side.length,
      })),
    });
  } catch (error) {
    return serviceError(error);
  }
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await params;
    const caller = await loadCaller(slug);
    if (!caller.ok) return caller.response;
    const { db, tournament, player, userId } = caller;

    let body: { savedDeckId?: unknown };
    try {
      body = (await request.json()) as { savedDeckId?: unknown };
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const savedDeckId = body?.savedDeckId;
    if (typeof savedDeckId !== "number" || !Number.isInteger(savedDeckId) || savedDeckId < 1) {
      return NextResponse.json({ error: "savedDeckId is required" }, { status: 400 });
    }

    const tournamentDuels = createTournamentDuelService(db);
    const rules = tournamentDuels.rules(tournament.id);
    const existing = tournamentDuels.registration(tournament.id, player.id);
    if (existing?.lockedAt) {
      return NextResponse.json({ error: "Your deck is locked: your first tournament game started" }, { status: 409 });
    }

    const saved = createSavedDeckService(db).get(savedDeckId, tournament.guild_id, userId);
    if (rules.draftId !== null && saved.draftId !== rules.draftId) {
      return NextResponse.json({ error: "This tournament accepts only your draft deck" }, { status: 400 });
    }
    if (saved.mode !== rules.mode) {
      return NextResponse.json(
        { error: `This tournament uses ${rules.mode} mode decks; this deck is ${saved.mode}` },
        { status: 400 },
      );
    }

    const checked = await callDuelHost({
      op: "check-deck",
      guildId: tournament.guild_id,
      playerId: player.id,
      deck: saved.deck,
      mode: rules.mode,
      masterRule: rules.masterRule,
      settings: rules.settings,
      draftId: rules.draftId,
    });
    if (!checked.ok) return checked.response;
    const { deck, report } = checked.data as { deck?: DuelDeck; report?: DuelDeckValidation };
    if (!deck || !report || !Array.isArray(report.issues)) {
      return NextResponse.json({ error: "Invalid engine response" }, { status: 502 });
    }
    // Draft rules check the stored pool and forced-copy allowance as well as structure.
    if (report.issues.length > 0) {
      return NextResponse.json({ error: "This deck is not legal for the tournament.", report }, { status: 400 });
    }

    if (rules.draftId !== null) {
      const pool = await loadDraftPool({
        db,
        guildId: tournament.guild_id,
        playerId: player.id,
        draftId: rules.draftId,
        deckCodes: [...deck.main, ...deck.extra, ...deck.side, ...(deck.deckMaster === undefined ? [] : [deck.deckMaster])],
      });
      if (!pool.ok) return pool.response;
      const poolIssues = checkDeckAgainstPool(deck, pool.counts, (code) => pool.codeMap.get(code) ?? code, pool.forcedCopies);
      if (poolIssues.length > 0) {
        return NextResponse.json(
          { error: "This deck uses cards you did not draft.", poolIssues },
          { status: 400 },
        );
      }
      const sizeError = draftMainSizeError(deck.main.length, pool.mainPoolCount);
      if (sizeError) return NextResponse.json({ error: sizeError }, { status: 400 });
    }

    const registration = tournamentDuels.registerDeck({
      tournamentId: tournament.id,
      playerId: player.id,
      savedDeckId,
      deck,
    });
    void broadcaster.tournament({ kind: "match-updated", slug });
    return NextResponse.json({ registration });
  } catch (error) {
    return serviceError(error);
  }
}

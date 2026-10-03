import { NextResponse } from "next/server";
import { createDuelSeriesService } from "@yugidraft/shared/services";
import { announceDuelInvite } from "@/lib/announce-bot";
import { getDb } from "@/lib/db";
import { mapDraftTournamentDecks } from "@/lib/draft-deck-codes";
import { duelErrorResponse, requireDuelActor } from "@/lib/duel-host";
import { broadcaster } from "@/lib/notify";
import { notifyDuelChange } from "@/lib/notify-duel";
import { playerIdentity } from "@/lib/player-lookup";

export const runtime = "nodejs";

/** Starts (or returns) the online series of a bracket slot, and DMs the other player. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ slug: string; tmId: string }> },
) {
  const actor = await requireDuelActor();
  if (!actor.ok) return actor.response;
  const { slug, tmId } = await params;
  const tournamentMatchId = Number(tmId);

  try {
    const db = getDb();
    const tournament = db
      .prepare("select id, name from tournaments where web_slug = ? and guild_id = ?")
      .get(slug, actor.guildId) as
      | { id: number; name: string }
      | undefined;
    if (!tournament) return NextResponse.json({ error: "Tournament not found" }, { status: 404 });
    const slot = Number.isInteger(tournamentMatchId)
      ? (db
          .prepare("select tournament_id, player_one_id, player_two_id from tournament_matches where id = ?")
          .get(tournamentMatchId) as
          | { tournament_id: number; player_one_id: number; player_two_id: number | null }
          | undefined)
      : undefined;
    if (!slot || slot.tournament_id !== tournament.id) {
      return NextResponse.json({ error: "Match not found" }, { status: 404 });
    }

    const playerIds = [slot.player_one_id, slot.player_two_id];
    // A draft tournament's auto-registered decks hold catalog ids: map both seats' decks to engine
    // codes before the series copies and locks them. If that cannot be done, nothing is started.
    const mapped = await mapDraftTournamentDecks(db, { tournamentId: tournament.id, guildId: actor.guildId, playerIds });
    if (!mapped.ok) {
      return NextResponse.json(mapped.report ? { error: mapped.error, report: mapped.report } : { error: mapped.error }, {
        status: mapped.status,
      });
    }

    const { series, duel, created } = createDuelSeriesService(db).startTournamentMatch({
      guildId: actor.guildId,
      tournamentMatchId,
      actorPlayerId: actor.playerId,
    });

    await notifyDuelChange(duel.slug, actor.guildId);
    void broadcaster.tournament({ kind: "match-updated", slug });

    // An open series returned as-is was announced when it started.
    if (created) {
      const challenger = playerIdentity(db, actor.playerId);
      for (const playerId of series.playerIds) {
        if (playerId === actor.playerId) continue;
        const recipient = playerIdentity(db, playerId);
        if (!recipient) continue;
        announceDuelInvite(
          {
            slug: duel.slug,
            guildId: actor.guildId,
            opponentDiscordUserId: recipient.discordUserId,
            challengerName: challenger?.displayName ?? "The organizer",
            duelName: duel.name,
            bestOf: series.bestOf,
            ranked: series.ranked,
            tournamentName: tournament.name,
          },
          request,
        );
      }
    }

    return NextResponse.json({ series, duel, created }, { status: created ? 201 : 200 });
  } catch (error) {
    return duelErrorResponse(error);
  }
}

import { findTournamentDashboardSummaries } from "@yugidraft/shared/services";
import { env } from "@/lib/env";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { requireWebAccess } from "@/lib/web-access";

export const runtime = "nodejs";

export async function GET() {
  try {
    const actor = await requireWebAccess();
    if (!actor.ok) return actor.response;

    const userId = actor.userId;
    const db = getDb();

    // Find the player records for this application user in the configured guild
    const playerRows = db
      .prepare("select id, guild_id from players where user_id = ? and guild_id = ?")
      .all(userId, env.discordGuildId) as Array<{ id: number; guild_id: string }>;

    const playerIds = playerRows.map((r) => r.id);

    const tournaments = findTournamentDashboardSummaries(db, env.discordGuildId, userId);

    if (playerIds.length === 0) {
      return NextResponse.json({
        tournaments,
        drafts: [],
        stats: { wins: 0, losses: 0 },
      });
    }

    // Active/pending drafts the user is in
    const drafts = db
      .prepare(
        `
        select
          d.id,
          d.guild_id,
          d.name,
          d.status,
          d.web_slug,
          d.current_wave_number,
          d.current_pick_step,
          count(dp2.player_id) as player_count
        from drafts d
        inner join draft_players dp on dp.draft_id = d.id
        left join draft_players dp2 on dp2.draft_id = d.id
        where d.guild_id = ? and dp.player_id in (${playerIds.map(() => "?").join(",")})
          and d.status in ('pending', 'active')
        group by d.id
        order by case d.status when 'active' then 0 else 1 end, d.created_at desc, d.id desc
        limit 10
      `
      )
      .all(env.discordGuildId, ...playerIds)
      .map((row: any) => ({
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        status: row.status,
        webSlug: row.web_slug ?? undefined,
        currentPackRound: row.current_wave_number,
        currentPickStep: row.current_pick_step,
        playerCount: row.player_count,
      }));

    // Lifetime stats
    const statsRow = db
      .prepare(
        `
        select
          sum(case when winner_id in (${playerIds.map(() => "?").join(",")}) then 1 else 0 end) as wins,
          sum(case
            when (player_one_id in (${playerIds.map(() => "?").join(",")}) or player_two_id in (${playerIds.map(() => "?").join(",")}))
              and winner_id is not null
              and winner_id not in (${playerIds.map(() => "?").join(",")})
            then 1 else 0 end) as losses
        from matches
        where guild_id = ? and status = 'approved'
          and (player_one_id in (${playerIds.map(() => "?").join(",")}) or player_two_id in (${playerIds.map(() => "?").join(",")}))
      `
      )
      .get(
        ...playerIds,
        ...playerIds,
        ...playerIds,
        ...playerIds,
        env.discordGuildId,
        ...playerIds,
        ...playerIds
      ) as { wins: number | null; losses: number | null } | undefined;

    const stats = {
      wins: statsRow?.wins ?? 0,
      losses: statsRow?.losses ?? 0,
    };

    return NextResponse.json({ tournaments, drafts, stats });
  } catch (error) {
    console.error("[api/dashboard] error:", error);
    return NextResponse.json(
      { error: "Failed to load dashboard" },
      { status: 500 }
    );
  }
}

import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import Link from "next/link";
import { FloorList, SectionHead } from "@/components/sheet";
import { PageFrame } from "@/components/dashboard/page-frame";
import { loadTournamentRounds } from "@/components/dashboard/tournament-rounds";
import { DraftRow, TournamentRow, type DashboardDraft, type DashboardTournament } from "@/components/dashboard/dashboard-rows";
import { YourStanding, type StandingProfile } from "@/components/dashboard/your-standing";
import { WelcomePanel } from "@/components/dashboard/welcome-panel";
import { DashboardDate } from "@/components/dashboard/dashboard-date";
import styles from "@/components/dashboard/dashboard.module.css";
import { auth } from "@/lib/auth";
import { parseUserId } from "@/lib/user-id";
import { getDb } from "@/lib/db";
import { createScoringService } from "@yugidraft/shared/services";
import { rankForRating } from "@yugidraft/shared/scoring";
import { RejoinDraftBanner } from "@/components/draft/rejoin-draft";
import { findRejoinDrafts } from "@/lib/rejoin-drafts";

/** What a player with no rating row yet starts with. */
const STARTING_PROFILE: StandingProfile = { rating: 1000, rank: rankForRating(1000), winnings: 0, currentStreak: 0 };

interface Stats {
  wins: number;
  losses: number;
}

export default async function DashboardPage() {
  const session = await auth();
  const userId = parseUserId(session?.user?.id);
  if (userId === null) redirect("/login");

  const db = getDb();

  const playerRows = db
    .prepare("select id, guild_id from players where user_id = ? and guild_id = ?")
    .all(userId, env.discordGuildId) as Array<{ id: number; guild_id: string }>;
  const playerIds = playerRows.map((r) => r.id);

  let tournaments: DashboardTournament[] = [];
  let drafts: DashboardDraft[] = [];
  let stats: Stats = { wins: 0, losses: 0 };

  // Profile stats (winnings / rank / streak) — only if this user has a player row
  let profileData: StandingProfile | null = null;

  if (playerIds.length > 0) {
    // Use first player row (single-guild assumption on dashboard)
    const firstPlayer = playerRows[0];
    if (firstPlayer) {
      try {
        const scoring = createScoringService(db);
        const profile = scoring.getProfile(firstPlayer.guild_id, firstPlayer.id, "season");
        profileData = {
          rating: profile.rating,
          rank: profile.rank,
          winnings: profile.winnings,
          currentStreak: profile.currentStreak,
        };
      } catch {
        // No player_ratings row yet — leave nulls, show dashes
      }
    }

    const ph = playerIds.map(() => "?").join(",");

    tournaments = db
      .prepare(
        `select t.id, t.guild_id, t.name, t.format, t.status, t.web_slug,
           count(tp2.player_id) as participant_count
         from tournaments t
         inner join tournament_participants tp on tp.tournament_id = t.id
         left join tournament_participants tp2 on tp2.tournament_id = t.id
         where t.guild_id = ? and tp.player_id in (${ph}) and t.status in ('pending', 'active')
         group by t.id
         order by case t.status when 'active' then 0 else 1 end, t.created_at desc`
      )
      .all(env.discordGuildId, ...playerIds)
      .map((row: any) => ({
        id: row.id,
        guildId: row.guild_id,
        name: row.name,
        format: row.format,
        status: row.status,
        webSlug: row.web_slug ?? undefined,
        participantCount: row.participant_count,
      }));

    drafts = db
      .prepare(
        `select d.id, d.guild_id, d.name, d.status, d.web_slug,
           d.current_wave_number, d.current_pick_step,
           count(dp2.player_id) as player_count
         from drafts d
         inner join draft_players dp on dp.draft_id = d.id
         left join draft_players dp2 on dp2.draft_id = d.id
         where d.guild_id = ? and dp.player_id in (${ph}) and d.status in ('pending', 'active')
         group by d.id
         order by case d.status when 'active' then 0 else 1 end, d.created_at desc`
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

    const statsRow = db
      .prepare(
        `select
           sum(case when winner_id in (${ph}) then 1 else 0 end) as wins,
           sum(case
             when (player_one_id in (${ph}) or player_two_id in (${ph}))
               and winner_id is not null
               and winner_id not in (${ph})
             then 1 else 0 end) as losses
         from matches
         where guild_id = ? and status = 'approved'
           and (player_one_id in (${ph}) or player_two_id in (${ph}))`
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

    stats = { wins: statsRow?.wins ?? 0, losses: statsRow?.losses ?? 0 };
  }

  const hasPlayer = playerIds.length > 0;
  // A new player: no player row yet, or a row (the sidebar's first poll creates one) with nothing played or joined.
  const isNewPlayer = !hasPlayer || (tournaments.length === 0 && drafts.length === 0 && stats.wins + stats.losses === 0);
  const rounds = loadTournamentRounds(db, env.discordGuildId, tournaments);
  const viewerId = playerIds[0] ?? null;
  const rejoin = hasPlayer ? findRejoinDrafts(db, env.discordGuildId, userId) : [];

  return (
    <PageFrame title="Dashboard" sub={<DashboardDate />}>
      <RejoinDraftBanner drafts={rejoin} />
      {isNewPlayer ? (
        <WelcomePanel standing={<YourStanding profile={profileData ?? STARTING_PROFILE} record={stats} />} />
      ) : (
        <div className={styles.cols}>
          <section className={styles.tournaments} aria-labelledby="db-tournaments">
            <SectionHead
              title="Your tournaments"
              id="db-tournaments"
              action={
                <Link className="link" href="/tournaments">
                  All tournaments
                </Link>
              }
            />
            {tournaments.length === 0 ? (
              <p className={styles.none}>
                You&apos;re not in a tournament right now. <Link className="link" href="/tournaments">See what&apos;s open</Link>.
              </p>
            ) : (
              <FloorList aria-labelledby="db-tournaments">
                {tournaments.map((t) => (
                  <TournamentRow key={t.id} tournament={t} rounds={rounds.get(t.id)} viewerId={viewerId} />
                ))}
              </FloorList>
            )}
          </section>
          <YourStanding className={styles.standing} profile={profileData} record={stats} />
          <section className={styles.drafts} aria-labelledby="db-drafts">
            <SectionHead
              title="Your drafts"
              id="db-drafts"
              action={
                <Link className="link" href="/drafts">
                  All drafts
                </Link>
              }
            />
            {drafts.length === 0 ? (
              <p className={styles.none}>
                You&apos;re not in a draft right now. <Link className="link" href="/drafts">See what&apos;s open</Link>.
              </p>
            ) : (
              <FloorList aria-labelledby="db-drafts">
                {drafts.map((d) => (
                  <DraftRow key={d.id} draft={d} />
                ))}
              </FloorList>
            )}
          </section>
        </div>
      )}
    </PageFrame>
  );
}

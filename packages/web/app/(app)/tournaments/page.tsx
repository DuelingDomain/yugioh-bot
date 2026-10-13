import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SvButton } from "@/components/sheet";
import { PageFrame } from "@/components/dashboard/page-frame";
import { loadTournamentRounds } from "@/components/dashboard/tournament-rounds";
import { TournamentsList } from "@/components/tournament/tournaments-list";
import {
  groupTournaments,
  listSummaryParts,
  type TournamentListItem,
} from "@/components/tournament/tournaments-list-model";

export default async function TournamentsPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const db = getDb();
  const tournaments: TournamentListItem[] = db
    .prepare(
      `select t.id, t.guild_id, t.name, t.format, t.status, t.created_by_user_id,
              t.web_slug, count(tp.player_id) as participant_count
       from tournaments t
       left join tournament_participants tp on tp.tournament_id = t.id
       where t.guild_id = ? and t.status in ('pending', 'active', 'completed')
       group by t.id
       order by case t.status when 'active' then 0 when 'pending' then 1 else 2 end, t.created_at desc`
    )
    .all(env.discordGuildId)
    .map((row: any) => ({
      id: row.id,
      name: row.name,
      format: row.format,
      status: row.status,
      webSlug: row.web_slug ?? undefined,
      participantCount: row.participant_count,
      createdByUserId: row.created_by_user_id,
    }));

  const groups = groupTournaments(tournaments);
  const summary = listSummaryParts(groups);

  // Round strips and duel actions need the pairings of the tournaments still in play.
  const viewer = db
    .prepare("select id from players where discord_user_id = ? and guild_id = ?")
    .get(session.user.id, env.discordGuildId) as { id: number } | undefined;
  const viewerId = viewer?.id ?? null;
  const rounds = loadTournamentRounds(db, env.discordGuildId, [...groups.running, ...groups.open]);

  return (
    <PageFrame
      title="Tournaments"
      sub={summary.length > 0 ? summary.join(", ") : undefined}
      actions={
        <SvButton as="a" href="/tournaments/new" variant="primary">
          New tournament
        </SvButton>
      }
    >
      <TournamentsList initialItems={tournaments} rounds={rounds} viewerId={viewerId} viewerUserId={session.user.id} />
    </PageFrame>
  );
}

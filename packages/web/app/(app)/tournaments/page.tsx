import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseUserId } from "@/lib/user-id";
import { getDb } from "@/lib/db";
import { FloorList, SectionHead, SvButton } from "@/components/sheet";
import { PageFrame } from "@/components/dashboard/page-frame";
import { loadTournamentRounds } from "@/components/dashboard/tournament-rounds";
import styles from "./tournaments.module.css";
import { TournamentRow } from "@/components/tournament/tournament-row";
import { FinishedLedger } from "@/components/tournament/finished-ledger";
import {
  groupTournaments,
  listSummaryParts,
  type TournamentListItem,
} from "@/components/tournament/tournaments-list-model";

export default async function TournamentsPage() {
  const session = await auth();
  const userId = parseUserId(session?.user?.id);
  if (userId === null) redirect("/login");

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
    }));

  const groups = groupTournaments(tournaments);
  const summary = listSummaryParts(groups);

  // Round strips and duel actions need the pairings of the tournaments still in play.
  const viewer = db
    .prepare("select id from players where user_id = ? and guild_id = ?")
    .get(userId, env.discordGuildId) as { id: number } | undefined;
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
      {tournaments.length === 0 ? (
        <section aria-labelledby="tl-none">
          <SectionHead title="No tournaments yet" id="tl-none" />
          <p className={styles.lede}>
            Create one and it shows up on this page, ready to share by link.
          </p>
          <SvButton as="a" href="/tournaments/new" variant="primary">
            New tournament
          </SvButton>
        </section>
      ) : (
        <>
          {groups.running.length > 0 && (
            <section aria-labelledby="tl-run">
              <SectionHead title="In progress" id="tl-run" />
              <FloorList aria-labelledby="tl-run">
                {groups.running.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="running" rounds={rounds.get(t.id)} viewerId={viewerId} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.open.length > 0 && (
            <section aria-labelledby="tl-open">
              <SectionHead title="Open to join" id="tl-open" note="Nothing starts until the organizer presses Start." />
              <FloorList aria-labelledby="tl-open">
                {groups.open.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="open" rounds={rounds.get(t.id)} viewerId={viewerId} />
                ))}
              </FloorList>
            </section>
          )}
          {groups.finished.length > 0 && (
            <section aria-labelledby="tl-fin">
              <SectionHead title="Finished" id="tl-fin" note="Newest first" />
              <FinishedLedger items={groups.finished} />
            </section>
          )}
        </>
      )}
    </PageFrame>
  );
}

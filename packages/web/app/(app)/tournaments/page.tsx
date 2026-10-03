import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import Link from "next/link";
import { Plus, Trophy } from "lucide-react";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { SheetRoot } from "@/components/sheet";
import { MetaLine } from "@/components/meta-line/meta-line";
import { TournamentRow } from "@/components/tournament/tournament-row";
import { FinishedLedger } from "@/components/tournament/finished-ledger";
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
    }));

  const groups = groupTournaments(tournaments);
  const summary = listSummaryParts(groups);

  return (
    <SheetRoot>
      <header className="page-h sheet-head">
        <div>
          <h1 className="t-title">Tournaments</h1>
          {summary.length > 0 && (
            <MetaLine className="page-sub" items={summary.map((part) => ({ content: part }))} />
          )}
        </div>
        <Link className="btn btn-primary" href="/tournaments/new">
          <Plus className="ic" aria-hidden="true" />
          New tournament
        </Link>
      </header>

      {tournaments.length === 0 ? (
        <div className="empty">
          <Trophy className="ic" aria-hidden="true" />
          <h2>No tournaments yet</h2>
          <p>
            Create one here, or run <code className="cmd">/event create</code> in Discord. Either way it shows up on this
            page.
          </p>
          <div className="acts">
            <Link className="btn btn-primary" href="/tournaments/new">
              <Plus className="ic" aria-hidden="true" />
              New tournament
            </Link>
          </div>
        </div>
      ) : (
        <div className="tl">
          {groups.running.length > 0 && (
            <section aria-labelledby="tl-run">
              <div className="sec-h">
                <h2 className="sec-t" id="tl-run">
                  In progress
                </h2>
              </div>
              <div className="tl-list">
                {groups.running.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="running" />
                ))}
              </div>
            </section>
          )}
          {groups.open.length > 0 && (
            <section aria-labelledby="tl-open">
              <div className="sec-h">
                <h2 className="sec-t" id="tl-open">
                  Open to join
                </h2>
                <span className="sec-aux">Nothing starts until the organizer presses Start.</span>
              </div>
              <div className="tl-list">
                {groups.open.map((t) => (
                  <TournamentRow key={t.id} tournament={t} variant="open" />
                ))}
              </div>
            </section>
          )}
          {groups.finished.length > 0 && (
            <section aria-labelledby="tl-fin">
              <div className="sec-h">
                <h2 className="sec-t" id="tl-fin">
                  Finished
                </h2>
                <span className="sec-aux">Newest first</span>
              </div>
              <FinishedLedger items={groups.finished} />
            </section>
          )}
        </div>
      )}
    </SheetRoot>
  );
}

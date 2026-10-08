import { findTournamentListPage } from "@yugidraft/shared/services";
import { TournamentsList } from "@/components/tournament/tournaments-list";
import { env } from "@/lib/env";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { parseUserId } from "@/lib/user-id";
import { getDb } from "@/lib/db";
import { SvButton } from "@/components/sheet";
import { PageFrame } from "@/components/dashboard/page-frame";
import { loadTournamentRounds } from "@/components/dashboard/tournament-rounds";
import {
  groupTournaments,
  listSummaryParts,
} from "@/components/tournament/tournaments-list-model";

export default async function TournamentsPage() {
  const session = await auth();
  const userId = parseUserId(session?.user?.id);
  if (userId === null) redirect("/login");

  const db = getDb();
  const { items: tournaments, nextCursor } = findTournamentListPage(db, env.discordGuildId, userId);

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
        // With nothing to list, the empty state below holds the page's one primary button.
        <SvButton as="a" href="/tournaments/new" variant={tournaments.length === 0 ? "ghost" : "primary"}>
          New tournament
        </SvButton>
      }
    >
      <TournamentsList initialItems={tournaments} nextCursor={nextCursor} rounds={rounds} viewerId={viewerId} />
    </PageFrame>
  );
}

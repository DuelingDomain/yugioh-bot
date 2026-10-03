import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createScoringService, createSeasonService } from "@yugidraft/shared/services";
import { liveDuelSlugs } from "@/components/player/live-duels";
import { LeaderboardClient } from "./leaderboard-client";

export default async function LeaderboardPage() {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const db = getDb();
  const guildId = env.discordGuildId;

  // Resolve current player id (null if user has no player record in this guild)
  const playerRow = db
    .prepare("select id from players where discord_user_id = ? and guild_id = ?")
    .get(session.user.id, guildId) as { id: number } | undefined;
  const currentPlayerId = playerRow?.id ?? null;

  const scoring = createScoringService(db);
  const initialRows = scoring.getLeaderboard(guildId, "season");
  const season = createSeasonService(db).getActive(guildId);
  const activeSeason = season ? { number: season.number, name: season.name, startedAt: season.startedAt } : null;
  // SQLite current_timestamp has no zone suffix. Interpret it as UTC here so
  // the server and hydrated browser never disagree about the calendar date.
  const seasonStartedOn = season
    ? new Date(season.startedAt.replace(" ", "T") + "Z").toLocaleDateString("en-US", {
        weekday: "short", month: "short", day: "numeric", timeZone: "UTC",
      })
    : null;

  const liveDuels = liveDuelSlugs(db, guildId, currentPlayerId);

  return (
    <LeaderboardClient
      initialRows={initialRows}
      currentPlayerId={currentPlayerId}
      activeSeason={activeSeason}
      seasonStartedOn={seasonStartedOn}
      liveDuels={liveDuels}
    />
  );
}

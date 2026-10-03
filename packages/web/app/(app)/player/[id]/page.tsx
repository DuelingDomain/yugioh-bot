import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getDb } from "@/lib/db";
import { env } from "@/lib/env";
import { createScoringService, createSeasonService } from "@yugidraft/shared/services";
import { ProfileView } from "@/components/player/profile-view";
import { PageFrame } from "@/components/dashboard/page-frame";
import { liveDuelSlugs } from "@/components/player/live-duels";
import { Zone } from "@/components/sheet";
import styles from "@/components/player/profile.module.css";

function NotFound() {
  return (
    <PageFrame title="Player" back={{ href: "/leaderboard", label: "Leaderboard" }}>
      <div className={styles.missing}>
        <Zone state="dashed" />
        <div>
          <h2>Player not found.</h2>
          <p>That player is not in this server.</p>
        </div>
      </div>
    </PageFrame>
  );
}

export default async function PlayerProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const { id } = await params;
  const playerId = Number(id);
  if (!Number.isFinite(playerId) || playerId <= 0) return <NotFound />;

  const db = getDb();
  const guildId = env.discordGuildId;
  const scoring = createScoringService(db);

  const playerRow = db.prepare("select id from players where id = ? and guild_id = ?").get(playerId, guildId) as
    | { id: number }
    | undefined;
  if (!playerRow) return <NotFound />;

  const me = db
    .prepare("select id from players where discord_user_id = ? and guild_id = ?")
    .get(session.user.id, guildId) as { id: number } | undefined;
  const season = createSeasonService(db).getActive(guildId);
  const hasSeason = Boolean(season);

  const profile = scoring.getProfile(guildId, playerId, "season");
  const leaderboard = scoring.getLeaderboard(guildId, "season");
  const posIdx = leaderboard.findIndex((r) => r.playerId === playerId);
  const leaderboardRank = posIdx >= 0 ? posIdx + 1 : null;

  const liveDuel = liveDuelSlugs(db, guildId, me?.id ?? null)[playerId] ?? null;

  return (
    <ProfileView
      profile={profile}
      leaderboardRank={leaderboardRank}
      isMe={me?.id === playerId}
      hasSeason={hasSeason}
      seasonStartedAt={season?.startedAt ?? null}
      liveDuel={liveDuel}
    />
  );
}

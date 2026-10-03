"use client";

import { useState, type ReactNode } from "react";
import { Flame } from "lucide-react";
import { PageFrame } from "@/components/dashboard/page-frame";
import { SectionHead, Segmented } from "@/components/sheet";
import { getTierProgress } from "@/components/leaderboard/leaderboard-model";
import { ProfileAchievements } from "./profile-achievements";
import { ProfileHeader } from "./profile-header";
import { ProfileWinnings } from "./profile-winnings";
import { getEloGuide, parseStamp, winningsThisWeek, type AwardEntry, type Profile, type ProfileScope } from "./profile-model";
import styles from "./profile.module.css";

export interface ProfileViewProps {
  profile: Profile;
  leaderboardRank: number | null;
  /** True when you are looking at your own profile. */
  isMe?: boolean;
  /** False when no season is running: the API then only has all-time standings. */
  hasSeason?: boolean;
  seasonStartedAt?: string | null;
  /** Slug of the duel this player is in right now. */
  liveDuel?: string | null;
}

function Signed({ n }: { n: number }) {
  return <span className={n < 0 ? styles.lossNum : styles.gain}>{n < 0 ? `−${Math.abs(n)}` : `+${n}`}</span>;
}

function Stat({ label, aside, children, sub, delta }: {
  label: string;
  aside?: ReactNode;
  children: ReactNode;
  sub?: ReactNode;
  delta?: ReactNode;
}) {
  return (
    <div className={styles.stat}>
      <dt>{label}{aside != null && aside !== false && <small>{aside}</small>}</dt>
      <dd><b>{children}</b>{delta}</dd>
      {sub != null && sub !== false && <p className={styles.statSub}>{sub}</p>}
    </div>
  );
}

export function ProfileView({
  profile: initialProfile, leaderboardRank: initialRank, isMe = false, hasSeason = true, seasonStartedAt = null, liveDuel = null,
}: ProfileViewProps) {
  const [scope, setScope] = useState<ProfileScope>(hasSeason ? "season" : "all");
  const [profile, setProfile] = useState<Profile>(initialProfile);
  const [rank, setRank] = useState<number | null>(initialRank);
  const [loading, setLoading] = useState(false);

  const handleScopeChange = async (next: ProfileScope) => {
    if (next === scope) return;
    setScope(next);
    setLoading(true);
    try {
      const [profileRes, lbRes] = await Promise.all([
        fetch(`/api/player/${profile.playerId}?scope=${next}`),
        fetch(`/api/leaderboard?scope=${next}`),
      ]);
      if (profileRes.ok) {
        setProfile(await profileRes.json());
      }
      if (lbRes.ok) {
        const lbData = await lbRes.json();
        const rows: Array<{ playerId: number }> = lbData.rows ?? [];
        const pos = rows.findIndex((r) => r.playerId === profile.playerId);
        setRank(pos >= 0 ? pos + 1 : null);
      }
    } finally {
      setLoading(false);
    }
  };

  const season = scope === "season";
  const total = profile.wins + profile.losses;
  const winRate = total > 0 ? Math.round((profile.wins / total) * 100) : 0;
  const recent = profile.recent as AwardEntry[];
  const week = season && seasonStartedAt
    ? winningsThisWeek(recent.filter((entry) => parseStamp(entry.created_at).getTime() >= parseStamp(seasonStartedAt).getTime()))
    : null;
  const tier = getTierProgress(profile.rating);
  const placeLabel = rank !== null
    ? `#${rank} ${season ? "this season" : "all-time"}`
    : season ? "not placed this season" : "not placed";
  // A player who is not on the season board has no season standing yet. The
  // profile API then reports career winnings, which would read as this season's.
  const seasonWinnings = rank === null ? 0 : profile.winnings;
  const shortOfHighRoller = 1000 - profile.careerWinnings;
  const nearHighRoller = shortOfHighRoller > 0 && profile.careerWinnings / 1000 >= 0.9;

  return (
    <PageFrame
      title={profile.displayName}
      sub={isMe ? "Your profile" : "Player profile"}
      back={{ href: "/leaderboard", label: "Leaderboard" }}
      actions={
        hasSeason ? (
          <Segmented
            label="Profile scope"
            value={scope}
            disabled={loading}
            onChange={handleScopeChange}
            options={[
              { value: "season", label: "This season" },
              { value: "all", label: "All-time" },
            ]}
          />
        ) : undefined
      }
    >
      <ProfileHeader
        playerId={profile.playerId}
        displayName={profile.displayName}
        isMe={isMe}
        rating={profile.rating}
        placeLabel={placeLabel}
        liveDuel={liveDuel}
      />

      <div className={styles.busy} aria-busy={loading}>
        {season ? (
          <dl className={styles.stats} data-n="4" aria-label="Season numbers">
            <Stat
              label="Winnings"
              aside={rank !== null ? `#${rank} this season` : undefined}
              delta={week !== null && week > 0 ? <span className={styles.delta}>+{week}</span> : undefined}
              sub={week !== null && week > 0 ? "this week" : undefined}
            >
              {seasonWinnings.toLocaleString()}
            </Stat>
            <Stat label="Record" aside="this season" sub={total > 0 && rank !== null ? `${winRate}% won` : "No matches yet"}>
              {rank === null ? 0 : profile.wins}<small>–{rank === null ? 0 : profile.losses}</small>
            </Stat>
            <Stat label="Streak" sub={`best ${rank === null ? 0 : profile.bestStreak} this season`}>
              <Flame className={styles.flame} aria-hidden />{rank === null ? 0 : profile.currentStreak}
            </Stat>
            <Stat
              label="Career"
              aside="every season"
              sub={nearHighRoller ? `${shortOfHighRoller.toLocaleString()} short of High Roller` : "winnings"}
            >
              {profile.careerWinnings.toLocaleString()}
            </Stat>
          </dl>
        ) : (
          <div className={styles.allTime}>
            <dl className={styles.stats} data-n="2" aria-label="Career numbers">
              <Stat label="Career winnings" aside={rank !== null ? `#${rank} all-time` : undefined}>
                {profile.careerWinnings.toLocaleString()}
              </Stat>
              <Stat label="Elo" aside={tier.tier}>{profile.rating}</Stat>
            </dl>
            <p className={styles.note}>
              {hasSeason
                ? "Record and streak are kept per season. Switch back to This season to see them."
                : "Record and streak are kept per season. They show here while a season is running."}
            </p>
          </div>
        )}
      </div>

      <div className={styles.layout}>
        <div className={styles.main}>
          <ProfileAchievements
            playerId={profile.playerId}
            isMe={isMe}
            achievements={profile.achievements}
            careerWinnings={profile.careerWinnings}
          />
          <ProfileWinnings recent={recent} />
        </div>

        <aside className={styles.rail} aria-label="How Elo moves">
          <SectionHead as="h3" title="How Elo moves" note="Per rated match" className={styles.railHead} />
          <p className={styles.railText}>
            Every rated match moves Elo, win or lose. Beating a stronger player moves it most. Your tier changes the moment your Elo crosses a line.
          </p>
          <table className="howto">
            <thead><tr><th scope="col">Opponent</th><th scope="col">Win</th><th scope="col">Loss</th></tr></thead>
            <tbody>
              {getEloGuide().map(({ label, win, loss }) => (
                <tr key={label}>
                  <td>{label}</td>
                  <td><Signed n={win} /></td>
                  <td><Signed n={loss} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </aside>
      </div>
    </PageFrame>
  );
}

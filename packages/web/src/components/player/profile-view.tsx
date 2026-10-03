"use client";

import { useState } from "react";
import { Flame } from "lucide-react";
import { SheetPanel, SheetRoot, TierName } from "@/components/sheet";
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
}

function Signed({ n }: { n: number }) {
  return <span className={`lp-d ${n < 0 ? "down" : "up"}`}>{n < 0 ? `−${Math.abs(n)}` : `+${n}`}</span>;
}

export function ProfileView({ profile: initialProfile, leaderboardRank: initialRank, isMe = false, hasSeason = true, seasonStartedAt = null }: ProfileViewProps) {
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
    <SheetRoot>
      <div className="pf">
        <ProfileHeader
          playerId={profile.playerId}
          displayName={profile.displayName}
          isMe={isMe}
          rating={profile.rating}
          placeLabel={placeLabel}
          scope={scope}
          onScopeChange={handleScopeChange}
          hasSeason={hasSeason}
          loading={loading}
        />

        <div className={styles.busy} aria-busy={loading}>
          {season ? (
            <div className="lps pf-lps" style={{ "--n": 4 } as React.CSSProperties}>
              <div className="lp">
                <p className="lp-k">Winnings{rank !== null && <small>#{rank} this season</small>}</p>
                <p className="lp-v">
                  <b>{seasonWinnings.toLocaleString()}</b>
                  {week !== null && week > 0 && <span className="lp-d up">+{week}</span>}
                </p>
                {week !== null && week > 0 && <p className="lp-s">this week</p>}
              </div>
              <div className="lp">
                <p className="lp-k">Record<small>this season</small></p>
                <p className="lp-v"><b>{rank === null ? 0 : profile.wins}<small>–{rank === null ? 0 : profile.losses}</small></b></p>
                <p className="lp-s">{total > 0 && rank !== null ? `${winRate}% won` : "No matches yet"}</p>
              </div>
              <div className="lp" data-tone="streak">
                <p className="lp-k">Streak</p>
                <p className="lp-v"><b><Flame className="ic" aria-hidden />{rank === null ? 0 : profile.currentStreak}</b></p>
                <p className="lp-s">best {rank === null ? 0 : profile.bestStreak} this season</p>
              </div>
              <div className="lp">
                <p className="lp-k">Career<small>every season</small></p>
                <p className="lp-v"><b>{profile.careerWinnings.toLocaleString()}</b></p>
                <p className="lp-s">{nearHighRoller ? `${shortOfHighRoller.toLocaleString()} short of High Roller` : "winnings"}</p>
              </div>
            </div>
          ) : (
            <div style={{ display: "grid", gap: 14 }}>
              <div className="lps" style={{ "--n": 2 } as React.CSSProperties}>
                <div className="lp">
                  <p className="lp-k">Career winnings{rank !== null && <small>#{rank} all-time</small>}</p>
                  <p className="lp-v"><b>{profile.careerWinnings.toLocaleString()}</b></p>
                </div>
                <div className="lp" data-tone="tier" style={{ "--tier": `var(--t-${tier.tier === "Platinum" ? "plat" : tier.tier === "Diamond" ? "dia" : tier.tier.toLowerCase()})` } as React.CSSProperties}>
                  <p className="lp-k">Elo<small>{tier.tier}</small></p>
                  <p className="lp-v"><b>{profile.rating}</b></p>
                </div>
              </div>
              <p className="small">
                {hasSeason
                  ? "Record and streak are kept per season. Switch back to This season to see them."
                  : "Record and streak are kept per season. They show here while a season is running."}
              </p>
            </div>
          )}
        </div>

        <div className="pf-grid">
          <div className="stack">
            <ProfileAchievements
              playerId={profile.playerId}
              isMe={isMe}
              achievements={profile.achievements}
              careerWinnings={profile.careerWinnings}
            />
            <ProfileWinnings recent={recent} />
          </div>

          <aside className="stack" style={{ gap: 18 }} aria-label="How Elo moves">
            <SheetPanel title="How Elo moves" aside="per rated match">
              <div className={styles.stakes}>
                <p className="small">
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
              </div>
            </SheetPanel>
          </aside>
        </div>
      </div>
    </SheetRoot>
  );
}

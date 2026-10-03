import Link from "next/link";
import { Flame } from "lucide-react";
import { SectionHead, TierName } from "@/components/sheet";
import { TierLine } from "@/components/rank/tier-line";
import { tierProgress, winRatePercent } from "./dashboard-model";
import styles from "./dashboard.module.css";

export type StandingProfile = {
  rating: number;
  rank: { name: string; min: number; nextAt: number | null };
  winnings: number;
  currentStreak: number;
};

/** Big numbers on the floor: tier and Elo, a thin tier line, then winnings, record and streak. */
export function YourStanding({
  profile,
  record,
  className,
}: {
  profile: StandingProfile | null;
  record: { wins: number; losses: number };
  className?: string;
}) {
  const progress = profile ? tierProgress(profile.rating, profile.rank) : null;
  const streak = profile?.currentStreak ?? 0;

  return (
    <section className={className} aria-labelledby="db-standing">
      <SectionHead
        title="Your standing"
        id="db-standing"
        action={
          <Link className="link" href="/leaderboard">
            Leaderboard
          </Link>
        }
      />
      <div className={styles.stand}>
        {profile && progress && (
          <div>
            <div className={styles.top}>
              <span className={styles.tierWord}>
                <TierName tier={profile.rank.name} />
              </span>
              <b className={styles.elo}>{profile.rating}</b>
              <span className={styles.toNext}>
                {progress.nextTier ? `${progress.toNext} to ${progress.nextTier}` : "Top tier"}
              </span>
            </div>
            <TierLine
              tier={profile.rank.name}
              value={progress.fraction}
              label={
                progress.span != null
                  ? `${progress.into} of ${progress.span} Elo through ${progress.tier}`
                  : `${progress.tier}, the top tier`
              }
            />
          </div>
        )}
        <dl className={styles.nums}>
          <div>
            <dt>Winnings</dt>
            <dd>{profile ? profile.winnings : "—"}</dd>
            <span className={styles.sub}>this season</span>
          </div>
          <div>
            <dt>Record</dt>
            <dd>
              {record.wins}
              <small>–{record.losses}</small>
            </dd>
            <span className={styles.sub}>{winRatePercent(record.wins, record.losses)}% won</span>
          </div>
          <div>
            <dt>Streak</dt>
            <dd>
              {streak > 0 && <Flame className={styles.flame} aria-hidden="true" />}
              {streak > 0 ? streak : "—"}
            </dd>
            <span className={styles.sub}>this season</span>
          </div>
        </dl>
      </div>
    </section>
  );
}

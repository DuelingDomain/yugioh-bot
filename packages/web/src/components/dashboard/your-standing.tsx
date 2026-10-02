import Link from "next/link";
import { Flame } from "lucide-react";
import { LpTally, TierMeter, TierName, type LpTallyItem } from "@/components/sheet";
import { tierProgress, winRatePercent } from "./dashboard-model";
import styles from "./dashboard.module.css";

export type StandingProfile = {
  rating: number;
  rank: { name: string; min: number; nextAt: number | null };
  winnings: number;
  currentStreak: number;
};

export function YourStanding({
  profile,
  record,
}: {
  profile: StandingProfile | null;
  record: { wins: number; losses: number };
}) {
  const items: LpTallyItem[] = [];
  const className = "db-lps";

  if (profile) {
    const p = tierProgress(profile.rating, profile.rank);
    items.push({
      key: "elo",
      tone: "tier",
      tier: profile.rank.name,
      label: <TierName tier={profile.rank.name} />,
      aside: p.nextTier ? `${p.toNext} to ${p.nextTier}` : "Top tier",
      value: profile.rating,
      sub: (
        <TierMeter
          tier={profile.rank.name}
          value={p.fraction}
          className={styles.meterBlock}
          label={
            p.span != null
              ? `${p.into} of ${p.span} Elo through ${p.tier}`
              : `${p.tier}, the top tier`
          }
        />
      ),
    });
  }

  items.push({
    key: "winnings",
    label: "Winnings",
    value: profile ? profile.winnings : "—",
    sub: "this season",
  });
  items.push({
    key: "record",
    label: "Record",
    value: record.wins,
    unit: `–${record.losses}`,
    sub: `${winRatePercent(record.wins, record.losses)}% won, all matches`,
  });
  const streak = profile?.currentStreak ?? null;
  items.push({
    key: "streak",
    label: "Streak",
    value:
      streak != null && streak > 0 ? (
        <span className={styles.flame}>
          <Flame className="ic" aria-hidden="true" />
          {streak}
        </span>
      ) : (
        "—"
      ),
    sub: "this season",
  });

  return (
    <section className="db-stand msheet" aria-labelledby="db-standing">
      <header className="sheet-cap">
        <h2 id="db-standing">Your standing</h2>
        <small>
          <Link className="link" href="/leaderboard">Leaderboard</Link>
        </small>
      </header>
      <LpTally items={items} className={className} />
    </section>
  );
}
